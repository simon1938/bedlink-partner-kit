"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PaymentFrame, type PaymentFrameResult } from "@/components/bedlink/PaymentFrame";
import { BookingSummary, nightLines, type SummaryPrice } from "./BookingSummary";
import { priceSelection } from "./extras";
import { StayCalendar } from "./StayCalendar";
import type { Range } from "./calendar-rules";
import { ExtrasGrid, extrasFor } from "./ExtrasGrid";
import { addDays, addMonths, firstOfMonth, formatDay, formatMoney, isoWeekday, lastOfMonth, plural } from "./format";
import { EMPTY_GUEST, GuestForm, validateGuest } from "./GuestForm";
import { HoldTimer } from "./HoldTimer";
import { MobileBookingBar } from "./MobileBookingBar";
import { SlotPicker, slotsFor } from "./SlotPicker";
import { Stepper } from "./Stepper";
import { kindOfSlot, StayTypePicker } from "./StayTypePicker";
import type {
  ActionResult,
  Extra,
  ExtraSelection,
  Formule,
  FreeSlot,
  GuestDetails,
  NightQuote,
  PaymentStart,
  SlotQuote,
  StayKind,
  TunnelActions,
  TunnelDay,
  TunnelListing,
} from "./types";

// The whole tunnel on ONE page, in steps (validated by BedLink and Logement
// Atypique on 30/10/2026):
//   night : dates + type → extras → details → payment (15-min option) → confirmed
//   day   : day + type → slot → extras → details → payment → confirmed
// Sticky summary on the right on a computer, full-width bar at the bottom on a
// phone. Every price comes from a BedLink quote; nothing is decided from the
// local copy. Adapt the texts and the classes to your site, keep the logic.

type Step = "dates" | "slot" | "extras" | "details" | "payment";
const STEP_LABEL: Record<Step, string> = {
  dates: "Dates",
  slot: "Créneau",
  extras: "Extras",
  details: "Coordonnées",
  payment: "Paiement",
};

const MESSAGES: Record<string, string> = {
  dates_unavailable: "Ces dates viennent d’être prises. Choisissez d’autres dates.",
  quote_expired: "Le tarif a expiré, il vient d’être recalculé.",
  hold_expired: "Votre option a expiré. Vos dates ont été libérées.",
  guest_limit: "Trop de voyageurs pour ce logement.",
  slot_unavailable: "Ce créneau vient d’être pris. Choisissez-en un autre.",
  capacity_exceeded: "Trop de personnes pour cette formule.",
  day_rental_disabled: "Ce logement ne se loue plus à la journée.",
  payment_unavailable: "Le paiement en ligne n’est pas disponible pour ce logement pour l’instant.",
  invalid_request: "Une information est incorrecte. Vérifiez vos dates et vos voyageurs.",
};
function messageOf(r: { reason: string; message: string }) {
  return MESSAGES[r.reason] ?? "Réservation momentanément indisponible. Réessayez dans un instant.";
}

