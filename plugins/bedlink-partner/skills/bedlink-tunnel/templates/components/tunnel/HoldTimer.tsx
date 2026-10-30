"use client";

import { useEffect, useRef, useState } from "react";

// The 15-minute option (POST /holds, or a slot reservation in pending_payment):
// the dates are closed everywhere (Airbnb, Booking…) while the guest pays.
// Clicking "Payer" on the BedLink page extends it by 10 minutes (30 max), so at
// zero ask the server (bookingStatus) before saying "expired".

export function HoldTimer(props: { expiresAt: string; onExpire: () => void; compact?: boolean }) {
  const end = Date.parse(props.expiresAt);
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const { onExpire } = props;

  useEffect(() => {
    fired.current = false;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [props.expiresAt]);

  const left = Math.max(0, end - now);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [left, onExpire]);

  const s = Math.ceil(left / 1000);
  const clock = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const late = left < 120_000;

  if (props.compact) {
    return (
      <span className={late ? "bt-hold-chip is-late" : "bt-hold-chip"} aria-label={`Option : ${clock} restantes`}>
        {clock}
      </span>
    );
  }
  return (
    <div className={late ? "bt-hold is-late" : "bt-hold"} role="status">
      <span className="bt-hold-clock">{clock}</span>
      <p>
        <strong>Vos dates sont gardées pour vous.</strong>
        <br />
        Personne d’autre ne peut les réserver pendant ce temps, ici comme sur les autres plateformes.
      </p>
    </div>
  );
}
