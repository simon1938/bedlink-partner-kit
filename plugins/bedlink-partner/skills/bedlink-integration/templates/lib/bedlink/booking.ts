import { randomUUID } from "node:crypto";
import { bedlink, BedlinkError } from "./client";
import { hasFeature } from "./config";
import { store as defaultStore, type BedlinkStore, type Checkout } from "./store";
import type { Guest, Quote, Reservation } from "./types";

// The booking path. NEVER decide a booking from the local copy: the copy
// says "probably free", only BedLink says "booked".
//
//   1. startCheckout()  POST /quotes        price for the exact stay (valid 5 min)
//   2. holdCheckout()   POST /holds         the night is closed everywhere for 15 min
//   3. payCheckout()    payments on  → POST /payment-sessions → embedded BedLink page
//                       payments off → POST /reservations (sandbox, no online payment)
//   4. the reservation is confirmed by BedLink (response, webhook, or getCheckoutStatus)
//
// externalId is generated once at step 1 and reused for the hold reference and
// the reservation: every retry is safe, BedLink never creates a duplicate.

const EXTERNAL_PREFIX = process.env.BEDLINK_EXTERNAL_ID_PREFIX || "ext";

export type CheckoutError =
  | "dates_unavailable"
  | "quote_expired"
  | "hold_expired"
  | "guest_limit"
  | "payment_unavailable"
  | "reservation_cancelled"
  | "reservation_started"
  | "price_change_requires_payment"
  | "unknown_checkout";

export class CheckoutFailed extends Error {
  constructor(
    public reason: CheckoutError | string,
    message: string,
  ) {
    super(message);
    this.name = "CheckoutFailed";
  }
}

function translate(e: unknown): never {
  if (e instanceof BedlinkError && e.status < 500 && e.status !== 401 && e.status !== 429) {
    throw new CheckoutFailed(e.code, e.message);
  }
  throw e;
}

