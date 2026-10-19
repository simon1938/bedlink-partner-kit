#!/usr/bin/env node
// Vérification de l'intégration BedLink dans un projet Next.js.
//
//   node check.mjs [--dir .] [--url http://localhost:3000] [--offline] [--json]
//
// Ce que le script fait :
//   1. variables d'environnement présentes et bien formées ;
//   2. secrets non exposés (pas de NEXT_PUBLIC_, rien dans git, rien côté navigateur) ;
//   3. fichiers de l'intégration en place (client, webhook, cron) ;
//   4. tables en base (lecture seule, si DATABASE_URL et un pilote sont là) ;
//   5. route webhook : faux événement « ping » signé localement, puis mauvaise
//      signature, horodatage trop vieux, rejeu (le serveur local doit tourner) ;
//   6. appels de LECTURE sur l'API BedLink (GET /properties, un calendrier de
//      7 jours). Ils apparaissent dans votre journal BedLink. --offline les saute.
//
// Aucun secret n'est affiché. Aucune écriture chez BedLink. Sans dépendance.

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── Arguments ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const DIR = resolve(opt("--dir", process.cwd()));
const OFFLINE = args.includes("--offline");
const JSON_OUT = args.includes("--json");
const LOCAL_URL = opt("--url", "http://localhost:3000").replace(/\/$/, "");

const KEY_RE = /^blp_(test|live)_[A-Za-z0-9_-]{43}$/;
const KEY_IN_TEXT = /blp_(test|live)_[A-Za-z0-9_-]{43}/;
const WHSEC_IN_TEXT = /whsec_[A-Za-z0-9_-]{16,}/;
const FEATURES = ["calendar_366", "changes", "webhooks", "reservations_list", "messages", "payments"];
const TABLES = [
  "bedlink_properties",
  "bedlink_calendar_days",
  "bedlink_sync_state",
  "bedlink_webhook_events",
  "bedlink_checkouts",
  "bedlink_reservations",
  "bedlink_messages",
];
const SERVER_ONLY_MODULES = ["config", "client", "store", "sync", "booking", "webhook", "messages", "db/"];

// ── Rapport ────────────────────────────────────────────────────────────────
const results = [];
let section = "";
const add = (status, label, detail = "") => results.push({ section, status, label, detail });
const ok = (l, d) => add("OK", l, d);
const fail = (l, d) => add("ECHEC", l, d);
const warn = (l, d) => add("ATTENTION", l, d);
const skip = (l, d) => add("IGNORE", l, d);

// ── Environnement : process.env + fichiers .env du projet ──────────────────
function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}
const ENV_FILES = [".env", ".env.development", ".env.local", ".env.development.local"];
const fileEnv = {};
for (const f of ENV_FILES) Object.assign(fileEnv, parseEnvFile(join(DIR, f)));
const env = { ...fileEnv, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("BEDLINK_") || ["CRON_SECRET", "DATABASE_URL"].includes(k))) };

