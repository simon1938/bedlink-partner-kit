"use client";

import { formatMoney } from "./format";
import type { Extra, ExtraSelection } from "./types";

// Step "Extras": photo cards, a tap adds the extra to the summary at once
// (Les Cocons d'Alex, La Parenthèse Normande). Grid of large photos when the
// tunnel is wide, list with a thumbnail on a phone.
//
// Extras are YOUR catalogue. BedLink does not take them in the online payment
// yet: they are shown "à régler sur place" and sent to the host in the notes.

export function extrasFor(extras: Extra[], night: boolean): Extra[] {
  return extras.filter((e) => night || !e.nightsOnly);
}

export function ExtrasGrid(props: {
  extras: Extra[];
  value: ExtraSelection;
  guests: number;
  currency: string;
  onChange: (value: ExtraSelection) => void;
}) {
  function toggle(e: Extra) {
    const on = (props.value[e.id] ?? 0) > 0;
    props.onChange({ ...props.value, [e.id]: on ? 0 : e.perPerson ? props.guests : 1 });
  }
  function setQty(e: Extra, q: number) {
    props.onChange({ ...props.value, [e.id]: Math.max(1, Math.min(q, 99)) });
  }

  return (
    <div className="bt-extras">
      {props.extras.map((e) => {
        const qty = props.value[e.id] ?? 0;
        const on = qty > 0;
        return (
          <div key={e.id} className="bt-extra" aria-pressed={on}>
            <button type="button" className="bt-extra-hit" aria-pressed={on} onClick={() => toggle(e)}>
              <span className="bt-extra-img">
                {e.imageUrl ? <img src={e.imageUrl} alt="" loading="lazy" /> : null}
                <span className="bt-extra-box" aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
              </span>
              <span className="bt-extra-body">
                <span className="bt-extra-row">
                  <span className="bt-extra-name">{e.name}</span>
                  <span className="bt-price">
                    {formatMoney(e.priceCents, props.currency)}
                    {e.perPerson ? <small> / pers.</small> : null}
                  </span>
                </span>
                {e.description ? <span className="bt-extra-desc">{e.description}</span> : null}
              </span>
            </button>
            {e.perPerson && on ? (
              <div className="bt-qty">
                Pour
                <span className="bt-stepper">
                  <button type="button" aria-label="Moins" disabled={qty <= 1} onClick={() => setQty(e, qty - 1)}>
                    −
                  </button>
                  <output>{qty}</output>
                  <button type="button" aria-label="Plus" onClick={() => setQty(e, qty + 1)}>
                    +
                  </button>
                </span>
                personne{qty > 1 ? "s" : ""}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