export function createBooking(store: BedlinkStore = defaultStore) {
  async function load(externalId: string): Promise<Checkout> {
    const c = await store.getCheckout(externalId);
    if (!c) throw new CheckoutFailed("unknown_checkout", "Unknown checkout.");
    return c;
  }

  return {
    async startCheckout(input: {
      propertyId: string;
      checkIn: string;
      checkOut: string;
      adults: number;
      children?: number;
    }): Promise<{ externalId: string; quote: Quote }> {
      const quote = await bedlink
        .createQuote({ ...input, children: input.children ?? 0 })
        .catch(translate);
      const externalId = `${EXTERNAL_PREFIX}_${randomUUID()}`;
      await store.saveCheckout({
        externalId,
        propertyId: input.propertyId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: quote.adults,
        children: quote.children,
        quoteId: quote.id,
        quoteExpiresAt: quote.expiresAt,
        totalCents: quote.totalCents,
        currency: quote.currency,
        holdId: null,
        holdExpiresAt: null,
        paymentSessionId: null,
        status: "quoted",
        reservationId: null,
      });
      return { externalId, quote };
    },

    /** Re-quotes once if the 5-minute quote has expired. */
    async holdCheckout(externalId: string) {
      let c = await load(externalId);
      if (c.status !== "quoted" && c.status !== "held") throw new CheckoutFailed(c.status, `Checkout is ${c.status}.`);
      if (c.status === "held" && c.holdId && c.holdExpiresAt && Date.parse(c.holdExpiresAt) > Date.now() + 5_000) {
        return { holdId: c.holdId, expiresAt: c.holdExpiresAt, totalCents: c.totalCents!, currency: c.currency! };
      }
      // First hold: reference = externalId (a network retry returns the same hold).
      // A new hold after expiry needs a new reference, BedLink refuses to reuse one.
      const reference = c.holdId ? `${externalId}:${Date.now().toString(36)}` : externalId;
      try {
        const hold = await bedlink.createHold(c.quoteId!, reference);
        c = { ...c, holdId: hold.id, holdExpiresAt: hold.expiresAt, status: "held" };
      } catch (e) {
        if (!(e instanceof BedlinkError && e.code === "quote_expired")) translate(e);
        const quote = await bedlink
          .createQuote({ propertyId: c.propertyId, checkIn: c.checkIn, checkOut: c.checkOut, adults: c.adults, children: c.children })
          .catch(translate);
        // A new price may differ: the caller must show quote.totalCents again.
        const hold = await bedlink.createHold(quote.id, reference).catch(translate);
        c = { ...c, quoteId: quote.id, quoteExpiresAt: quote.expiresAt, totalCents: quote.totalCents, currency: quote.currency, holdId: hold.id, holdExpiresAt: hold.expiresAt, status: "held" };
      }
      await store.saveCheckout(c);
      return { holdId: c.holdId!, expiresAt: c.holdExpiresAt!, totalCents: c.totalCents!, currency: c.currency! };
    },

    /**
     * payments on : returns the BedLink payment page to embed (iframe) or to
     *               redirect to. The reservation is created by BedLink once paid.
     * payments off: creates the reservation directly (sandbox today).
     */
    async payCheckout(
      externalId: string,
      input: { guest: Guest; notes?: string; returnUrl: string; cancelUrl?: string },
    ): Promise<
      | { mode: "payment"; embedUrl?: string; url?: string; sessionId: string; amountCents: number; currency: string }
      | { mode: "confirmed"; reservation: Reservation }
    > {
      const c = await load(externalId);
      if (c.status === "confirmed" && c.reservationId) {
        return { mode: "confirmed", reservation: await bedlink.getReservation(c.reservationId) };
      }
      if (!c.holdId) throw new CheckoutFailed("hold_expired", "Hold the dates first.");
      if (hasFeature("payments")) {
        const s = await bedlink
          .createPaymentSession({ holdId: c.holdId, externalId, guest: input.guest, notes: input.notes, returnUrl: input.returnUrl, cancelUrl: input.cancelUrl })
          .catch(translate);
        await store.saveCheckout({ ...c, paymentSessionId: s.id, status: "paying" });
        return { mode: "payment", embedUrl: s.embedUrl, url: s.url, sessionId: s.id, amountCents: s.amountCents, currency: s.currency };
      }
      const reservation = await bedlink
        .createReservation({ holdId: c.holdId, externalId, guest: input.guest, notes: input.notes })
        .catch(translate);
      await store.upsertReservation(reservation);
      await store.saveCheckout({ ...c, status: "confirmed", reservationId: reservation.id });
      return { mode: "confirmed", reservation };
    },

    /** What to show after the payment page. Only BedLink's answer counts. */
    async getCheckoutStatus(externalId: string): Promise<{ status: Checkout["status"]; reservation?: Reservation }> {
      const c = await load(externalId);
      if (c.status === "confirmed" && c.reservationId) {
        return { status: "confirmed", reservation: await bedlink.getReservation(c.reservationId) };
      }
      if (c.status === "paying" && c.paymentSessionId) {
        const s = await bedlink.getPaymentSession(c.paymentSessionId);
        if (s.status === "succeeded" && s.reservationId) {
          const reservation = await bedlink.getReservation(s.reservationId);
          await store.upsertReservation(reservation);
          await store.saveCheckout({ ...c, status: "confirmed", reservationId: reservation.id });
          return { status: "confirmed", reservation };
        }
        if (s.status === "failed" || s.status === "expired") {
          await store.saveCheckout({ ...c, status: s.status === "failed" ? "failed" : "expired" });
          return { status: s.status === "failed" ? "failed" : "expired" };
        }
      }
      return { status: c.status };
    },

    /** The traveller gives up: free the dates right away instead of waiting 15 min. */
    async abandonCheckout(externalId: string) {
      const c = await load(externalId);
      if (c.holdId && (c.status === "held" || c.status === "quoted")) {
        await bedlink.releaseHold(c.holdId).catch(() => undefined);
        await store.saveCheckout({ ...c, status: "released" });
      }
    },

    /**
     * The traveller changes the dates (or guests) of a confirmed booking.
     * BedLink recomputes the price: show the new totalCents to the traveller.
     * A booking paid online keeps its amount: a change that would alter it is
     * refused (price_change_requires_payment), ask the host.
     */
    async modifyReservation(
      reservationId: string,
      input: { checkIn?: string; checkOut?: string; adults?: number; children?: number },
    ) {
      const r = await bedlink.modifyReservation(reservationId, input).catch(translate);
      await store.upsertReservation(r);
      return r;
    },

    async cancelReservation(reservationId: string) {
      const r = await bedlink.cancelReservation(reservationId).catch(translate);
      await store.upsertReservation(r);
      return r;
    },
  };
}

export const booking = createBooking();
