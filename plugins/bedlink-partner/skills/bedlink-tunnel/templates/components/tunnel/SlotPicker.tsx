"use client";

import { formatMoney } from "./format";
import { kindOfSlot } from "./StayTypePicker";
import type { FreeSlot, Formule, StayKind } from "./types";

// Step "Créneau" (day or evening): the formules that still have a FREE slot on
// the chosen day. Free slots come from GET /properties/{id}/creneaux, which
// never returns a slot during a stay, already taken, too soon or on a closed day.

export function slotsFor(slots: FreeSlot[], date: string, kind: StayKind): FreeSlot[] {
  return slots.filter((s) => s.date === date && kindOfSlot(s.start) === kind);
}

export function SlotPicker(props: {
  formules: Formule[];
  slots: FreeSlot[]; // already filtered on the day and the kind
  guests: number;
  value: { formuleId: string; slotId: string } | null;
  onChange: (value: { formuleId: string; slotId: string }) => void;
}) {
  const byFormule = props.formules
    .map((f) => ({ f, free: props.slots.filter((s) => s.formuleId === f.id) }))
    .filter((x) => x.free.length > 0);

  if (!byFormule.length) {
    return <p className="bt-muted">Plus aucun créneau libre ce jour-là. Choisissez un autre jour.</p>;
  }

  return (
    <div className="bt-formules">
      {byFormule.map(({ f, free }) => {
        const tooMany = !!f.capacity && props.guests > f.capacity;
        const minPrice = Math.min(...free.map((s) => s.priceCents));
        const on = props.value?.formuleId === f.id;
        return (
          <div key={f.id} className="bt-formule" aria-current={on || undefined}>
            <div className="bt-formule-top">
              <b>{f.name}</b>
              <span className="bt-price">{free.length > 1 ? "dès " : ""}{formatMoney(minPrice, free[0].currency)}</span>
            </div>
            {f.description ? <p className="bt-small bt-muted">{f.description}</p> : null}
            {f.capacity ? (
              <p className={tooMany ? "bt-small bt-danger" : "bt-small bt-muted"}>
                {tooMany ? `${f.capacity} personnes au plus : réduisez le nombre de voyageurs.` : `${f.capacity} personnes au plus`}
              </p>
            ) : null}
            <div className="bt-slots" role="group" aria-label={`Créneaux ${f.name}`}>
              {free.map((s) => (
                <button
                  key={s.slotId}
                  type="button"
                  className="bt-slot"
                  disabled={tooMany}
                  aria-pressed={on && props.value?.slotId === s.slotId}
                  onClick={() => props.onChange({ formuleId: f.id, slotId: s.slotId })}
                >
                  {s.start} → {s.end}
                  <small>
                    {s.label}
                    {free.length > 1 ? ` · ${formatMoney(s.priceCents, s.currency)}` : ""}
                  </small>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