// ── Fichiers du projet ─────────────────────────────────────────────────────
const IGNORED_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", "dist", "build", "out", "coverage", ".turbo"]);
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (s.size < 2_000_000) acc.push(p);
  }
  return acc;
}
function git(argsList) {
  try {
    return execFileSync("git", argsList, { cwd: DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
const isGit = git(["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
const allFiles = walk(DIR);
const trackedFiles = isGit
  ? (git(["ls-files", "-z"]) ?? "").split("\0").filter(Boolean).map((f) => join(DIR, f))
  : allFiles;
const codeFiles = allFiles.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
const srcRoot = existsSync(join(DIR, "src", "app")) || existsSync(join(DIR, "src", "lib")) ? join(DIR, "src") : DIR;
const rel = (p) => relative(DIR, p) || ".";

// ═══ 1. Variables ════════════════════════════════════════════════════════
section = "Variables d'environnement";
const key = env.BEDLINK_API_KEY?.trim() ?? "";
if (!key) fail("BEDLINK_API_KEY absente", "à coller dans .env.local et dans Vercel (serveur)");
else if (!KEY_RE.test(key)) fail("BEDLINK_API_KEY mal formée", "attendu blp_test_… ou blp_live_… (43 caractères après le préfixe)");
else ok("BEDLINK_API_KEY présente", key.startsWith("blp_live_") ? "clé de production" : "clé sandbox");

const secrets = (env.BEDLINK_WEBHOOK_SECRET ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!secrets.length) fail("BEDLINK_WEBHOOK_SECRET absente", "secret BedLink (whsec_…) ou secret local en attendant");
else if (secrets.some((s) => s.length < 24)) fail("BEDLINK_WEBHOOK_SECRET trop court", "24 caractères minimum");
else ok("BEDLINK_WEBHOOK_SECRET présente", secrets.length > 1 ? `${secrets.length} secrets (rotation)` : "");

const cron = env.CRON_SECRET ?? "";
if (!cron) fail("CRON_SECRET absente", "Vercel l'envoie au cron ; sans elle la route refuse tout");
else if (cron.length < 16) fail("CRON_SECRET trop courte", "16 caractères minimum, 32 conseillés");
else ok("CRON_SECRET présente");

if (!env.DATABASE_URL) warn("DATABASE_URL absente des fichiers .env", "la vérification du schéma sera sautée");
else ok("DATABASE_URL présente");

const features = (env.BEDLINK_FEATURES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const unknownFeatures = features.filter((f) => !FEATURES.includes(f));
if (unknownFeatures.length) fail("BEDLINK_FEATURES contient des noms inconnus", unknownFeatures.join(", "));
else ok("BEDLINK_FEATURES valide", features.length ? features.join(", ") : "vide (fonctions sandbox d'aujourd'hui)");

if (env.BEDLINK_API_URL && !/^https:\/\//.test(env.BEDLINK_API_URL) && !env.BEDLINK_API_URL.startsWith("http://localhost"))
  fail("BEDLINK_API_URL doit être en https");

// ═══ 2. Secrets non exposés ══════════════════════════════════════════════
section = "Secrets non exposés";
const publicNames = new Set();
for (const [k] of Object.entries(fileEnv)) if (/^NEXT_PUBLIC_.*(BEDLINK|CRON_SECRET)/.test(k)) publicNames.add(k);
for (const f of codeFiles) {
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(?:BEDLINK|CRON_SECRET)[A-Z0-9_]*/g)) publicNames.add(`${m[0]} (${rel(f)})`);
}
if (publicNames.size) fail("Variable BedLink exposée au navigateur (NEXT_PUBLIC_)", [...publicNames].join(", "));
else ok("Aucune variable BedLink en NEXT_PUBLIC_");

if (isGit) {
  const trackedEnv = trackedFiles.map(rel).filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.example$|\.sample$|\.template$/.test(f));
  if (trackedEnv.length) fail("Fichier .env suivi par git", trackedEnv.join(", "));
  else ok("Aucun fichier .env suivi par git");
  const ignored = git(["check-ignore", "-q", ".env.local"]) !== null;
  if (!ignored) fail(".env.local n'est pas dans .gitignore", "ajouter .env*.local");
  else ok(".env.local ignoré par git");
} else warn("Pas de dépôt git détecté", "vérifications git sautées");

const leaks = [];
for (const f of trackedFiles) {
  if (!existsSync(f) || statSync(f).size > 2_000_000) continue;
  const name = rel(f);
  if (/(^|\/)\.env(\.|$)/.test(name) && !/\.example$/.test(name)) continue; // already reported above
  let t;
  try {
    t = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  if (KEY_IN_TEXT.test(t) || WHSEC_IN_TEXT.test(t) || (key && t.includes(key)) || secrets.some((s) => s && t.includes(s)) || (cron.length >= 16 && t.includes(cron)))
    leaks.push(name);
}
if (leaks.length) fail("Secret écrit en clair dans un fichier versionné", leaks.join(", ") + " (valeur non affichée)");
else ok("Aucun secret en clair dans les fichiers versionnés");

const clientImports = [];
for (const f of codeFiles) {
  const t = readFileSync(f, "utf8");
  if (!/^\s*["']use client["']/m.test(t.split("\n").slice(0, 5).join("\n"))) continue;
  if (/process\.env\.(BEDLINK_|CRON_SECRET)/.test(t)) clientImports.push(`${rel(f)} lit process.env.BEDLINK_*`);
  for (const m of t.matchAll(/from\s+["']([^"']*lib\/bedlink\/([^"']+))["']/g)) {
    if (SERVER_ONLY_MODULES.some((s) => m[2].startsWith(s))) clientImports.push(`${rel(f)} importe ${m[1]}`);
  }
}
if (clientImports.length) fail("Code serveur BedLink importé dans un composant client", clientImports.join(" ; "));
else ok("Aucun composant client n'importe la clé ou le client BedLink");

// ═══ 3. Fichiers ═════════════════════════════════════════════════════════
section = "Fichiers de l'intégration";
const expected = [
  "lib/bedlink/config.ts",
  "lib/bedlink/client.ts",
  "lib/bedlink/store.ts",
  "lib/bedlink/sync.ts",
  "lib/bedlink/booking.ts",
  "lib/bedlink/webhook.ts",
  "lib/bedlink/webhook-signature.ts",
  "app/api/bedlink/webhook/route.ts",
  "app/api/bedlink/cron/route.ts",
];
const missing = expected.filter((p) => !existsSync(join(srcRoot, p)));
if (missing.length) fail("Fichiers manquants", missing.join(", "));
else ok("Client, synchro, webhook et cron en place", rel(srcRoot) === "." ? "" : `sous ${rel(srcRoot)}/`);

const vercelJson = join(DIR, "vercel.json");
const vercelTs = ["vercel.ts", "vercel.mts", "vercel.js"].map((f) => join(DIR, f)).find(existsSync);
const cronDeclared =
  (existsSync(vercelJson) && readFileSync(vercelJson, "utf8").includes("/api/bedlink/cron")) ||
  (vercelTs && readFileSync(vercelTs, "utf8").includes("/api/bedlink/cron"));
if (cronDeclared) ok("Cron de rattrapage déclaré", rel(vercelTs && readFileSync(vercelTs, "utf8").includes("/api/bedlink/cron") ? vercelTs : vercelJson));
else fail("Cron /api/bedlink/cron non déclaré", "ni dans vercel.json ni dans vercel.ts");

// ═══ 4. Base de données ══════════════════════════════════════════════════
section = "Base de données";
async function checkSchema() {
  if (!env.DATABASE_URL) return skip("Tables non vérifiées", "DATABASE_URL absente");
  const req = createRequire(join(DIR, "package.json"));
  const sqlText = `select table_name, column_name from information_schema.columns
    where table_schema = current_schema() and table_name like 'bedlink\\_%'`;
  let rows = null;
  try {
    const { neon } = await import(pathToFileURL(req.resolve("@neondatabase/serverless")).href);
    rows = await neon(env.DATABASE_URL).query(sqlText, []);
  } catch {
    try {
      const pg = await import(pathToFileURL(req.resolve("pg")).href);
      const client = new (pg.default?.Client ?? pg.Client)({ connectionString: env.DATABASE_URL });
      await client.connect();
      rows = (await client.query(sqlText)).rows;
      await client.end();
    } catch (e) {
      return skip("Tables non vérifiées", `ni @neondatabase/serverless ni pg utilisables (${String(e?.message ?? e).slice(0, 80)})`);
    }
  }
  const byTable = new Map();
  for (const r of rows) byTable.set(r.table_name, (byTable.get(r.table_name) ?? new Set()).add(r.column_name));
  const absent = TABLES.filter((t) => !byTable.has(t));
  if (absent.length) return fail("Tables absentes", absent.join(", ") + " : migration non appliquée ?");
  const keyCols = {
    bedlink_calendar_days: ["price_cents", "available", "min_nights", "min_nights_through", "arrival_allowed", "departure_allowed", "synced_at"],
    bedlink_webhook_events: ["event_id", "processed_at"],
    bedlink_sync_state: ["changes_cursor", "locked_until"],
    bedlink_properties: ["calendar_until", "last_full_sync_at"],
  };
  const wrong = Object.entries(keyCols).flatMap(([t, cols]) => cols.filter((c) => !byTable.get(t).has(c)).map((c) => `${t}.${c}`));
  if (wrong.length) return fail("Colonnes manquantes", wrong.join(", "));
  ok("Les 7 tables bedlink_ sont en place");
}

// ═══ 5. Webhook ══════════════════════════════════════════════════════════
function sign(secret, body, t) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}
async function checkWebhook() {
  section = "Webhook (faux événement signé localement)";
  // The algorithm itself, against a fixed vector.
  const vector = sign("whsec_test_vector_0123456789", '{"id":"evt_1"}', 1700000000);
  if (vector === "t=1700000000,v1=" + createHmac("sha256", "whsec_test_vector_0123456789").update('1700000000.{"id":"evt_1"}').digest("hex")) ok("Algorithme HMAC-SHA256 « t.corps »");
  if (!secrets.length) return skip("Route non testée", "pas de secret");
  const url = `${LOCAL_URL}/api/bedlink/webhook`;
  const now = Math.floor(Date.now() / 1000);
  const event = { id: `evt_check_${randomBytes(8).toString("hex")}`, type: "ping", createdAt: new Date().toISOString(), apiVersion: "2026-10-19", data: {} };
  const body = JSON.stringify(event);
  const post = (headers, b = body) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "BedLink-Event-Id": event.id, "BedLink-Event-Type": "ping", ...headers }, body: b, signal: AbortSignal.timeout(10_000) });
  let res;
  try {
    res = await post({ "BedLink-Signature": sign(secrets[0], body, now) });
  } catch {
    return skip("Route non testée", `${url} ne répond pas : lancez « npm run dev » ou passez --url`);
  }
  if (res.status === 200) ok("Événement signé accepté", `200 sur ${url}`);
  else return fail("Événement signé refusé", `${res.status} : signature, base ou route en erreur`);
  const again = await post({ "BedLink-Signature": sign(secrets[0], body, now) });
  const againBody = await again.json().catch(() => ({}));
  if (again.status === 200 && againBody.duplicate === true) ok("Rejeu du même événement : reconnu, rien refait");
  else if (again.status === 200) warn("Rejeu accepté mais non signalé comme doublon", "l'idempotence sur l'id d'événement est-elle en place ?");
  else fail("Rejeu du même événement refusé", String(again.status));
  const bad = await post({ "BedLink-Signature": sign("whsec_wrong_secret_000000000000", body, now) });
  if (bad.status >= 400 && bad.status < 500) ok("Mauvaise signature refusée", String(bad.status));
  else fail("Mauvaise signature ACCEPTÉE", `${bad.status} : n'importe qui peut écrire dans votre base`);
  const old = await post({ "BedLink-Signature": sign(secrets[0], body, now - 600) });
  if (old.status >= 400 && old.status < 500) ok("Horodatage de plus de 5 minutes refusé", String(old.status));
  else fail("Horodatage trop vieux ACCEPTÉ", `${old.status} : un ancien message pourrait être rejoué`);
  const none = await post({});
  if (none.status >= 400 && none.status < 500) ok("Requête sans signature refusée", String(none.status));
  else fail("Requête sans signature ACCEPTÉE", String(none.status));
  const tampered = body.replace('"ping"', '"pong"');
  const tamper = await post({ "BedLink-Signature": sign(secrets[0], body, now) }, tampered);
  if (tamper.status >= 400 && tamper.status < 500) ok("Corps modifié après signature refusé", String(tamper.status));
  else fail("Corps modifié ACCEPTÉ", String(tamper.status));
}

// ═══ 6. API BedLink (lecture seule) ══════════════════════════════════════
async function checkApi() {
  section = "API BedLink (lecture seule)";
  if (OFFLINE) return skip("Appels sautés", "--offline");
  if (!KEY_RE.test(key)) return skip("Appels sautés", "clé absente ou mal formée");
  const base = (env.BEDLINK_API_URL || "https://app.bedlink.fr/api/partner/v1").replace(/\/$/, "");
  const get = async (path) => {
    const r = await fetch(base + path, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    let j = null;
    try {
      j = await r.json();
    } catch {}
    return { status: r.status, json: j, requestId: r.headers.get("x-request-id") };
  };
  let props;
  try {
    props = await get("/properties");
  } catch (e) {
    return fail("API injoignable", String(e?.message ?? e));
  }
  if (props.status !== 200) return fail("GET /properties", `${props.status} ${props.json?.error?.code ?? ""} (requestId ${props.requestId ?? "?"})`);
  const list = props.json?.properties ?? [];
  ok("GET /properties", `${list.length} logement(s) relié(s)`);
  if (!list.length) return warn("Aucun logement relié à cette clé", "demander à BedLink de relier un logement de test");
  const p = list[0];
  const missingProp = ["id", "name", "currency", "channel", "environment"].filter((k) => !(k in p));
  if (missingProp.length) fail("Fiche logement incomplète", missingProp.join(", "));
  else ok("Fiche logement conforme au contrat", `${p.name} (${p.environment}, ${p.currency})`);
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
  const cal = await get(`/properties/${p.id}/calendar?from=${today}&to=${end}`);
  if (cal.status !== 200) return fail("GET calendrier 7 jours", `${cal.status} ${cal.json?.error?.code ?? ""}`);
  const days = cal.json?.days ?? [];
  const fields = ["date", "priceCents", "available", "minNights", "minNightsThrough", "maxNights", "arrivalAllowed", "departureAllowed"];
  const badDay = days.find((d) => fields.some((f) => !(f in d)));
  if (days.length !== 7 || badDay) fail("Calendrier non conforme", `${days.length} jours`);
  else ok("GET calendrier 7 jours", `${days.filter((d) => d.available).length}/7 jours disponibles`);
  if (features.includes("changes")) {
    const ch = await get("/changes?limit=1");
    if (ch.status === 200 && typeof ch.json?.nextCursor === "string") ok("GET /changes", "fil des changements ouvert");
    else fail("GET /changes", `${ch.status} : retirer « changes » de BEDLINK_FEATURES tant que BedLink ne l'a pas ouvert`);
  }
  if (features.includes("reservations_list")) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const rl = await get(`/reservations?since=${encodeURIComponent(since)}`);
    if (rl.status === 200) ok("GET /reservations?since=", "liste ouverte");
    else fail("GET /reservations?since=", `${rl.status} : retirer « reservations_list » de BEDLINK_FEATURES`);
  }
}

// ── Exécution ──────────────────────────────────────────────────────────────
section = "Base de données";
await checkSchema().catch((e) => fail("Vérification du schéma impossible", String(e?.message ?? e).slice(0, 120)));
await checkWebhook().catch((e) => fail("Test du webhook impossible", String(e?.message ?? e).slice(0, 120)));
await checkApi().catch((e) => fail("Test de l'API impossible", String(e?.message ?? e).slice(0, 120)));

const failed = results.filter((r) => r.status === "ECHEC").length;
const warned = results.filter((r) => r.status === "ATTENTION").length;
if (JSON_OUT) {
  console.log(JSON.stringify({ kit: "bedlink-partner-kit", checkVersion: 1, at: new Date().toISOString(), dir: DIR, failed, warned, results }, null, 2));
} else {
  console.log(`\nVérification de l'intégration BedLink : ${DIR}\n`);
  let current = "";
  for (const r of results) {
    if (r.section !== current) {
      current = r.section;
      console.log(`\n${current}`);
    }
    console.log(`  [${r.status.padEnd(9)}] ${r.label}${r.detail ? ` : ${r.detail}` : ""}`);
  }
  console.log(`\n${failed ? `${failed} échec(s)` : "Aucun échec"}, ${warned} point(s) d'attention.\n`);
}
process.exit(failed ? 1 : 0);
