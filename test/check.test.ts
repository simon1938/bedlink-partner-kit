// check.mjs against a fake project: a local "Next" webhook route (the real
// template behind a plain HTTP server), the fake BedLink API, PGlite.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { newState, startMock, TEST_KEY } from "./mock-bedlink.ts";

const SKILL = fileURLToPath(new URL("../plugins/bedlink-partner/skills/bedlink-integration/", import.meta.url));
const T = join(SKILL, "templates");
const SECRET = "whsec_local_" + "k".repeat(32);

let project: string;
let pg: PGlite;
let mock: Awaited<ReturnType<typeof startMock>>;
let route: ReturnType<typeof createServer>;
let routeUrl: string;

// Async on purpose: the fake API and the route live in this process.
function runCheck(extraEnv: Record<string, string> = {}) {
  return new Promise<{ code: number; report: { failed: number; results: { status: string; label: string; detail: string }[] } }>((resolve) => {
    execFile(
      process.execPath,
      [join(SKILL, "scripts/check.mjs"), "--dir", project, "--url", routeUrl, "--json"],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...extraEnv } },
      (err, stdout) => resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, report: JSON.parse(stdout) }),
    );
  });
}

before(async () => {
  project = mkdtempSync(join(tmpdir(), "bedlink-check-"));
  cpSync(join(T, "lib"), join(project, "src/lib"), { recursive: true });
  cpSync(join(T, "app"), join(project, "src/app"), { recursive: true });
  cpSync(join(T, "components"), join(project, "src/components"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "fake", dependencies: { next: "16.0.0", "@neondatabase/serverless": "^1" } }));
  writeFileSync(join(project, "vercel.json"), readFileSync(join(T, "vercel/vercel.json")));
  writeFileSync(join(project, ".gitignore"), "node_modules\n.env*.local\n");
  mock = await startMock(newState());
  writeFileSync(
    join(project, ".env.local"),
    `BEDLINK_API_KEY=${TEST_KEY}\nBEDLINK_WEBHOOK_SECRET=${SECRET}\nCRON_SECRET=${"c".repeat(40)}\nBEDLINK_FEATURES=\nBEDLINK_API_URL=${mock.url}\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: project });
  execFileSync("git", ["add", "."], { cwd: project });

  // The webhook route, served the way Next would call it.
  pg = new PGlite();
  await pg.exec(readFileSync(join(T, "schema/bedlink.sql"), "utf8"));
  process.env.BEDLINK_API_KEY = TEST_KEY;
  process.env.BEDLINK_API_URL = mock.url;
  process.env.BEDLINK_WEBHOOK_SECRET = SECRET;
  const db = { query: async <R>(text: string, params: unknown[] = []) => (await pg.query<R>(text, params)).rows };
  const { createStore } = await import(join(T, "lib/bedlink/store.ts"));
  const { createSync } = await import(join(T, "lib/bedlink/sync.ts"));
  const { receiveWebhook } = await import(join(T, "lib/bedlink/webhook.ts"));
  const store = createStore(db);
  const sync = createSync(store);
  route = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const out = await receiveWebhook(new Request(`http://localhost${req.url}`, { method: "POST", headers, body }), { store, sync });
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body));
  });
  await new Promise<void>((r) => route.listen(0, r));
  routeUrl = `http://localhost:${(route.address() as AddressInfo).port}`;
});

after(async () => {
  route.close();
  mock.server.close();
  await pg.close();
});

describe("check.mjs", () => {
  it("passes on a clean installation", async () => {
    const { code, report } = await runCheck();
    const failures = report.results.filter((r) => r.status === "ECHEC");
    assert.deepEqual(failures, []);
    assert.equal(code, 0);
    const labels = report.results.map((r) => r.label);
    for (const l of ["Événement signé accepté", "Mauvaise signature refusée", "Horodatage de plus de 5 minutes refusé", "Corps modifié après signature refusé", "GET /properties", "GET calendrier 7 jours"]) {
      assert.ok(labels.includes(l), `missing: ${l}`);
    }
    assert.ok(report.results.some((r) => r.label.startsWith("Rejeu du même événement : reconnu")));
    // never prints a secret
    assert.ok(!JSON.stringify(report).includes(TEST_KEY));
    assert.ok(!JSON.stringify(report).includes(SECRET));
  });

  it("fails on exposed or committed secrets and client imports", async () => {
    writeFileSync(join(project, "src/leak.ts"), `export const k = "${TEST_KEY}";\nexport const u = process.env.NEXT_PUBLIC_BEDLINK_API_KEY;\n`);
    writeFileSync(join(project, "src/components/Bad.tsx"), `"use client";\nimport { bedlink } from "@/lib/bedlink/client";\nexport default function B() { return null; }\n`);
    execFileSync("git", ["add", "."], { cwd: project });
    const { code, report } = await runCheck();
    assert.equal(code, 1);
    const failed = report.results.filter((r) => r.status === "ECHEC").map((r) => r.label);
    assert.ok(failed.includes("Variable BedLink exposée au navigateur (NEXT_PUBLIC_)"));
    assert.ok(failed.includes("Secret écrit en clair dans un fichier versionné"));
    assert.ok(failed.includes("Code serveur BedLink importé dans un composant client"));
    assert.ok(!JSON.stringify(report).includes(TEST_KEY));
  });
});
