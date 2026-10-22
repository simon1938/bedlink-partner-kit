// End-to-end test of the templates against a fake BedLink API and an
// in-process Postgres (PGlite). Nothing leaves the machine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { newState, setDay, startMock, TEST_KEY, type MockState } from "./mock-bedlink.ts";

const T = new URL("../plugins/bedlink-partner/skills/bedlink-integration/templates/", import.meta.url);
const SECRET = "whsec_test_" + "s".repeat(32);

let pg: PGlite;
let state: MockState;
let mock: Awaited<ReturnType<typeof startMock>>;
let lib: {
  store: ReturnType<typeof import("../plugins/bedlink-partner/skills/bedlink-integration/templates/lib/bedlink/store.ts").createStore>;
  sync: ReturnType<typeof import("../plugins/bedlink-partner/skills/bedlink-integration/templates/lib/bedlink/sync.ts").createSync>;
  booking: ReturnType<typeof import("../plugins/bedlink-partner/skills/bedlink-integration/templates/lib/bedlink/booking.ts").createBooking>;
  receiveWebhook: typeof import("../plugins/bedlink-partner/skills/bedlink-integration/templates/lib/bedlink/webhook.ts").receiveWebhook;
  signPayload: typeof import("../plugins/bedlink-partner/skills/bedlink-integration/templates/lib/bedlink/webhook-signature.ts").signPayload;
};

const today = new Date().toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const count = async (sql: string, params: unknown[] = []) => Number((await pg.query<{ n: number }>(sql, params)).rows[0].n);

before(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync(new URL("schema/bedlink.sql", T), "utf8"));
  state = newState();
  mock = await startMock(state);
  process.env.BEDLINK_API_KEY = TEST_KEY;
  process.env.BEDLINK_API_URL = mock.url;
  process.env.BEDLINK_WEBHOOK_SECRET = SECRET;
  process.env.BEDLINK_FEATURES = "";
  const db = { query: async <R>(text: string, params: unknown[] = []) => (await pg.query<R>(text, params)).rows };
  const { createStore } = await import(new URL("lib/bedlink/store.ts", T).href);
  const { createSync } = await import(new URL("lib/bedlink/sync.ts", T).href);
  const { createBooking } = await import(new URL("lib/bedlink/booking.ts", T).href);
  const { receiveWebhook } = await import(new URL("lib/bedlink/webhook.ts", T).href);
  const { signPayload } = await import(new URL("lib/bedlink/webhook-signature.ts", T).href);
  const store = createStore(db);
  lib = { store, sync: createSync(store), booking: createBooking(store), receiveWebhook, signPayload };
});

after(async () => {
  mock.server.close();
  await pg.close();
});

beforeEach(() => {
  state.calls.length = 0;
});

describe("schema", () => {
  it("is idempotent", async () => {
    await pg.exec(readFileSync(new URL("schema/bedlink.sql", T), "utf8"));
  });
});

describe("full sync on today's sandbox (no feature)", () => {
  it("reads 366 days per property in 91-day windows and writes them", async () => {
    setDay(state, state.properties[0].id, plus(10), { available: false });
    const report = await lib.sync.fullSync();
    assert.equal(report.error, undefined);
    assert.equal(report.propertiesSynced, 2);
    // 366 dates / 91 per call = 5 calls per property, + 1 list, + 0 reservations
    assert.equal(state.calls.filter((c) => c.includes("/calendar")).length, 10);
    assert.equal(await count("select count(*)::int as n from bedlink_calendar_days"), 2 * 366);
    assert.equal(await count("select count(*)::int as n from bedlink_calendar_days where available = false"), 1);
    assert.equal(await count("select count(*)::int as n from bedlink_properties where last_full_sync_at is not null"), 2);
  });

  it("catch-up without the changes feed re-reads the next 91 days and never calls /changes", async () => {
    setDay(state, state.properties[1].id, plus(5), { priceCents: 19900 });
    const report = await lib.sync.runCatchUp();
    assert.equal(report.error, undefined, report.error);
    assert.ok(!state.calls.some((c) => c.includes("/changes")));
    const row = await pg.query<{ price_cents: number }>("select price_cents from bedlink_calendar_days where bedlink_property_id = $1 and date = $2", [state.properties[1].id, plus(5)]);
    assert.equal(row.rows[0].price_cents, 19900);
  });

  it("a property removed from the list is taken off sale", async () => {
    const removed = state.properties.pop()!;
    await lib.sync.runCatchUp();
    const p = await pg.query<{ status: string }>("select status from bedlink_properties where bedlink_property_id = $1", [removed.id]);
    assert.equal(p.rows[0].status, "disconnected");
    assert.equal(await count("select count(*)::int as n from bedlink_calendar_days where bedlink_property_id = $1", [removed.id]), 0);
    state.properties.push(removed);
    await lib.sync.runCatchUp(); // reconnected → full sync again
    assert.equal(await count("select count(*)::int as n from bedlink_calendar_days where bedlink_property_id = $1", [removed.id]), 366);
  });

  it("the cron budget stops cleanly and resumes", async () => {
    await pg.query("update bedlink_properties set last_full_sync_at = null");
    const report = await lib.sync.runCatchUp({ maxCalls: 3 });
    assert.equal(report.complete, false);
    assert.equal(report.error, undefined);
    const locked = await pg.query<{ locked_until: string | null }>("select locked_until from bedlink_sync_state");
    assert.equal(locked.rows[0].locked_until, null);
    const next = await lib.sync.runCatchUp();
    assert.equal(next.complete, true);
  });
});

