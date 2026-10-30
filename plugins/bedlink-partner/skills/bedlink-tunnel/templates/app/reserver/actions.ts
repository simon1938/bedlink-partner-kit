"use server";

// Server actions of the booking tunnel. The ONLY place that talks to BedLink
// for the tunnel: the browser never sees the key and never decides a price.
// Every input is checked here: a server action can be called by anyone.

import { randomUUID } from "node:crypto";
import { booking, CheckoutFailed } from "@/lib/bedlink/booking";
import { bedlink, BedlinkError, FeatureUnavailableError } from "@/lib/bedlink/client";
import { hasFeature } from "@/lib/bedlink/config";
import { store as bedlinkStore } from "@/lib/bedlink/store";
import { dayRental, SLOTS_MAX_DAYS } from "@/lib/bedlink/day-rental";
import { addDays, daysBetween, formatMoney } from "@/components/tunnel/format";
import type {
  ActionResult,
  BookingState,
  Formule,
  FreeSlot,
  NightQuote,
  PaymentStart,
  SlotQuote,
  StartPaymentInput,
  TunnelDay,
} from "@/components/tunnel/types";
import { getListing } from "@/lib/tunnel/config";
import { confirmAndNotify, returnUrlFor } from "@/lib/tunnel/notify";
import { refreshBooking } from "@/lib/tunnel/status";
import { tunnelStore } from "@/lib/tunnel/store";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = process.env.BEDLINK_EXTERNAL_ID_PREFIX || "la";

class Invalid extends Error {}
function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Invalid(what);
}
const int = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, reason: "invalid_request", message: e.message };
    if (e instanceof CheckoutFailed) return { ok: false, reason: e.reason, message: e.message };
    if (e instanceof BedlinkError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
      return { ok: false, reason: e.code, message: e.message };
    }
    if (e instanceof FeatureUnavailableError) return { ok: false, reason: "unavailable", message: "Not opened by BedLink yet." };
    console.error("[tunnel]", e instanceof Error ? e.message : e);
    return { ok: false, reason: "unavailable", message: "Réservation momentanément indisponible." };
  }
}

// ── Calendar (local copy, filled by the BedLink sync) ───────────────────

export async function loadCalendar(propertyId: string, from: string, to: string): Promise<ActionResult<TunnelDay[]>> {
  return run(async () => {
    check(UUID.test(propertyId) && DATE.test(from) && DATE.test(to), "Bad calendar range.");
    check(daysBetween(from, to) >= 0 && daysBetween(from, to) <= 400, "Range too long.");
    const days = await tunnelStore.calendarDays(propertyId, from, to);
    if (days.length) return days;
    // Copy still empty (first sync not run yet): read BedLink directly.
    const live = await bedlink.getCalendarRange(propertyId, from, to);
    return live.map(({ priceCents: _price, ...d }) => d);
  });
}

// ── Night stay ────────────────────────────────────────────────────────

/** POST /quotes: the exact price, valid 5 minutes. Nothing is held yet. */
export async function quoteNights(input: {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}): Promise<ActionResult<NightQuote>> {
  return run(async () => {
    check(UUID.test(input.propertyId) && DATE.test(input.checkIn) && DATE.test(input.checkOut), "Bad stay.");
    check(int(daysBetween(input.checkIn, input.checkOut), 1, 90), "1 to 90 nights.");
    check(int(input.adults, 1, 50) && int(input.children, 0, 50), "Bad guests.");
    const { externalId, quote } = await booking.startCheckout(input);
    return { externalId, totalCents: quote.totalCents, currency: quote.currency, nights: quote.nights };
  });
}

// ── Day rental ────────────────────────────────────────────────────────

