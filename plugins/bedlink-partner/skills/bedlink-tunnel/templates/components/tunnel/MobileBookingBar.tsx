"use client";

import type { ReactNode } from "react";

// Full-width bar stuck to the bottom of the screen on a phone (Chalet WHA idea,
// as a real bar): total + "Voir le détail" + the button. It stays while the
// page scrolls and unfolds the summary in place. Hidden on a computer (CSS),
// where the sticky right column takes over.
//
// The page must keep room for it: .bt-tunnel has a bottom padding on phones.

export function MobileBookingBar(props: {
  total: string | null; // formatted, null = no quote yet
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  summary: ReactNode;
  cta?: { label: string; disabled?: boolean; onClick: () => void } | null;
  aside?: ReactNode; // e.g. the hold timer on the payment step
}) {
  return (
    <div className="bt-mbar">
      {props.open ? <div className="bt-mbar-sheet">{props.summary}</div> : null}
      <div className="bt-mbar-row">
        <button type="button" className="bt-mbar-sum" aria-expanded={props.open} onClick={props.onToggle} disabled={!props.total}>
          <strong>{props.total ?? "Prix sur vos dates"}</strong>
          <small>{props.total ? (props.open ? "Masquer le détail" : "Voir le détail") : props.subtitle}</small>
        </button>
        {props.aside}
        {props.cta ? (
          <button type="button" className="bt-btn" disabled={props.cta.disabled} onClick={props.cta.onClick}>
            {props.cta.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
