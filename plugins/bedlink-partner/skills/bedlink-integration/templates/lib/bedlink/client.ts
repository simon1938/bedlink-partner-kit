import { bedlinkConfig, calendarChunkDays, hasFeature, type Feature } from "./config";
import type {
  Calendar,
  CalendarDay,
  ChangesPage,
  Guest,
  Hold,
  Message,
  Page,
  PaymentSession,
  Property,
  Quote,
  QuoteInput,
  Reservation,
} from "./types";
import { addDays, daysBetween } from "./dates";

/** An error answered by BedLink: { error: { code, message }, requestId }. */
export class BedlinkError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public retryAfterSeconds?: number,
  ) {
    super(`BedLink ${status} ${code}: ${message}`);
    this.name = "BedlinkError";
  }
}

/** The endpoint exists in the contract but BedLink has not opened it yet. */
export class FeatureUnavailableError extends Error {
  constructor(public feature: Feature | string) {
    super(`BedLink feature not available yet: ${feature}`);
    this.name = "FeatureUnavailableError";
  }
}

type Options = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; feature?: Feature };

async function call<T>(path: string, opts: Options = {}): Promise<T> {
  if (opts.feature && !hasFeature(opts.feature)) throw new FeatureUnavailableError(opts.feature);
  const { apiKey, apiUrl } = bedlinkConfig();
  const res = await fetch(apiUrl + path, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON answer (proxy, outage): handled below.
  }
  if (res.ok) return json as T;
  const err = (json as { error?: { code?: string; message?: string }; requestId?: string } | null) ?? {};
  const code = err.error?.code ?? "http_error";
  const message = err.error?.message ?? (text.slice(0, 200) || res.statusText);
  // A route that does not exist yet answers 404 "Endpoint not found.".
  if (res.status === 404 && message === "Endpoint not found.") throw new FeatureUnavailableError(path);
  const retry = Number(res.headers.get("retry-after"));
  throw new BedlinkError(res.status, code, message, err.requestId, Number.isFinite(retry) ? retry : undefined);
}

const enc = encodeURIComponent;

export const bedlink = {
  // ── Available today ────────────────────────────────────────────────────
  listProperties: () => call<{ properties: Property[] }>("/properties").then((r) => r.properties),

  getProperty: (id: string) => call<Property>(`/properties/${enc(id)}`),

  /** One call, from..to inclusive, within calendarChunkDays(). */
  getCalendar: (id: string, from: string, to: string) =>
    call<Calendar>(`/properties/${enc(id)}/calendar?from=${from}&to=${to}`),

  /** Any range: split into the largest windows BedLink accepts. */
  async getCalendarRange(id: string, from: string, to: string): Promise<CalendarDay[]> {
    const chunk = calendarChunkDays();
    const days: CalendarDay[] = [];
    for (let start = from; daysBetween(start, to) >= 0; start = addDays(start, chunk)) {
      const end = daysBetween(start, to) >= chunk ? addDays(start, chunk - 1) : to;
      days.push(...(await bedlink.getCalendar(id, start, end)).days);
    }
    return days;
  },

  createQuote: (input: QuoteInput) => call<Quote>("/quotes", { method: "POST", body: input }),

  /** reference must be unique for you; repeating it returns the same hold. */
  createHold: (quoteId: string, reference: string) =>
    call<Hold>("/holds", { method: "POST", body: { quoteId, reference } }),

  releaseHold: (holdId: string) =>
    call<{ id: string; status: "released" }>(`/holds/${enc(holdId)}`, { method: "DELETE" }),

  /** Sandbox path (no online payment). externalId makes retries safe. */
  createReservation: (input: { holdId: string; externalId: string; guest: Guest; notes?: string }) =>
    call<Reservation>("/reservations", { method: "POST", body: input }),

  getReservation: (id: string) => call<Reservation>(`/reservations/${enc(id)}`),

  cancelReservation: (id: string) => call<Reservation>(`/reservations/${enc(id)}`, { method: "DELETE" }),

  // ── Planned (behind BEDLINK_FEATURES) ──────────────────────────────────
  /** Without cursor: returns the head cursor and no change. */
  getChanges: (cursor?: string | null, limit = 500) =>
    call<ChangesPage>(`/changes?limit=${limit}${cursor ? `&cursor=${enc(cursor)}` : ""}`, {
      feature: "changes",
    }),

  listReservations: (since: string, cursor?: string | null) =>
    call<Page<"reservations", Reservation>>(
      `/reservations?since=${enc(since)}${cursor ? `&cursor=${enc(cursor)}` : ""}`,
      { feature: "reservations_list" },
    ),

  listMessages: (reservationId: string, cursor?: string | null) =>
    call<Page<"messages", Message>>(
      `/reservations/${enc(reservationId)}/messages${cursor ? `?cursor=${enc(cursor)}` : ""}`,
      { feature: "messages" },
    ),

  sendMessage: (
    reservationId: string,
    input: { externalId: string; sender: "guest" | "host"; body: string; sentAt?: string },
  ) =>
    call<Message>(`/reservations/${enc(reservationId)}/messages`, {
      method: "POST",
      body: input,
      feature: "messages",
    }),

  createPaymentSession: (input: {
    holdId: string;
    externalId: string;
    guest: Guest;
    notes?: string;
    returnUrl: string;
    cancelUrl?: string;
  }) => call<PaymentSession>("/payment-sessions", { method: "POST", body: input, feature: "payments" }),

  /**
   * Change the dates or guests of YOUR reservation. Send only what changes;
   * BedLink re-checks the stay and recomputes totalCents (never sent by you).
   * Sending the current values again is a no-op (200).
   */
  modifyReservation: (
    id: string,
    input: { checkIn?: string; checkOut?: string; adults?: number; children?: number },
  ) =>
    call<Reservation>(`/reservations/${enc(id)}`, {
      method: "PATCH",
      body: input,
      feature: "reservations_modify",
    }),

  getPaymentSession: (id: string) =>
    call<PaymentSession>(`/payment-sessions/${enc(id)}`, { feature: "payments" }),
};
