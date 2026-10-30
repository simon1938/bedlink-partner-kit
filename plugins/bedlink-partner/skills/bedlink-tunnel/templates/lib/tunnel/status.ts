import { booking } from "@/lib/bedlink/booking";
import { dayRental } from "@/lib/bedlink/day-rental";
import type { BookingState } from "@/components/tunnel/types";
import { confirmAndNotify } from "./notify";
import { tunnelStore } from "./store";

// Where a booking stands, asked to BedLink (never to the browser), and the
// e-mails sent the first time it is confirmed. Used by the tunnel, the return
// page and the cron sweep (a guest may close the tab right after paying).

export async function refreshBooking(ref: string): Promise<BookingState | null> {
  const t = await tunnelStore.get(ref);
  if (!t) return null;
  if (t.status === "released") return "expired";
  let state: BookingState = "pending";
  if (t.kind === "night") {
    const s = await booking.getCheckoutStatus(ref);
    // "failed" = a card was refused: the BedLink page lets the guest try again.
    state = s.status === "confirmed" ? "confirmed" : s.status === "expired" || s.status === "released" ? "expired" : "pending";
  } else if (t.slotReservationId) {
    const r = await dayRental.get(t.slotReservationId);
    state = r.status === "confirmed" ? "confirmed" : r.status === "pending_payment" ? "pending" : "expired";
  }
  if (state === "confirmed") await confirmAndNotify(ref).catch((e) => console.error("[tunnel] e-mails", e));
  else if (state === "expired" && t.status === "pending") await tunnelStore.setStatus(ref, "expired");
  return state;
}

/**
 * Call it from your cron (/api/bedlink/cron, every 10 minutes): pending
 * bookings of the last 2 hours are checked, and confirmed ones not yet
 * e-mailed are e-mailed. Slots have no reservation.confirmed webhook.
 */
export async function sweepPendingBookings(limit = 20) {
  const refs = await tunnelStore.toSweep(limit);
  let confirmed = 0;
  for (const ref of refs) {
    const state = await refreshBooking(ref).catch(() => null);
    if (state === "confirmed") confirmed++;
  }
  return { checked: refs.length, confirmed };
}