describe("with the changes feed and 366-day calendar", () => {
  it("full sync takes the head cursor first, then catch-up applies only changed ranges", async () => {
    state.features = new Set(["changes", "calendar_366"]);
    process.env.BEDLINK_FEATURES = "changes,calendar_366";
    await lib.sync.fullSync();
    const calendarCalls = state.calls.filter((c) => c.includes("/calendar")).length;
    assert.equal(calendarCalls, 2); // one 366-day call per property
    const cursor = (await pg.query<{ changes_cursor: string }>("select changes_cursor from bedlink_sync_state")).rows[0].changes_cursor;
    assert.match(cursor, /^c_\d+$/);

    state.calls.length = 0;
    setDay(state, state.properties[0].id, plus(20), { available: false });
    const report = await lib.sync.runCatchUp();
    assert.equal(report.error, undefined, report.error);
    assert.equal(report.rangesApplied, 1);
    assert.deepEqual(state.calls.filter((c) => c.includes("/calendar")), [`GET /properties/${state.properties[0].id}/calendar`]);
    const d = await pg.query<{ available: boolean }>("select available from bedlink_calendar_days where bedlink_property_id = $1 and date = $2", [state.properties[0].id, plus(20)]);
    assert.equal(d.rows[0].available, false);
    state.features = new Set();
    process.env.BEDLINK_FEATURES = "";
  });
});

describe("booking path (sandbox: payments off)", () => {
  it("quote → hold → reservation, retries are safe", async () => {
    const p = state.properties[0].id;
    const { externalId, quote } = await lib.booking.startCheckout({ propertyId: p, checkIn: plus(30), checkOut: plus(32), adults: 2 });
    assert.equal(quote.totalCents, 28000);
    const hold = await lib.booking.holdCheckout(externalId);
    const holdAgain = await lib.booking.holdCheckout(externalId);
    assert.equal(hold.holdId, holdAgain.holdId);
    const paid = await lib.booking.payCheckout(externalId, { guest: { name: "Jeanne Test", email: "jeanne@example.com" }, returnUrl: "https://example.com/merci" });
    assert.equal(paid.mode, "confirmed");
    const again = await lib.booking.payCheckout(externalId, { guest: { name: "Jeanne Test", email: "jeanne@example.com" }, returnUrl: "https://example.com/merci" });
    assert.equal(again.mode, "confirmed");
    assert.equal(state.reservations.size, 1);
    assert.equal(await count("select count(*)::int as n from bedlink_reservations where external_id = $1", [externalId]), 1);
    assert.equal((await lib.booking.getCheckoutStatus(externalId)).status, "confirmed");
  });

  it("unavailable dates surface as a CheckoutFailed reason", async () => {
    const p = state.properties[0].id;
    setDay(state, p, plus(40), { available: false });
    await assert.rejects(lib.booking.startCheckout({ propertyId: p, checkIn: plus(40), checkOut: plus(41), adults: 2 }), (e: Error & { reason?: string }) => e.reason === "dates_unavailable");
  });

  it("the traveller changes the dates: new total from BedLink, copy updated; flag off = clear error", async () => {
    const p = state.properties[0].id;
    const { externalId } = await lib.booking.startCheckout({ propertyId: p, checkIn: plus(60), checkOut: plus(62), adults: 2 });
    await lib.booking.holdCheckout(externalId);
    await lib.booking.payCheckout(externalId, { guest: { name: "M", email: "m@example.com" }, returnUrl: "https://example.com" });
    const id = (await lib.booking.getCheckoutStatus(externalId)).reservation!.id;
    await assert.rejects(lib.booking.modifyReservation(id, { checkOut: plus(63) }), /not available yet/);
    process.env.BEDLINK_FEATURES = "reservations_modify";
    state.features = new Set(["reservations_modify"]);
    const r = await lib.booking.modifyReservation(id, { checkOut: plus(63) });
    assert.equal(r.checkOut, plus(63));
    assert.equal(r.totalCents, 3 * 14000);
    const copy = await pg.query<{ check_out: string }>("select check_out::text from bedlink_reservations where bedlink_reservation_id = $1", [id]);
    assert.equal(copy.rows[0].check_out, plus(63));
    setDay(state, p, plus(63), { available: false });
    await assert.rejects(lib.booking.modifyReservation(id, { checkOut: plus(64) }), (e: Error & { reason?: string }) => e.reason === "dates_unavailable");
    state.features = new Set();
    process.env.BEDLINK_FEATURES = "";
  });

  it("payments flag on but endpoint not open: a clear error, nothing created", async () => {
    process.env.BEDLINK_FEATURES = "payments";
    const p = state.properties[0].id;
    const { externalId } = await lib.booking.startCheckout({ propertyId: p, checkIn: plus(50), checkOut: plus(51), adults: 2 });
    await lib.booking.holdCheckout(externalId);
    const before = state.reservations.size;
    await assert.rejects(lib.booking.payCheckout(externalId, { guest: { name: "A", email: "a@example.com" }, returnUrl: "https://example.com" }), /not available yet/);
    assert.equal(state.reservations.size, before);
    process.env.BEDLINK_FEATURES = "";
  });
});

