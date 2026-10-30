import { formatMoney } from "@/components/tunnel/format";
import { box, button, esc, kicker, layout, paragraph, table, title } from "./layout";

// The two confirmation e-mails, sent by YOUR site once BedLink has confirmed
// the booking (BedLink does not e-mail the guest or the host for a partner
// booking). Built from data BedLink confirmed, never from the browser.

export type EmailBooking = {
  ref: string; // your externalId
  kind: "night" | "slot";
  listingName: string;
  listingUrl: string;
  photoUrl?: string;
  hostFirstName?: string;
  when: string; // "ven. 13 nov. → dim. 15 nov. · 2 nuits" or "sam. 21 nov. · 17:30 → 19:30"
  formuleName?: string;
  guestsLabel: string; // "2 adultes, 1 enfant"
  priceLines: { label: string; cents: number }[];
  totalCents: number;
  currency: string;
  extras: { label: string; cents: number }[]; // paid online, included in totalCents
  guest: { name: string; email: string; phone?: string | null; message?: string | null };
  cancellationSummary?: string | null;
  manageUrl?: string; // your "ma réservation" page, if you have one
  supportEmail: string;
};

function money(cents: number, currency: string) {
  return esc(formatMoney(cents, currency));
}

/** One row per extra, above the total: they are paid online with the stay. */
function extrasRows(b: EmailBooking): [string, string][] {
  return b.extras.map((e) => [esc(e.label), money(e.cents, b.currency)] as [string, string]);
}

export function guestEmail(b: EmailBooking) {
  const host = b.hostFirstName ?? "Votre hôte";
  const rows: [string, string][] = [
    [b.kind === "night" ? "Séjour" : "Venue", esc(b.when)],
    ...(b.formuleName ? ([["Formule", esc(b.formuleName)]] as [string, string][]) : []),
    ["Voyageurs", esc(b.guestsLabel)],
    ...b.priceLines.map((l) => [esc(l.label), money(l.cents, b.currency)] as [string, string]),
    ...extrasRows(b),
  ];
  const body =
    kicker(`Réservation confirmée · ${b.ref}`) +
    title(`Bonjour ${b.guest.name.split(" ")[0]}, tout est prêt.`) +
    paragraph(`Votre réservation à <strong>${esc(b.listingName)}</strong> est confirmée et payée. ${esc(host)}, votre hôte, l’a bien reçue.`) +
    table(rows, ["Payé", money(b.totalCents, b.currency)]) +
    box(
      `<strong>Et maintenant ?</strong><br>${esc(host)} vous enverra l’adresse exacte et les instructions d’arrivée avant votre venue.` +
        (b.cancellationSummary ? `<br><br><strong>Annulation</strong><br>${esc(b.cancellationSummary)}` : ""),
    ) +
    button(b.manageUrl ? "Voir ma réservation" : "Revoir le logement", b.manageUrl ?? b.listingUrl);

  const html = layout({
    preheader: `Réservation confirmée à ${b.listingName}`,
    band: "RÉSERVATION DIRECTE",
    heroUrl: b.photoUrl,
    body,
    footer: `Une question ? Écrivez-nous à <a href="mailto:${esc(b.supportEmail)}" style="color:inherit">${esc(b.supportEmail)}</a>.<br>Référence ${esc(b.ref)}`,
  });

  const text = [
    `Réservation confirmée · ${b.ref}`,
    ``,
    `Bonjour ${b.guest.name.split(" ")[0]},`,
    `Votre réservation à ${b.listingName} est confirmée et payée.`,
    ``,
    `${b.kind === "night" ? "Séjour" : "Venue"} : ${b.when}`,
    ...(b.formuleName ? [`Formule : ${b.formuleName}`] : []),
    `Voyageurs : ${b.guestsLabel}`,
    ...b.extras.map((e) => `${e.label} : ${formatMoney(e.cents, b.currency)}`),
    `Payé : ${formatMoney(b.totalCents, b.currency)}${b.extras.length ? " (extras compris)" : ""}`,
    ``,
    `${host} vous enverra l’adresse exacte et les instructions d’arrivée.`,
    ...(b.cancellationSummary ? [``, `Annulation : ${b.cancellationSummary}`] : []),
    ``,
    `Une question ? ${b.supportEmail}`,
  ].join("\n");

  return { subject: `Réservation confirmée · ${b.listingName} · ${b.when}`, html, text };
}

/** BedLink dashboard, list of reservations: the partner id is not the BedLink one, so no deep link. */
export const BEDLINK_RESERVATIONS_URL = "https://app.bedlink.fr/fr/dashboard/reservations";

export function hostEmail(b: EmailBooking) {
  const rows: [string, string][] = [
    [b.kind === "night" ? "Séjour" : "Venue", esc(b.when)],
    ...(b.formuleName ? ([["Formule", esc(b.formuleName)]] as [string, string][]) : []),
    ["Voyageurs", esc(b.guestsLabel)],
    ["Voyageur", `${esc(b.guest.name)}<br>${esc(b.guest.email)}${b.guest.phone ? "<br>" + esc(b.guest.phone) : ""}`],
    ...(b.guest.message ? ([["Message", esc(b.guest.message).replace(/\n/g, "<br>")]] as [string, string][]) : []),
    ...extrasRows(b),
  ];
  const body =
    kicker(`Nouvelle réservation · ${b.ref}`) +
    title(`${formatMoney(b.totalCents, b.currency)} encaissés pour ${b.listingName}.`) +
    paragraph(`${esc(b.guest.name)} vient de réserver et de payer sur Logement Atypique. Le paiement arrive sur votre compte Stripe.`) +
    table(rows, ["Payé en ligne", money(b.totalCents, b.currency)]) +
    box("✓ Dates déjà fermées sur Airbnb, Booking et vos autres canaux reliés à BedLink.") +
    button("Ouvrir dans BedLink", BEDLINK_RESERVATIONS_URL);

  const html = layout({
    preheader: `Nouvelle réservation : ${b.guest.name}, ${b.when}`,
    band: "ESPACE HÔTE",
    body,
    footer: `Vous recevez cet e-mail car ${esc(b.listingName)} est réservable sur Logement Atypique.`,
  });

  const text = [
    `Nouvelle réservation · ${b.ref}`,
    `${b.listingName} : ${b.when}`,
    ...(b.formuleName ? [`Formule : ${b.formuleName}`] : []),
    `Voyageurs : ${b.guestsLabel}`,
    `Voyageur : ${b.guest.name}, ${b.guest.email}${b.guest.phone ? ", " + b.guest.phone : ""}`,
    ...(b.guest.message ? [`Message : ${b.guest.message}`] : []),
    ...b.extras.map((e) => `Extra payé en ligne : ${e.label} (${formatMoney(e.cents, b.currency)})`),
    `Payé en ligne : ${formatMoney(b.totalCents, b.currency)}${b.extras.length ? " (extras compris)" : ""}`,
    `Dates déjà fermées sur vos autres canaux.`,
    `Ouvrir dans BedLink : ${BEDLINK_RESERVATIONS_URL}`,
  ].join("\n");

  return { subject: `Nouvelle réservation · ${b.guest.name} · ${b.when}`, html, text, replyTo: b.guest.email };
}
