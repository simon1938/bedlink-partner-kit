import { createHmac, timingSafeEqual } from "node:crypto";

// Verification of the BedLink-Signature header, Stripe style:
//   BedLink-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>[,v1=<hex>]
//   signed payload    = `${t}.${rawBody}`
// Several v1 entries may be present while BedLink rotates the secret, and
// several secrets may be configured locally (BEDLINK_WEBHOOK_SECRET="new,old").

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureCheck =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing_header" | "malformed_header" | "timestamp_out_of_tolerance" | "no_matching_signature" | "no_secret" };

export function parseSignatureHeader(header: string | null | undefined) {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && /^\d{1,12}$/.test(value ?? "")) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/.test(value ?? "")) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/** Builds a header, used by tests and by the local check script. */
export function signPayload(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, rawBody)}`;
}

export function verifySignature(
  rawBody: string,
  header: string | null | undefined,
  secrets: string[],
  options: { toleranceSeconds?: number; now?: number } = {},
): SignatureCheck {
  if (secrets.length === 0) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "missing_header" };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed_header" };
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  // Refuse old (replayed) and far-future timestamps.
  if (Math.abs(now - parsed.timestamp) > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };
  for (const secret of secrets) {
    const expected = Buffer.from(computeSignature(secret, parsed.timestamp, rawBody), "hex");
    for (const candidate of parsed.signatures) {
      const given = Buffer.from(candidate, "hex");
      // Constant-time comparison; lengths are equal (both 32 bytes) by construction.
      if (given.length === expected.length && timingSafeEqual(given, expected)) {
        return { ok: true, timestamp: parsed.timestamp };
      }
    }
  }
  return { ok: false, reason: "no_matching_signature" };
}
