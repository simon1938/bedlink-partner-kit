import "@/styles/tunnel.css";
import { bookingStatus } from "../actions";

// Return page of the BedLink payment (payment.returnUrl). Used when the
// payment page was opened full screen (fallback link, old browser) or when the
// guest clicks "Continuer" after paying. It asks BedLink, never the URL: a
// "status=succeeded" in a link proves nothing.
//
// Its ORIGIN must be the origin of the tunnel: BedLink posts the payment
// result to the origin of returnUrl.

export const dynamic = "force-dynamic";

export default async function MerciPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  const r = ref ? await bookingStatus(ref) : null;
  const state = r?.ok ? r.data.state : "unknown";

  return (
    <div className="bt-tunnel">
      {state === "pending" ? <meta httpEquiv="refresh" content="3" /> : null}
      <div className="bt-main bt-done">
        {state === "confirmed" ? (
          <>
            <div className="bt-done-ico" aria-hidden="true">
              ✓
            </div>
            <p className="bt-kicker">Réservation confirmée</p>
            <h1 className="bt-h1">Merci, c’est réservé.</h1>
            <p className="bt-lead">Un e-mail de confirmation vient de partir avec tous les détails.</p>
            <p className="bt-ref">RÉFÉRENCE {ref}</p>
          </>
        ) : state === "pending" ? (
          <>
            <p className="bt-kicker">Paiement</p>
            <h1 className="bt-h1">Nous confirmons votre paiement…</h1>
            <p className="bt-lead">Cela prend quelques secondes. Ne fermez pas cette page.</p>
          </>
        ) : state === "expired" ? (
          <>
            <p className="bt-kicker">Option expirée</p>
            <h1 className="bt-h1">Vos dates n’ont pas été gardées.</h1>
            <p className="bt-lead">Le délai de paiement est passé : rien n’a été débité. Si un montant apparaît sur votre relevé, il est remboursé automatiquement.</p>
          </>
        ) : (
          <>
            <h1 className="bt-h1">Réservation introuvable.</h1>
            <p className="bt-lead">Vérifiez le lien reçu, ou écrivez-nous.</p>
          </>
        )}
      </div>
    </div>
  );
}