export function BookingTunnel(props: {
  listing: TunnelListing;
  today: string; // todayIn(property.timezone), computed on the server
  initialDays: TunnelDay[]; // night calendar for the first visible months
  formules: Formule[]; // [] when the place is not rented by the day
  initialSlots: FreeSlot[];
  extras: Extra[];
  actions: TunnelActions;
  header?: ReactNode; // gallery, title, description of the place (your page)
}) {
  const { listing, actions } = props;
  const rootRef = useRef<HTMLDivElement>(null);

  // ── What can be booked ────────────────────────────────────────────────
  const availableKinds = useMemo<StayKind[]>(() => {
    const kinds = new Set<StayKind>(["night"]);
    for (const f of props.formules) for (const s of f.slots) kinds.add(kindOfSlot(s.start));
    return ["night", "day", "evening"].filter((k) => kinds.has(k as StayKind)) as StayKind[];
  }, [props.formules]);

  const [kind, setKind] = useState<StayKind>("night");
  const [month, setMonth] = useState(firstOfMonth(props.today));
  const [adults, setAdults] = useState(Math.min(2, listing.maxGuests));
  const [children, setChildren] = useState(0);
  const guests = adults + children;

  // ── Nights ────────────────────────────────────────────────────────────
  const [days, setDays] = useState<TunnelDay[]>(props.initialDays);
  const [range, setRange] = useState<Range>({ from: null, to: null });
  const [nightQuote, setNightQuote] = useState<NightQuote | null>(null);

  // ── Day / evening ─────────────────────────────────────────────────────
  const [slots, setSlots] = useState<FreeSlot[]>(props.initialSlots);
  const [day, setDay] = useState<string | null>(null);
  const [slotSel, setSlotSel] = useState<{ formuleId: string; slotId: string } | null>(null);
  const [slotQuote, setSlotQuote] = useState<SlotQuote | null>(null);

  // ── Rest of the tunnel ────────────────────────────────────────────────
  const [extraSel, setExtraSel] = useState<ExtraSelection>({});
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [guest, setGuest] = useState<GuestDetails>(EMPTY_GUEST);
  const [guestError, setGuestError] = useState<ReturnType<typeof validateGuest>>(null);
  const [terms, setTerms] = useState(false);
  const [payment, setPayment] = useState<PaymentStart | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [confirmedRef, setConfirmedRef] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  const extras = useMemo(() => extrasFor(props.extras, kind), [props.extras, kind]);
  const steps: Step[] = useMemo(() => {
    const s: Step[] = kind === "night" ? ["dates"] : ["dates", "slot"];
    if (extras.length) s.push("extras");
    s.push("details", "payment");
    return s;
  }, [kind, extras.length]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  // ── Loading the calendar when the months change ───────────────────────
  useEffect(() => {
    const from = month < props.today ? props.today : month;
    const to = lastOfMonth(addMonths(month, 1));
    let alive = true;
    if (kind === "night") {
      if (days.some((d) => d.date === to) && days.some((d) => d.date === from)) return;
      actions.loadCalendar(listing.propertyId, from, addDays(to, 1)).then((r) => {
        if (!alive || !r.ok) return;
        setDays((old) => {
          const m = new Map(old.map((d) => [d.date, d]));
          for (const d of r.data) m.set(d.date, d);
          return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
        });
      });
    } else {
      actions.loadSlots(listing.propertyId, from, to).then((r) => {
        if (!alive || !r.ok) return;
        setSlots((old) => [...old.filter((s) => s.date < from || s.date > to), ...r.data.slots]);
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, kind]);

  // ── Quote of the stay, as soon as both dates are set ──────────────────
  useEffect(() => {
    setNightQuote(null);
    if (kind !== "night" || !range.from || !range.to) return;
    let alive = true;
    setBusy(true);
    setError(null);
    actions
      .quoteNights({ propertyId: listing.propertyId, checkIn: range.from, checkOut: range.to, adults, children })
      .then((r) => {
        if (!alive) return;
        if (r.ok) setNightQuote(r.data);
        else {
          setError(messageOf(r));
          if (r.reason === "dates_unavailable") setRange({ from: null, to: null });
        }
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [kind, range.from, range.to, adults, children, listing.propertyId, actions]);

  // ── Quote of the slot ─────────────────────────────────────────────────
  useEffect(() => {
    setSlotQuote(null);
    if (kind === "night" || !day || !slotSel) return;
    let alive = true;
    setBusy(true);
    setError(null);
    actions
      .quoteSlot({ propertyId: listing.propertyId, formuleId: slotSel.formuleId, slotId: slotSel.slotId, date: day, guests })
      .then((r) => {
        if (!alive) return;
        if (r.ok && r.data.available) setSlotQuote(r.data);
        else {
          setError(r.ok ? MESSAGES.slot_unavailable : messageOf(r));
          setSlotSel(null);
        }
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [kind, day, slotSel, guests, listing.propertyId, actions]);

  // ── Derived display ───────────────────────────────────────────────────
  const formule = props.formules.find((f) => f.id === slotSel?.formuleId) ?? null;
  const slot = formule?.slots.find((s) => s.id === slotSel?.slotId) ?? null;
  // Extras paid online with the stay: BedLink's catalogue prices, same arithmetic
  // as BedLink. The held total (payment.totalCents) is the one that counts.
  const nightsCount = kind === "night" && range.from && range.to ? Math.max(1, Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000)) : 1;
  const chosenExtras = priceSelection(extras, extraSel, { persons: guests, nights: nightsCount });
  const extrasTotal = chosenExtras.reduce((s, e) => s + e.totalCents, 0);

  let price: SummaryPrice = null;
  if (kind === "night" && nightQuote) {
    price = { lines: nightLines(nightQuote.nights, nightQuote.totalCents), totalCents: nightQuote.totalCents, currency: nightQuote.currency };
  } else if (kind !== "night" && slotQuote && formule && slot) {
    price = { lines: [{ label: `${formule.name} · ${slot.label}`, cents: slotQuote.totalCents }], totalCents: slotQuote.totalCents, currency: slotQuote.currency };
  }
  // What the guest pays now: stay + extras, or BedLink's held amount once known
  // (it re-quotes with the extras, and again if the quote is older than 5 minutes).
  const toPayCents = payment ? payment.totalCents : price ? price.totalCents + extrasTotal : null;

  const summary = (final = false) => (
    <BookingSummary
      listing={listing}
      kind={kind}
      checkIn={range.from}
      checkOut={range.to}
      day={day}
      slot={formule && slot ? { name: formule.name, start: slot.start, end: slot.end } : null}
      adults={adults}
      children={children}
      price={price}
      extras={chosenExtras}
      heldTotalCents={payment ? payment.totalCents : null}
      justAdded={justAdded}
      final={final}
    />
  );

  // ── Navigation ────────────────────────────────────────────────────────
  function canContinue(): boolean {
    if (busy) return false;
    if (step === "dates") return kind === "night" ? !!nightQuote : !!day;
    if (step === "slot") return !!slotQuote;
    return true;
  }

  function scrollTop() {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function next() {
    setError(null);
    if (step === "dates" && !canContinue()) {
      setError(kind === "night" ? "Choisissez votre arrivée puis votre départ." : "Choisissez le jour de votre venue.");
      return;
    }
    if (step === "slot" && !canContinue()) {
      setError("Choisissez une formule et un créneau.");
      return;
    }
    if (step === "details") {
      const e = validateGuest(guest);
      setGuestError(e);
      if (e) return;
    }
    setSheet(false);
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    scrollTop();
  }

  async function back() {
    setError(null);
    if (step === "payment" && payment?.mode === "payment") {
      // The guest leaves the payment: free the dates now instead of in 15 minutes.
      await actions.release(payment.ref);
      setPayment(null);
      setTerms(false);
    }
    setStepIndex((i) => Math.max(0, i - 1));
    scrollTop();
  }

  function changeKind(k: StayKind) {
    setKind(k);
    setStepIndex(0);
    setError(null);
    setDay(null);
    setSlotSel(null);
    setRange({ from: null, to: null });
  }

  // ── Payment ───────────────────────────────────────────────────────────
  async function acceptTermsAndPay(checked: boolean) {
    setTerms(checked);
    if (!checked || payment || busy) return;
    setBusy(true);
    setError(null);
    setExpired(false);
    const base = {
      listingId: listing.listingId,
      guest,
      extras: chosenExtras.map((e) => ({ id: e.id, quantity: e.quantity })),
    };
    let r: ActionResult<PaymentStart>;
    if (kind === "night") {
      if (!nightQuote) return setBusy(false);
      r = await actions.startPayment({ ...base, kind: "night", externalId: nightQuote.externalId });
    } else {
      if (!day || !slotSel) return setBusy(false);
      r = await actions.startPayment({ ...base, kind: "slot", propertyId: listing.propertyId, formuleId: slotSel.formuleId, slotId: slotSel.slotId, date: day, guests });
    }
    setBusy(false);
    if (!r.ok) {
      setTerms(false);
      setError(messageOf(r));
      return;
    }
    if (toPayCents !== null && r.data.totalCents !== toPayCents) {
      setNotice(`Le tarif a été recalculé : ${formatMoney(r.data.totalCents, r.data.currency)}.`);
    }
    if (r.data.mode === "confirmed") {
      // Sandbox without online payment: BedLink confirmed right away.
      setConfirmedRef(r.data.ref);
      scrollTop();
      return;
    }
    setPayment(r.data);
  }

  const checkStatus = useCallback(
    async (attempts: number) => {
      if (!payment) return;
      for (let i = 0; i < attempts; i++) {
        const r = await actions.bookingStatus(payment.ref);
        if (r.ok && r.data.state === "confirmed") {
          setConfirmedRef(payment.ref);
          scrollTop();
          return;
        }
        if (r.ok && r.data.state === "expired") {
          setExpired(true);
          return;
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
    },
    [payment, actions],
  );

  function onPaymentResult(res: PaymentFrameResult) {
    // The message of the page is a display convenience: confirm on the server.
    if (res.status === "succeeded") void checkStatus(10);
    else if (res.status === "expired") setExpired(true);
    else setError("Le paiement n’a pas abouti et rien n’a été débité. Vous pouvez réessayer, avec une autre carte si besoin.");
  }

  async function restartAfterExpiry() {
    setPayment(null);
    setTerms(false);
    setExpired(false);
    setError(null);
    if (kind === "night" && range.from && range.to) {
      // A new quote = a new reference: the old checkout is finished.
      const r = await actions.quoteNights({ propertyId: listing.propertyId, checkIn: range.from, checkOut: range.to, adults, children });
      if (r.ok) setNightQuote(r.data);
      else {
        setError(messageOf(r));
        setStepIndex(0);
      }
    }
  }

  // ── Confirmation ──────────────────────────────────────────────────────
  if (confirmedRef) {
    return (
      <div ref={rootRef} className="bt-tunnel">
        <div className="bt-main bt-done">
          <div className="bt-done-ico" aria-hidden="true">
            ✓
          </div>
          <p className="bt-kicker">Réservation confirmée</p>
          <h2 className="bt-h1">
            À très vite à {listing.name}, {guest.firstName}.
          </h2>
          <p className="bt-lead">
            Un e-mail de confirmation part à <strong>{guest.email}</strong>.{" "}
            {listing.hostFirstName ? `${listing.hostFirstName} a reçu votre réservation.` : "Votre hôte a reçu votre réservation."}
          </p>
          <p className="bt-ref">RÉFÉRENCE {confirmedRef}</p>
          <div className="bt-card">{summary(true)}</div>
          <ol className="bt-next">
            <li>Vos dates sont déjà bloquées partout : personne ne peut réserver ce logement ailleurs.</li>
            <li>{listing.hostFirstName ?? "Votre hôte"} vous enverra l’adresse exacte et les instructions d’arrivée.</li>
          </ol>
        </div>
      </div>
    );
  }

  // ── Steps ─────────────────────────────────────────────────────────────
  const nightsLabel = range.from && range.to ? `${formatDay(range.from)} → ${formatDay(range.to)}` : "Choisissez vos dates";
  const dayLabel = day ? (slot ? `${formule?.name} · ${slot.start}` : formatDay(day)) : "Choisissez un jour";
  const ctaLabel =
    step === "dates" ? "Réserver" : step === "extras" ? (chosenExtras.length ? "Continuer" : "Continuer sans extra") : step === "details" ? "Continuer vers le paiement" : "Continuer";

  let body: ReactNode;
  if (step === "dates") {
    const dayEnabled = (d: string) => slots.some((s) => s.date === d && kindOfSlot(s.start) === kind) && (!formule || formule.days.includes(isoWeekday(d)));
    body = (
      <>
        {props.header}
        {availableKinds.length > 1 ? (
          <section className="bt-sec">
            <h3 className="bt-h3">Type de séjour</h3>
            <StayTypePicker value={kind} available={availableKinds} onChange={changeKind} />
          </section>
        ) : null}
        <section className="bt-sec">
          <h3 className="bt-h3">{kind === "night" ? "Vos dates" : "Le jour de votre venue"}</h3>
          {kind === "night" ? (
            <StayCalendar
              mode="range"
              today={props.today}
              month={month}
              onMonthChange={setMonth}
              days={days}
              range={range}
              onRangeChange={(r) => {
                setError(null);
                setRange(r);
              }}
            />
          ) : (
            <StayCalendar
              mode="single"
              today={props.today}
              month={month}
              onMonthChange={setMonth}
              selected={day}
              onSelect={(d) => {
                setDay(d);
                setSlotSel(null);
              }}
              isEnabled={dayEnabled}
              legend="Seuls les jours avec un créneau libre sont proposés."
            />
          )}
          {kind === "night" && nightQuote ? <p className="bt-avail">● Disponible · tarif vérifié en direct</p> : null}
        </section>
        <section className="bt-sec">
          <h3 className="bt-h3">Voyageurs</h3>
          <div className="bt-card bt-guests">
            <Counter label="Adultes" value={adults} min={1} max={listing.maxGuests - children} onChange={setAdults} />
            <Counter label="Enfants" value={children} min={0} max={listing.maxGuests - adults} onChange={setChildren} />
            <p className="bt-small bt-muted">{plural(listing.maxGuests, "voyageur", "voyageurs")} au plus.</p>
          </div>
        </section>
      </>
    );
  } else if (step === "slot") {
    body = (
      <>
        <p className="bt-kicker">{day ? formatDay(day, "long") : ""}</p>
        <h2 className="bt-h2">{kind === "evening" ? "Choisissez votre soirée" : "Choisissez votre formule"}</h2>
        <p className="bt-lead">Seuls les créneaux encore libres sont proposés.</p>
        <div className="bt-sec">
          <SlotPicker formules={props.formules} slots={day ? slotsFor(slots, day, kind) : []} guests={guests} value={slotSel} onChange={setSlotSel} />
        </div>
      </>
    );
  } else if (step === "extras") {
    body = (
      <>
        <p className="bt-kicker">Facultatif</p>
        <h2 className="bt-h2">Pour rendre le séjour inoubliable</h2>
        <p className="bt-lead">Touchez un extra pour l’ajouter : il apparaît aussitôt dans votre récapitulatif et se paie avec la réservation.</p>
        <div className="bt-sec">
          <ExtrasGrid
            extras={extras}
            value={extraSel}
            currency={listing.currency}
            onChange={(v) => {
              const added = Object.keys(v).find((k) => (v[k] ?? 0) > 0 && !(extraSel[k] ?? 0));
              setJustAdded(added ?? null);
              setExtraSel(v);
            }}
          />
        </div>
      </>
    );
  } else if (step === "details") {
    body = (
      <>
        <p className="bt-kicker">Vos coordonnées</p>
        <h2 className="bt-h2">Qui vient profiter du lieu ?</h2>
        <p className="bt-lead">{listing.hostFirstName ?? "L’hôte"} les reçoit avec votre réservation pour préparer votre venue.</p>
        <div className="bt-sec">
          <GuestForm value={guest} onChange={setGuest} hostFirstName={listing.hostFirstName} error={guestError} />
        </div>
      </>
    );
  } else {
    body = (
      <>
        {payment?.mode === "payment" && !expired ? <HoldTimer expiresAt={payment.expiresAt} onExpire={() => void checkStatus(1)} /> : null}
        <p className="bt-kicker">Paiement</p>
        <h2 className="bt-h2">Paiement sécurisé</h2>
        <p className="bt-lead">
          Vous payez {price && toPayCents !== null ? formatMoney(toPayCents, price.currency) : ""} maintenant, directement à {listing.hostFirstName ?? "votre hôte"}
          {chosenExtras.length ? ", extras compris." : "."}
        </p>
        <label className="bt-terms">
          <input type="checkbox" checked={terms} disabled={!!payment || busy} onChange={(e) => void acceptTermsAndPay(e.target.checked)} />
          <span>
            J’ai lu et j’accepte les{" "}
            <a href={listing.termsUrl} target="_blank" rel="noopener">
              conditions de réservation
            </a>
            , dont les conditions d’annulation de l’hôte.
          </span>
        </label>
        {!terms && !payment ? <p className="bt-small bt-muted">Acceptez les conditions pour afficher le paiement.</p> : null}
        {busy && !payment ? <p className="bt-small bt-muted">Nous gardons vos dates…</p> : null}
        {expired ? (
          <div className="bt-expired" role="alert">
            <p>
              <strong>Votre option a expiré.</strong> Vos dates ont été libérées et rien n’a été débité.
            </p>
            <button type="button" className="bt-btn" onClick={() => void restartAfterExpiry()}>
              Reprendre ma réservation
            </button>
          </div>
        ) : payment?.mode === "payment" ? (
          <div className="bt-pay">
            <PaymentFrame embedUrl={payment.embedUrl} url={payment.url} onResult={onPaymentResult} height={560} />
          </div>
        ) : null}
        <p className="bt-powered">Paiement sécurisé · Powered by BedLink</p>
      </>
    );
  }

  const showCta = step !== "payment";

  return (
    <div ref={rootRef} className="bt-tunnel">
      <div className="bt-main">
        {step !== "dates" ? <Stepper steps={steps.map((s) => (s === "dates" && kind !== "night" ? "Date" : STEP_LABEL[s]))} current={stepIndex} /> : null}
        <div className="bt-layout">
          <div className="bt-content">
            {body}
            {notice ? <p className="bt-notice">{notice}</p> : null}
            {error ? (
              <p className="bt-error" role="alert">
                {error}
              </p>
            ) : null}
            {step !== "dates" ? (
              <div className="bt-actions">
                <button type="button" className="bt-btn bt-btn-line" onClick={() => void back()}>
                  ‹ Retour
                </button>
                {showCta ? (
                  <button type="button" className="bt-btn bt-grow" disabled={!canContinue()} onClick={next}>
                    {ctaLabel}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <aside className="bt-aside">
            <div className="bt-card">
              {summary()}
              {showCta ? (
                <button type="button" className="bt-btn bt-block" disabled={!canContinue()} onClick={next}>
                  {busy && step === "dates" ? "Vérification…" : ctaLabel}
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
      <MobileBookingBar
        total={price && toPayCents !== null ? formatMoney(toPayCents, price.currency) : null}
        subtitle={kind === "night" ? nightsLabel : dayLabel}
        open={sheet}
        onToggle={() => setSheet((s) => !s)}
        summary={summary()}
        cta={showCta ? { label: step === "dates" ? "Réserver" : "Continuer", disabled: !canContinue(), onClick: next } : null}
        aside={step === "payment" && payment?.mode === "payment" && !expired ? <HoldTimer compact expiresAt={payment.expiresAt} onExpire={() => undefined} /> : null}
      />
    </div>
  );
}

function Counter(props: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="bt-counter">
      <span>{props.label}</span>
      <span className="bt-stepper">
        <button type="button" aria-label={`${props.label} : moins`} disabled={props.value <= props.min} onClick={() => props.onChange(props.value - 1)}>
          −
        </button>
        <output aria-live="polite">{props.value}</output>
        <button type="button" aria-label={`${props.label} : plus`} disabled={props.value >= props.max} onClick={() => props.onChange(props.value + 1)}>
          +
        </button>
      </span>
    </div>
  );
}
