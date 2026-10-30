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
import { addDays, daysBetween } from "@/components/tunnel/format";
import { extrasFor, priceSelection } from "@/components/tunnel/extras";
import type {
  ActionResult,
  Extra,
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
import { tunnelStore, type TunnelExtra } from "@/lib/tunnel/store";

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

function notesFor(message: string): string | undefined {
  return message.trim() ? message.trim().slice(0, 2000) : undefined;
}

/** The extras of a property, from BedLink (prices included). [] when none or not reachable. */
export async function loadExtras(propertyId: string): Promise<Extra[]> {
  if (!UUID.test(propertyId)) return [];
  try {
    const r = await bedlink.listExtras(propertyId);
    return r.extras.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      photoUrl: e.photoUrl,
      priceCents: e.priceCents,
      unit: e.unit,
      appliesTo: e.appliesTo,
      maxQuantity: e.maxQuantity,
    }));
  } catch (e) {
    console.error("[tunnel] extras", e instanceof Error ? e.message : e);
    return [];
  }
}

function checkGuest(input: StartPaymentInput) {
  const g = input.guest;
  check(g && g.firstName?.trim() && g.lastName?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email ?? ""), "Bad guest.");
  check((g.phone ?? "").replace(/\D/g, "").length >= 9 && (g.message ?? "").length <= 1500, "Bad guest.");
  check(Array.isArray(input.extras) && input.extras.length <= 30, "Bad extras.");
  for (const e of input.extras) check(typeof e.id === "string" && UUID.test(e.id) && int(e.quantity, 1, 20), "Bad extra.");
  check(new Set(input.extras.map((e) => e.id)).size === input.extras.length, "Bad extras.");
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
    // Extras: ids and quantities only. BedLink prices them and adds them to the
    // amount charged; the lines kept here are re-read from BedLink's catalogue.
    const content = await getListing(listing);
    check(content, "Unknown listing.");
    const catalogue = input.extras.length ? extrasFor(await loadExtras(property.propertyId), input.kind === "night" ? "night" : "day") : [];
    for (const e of input.extras) check(catalogue.some((c) => c.id === e.id), "Unknown extra.");
    const persons = input.kind === "night" ? 0 : input.guests;
    const selection = Object.fromEntries(input.extras.map((e) => [e.id, e.quantity]));
    const extraRequests = input.extras.map((e) => ({ id: e.id, quantity: e.quantity }));
    const guest = {
      name: `${input.guest.firstName.trim()} ${input.guest.lastName.trim()}`,
      email: input.guest.email.trim(),
      phone: input.guest.phone.trim(),
    };
    const notes = notesFor(input.guest.message);
    const row = {
      listingId: listing,
      propertyId: property.propertyId,
      guestFirstName: input.guest.firstName.trim(),
      guestLastName: input.guest.lastName.trim(),
      guestEmail: guest.email,
      guestPhone: guest.phone,
      guestMessage: input.guest.message.trim() || null,
      extras: [] as TunnelExtra[],
    };

    if (input.kind === "night") {
      const c = await bedlinkStore.getCheckout(input.externalId);
      check(c && c.propertyId === property.propertyId, "Unknown checkout.");
      const nights = Math.max(1, daysBetween(c.checkIn, c.checkOut));
      const estimate = priceSelection(catalogue, selection, { persons: c.adults + c.children, nights });
      await tunnelStore.create({ ...row, extras: estimate, externalId: input.externalId, kind: "night" });
      // With extras, BedLink re-quotes stay + extras and holds THAT quote: hold.totalCents is the price.
      const hold = await booking.holdCheckout(input.externalId, { extras: extraRequests });
      if (hold.extras.length) await tunnelStore.create({ ...row, extras: hold.extras, externalId: input.externalId, kind: "night" });
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
    await tunnelStore.create({ ...row, extras: priceSelection(catalogue, selection, { persons, nights: 1 }), externalId, kind: "slot" });
    const r = await dayRental.reserve({
      propertyId: input.propertyId,
      formuleId: input.formuleId,
      slotId: input.slotId,
      date: input.date,
      guests: input.guests,
      externalId,
      guest,
      notes,
      ...(extraRequests.length ? { extras: extraRequests } : {}),
      ...(hasFeature("payments") ? { payment: { returnUrl: returnUrlFor(externalId) } } : {}),
    });
    if (r.extras?.length) await tunnelStore.create({ ...row, extras: r.extras, externalId, kind: "slot" });
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
