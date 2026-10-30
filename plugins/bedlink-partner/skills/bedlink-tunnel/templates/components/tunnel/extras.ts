import type { Extra, ExtraSelection, StayKind } from "./types";

// Extras paid online with the stay (31/10/2026). The SAME arithmetic as
// BedLink, only to show the guest a line before the price is held. The amount
// charged is always BedLink's (the hold / slot reservation totalCents).
//
// units = quantity × persons and/or nights, depending on the unit:
//   per_stay → 1, per_person → persons, per_night → nights,
//   per_person_per_night → persons × nights. A day rental counts as one night.

export function extrasFor(extras: Extra[], kind: StayKind): Extra[] {
  const genre = kind === "night" ? "stay" : "day";
  return extras.filter((e) => e.appliesTo === "any" || e.appliesTo === genre);
}

export function extraUnits(e: Pick<Extra, "unit">, quantity: number, ctx: { persons: number; nights: number }) {
  const p = Math.max(1, ctx.persons);
  const n = Math.max(1, ctx.nights);
  const m = e.unit === "per_person" ? p : e.unit === "per_night" ? n : e.unit === "per_person_per_night" ? p * n : 1;
  return quantity * m;
}

export type ExtraLineView = {
  id: string;
  name: string;
  unit: Extra["unit"];
  quantity: number;
  units: number;
  unitPriceCents: number;
  totalCents: number;
};

export function priceSelection(extras: Extra[], value: ExtraSelection, ctx: { persons: number; nights: number }): ExtraLineView[] {
  return extras
    .filter((e) => (value[e.id] ?? 0) > 0)
    .map((e) => {
      const quantity = value[e.id];
      const units = extraUnits(e, quantity, ctx);
      return { id: e.id, name: e.name, unit: e.unit, quantity, units, unitPriceCents: e.priceCents, totalCents: units * e.priceCents };
    });
}

/** "× 2 pers. × 3 nuits", empty for a single flat extra. */
export function unitLabel(l: Pick<ExtraLineView, "unit" | "quantity" | "units">, ctx: { persons: number; nights: number }) {
  const parts: string[] = [];
  if (l.quantity > 1) parts.push(`× ${l.quantity}`);
  if (l.unit === "per_person" || l.unit === "per_person_per_night") parts.push(`${Math.max(1, ctx.persons)} pers.`);
  if ((l.unit === "per_night" || l.unit === "per_person_per_night") && ctx.nights > 1) parts.push(`${ctx.nights} nuits`);
  return parts.join(" · ");
}

export function perUnitSuffix(unit: Extra["unit"]) {
  return unit === "per_person" ? " / pers." : unit === "per_night" ? " / nuit" : unit === "per_person_per_night" ? " / pers. / nuit" : "";
}
