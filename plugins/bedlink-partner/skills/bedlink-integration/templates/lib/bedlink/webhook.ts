import { bedlinkConfig } from "./config";
import { Budget, sync as defaultSync } from "./sync";
import { store as defaultStore, type BedlinkStore } from "./store";
import type { WebhookEvent } from "./types";
import { verifySignature } from "./webhook-signature";

// Receiving a BedLink webhook, in order:
//   1. raw body, size cap
//   2. signature (constant time, timestamp within 5 minutes)
//   3. idempotence on the event id (already processed → 200, nothing redone)
//   4. handling, quick (< 10 s): BedLink retries anything that is not 2xx
// Webhooks are a signal. Losing one is not a problem: the cron catches up.

const MAX_BODY = 256 * 1024;

type Result = { status: number; body: Record<string, unknown> };

export async function receiveWebhook(
  request: Request,
  deps: { store?: BedlinkStore; sync?: typeof defaultSync; secrets?: string[] } = {},
): Promise<Result> {
  const store = deps.store ?? defaultStore;
  const sync = deps.sync ?? defaultSync;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { status: 413, body: { error: "payload_too_large" } };

  const check = verifySignature(raw, request.headers.get("bedlink-signature"), deps.secrets ?? bedlinkConfig().webhookSecrets);
  if (!check.ok) return { status: 400, body: { error: "invalid_signature", reason: check.reason } };

  let event: WebhookEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    return { status: 400, body: { error: "invalid_event" } };
  }
  const headerId = request.headers.get("bedlink-event-id");
  if (headerId && headerId !== event.id) return { status: 400, body: { error: "event_id_mismatch" } };

  const seen = await store.recordWebhookEvent({ id: event.id, type: event.type, createdAt: event.createdAt, payload: event });
  if (seen === "done") return { status: 200, body: { received: true, duplicate: true } };

  try {
    await handleEvent(event, store, sync);
    await store.markWebhookProcessed(event.id);
    return { status: 200, body: { received: true } };
  } catch (e) {
    await store.markWebhookProcessed(event.id, String(e).slice(0, 500));
    // 500 → BedLink retries later with backoff.
    return { status: 500, body: { error: "processing_failed" } };
  }
}

async function handleEvent(event: WebhookEvent, store: BedlinkStore, sync: typeof defaultSync) {
  switch (event.type) {
    case "ping":
      return;
    case "property.connected":
      return sync.syncOneProperty(event.data.propertyId);
    case "property.disconnected":
      return store.markPropertyDisconnected(event.data.propertyId);
    case "availability.changed": {
      // Signal only: the data is read from BedLink, never taken from the event.
      const p = await store.getLocalProperty(event.data.propertyId);
      if (!p) return; // unknown property: the cron will pick it up
      await sync.applyRange(p, event.data.from, event.data.to, new Budget(6, Date.now() + 8_000));
      return;
    }
    case "reservation.confirmed":
    case "reservation.cancelled":
    case "reservation.modified": {
      const r = event.data.reservation;
      await store.upsertReservation(r);
      if (event.type === "reservation.confirmed") await store.confirmCheckoutByExternalId(r.externalId, r.id);
      return;
    }
    case "message.created":
      return store.upsertMessage(event.data.message);
    default:
      // Unknown type (added later by BedLink): acknowledge, do nothing.
      return;
  }
}
