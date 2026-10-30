"use client";

import { formatDay, formatHour, formatMoney, plural } from "./format";
import type { Extra, ExtraSelection, StayKind, TunnelListing } from "./types";

// The summary: sticky right column on a computer (Alexian, Yenna), unfolded
// from the bottom bar on a phone. Prices come ONLY from the BedLink quote
// (nights or slot). Nothing is computed here except the extras, which are
// yours and paid on site.

export type SummaryPrice = {
  lines: { label: string; cents: number }[];
  totalCents: number;
  currency: string;
} | null;

export function nightLines(nights: { date: string; priceCents: number }[], totalCents: number) {
  const sum = nights.reduce((s, n) => s + n.priceCents, 0);
  const lines = [{ label: plural(nights.length, "nuit", "nuits"), cents: sum }];
  // Today the quote total is the sum of the nights. If BedLink adds fees one day,
  // show the difference as such instead of hiding it.
  if (totalCents !== sum) lines.push({ label: "Frais (devis BedLink)", cents: totalCents - sum });
  return lines;
}

export function selectedExtras(extras: Extra[], value: ExtraSelection) {
  return extras
    .filter((e) => (value[e.id] ?? 0) > 0)
    .map((e) => ({ id: e.id, name: e.name, quantity: value[e.id], unitPriceCents: e.priceCents, perPerson: !!e.perPerson }));
}

export function BookingSummary(props: {
  listing: TunnelListing;
  kind: StayKind;
  checkIn?: string | null;
  checkOut?: string | null;
  day?: string | null;
  slot?: { name: string; start: string; end: string } | null;
  adults: number;
  children: number;
  price: SummaryPrice;
  extras: ReturnType<typeof selectedExtras>;
  justAdded?: string | null; // extra id, for the short highlight
  final?: boolean; // confirmation page
}) {
  const { listing, price } = props;
  const extrasTotal = props.extras.reduce((s, e) => s + e.quantity * e.unitPriceCents, 0);
  const guests = `${plural(props.adults, "adulte", "adultes")}${props.children ? ", " + plural(props.children, "enfant", "enfants") : ""}`;

  return (
    <div className="bt-recap">
      <div className="bt-recap-head">
        {listing.photoUrl ? <img src={listing.photoUrl} alt="" className="bt-recap-photo" /> : null}
        <div>
          <h4>{listing.name}</h4>
          {listing.subtitle ? <span className="bt-small bt-muted">{listing.subtitle}</span> : null}
        </div>
      </div>

      <div className="bt-recap-block">
        {props.kind === "night" ? (
          <>
            <Row label="Arrivée" value={props.checkIn ? formatDay(props.checkIn) + (listing.checkInFrom ? ` · dès ${formatHour(listing.checkInFrom)}` : "") : "·"} />
            <Row label="Départ" value={props.checkOut ? formatDay(props.checkOut) + (listing.checkOutUntil ? ` · avant ${formatHour(listing.checkOutUntil)}` : "") : "·"} />
          </>
        ) : (
          <>
            <Row label="Jour" value={props.day ? formatDay(props.day) : "·"} />
            <Row label="Formule" value={props.slot?.name ?? "·"} />
            <Row label="Créneau" value={props.slot ? `${props.slot.start} → ${props.slot.end}` : "·"} />
          </>
        )}
        <Row label="Voyageurs" value={guests} />
      </div>

      <div className="bt-recap-block">
        {price ? (
          price.lines.map((l) => <Row key={l.label} label={l.label} value={formatMoney(l.cents, price.currency)} />)
        ) : (
          <Row label="Tarif" value={props.kind === "night" ? "Choisissez vos dates" : "Choisissez un créneau"} />
        )}
      </div>

      <div className="bt-recap-total">
        <span>{props.final ? "Payé" : "À payer maintenant"}</span>
        <strong>{price ? formatMoney(price.totalCents, price.currency) : "·"}</strong>
      </div>
      {price && !props.final ? <span className="bt-live">Tarif vérifié en direct</span> : null}

      {props.extras.length ? (
        <div className="bt-recap-block bt-recap-extras">
          <span className="bt-cap">Extras · à régler sur place</span>
          {props.extras.map((e) => (
            <Row
              key={e.id}
              className={props.justAdded === e.id ? "is-new" : undefined}
              label={e.name + (e.perPerson ? ` × ${e.quantity}` : "")}
              value={formatMoney(e.quantity * e.unitPriceCents, listing.currency)}
            />
          ))}
          <Row label="Sur place" value={formatMoney(extrasTotal, listing.currency)} />
        </div>
      ) : null}

      {!props.final ? (
        <p className="bt-recap-foot">{listing.cancellationSummary || "Annulation selon les conditions de l’hôte"}</p>
      ) : null}
    </div>
  );
}

function Row(props: { label: string; value: string; className?: string }) {
  return (
    <div className={props.className ? "bt-row " + props.className : "bt-row"}>
      <span>{props.label}</span>
      <span>{props.value}</span>
    </div>
  );
}
