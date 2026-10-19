#!/usr/bin/env node
// Détecte la stack du projet et l'imprime en JSON (lecture seule).
//   node detect-stack.mjs [--dir .]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const i = process.argv.indexOf("--dir");
const DIR = resolve(i > 0 ? process.argv[i + 1] : process.cwd());
const read = (p) => (existsSync(join(DIR, p)) ? readFileSync(join(DIR, p), "utf8") : null);
const json = (p) => {
  try {
    return JSON.parse(read(p) ?? "null");
  } catch {
    return null;
  }
};

const pkg = json("package.json") ?? {};
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const has = (n) => Boolean(deps[n]);
const srcDir = existsSync(join(DIR, "src", "app")) || existsSync(join(DIR, "src", "pages"));
const base = srcDir ? "src" : ".";
const appRouter = existsSync(join(DIR, base, "app"));

// tsconfig may contain comments: strip them before parsing.
let alias = null;
const tsRaw = read("tsconfig.json");
if (tsRaw) {
  try {
    const ts = JSON.parse(tsRaw.replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1"));
    const paths = ts.compilerOptions?.paths ?? {};
    const k = Object.keys(paths).find((x) => x.endsWith("/*"));
    if (k) alias = { prefix: k.slice(0, -1), target: paths[k][0]?.replace(/\*$/, "") };
  } catch {}
}

const prismaSchema = ["prisma/schema.prisma", "schema.prisma"].find((p) => existsSync(join(DIR, p))) ??
  (existsSync(join(DIR, "prisma")) ? readdirSync(join(DIR, "prisma")).filter((f) => f.endsWith(".prisma")).map((f) => `prisma/${f}`)[0] : undefined) ?? null;
const drizzleConfig = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"].find((p) => existsSync(join(DIR, p))) ?? null;
let drizzleSchema = null;
if (drizzleConfig) {
  const m = read(drizzleConfig)?.match(/schema\s*:\s*["'`]([^"'`]+)["'`]/);
  drizzleSchema = m?.[1] ?? null;
}
let prismaClientPath = null;
for (const p of ["lib/prisma.ts", "lib/db.ts", "server/db.ts", "lib/prisma/index.ts"]) {
  const full = join(base, p);
  if (existsSync(join(DIR, full)) && /PrismaClient/.test(read(full) ?? "")) prismaClientPath = full;
}

const orm = has("drizzle-orm") ? "drizzle" : has("@prisma/client") || has("prisma") ? "prisma" : "sql";
const driver = has("@neondatabase/serverless") ? "neon" : has("pg") ? "pg" : has("postgres") ? "postgres-js" : null;
const vercelConfig = ["vercel.ts", "vercel.mts", "vercel.js"].find((p) => existsSync(join(DIR, p))) ?? (existsSync(join(DIR, "vercel.json")) ? "vercel.json" : null);
const pm = existsSync(join(DIR, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(DIR, "yarn.lock")) ? "yarn" : existsSync(join(DIR, "bun.lockb")) || existsSync(join(DIR, "bun.lock")) ? "bun" : "npm";
const gitignore = read(".gitignore") ?? "";

console.log(
  JSON.stringify(
    {
      dir: DIR,
      next: deps.next ?? null,
      react: deps.react ?? null,
      typescript: has("typescript") || existsSync(join(DIR, "tsconfig.json")),
      appRouter,
      srcDir,
      codeRoot: base,
      alias,
      orm,
      driver,
      prismaSchema,
      prismaClientPath,
      drizzleConfig,
      drizzleSchema,
      vercelConfig,
      vercelLinked: existsSync(join(DIR, ".vercel", "project.json")),
      packageManager: pm,
      hasTsx: has("tsx"),
      hasServerOnly: has("server-only"),
      envFiles: [".env", ".env.local", ".env.development.local", ".env.example"].filter((f) => existsSync(join(DIR, f))),
      gitignoreCoversEnvLocal: /(^|\n)\s*\.env\*?(\.local)?\s*(\n|$)|\.env\*\.local|\.env\.local/.test(gitignore),
      existing: {
        bedlinkLib: existsSync(join(DIR, base, "lib", "bedlink")),
        webhookRoute: existsSync(join(DIR, base, "app", "api", "bedlink", "webhook", "route.ts")),
      },
    },
    null,
    2,
  ),
);
