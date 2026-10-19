// Initial (or repair) full sync, run from a terminal:
//   npx tsx --env-file=.env.local scripts/bedlink-sync.ts
// Reads every connected property over 366 days and writes the local copy.
// Safe to re-run. With today's sandbox: 5 calendar calls per property.
import { sync } from "../lib/bedlink/sync";

async function main() {
  const started = Date.now();
  const report = await sync.fullSync({ maxCalls: 100_000, maxMs: 60 * 60_000 });
  console.log(JSON.stringify({ ...report, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
  process.exit(report.error ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