/** Formules + FREE slots. A place without day rental answers empty lists. */
export async function loadSlots(propertyId: string, from: string, to: string): Promise<ActionResult<{ formules: Formule[]; slots: FreeSlot[] }>> {
  return run(async () => {
    check(UUID.test(propertyId) && DATE.test(from) && DATE.test(to), "Bad range.");
    const end = daysBetween(from, to) > SLOTS_MAX_DAYS - 1 ? addDays(from, SLOTS_MAX_DAYS - 1) : to;
    try {
      const [formules, slots] = await Promise.all([dayRental.listFormules(propertyId), dayRental.listFreeSlots(propertyId, from, end)]);
      return { formules, slots };
    } catch (e) {
      if (e instanceof FeatureUnavailableError) return { formules: [], slots: [] };
      if (e instanceof BedlinkError && e.code === "day_rental_disabled") return { formules: [], slots: [] };
      throw e;
    }
  });
}

/** POST /creneaux/quotes: price and availability of one slot. Nothing is held. */
export async function quoteSlot(input: {
  propertyId: string;
  formuleId: string;
  slotId: string;
  date: string;
  guests: number;
}): Promise<ActionResult<SlotQuote>> {
  return run(async () => {
    check(UUID.test(input.propertyId) && UUID.test(input.formuleId) && DATE.test(input.date), "Bad slot.");
    check(/^[a-z0-9-]{1,40}$/.test(input.slotId) && int(input.guests, 1, 1000), "Bad slot.");
    const q = await dayRental.quote(input);
    return { available: q.available, totalCents: q.totalCents, currency: q.currency, startAt: q.startAt, endAt: q.endAt, nightIncluded: q.nightIncluded };
  });
}

// ── Payment (both kinds) ──────────────────────────────────────────────

function notesFor(message: string, extras: StartPaymentInput["extras"], currency: string): string | undefined {
  const parts: string[] = [];
  if (message.trim()) parts.push(message.trim());
  if (extras.length) {
    const list = extras.map((e) => `${e.name} × ${e.quantity} = ${formatMoney(e.quantity * e.unitPriceCents, currency)}`).join(" ; ");
    parts.push(`Extras demandés sur Logement Atypique, à régler sur place : ${list}`);
  }
  return parts.length ? parts.join("\n\n").slice(0, 2000) : undefined;
}

function checkGuest(input: StartPaymentInput) {
  const g = input.guest;
  check(g && g.firstName?.trim() && g.lastName?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email ?? ""), "Bad guest.");
  check((g.phone ?? "").replace(/\D/g, "").length >= 9 && (g.message ?? "").length <= 1500, "Bad guest.");
  check(Array.isArray(input.extras) && input.extras.length <= 30, "Bad extras.");
  for (const e of input.extras) check(typeof e.id === "string" && int(e.quantity, 1, 99), "Bad extra.");
}

/**
 * Night : POST /holds (15 min, closed everywhere) then POST /payment-sessions.
 * Slot  : POST /creneaux/reservations with payment (pending_payment, 15 min).
 * Without the "payments" feature (sandbox), BedLink confirms right away.
 */
