import { timingSafeEqual } from "node:crypto";
import { sync } from "@/lib/bedlink/sync";

// Catch-up cron (vercel.json / vercel.ts → crons). Vercel sends
// "Authorization: Bearer $CRON_SECRET" by itself when CRON_SECRET is set.
// Bounded run: what does not fit resumes on the next run.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const report = await sync.runCatchUp({ maxCalls: 90, maxMs: 45_000 });
  return Response.json(report, { status: report.error ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
