import { receiveWebhook } from "@/lib/bedlink/webhook";

// BedLink webhooks. URL to give BedLink: https://<your-domain>/api/bedlink/webhook
// No session, no CSRF: the HMAC signature is the authentication.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request) {
  const { status, body } = await receiveWebhook(request);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
