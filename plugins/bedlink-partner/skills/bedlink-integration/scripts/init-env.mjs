#!/usr/bin/env node
// Prépare .env.local sans jamais afficher de valeur.
//   node init-env.mjs [--dir .]
// - ajoute les lignes BedLink manquantes (clé vide, à coller par vous) ;
// - génère CRON_SECRET et un secret webhook LOCAL s'ils manquent ;
// - s'assure que .env*.local est dans .gitignore ;
// - n'écrase jamais une valeur existante.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const i = process.argv.indexOf("--dir");
const DIR = resolve(i > 0 ? process.argv[i + 1] : process.cwd());
const envPath = join(DIR, ".env.local");
const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const has = (k) => new RegExp(`^\\s*(export\\s+)?${k}\\s*=`, "m").test(current);

const lines = [];
const added = [];
const push = (k, v, comment) => {
  if (has(k)) return;
  if (comment) lines.push(`# ${comment}`);
  lines.push(`${k}=${v}`);
  added.push(k);
};

push("BEDLINK_API_KEY", "", "Clé partenaire BedLink (blp_test_…) : à coller ici vous-même. Serveur uniquement.");
push(
  "BEDLINK_WEBHOOK_SECRET",
  `whsec_local_${randomBytes(24).toString("base64url")}`,
  "Secret de signature des webhooks. Secret LOCAL généré : remplacez-le par celui de BedLink quand il vous sera remis.",
);
push("CRON_SECRET", randomBytes(32).toString("base64url"), "Envoyé par Vercel au cron. À recopier dans Vercel (Sensitive).");
push("BEDLINK_FEATURES", "", "Fonctions ouvertes par BedLink (vide = sandbox actuelle).");

if (lines.length) {
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  appendFileSync(envPath, `${prefix}\n# ── BedLink ──\n${lines.join("\n")}\n`, { mode: 0o600 });
}

const giPath = join(DIR, ".gitignore");
const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
let gitignoreFixed = false;
if (!/(^|\n)\s*\.env\*(\.local)?\s*(\n|$)|\.env\*\.local|(^|\n)\.env\.local/.test(gi)) {
  writeFileSync(giPath, `${gi}${gi && !gi.endsWith("\n") ? "\n" : ""}.env*.local\n`);
  gitignoreFixed = true;
}

const keyFilled = /^\s*BEDLINK_API_KEY\s*=\s*blp_/m.test(readFileSync(envPath, "utf8"));
console.log(JSON.stringify({ envFile: ".env.local", added, gitignoreFixed, apiKeyFilled: keyFilled }, null, 2));