export async function startPayment(input: StartPaymentInput): Promise<ActionResult<PaymentStart>> {
  return run(async () => {
    checkGuest(input);
    const listing = String(input.listingId);
    const property = await tunnelStore.propertyForListing(listing);
    check(property, "Unknown listing.");
    // Extras: names and prices re-read from YOUR catalogue, never from the browser.
    const content = await getListing(listing);
    check(content, "Unknown listing.");
    const extras = input.extras.map((e) => {
      const x = content.extras.find((c) => c.id === e.id);
      check(x, "Unknown extra.");
      if (x.nightsOnly) check(input.kind === "night", "Extra reserved to nights.");
      return { id: x.id, name: x.name, quantity: e.quantity, unitPriceCents: x.priceCents };
    });
    const guest = {
      name: `${input.guest.firstName.trim()} ${input.guest.lastName.trim()}`,
      email: input.guest.email.trim(),
      phone: input.guest.phone.trim(),
    };
    const notes = notesFor(input.guest.message, extras, property.currency);
    const row = {
      listingId: listing,
      propertyId: property.propertyId,
      guestFirstName: input.guest.firstName.trim(),
      guestLastName: input.guest.lastName.trim(),
      guestEmail: guest.email,
      guestPhone: guest.phone,
      guestMessage: input.guest.message.trim() || null,
      extras,
    };

    if (input.kind === "night") {
      const c = await bedlinkStore.getCheckout(input.externalId);
      check(c && c.propertyId === property.propertyId, "Unknown checkout.");
      await tunnelStore.create({ ...row, externalId: input.externalId, kind: "night" });
      const hold = await booking.holdCheckout(input.externalId); // may re-quote: hold.totalCents is the price
      const pay = await booking.payCheckout(input.externalId, { guest, notes, returnUrl: returnUrlFor(input.externalId) });
      if (pay.mode === "confirmed") {
        await confirmAndNotify(input.externalId).catch((e) => console.error("[tunnel] e-mails", e));
        return { mode: "confirmed", ref: input.externalId, totalCents: pay.reservation.totalCents, currency: pay.reservation.currency };
      }
      return {
        mode: "payment",
        ref: input.externalId,
        embedUrl: pay.embedUrl ?? pay.url!,
        url: pay.url ?? pay.embedUrl!,
        expiresAt: hold.expiresAt,
        totalCents: pay.amountCents,
        currency: pay.currency,
      };
    }

    check(UUID.test(input.propertyId) && input.propertyId === property.propertyId, "Bad property.");
    check(UUID.test(input.formuleId) && DATE.test(input.date) && int(input.guests, 1, 1000), "Bad slot.");
    const externalId = `${PREFIX}_slot_${randomUUID()}`;
    await tunnelStore.create({ ...row, externalId, kind: "slot" });
    const r = await dayRental.reserve({
      propertyId: input.propertyId,
      formuleId: input.formuleId,
      slotId: input.slotId,
      date: input.date,
      guests: input.guests,
      externalId,
      guest,
      notes,
      ...(hasFeature("payments") ? { payment: { returnUrl: returnUrlFor(externalId) } } : {}),
    });
    await tunnelStore.setSlotReservation(externalId, r.id);
    if (r.status === "confirmed") {
      await confirmAndNotify(externalId).catch((e) => console.error("[tunnel] e-mails", e));
      return { mode: "confirmed", ref: externalId, totalCents: r.totalCents, currency: r.currency };
    }
    check(r.payment, "No payment page.");
    return {
      mode: "payment",
      ref: externalId,
      embedUrl: r.payment.embedUrl,
      url: r.payment.url,
      expiresAt: r.payment.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
      totalCents: r.totalCents,
      currency: r.currency,
    };
  });
}

/** What BedLink says, never the browser. Sends the e-mails the first time it is confirmed. */
export async function bookingStatus(ref: string): Promise<ActionResult<{ state: BookingState }>> {
  return run(async () => {
    check(typeof ref === "string" && ref.length <= 100, "Bad reference.");
    const state = await refreshBooking(ref);
    check(state, "Unknown reference.");
    return { state };
  });
}

/** The guest leaves the payment step: free the dates now, not in 15 minutes. */
export async function release(ref: string): Promise<ActionResult<null>> {
  return run(async () => {
    check(typeof ref === "string" && ref.length <= 100, "Bad reference.");
    const t = await tunnelStore.get(ref);
    if (!t || t.status !== "pending") return null;
    if (t.kind === "night") {
      const c = await bedlinkStore.getCheckout(ref);
      if (c?.holdId && (c.status === "held" || c.status === "paying")) {
        await bedlink.releaseHold(c.holdId).catch(() => undefined);
        await bedlinkStore.saveCheckout({ ...c, status: "released" });
      }
    } else if (t.slotReservationId) {
      const r = await dayRental.get(t.slotReservationId);
      if (r.status === "pending_payment") await dayRental.cancel(r.id).catch(() => undefined);
    }
    await tunnelStore.setStatus(ref, "released");
    return null;
  });
}
