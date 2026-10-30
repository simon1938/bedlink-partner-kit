"use client";

import { formatMoney } from "./format";
import { perUnitSuffix } from "./extras";
import type { Extra, ExtraSelection } from "./types";

// Step "Extras": photo cards, a tap adds the extra to the summary at once
// (Les Cocons d'Alex, La Parenthèse Normande). Grid of large photos when the
// tunnel is wide, list with a thumbnail on a phone.
//
// Extras come from BedLink (GET /properties/{id}/extras) and are PAID ONLINE
// with the stay: BedLink prices them and adds them to the amount charged. A
// "per person" or "per night" extra is multiplied by BedLink, the guest only
// picks it (quantity 1); a flat extra (per stay) can be taken several times.

export { extrasFor } from "./extras";

export function ExtrasGrid(props: {
  extras: Extra[];
  value: ExtraSelection;
  currency: string;
  onChange: (value: ExtraSelection) => void;
}) {
  function toggle(e: Extra) {
    const on = (props.value[e.id] ?? 0) > 0;
    props.onChange({ ...props.value, [e.id]: on ? 0 : 1 });
  }
  function setQty(e: Extra, q: number) {
    props.onChange({ ...props.value, [e.id]: Math.max(1, Math.min(q, e.maxQuantity ?? 20)) });
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
                {e.photoUrl ? <img src={e.photoUrl} alt="" loading="lazy" /> : null}
                <span className="bt-extra-box" aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
              </span>
              <span className="bt-extra-body">
                <span className="bt-extra-row">
                  <span className="bt-extra-name">{e.name}</span>
                  <span className="bt-price">
                    {formatMoney(e.priceCents, props.currency)}
                    {perUnitSuffix(e.unit) ? <small>{perUnitSuffix(e.unit)}</small> : null}
                  </span>
                </span>
                {e.description ? <span className="bt-extra-desc">{e.description}</span> : null}
              </span>
            </button>
            {e.unit === "per_stay" && on ? (
              <div className="bt-qty">
                Quantité
                <span className="bt-stepper">
                  <button type="button" aria-label="Moins" disabled={qty <= 1} onClick={() => setQty(e, qty - 1)}>
                    −
                  </button>
                  <output>{qty}</output>
                  <button type="button" aria-label="Plus" disabled={qty >= (e.maxQuantity ?? 20)} onClick={() => setQty(e, qty + 1)}>
                    +
                  </button>
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
