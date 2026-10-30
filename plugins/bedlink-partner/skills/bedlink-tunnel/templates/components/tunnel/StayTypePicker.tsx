"use client";

import type { StayKind } from "./types";

// Nuit by default; Journée / Soirée only when the place has formules with free
// slots of that kind (GET /properties/{id}/formules + /creneaux).

export const STAY_KINDS: { kind: StayKind; label: string; hint: string }[] = [
  { kind: "night", label: "Nuit", hint: "dès 1 nuit" },
  { kind: "day", label: "Journée", hint: "shooting, détente" },
  { kind: "evening", label: "Soirée", hint: "fête, dîner" },
];

/**
 * BedLink formules have no "day" or "evening" category: this is OUR choice.
 * A slot starting at 17:00 or later is an evening. Change the hour, or drop
 * the split and show one "Journée" button, as Logement Atypique prefers.
 */
export const EVENING_FROM = "17:00";
export function kindOfSlot(start: string): Exclude<StayKind, "night"> {
  return start >= EVENING_FROM ? "evening" : "day";
}

export function StayTypePicker(props: {
  value: StayKind;
  available: StayKind[]; // kinds that can be booked for this place
  onChange: (kind: StayKind) => void;
}) {
  const kinds = STAY_KINDS.filter((k) => props.available.includes(k.kind));
  if (kinds.length < 2) return null; // nights only: nothing to choose
  return (
    <div className="bt-types" role="group" aria-label="Type de séjour" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}>
      {kinds.map((k) => (
        <button key={k.kind} type="button" aria-pressed={props.value === k.kind} onClick={() => props.onChange(k.kind)}>
          <b>{k.label}</b>
          <small>{k.hint}</small>
        </button>
      ))}
    </div>
  );
}