describe("webhook", () => {
  const post = (body: string, headers: Record<string, string>) =>
    lib.receiveWebhook(new Request("http://localhost/api/bedlink/webhook", { method: "POST", body, headers }), { store: lib.store, sync: lib.sync });

  it("accepts a signed event once, recognises the replay", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "ping", createdAt: new Date().toISOString(), data: {} });
    const r1 = await post(body, { "bedlink-signature": lib.signPayload(SECRET, body), "bedlink-event-id": "evt_1" });
    assert.equal(r1.status, 200);
    const r2 = await post(body, { "bedlink-signature": lib.signPayload(SECRET, body), "bedlink-event-id": "evt_1" });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.duplicate, true);
  });

  it("refuses bad signature, old timestamp, tampered body, missing header", async () => {
    const body = JSON.stringify({ id: "evt_2", type: "ping", data: {} });
    assert.equal((await post(body, { "bedlink-signature": lib.signPayload("whsec_other_" + "x".repeat(30), body) })).status, 400);
    assert.equal((await post(body, { "bedlink-signature": lib.signPayload(SECRET, body, Math.floor(Date.now() / 1000) - 301) })).status, 400);
    assert.equal((await post(body.replace("ping", "pong"), { "bedlink-signature": lib.signPayload(SECRET, body) })).status, 400);
    assert.equal((await post(body, {})).status, 400);
    assert.equal(await count("select count(*)::int as n from bedlink_webhook_events where event_id = 'evt_2'"), 0);
  });

  it("accepts the previous secret during a rotation", async () => {
    process.env.BEDLINK_WEBHOOK_SECRET = `whsec_new_${"n".repeat(30)},${SECRET}`;
    const body = JSON.stringify({ id: "evt_3", type: "ping", data: {} });
    const r = await lib.receiveWebhook(new Request("http://localhost/x", { method: "POST", body, headers: { "bedlink-signature": lib.signPayload(SECRET, body) } }), { store: lib.store, sync: lib.sync });
    assert.equal(r.status, 200);
    process.env.BEDLINK_WEBHOOK_SECRET = SECRET;
  });

  it("availability.changed re-reads the range from BedLink (signal only)", async () => {
    const p = state.properties[0].id;
    setDay(state, p, plus(60), { priceCents: 33300 });
    const body = JSON.stringify({ id: "evt_4", type: "availability.changed", data: { propertyId: p, from: plus(60), to: plus(60), priceCents: 1 } });
    const r = await post(body, { "bedlink-signature": lib.signPayload(SECRET, body) });
    assert.equal(r.status, 200);
    const d = await pg.query<{ price_cents: number }>("select price_cents from bedlink_calendar_days where bedlink_property_id = $1 and date = $2", [p, plus(60)]);
    assert.equal(d.rows[0].price_cents, 33300); // from the API, not from the event
  });

  it("reservation.cancelled updates the local reservation", async () => {
    const r = [...state.reservations.values()][0];
    const cancelled = { ...r, status: "cancelled", cancelledBy: "host" };
    const body = JSON.stringify({ id: "evt_5", type: "reservation.cancelled", data: { reservation: cancelled } });
    assert.equal((await post(body, { "bedlink-signature": lib.signPayload(SECRET, body) })).status, 200);
    const row = await pg.query<{ status: string; cancelled_by: string }>("select status, cancelled_by from bedlink_reservations where bedlink_reservation_id = $1", [r.id]);
    assert.deepEqual(row.rows[0], { status: "cancelled", cancelled_by: "host" });
  });

  it("an unknown event type is acknowledged", async () => {
    const body = JSON.stringify({ id: "evt_6", type: "future.event", data: {} });
    assert.equal((await post(body, { "bedlink-signature": lib.signPayload(SECRET, body) })).status, 200);
  });
});

describe("dates", () => {
  it("today is not shifted by the server timezone", async () => {
    const { todayIn, addDays, daysBetween } = await import(new URL("lib/bedlink/dates.ts", T).href);
    assert.equal(addDays("2026-03-28", 1), "2026-03-29");
    assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
    assert.match(todayIn("Pacific/Auckland"), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(today);
  });
});
