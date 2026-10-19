"use client";

import { useEffect, useState } from "react";

// The BedLink payment page embedded in your checkout ("Powered by BedLink").
// Planned feature: rendered only once payCheckout() returns { mode: "payment" }.
// The card is entered on BedLink's page, on the host's Stripe account: your
// site never sees it and never loads Stripe.js.
//
// The message posted by the page is a display convenience ONLY. The truth is
// the reservation.confirmed webhook or getCheckoutStatus() on your server:
// call it before showing "booked".

const BEDLINK_ORIGIN = "https://app.bedlink.fr";

export type PaymentFrameResult = {
  status: "succeeded" | "failed" | "expired";
  sessionId: string;
  reservationId?: string;
};

export function PaymentFrame(props: {
  embedUrl: string;
  /** Fallback when the iframe cannot be used (old browser, blocked cookies). */
  url?: string;
  onResult: (result: PaymentFrameResult) => void;
  height?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const { onResult } = props;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== BEDLINK_ORIGIN) return; // ignore every other origin
      const data = event.data as { type?: string } & Partial<PaymentFrameResult>;
      if (data?.type !== "bedlink:payment" || !data.status || !data.sessionId) return;
      onResult({ status: data.status, sessionId: data.sessionId, reservationId: data.reservationId });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onResult]);

  if (!props.embedUrl.startsWith(BEDLINK_ORIGIN + "/")) return null;

  return (
    <div style={{ width: "100%" }}>
      <iframe
        src={props.embedUrl}
        title="Paiement sécurisé BedLink"
        onLoad={() => setLoaded(true)}
        allow="payment *"
        style={{ width: "100%", minHeight: props.height ?? 640, border: 0 }}
      />
      {!loaded && props.url ? (
        <p style={{ fontSize: 14 }}>
          Le paiement ne s’affiche pas ? <a href={props.url}>Ouvrir la page de paiement</a>
        </p>
      ) : null}
    </div>
  );
}
