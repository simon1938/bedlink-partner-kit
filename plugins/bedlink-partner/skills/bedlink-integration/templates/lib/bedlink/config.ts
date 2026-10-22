// Server-side configuration for the BedLink integration.
// Every value comes from server environment variables. Never prefix them with
// NEXT_PUBLIC_, never write them in code, never commit them.

/**
 * Features that BedLink has not opened yet. Turn one on (BEDLINK_FEATURES)
 * only when BedLink tells you it is live. With every flag off the code uses
 * what the sandbox already offers today.
 */
export const FEATURES = [
  "calendar_366", // calendar reads up to 366 days in one call (today: 91)
  "changes", // GET /changes feed
  "webhooks", // signed webhooks are sent by BedLink
  "reservations_list", // GET /reservations?since=
  "messages", // POST/GET /reservations/{id}/messages
  "payments", // POST /payment-sessions + embedded payment page
  "reservations_modify", // PATCH /reservations/{id}: change dates or guests
] as const;
export type Feature = (typeof FEATURES)[number];

const KEY_RE = /^blp_(test|live)_[A-Za-z0-9_-]{43}$/;
const DEFAULT_API_URL = "https://app.bedlink.fr/api/partner/v1";

export type BedlinkConfig = {
  apiKey: string;
  apiUrl: string;
  environment: "sandbox" | "live";
  webhookSecrets: string[];
  features: Set<Feature>;
};

let cached: { signature: string; config: BedlinkConfig } | null = null;

if (typeof window !== "undefined") {
  // This module holds the API key: it must never reach a browser bundle.
  throw new Error("lib/bedlink/config must only be imported on the server.");
}

export function bedlinkConfig(): BedlinkConfig {
  // Re-read when the environment changes (tests, hot reload); cheap otherwise.
  const signature = ["BEDLINK_API_KEY", "BEDLINK_API_URL", "BEDLINK_WEBHOOK_SECRET", "BEDLINK_FEATURES"]
    .map((k) => process.env[k] ?? "")
    .join("\u0000");
  if (cached?.signature === signature) return cached.config;
  const apiKey = process.env.BEDLINK_API_KEY?.trim() ?? "";
  if (!KEY_RE.test(apiKey)) {
    throw new Error(
      "BEDLINK_API_KEY is missing or malformed (expected blp_test_… or blp_live_…). Set it in .env.local and in Vercel (server only).",
    );
  }
  const apiUrl = (process.env.BEDLINK_API_URL?.trim() || DEFAULT_API_URL).replace(/\/$/, "");
  if (!apiUrl.startsWith("https://") && !apiUrl.startsWith("http://localhost")) {
    throw new Error("BEDLINK_API_URL must use https.");
  }
  // Two secrets may be active during a rotation: "whsec_new,whsec_old".
  const webhookSecrets = (process.env.BEDLINK_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const features = new Set<Feature>();
  for (const raw of (process.env.BEDLINK_FEATURES ?? "").split(",")) {
    const f = raw.trim() as Feature;
    if (f && (FEATURES as readonly string[]).includes(f)) features.add(f);
  }
  const config: BedlinkConfig = {
    apiKey,
    apiUrl,
    environment: apiKey.startsWith("blp_live_") ? "live" : "sandbox",
    webhookSecrets,
    features,
  };
  cached = { signature, config };
  return config;
}

export function hasFeature(feature: Feature): boolean {
  return bedlinkConfig().features.has(feature);
}

/** Longest calendar window BedLink accepts in one call, in days (inclusive). */
export function calendarChunkDays(): number {
  return hasFeature("calendar_366") ? 366 : 91;
}

/** How far ahead the local copy goes. */
export const WINDOW_DAYS = 366;
