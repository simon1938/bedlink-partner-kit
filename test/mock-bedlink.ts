// A fake BedLink Partner API, for the kit's own tests only. It mimics the
// sandbox contract (references/contract.md), including its limits (90-day
// calendar, 404 "Endpoint not found." for routes not open yet), and the
// planned endpoints when the matching feature is enabled.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const TEST_KEY = "blp_test_" + "a".repeat(43);

type Day = { priceCents: number | null; available: boolean; minNights: number };

export type MockState = {
  features: Set<string>;
  properties: { id: string; name: string; maxGuests: number; currency: string; timezone: string }[];
  calendar: Map<string, Map<string, Day>>;
  quotes: Map<string, { propertyId: string; checkIn: string; checkOut: string; adults: number; children: number; totalCents: number; expiresAt: number }>;
  holds: Map<string, { quoteId: string; reference: string; status: string; expiresAt: number }>;
  reservations: Map<string, Record<string, unknown>>;
  changes: { id: number; kind: string; propertyId: string; from?: string; to?: string; reservationId?: string }[];
  calls: string[];
};

function addDays(d: string, n: number) {
  const x = new Date(d + "T12:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
const diff = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);

export function newState(): MockState {
  const p1 = { id: randomUUID(), name: "Logement Test", maxGuests: 6, currency: "EUR", timezone: "Europe/Paris" };
  const p2 = { id: randomUUID(), name: "Chalet des Dunes", maxGuests: 4, currency: "EUR", timezone: "Europe/Paris" };
  return {
    features: new Set(),
    properties: [p1, p2],
    calendar: new Map(),
    quotes: new Map(),
    holds: new Map(),
    reservations: new Map(),
    changes: [],
    calls: [],
  };
}

function day(state: MockState, propertyId: string, date: string): Day {
  return state.calendar.get(propertyId)?.get(date) ?? { priceCents: 14000, available: true, minNights: 1 };
}

export function setDay(state: MockState, propertyId: string, date: string, d: Partial<Day>) {
  const m = state.calendar.get(propertyId) ?? new Map();
  m.set(date, { ...day(state, propertyId, date), ...d });
  state.calendar.set(propertyId, m);
  state.changes.push({ id: state.changes.length + 1, kind: "calendar", propertyId, from: date, to: date });
}

export async function startMock(state: MockState): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/^\/api\/partner\/v1/, "");
    state.calls.push(`${req.method} ${path}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "x-request-id": randomUUID() });
      res.end(JSON.stringify(body));
    };
    const error = (status: number, code: string, message: string) => send(status, { error: { code, message }, requestId: randomUUID() });
    if (req.headers.authorization !== `Bearer ${TEST_KEY}`) return error(401, "invalid_token", "Token is invalid, expired or revoked.");
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    const parts = path.split("/").filter(Boolean);
    const prop = (id: string) => state.properties.find((p) => p.id === id);
    const propertyJson = (p: MockState["properties"][number]) => ({ ...p, description: "", imageUrl: null, address: null, channel: "partner_test", environment: "sandbox" });
    const today = new Date().toISOString().slice(0, 10);

    if (req.method === "GET" && path === "/properties") return send(200, { properties: state.properties.map(propertyJson) });
    if (req.method === "GET" && parts[0] === "properties" && parts.length >= 2) {
      const p = prop(parts[1]);
      if (!p) return error(404, "not_found", "Property not found.");
      if (parts.length === 2) return send(200, propertyJson(p));
      if (parts[2] === "calendar") {
        const from = url.searchParams.get("from")!;
        const to = url.searchParams.get("to")!;
        const max = state.features.has("calendar_366") ? 365 : 90;
        if (diff(from, to) < 0 || diff(from, to) > max) return error(400, "invalid_request", `request: Calendar range must be between 0 and ${max} days`);
        const days = [];
        for (let d = from; d <= to; d = addDays(d, 1)) {
          const x = day(state, p.id, d);
          days.push({ date: d, priceCents: x.priceCents, available: d >= today && x.available, minNights: x.minNights, minNightsThrough: null, maxNights: null, arrivalAllowed: true, departureAllowed: true });
        }
        return send(200, { propertyId: p.id, channel: "partner_test", currency: "EUR", from, to, days });
      }
    }
    if (req.method === "POST" && path === "/quotes") {
      const p = prop(body.propertyId);
      if (!p) return error(404, "not_found", "Property not found.");
      const nights = [];
      for (let d = body.checkIn; d < body.checkOut; d = addDays(d, 1)) {
        const x = day(state, p.id, d);
        if (!x.available || !x.priceCents) return error(409, "dates_unavailable", "These dates are unavailable or do not meet the stay rules.");
        nights.push({ date: d, priceCents: x.priceCents });
      }
      const id = randomUUID();
      const totalCents = nights.reduce((s, n) => s + n.priceCents, 0);
      const expiresAt = Date.now() + 5 * 60_000;
      state.quotes.set(id, { propertyId: p.id, checkIn: body.checkIn, checkOut: body.checkOut, adults: body.adults ?? 2, children: body.children ?? 0, totalCents, expiresAt });
      return send(201, { id, propertyId: p.id, channel: "partner_test", checkIn: body.checkIn, checkOut: body.checkOut, adults: body.adults ?? 2, children: body.children ?? 0, totalCents, currency: "EUR", nights, expiresAt: new Date(expiresAt).toISOString() });
    }
    if (req.method === "POST" && path === "/holds") {
      const existing = [...state.holds.entries()].find(([, h]) => h.reference === body.reference);
      if (existing) {
        if (existing[1].quoteId !== body.quoteId) return error(409, "reference_conflict", "This reference was already used with different data.");
        return send(200, { id: existing[0], quoteId: body.quoteId, status: existing[1].status, expiresAt: new Date(existing[1].expiresAt).toISOString() });
      }
      const q = state.quotes.get(body.quoteId);
      if (!q) return error(404, "not_found", "Resource not found.");
      if (q.expiresAt < Date.now()) return error(409, "quote_expired", "Quote expired. Request a new quote.");
      const id = randomUUID();
      const expiresAt = Date.now() + 15 * 60_000;
      state.holds.set(id, { quoteId: body.quoteId, reference: body.reference, status: "active", expiresAt });
      return send(201, { id, quoteId: body.quoteId, status: "active", expiresAt: new Date(expiresAt).toISOString() });
    }
    if (req.method === "DELETE" && parts[0] === "holds") {
      const h = state.holds.get(parts[1]);
      if (!h) return error(404, "not_found", "Resource not found.");
      h.status = "released";
      return send(200, { id: parts[1], status: "released" });
    }
    if (req.method === "POST" && path === "/reservations") {
      const replay = [...state.reservations.values()].find((r) => r.externalId === body.externalId);
      if (replay) return send(200, replay);
      const h = state.holds.get(body.holdId);
      if (!h || h.status !== "active") return error(409, "hold_expired", "Hold expired or released. Request a new hold.");
      const q = state.quotes.get(h.quoteId)!;
      h.status = "used";
      const r = { id: randomUUID(), externalId: body.externalId, propertyId: q.propertyId, channel: "partner_test", checkIn: q.checkIn, checkOut: q.checkOut, status: "confirmed", adults: q.adults, children: q.children, totalCents: q.totalCents, currency: "EUR", guest: body.guest, notes: body.notes ?? null };
      state.reservations.set(r.id as string, r);
      return send(201, r);
    }
    if (parts[0] === "reservations" && parts.length === 2 && (req.method === "GET" || req.method === "DELETE")) {
      const r = state.reservations.get(parts[1]);
      if (!r) return error(404, "not_found", "Reservation not found.");
      if (req.method === "DELETE") r.status = "cancelled";
      return send(200, r);
    }
    if (req.method === "GET" && path === "/changes" && state.features.has("changes")) {
      const cursor = Number(url.searchParams.get("cursor")?.replace("c_", "") ?? NaN);
      const limit = Number(url.searchParams.get("limit") ?? 500);
      if (Number.isNaN(cursor)) return send(200, { changes: [], nextCursor: `c_${state.changes.length}`, hasMore: false });
      const page = state.changes.filter((c) => c.id > cursor).slice(0, limit);
      const last = page.length ? page[page.length - 1].id : cursor;
      return send(200, {
        changes: page.map((c) => ({ ...c, id: `chg_${c.id}`, occurredAt: new Date().toISOString() })),
        nextCursor: `c_${last}`,
        hasMore: state.changes.some((c) => c.id > last),
      });
    }
    return error(404, "not_found", "Endpoint not found.");
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://localhost:${port}/api/partner/v1`, server };
}
