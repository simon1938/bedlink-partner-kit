"use server";

// Example server actions for a checkout page. Adapt names and validation to
// the project (zod, auth, rate limiting…). Never call BedLink from the browser.
import { booking, CheckoutFailed } from "@/lib/bedlink/booking";

type Result<T> = { ok: true; data: T } | { ok: false; reason: string; message: string };

async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof CheckoutFailed) return { ok: false, reason: e.reason, message: e.message };
    console.error("[bedlink] checkout error", e instanceof Error ? e.message : e);
    return { ok: false, reason: "unavailable", message: "Réservation momentanément indisponible." };
  }
}

/** Step 1: exact price for the stay (the local calendar copy only gave an estimate). */
export async function quoteStay(input: { propertyId: string; checkIn: string; checkOut: string; adults: number; children?: number }) {
  return safe(() => booking.startCheckout(input));
}

/** Step 2: the traveller clicks "Book": the dates are held 15 minutes everywhere. */
export async function holdStay(externalId: string) {
  return safe(() => booking.holdCheckout(externalId));
}

/** Step 3: guest details → payment page (payments on) or direct confirmation (sandbox). */
export async function payStay(externalId: string, guest: { name: string; email: string; phone?: string }) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return safe(() =>
    booking.payCheckout(externalId, {
      guest,
      returnUrl: `${site}/reservation/${encodeURIComponent(externalId)}/merci`,
      cancelUrl: `${site}/reservation/${encodeURIComponent(externalId)}`,
    }),
  );
}

/** Step 4: the confirmation page asks the server, never trusts the browser. */
export async function stayStatus(externalId: string) {
  return safe(() => booking.getCheckoutStatus(externalId));
}

export async function abandonStay(externalId: string) {
  return safe(() => booking.abandonCheckout(externalId));
}
