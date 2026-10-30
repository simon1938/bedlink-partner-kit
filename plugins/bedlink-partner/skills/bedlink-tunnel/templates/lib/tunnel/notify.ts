import { bedlink } from "@/lib/bedlink/client";
import { store as bedlinkStore } from "@/lib/bedlink/store";
import { dayRental } from "@/lib/bedlink/day-rental";
import { daysBetween, formatDay, plural } from "@/components/tunnel/format";
import { EMAIL_FROM, getListing, sendEmail, siteUrl, SUPPORT_EMAIL } from "./config";
import { guestEmail, hostEmail, type EmailBooking } from "./emails/booking-emails";
import { tunnelStore } from "./store";

// Sends the guest and host e-mails ONCE per booking, whoever notices the
// confirmation first: the tunnel (bookingStatus), the return page, or the
// BedLink webhook reservation.confirmed. tunnelStore.claimEmails is the lock.

export async function confirmAndNotify(externalId: string): Promise<void> {
  await tunnelStore.setStatus(externalId, "confirmed");
  if (!(await tunnelStore.claimEmails(externalId))) return; // already sent, or being sent
  try {
    const { booking, hostEmail: hostTo } = await buildEmailBooking(externalId);
    const g = guestEmail(booking);
    const h = hostEmail(booking);
    await sendEmail({ from: EMAIL_FROM, to: booking.guest.email, subject: g.subject, html: g.html, text: g.text, replyTo: SUPPORT_EMAIL });
    await sendEmail({ from: EMAIL_FROM, to: hostTo, subject: h.subject, html: h.html, text: h.text, replyTo: h.replyTo });
  } catch (e) {
    await tunnelStore.unclaimEmails(externalId);
    throw e;
  }
}

async function buildEmailBooking(externalId: string): Promise<{ booking: EmailBooking; hostEmail: string }> {
  const t = await tunnelStore.get(externalId);
  if (!t) throw new Error(`Unknown tunnel booking ${externalId}`);
  const listing = await getListing(t.listingId);
  if (!listing) throw new Error(`Unknown listing ${t.listingId}`);
  const property = await tunnelStore.propertyForListing(t.listingId);

  const common = {
    ref: externalId,
    listingName: listing.name,
    listingUrl: listing.url,
    photoUrl: listing.photoUrl,
    hostFirstName: listing.hostFirstName,
    guest: {
      name: `${t.guestFirstName} ${t.guestLastName}`,
      email: t.guestEmail,
      phone: t.guestPhone,
      message: t.guestMessage,
    },
    cancellationSummary: property?.cancellationPolicy?.summary?.fr ?? null,
    supportEmail: SUPPORT_EMAIL,
  };

  if (t.kind === "night") {
    // The BedLink reservation, never the browser: dates, guests, amount.
    const c = await bedlinkStore.getCheckout(externalId);
    if (!c?.reservationId) throw new Error(`Checkout ${externalId} is not confirmed`);
    const r = await bedlink.getReservation(c.reservationId);
    const n = daysBetween(r.checkIn, r.checkOut);
    // Extras paid with the stay: BedLink's lines first, the ones kept here otherwise.
    const extras = extraLines(r.extras?.length ? r.extras : t.extras);
    const extrasCents = extras.reduce((sum, e) => sum + e.cents, 0);
    const booking: EmailBooking = {
      ...common,
      kind: "night",
      when: `${formatDay(r.checkIn)} → ${formatDay(r.checkOut)} · ${plural(n, "nuit", "nuits")}`,
      guestsLabel: guestsLabel(r.adults, r.children),
      priceLines: [{ label: plural(n, "nuit", "nuits"), cents: r.totalCents - extrasCents }],
      totalCents: r.payment?.amountCents ?? r.totalCents,
      currency: r.currency,
      extras,
    };
    return { booking, hostEmail: listing.hostEmail };
  }

  const s = await dayRental.get(t.slotReservationId!);
  const hour = (iso: string) =>
    new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: property?.timezone ?? "Europe/Paris" }).format(new Date(iso));
  const slotExtras = extraLines(s.extras?.length ? s.extras : t.extras);
  const slotExtrasCents = slotExtras.reduce((sum, e) => sum + e.cents, 0);
  const booking: EmailBooking = {
    ...common,
    kind: "slot",
    when: `${formatDay(s.date)} · ${hour(s.startAt)} → ${hour(s.endAt)}`,
    formuleName: `${s.formuleName} · ${s.slotLabel}`,
    guestsLabel: plural(s.guests, "personne", "personnes"),
    priceLines: [{ label: s.formuleName, cents: s.totalCents - slotExtrasCents }],
    totalCents: s.totalCents,
    currency: s.currency,
    extras: slotExtras,
  };
  return { booking, hostEmail: listing.hostEmail };
}

/** Extras paid online with the stay, as e-mail lines (they are IN the total). */
function extraLines(list: { name: string; units: number; unitPriceCents: number; totalCents?: number }[]) {
  return list.map((e) => ({ label: e.units > 1 ? `${e.name} × ${e.units}` : e.name, cents: e.totalCents ?? e.units * e.unitPriceCents }));
}

function guestsLabel(adults: number, children: number) {
  return plural(adults, "adulte", "adultes") + (children ? ", " + plural(children, "enfant", "enfants") : "");
}

/** Where the BedLink payment page sends the guest back (and the postMessage origin). */
export function returnUrlFor(externalId: string) {
  return `${siteUrl()}/reserver/merci?ref=${encodeURIComponent(externalId)}`;
}
