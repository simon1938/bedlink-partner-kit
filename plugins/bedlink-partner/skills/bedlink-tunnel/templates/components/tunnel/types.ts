// Types shared by the booking tunnel components (browser side).
// No server import here: this file is safe in a "use client" component.

/** "night" = a stay (quote → hold → payment). "day" / "evening" = a slot of a formule. */
export type StayKind = "night" | "day" | "evening";

/** One day of the BedLink calendar, as kept in bedlink_calendar_days. No price: only the quote prices. */
export type TunnelDay = {
  date: string; // YYYY-MM-DD
  available: boolean; // the NIGHT starting this day can be sold
  arrivalAllowed: boolean;
  departureAllowed: boolean;
  minNights: number;
  minNightsThrough: number | null;
  maxNights: number | null;
};

/** A formule as returned by GET /properties/{id}/formules. */
export type Formule = {
  id: string;
  name: string;
  nameEn?: string | null;
  description?: string | null;
  slots: { id: string; label: string; start: string; end: string; priceCents: number }[];
  capacity?: number | null;
  nightIncluded: boolean;
  days: number[];
  minNoticeHours: number;
  active: boolean;
};

/** A FREE slot as returned by GET /properties/{id}/creneaux. */
export type FreeSlot = {
  date: string;
  formuleId: string;
  slotId: string;
  label: string;
  start: string; // HH:MM
  end: string;
  startAt: string; // ISO, property timezone
  endAt: string;
  priceCents: number;
  currency: string;
};

/**
 * An extra from YOUR catalogue (Logement Atypique side). BedLink does not sell
 * extras through the partner API yet: they are not part of the online payment.
 */
export type Extra = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  priceCents: number;
  perPerson?: boolean;
  /** Only offered for a night stay (breakfast, late check-out…). */
  nightsOnly?: boolean;
};
export type ExtraSelection = Record<string, number>; // extra id → quantity (0 = not selected)

export type GuestDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
};

/** What the listing page knows about the place (your data + BedLink property). */
export type TunnelListing = {
  listingId: string;
  propertyId: string; // BedLink property id
  name: string;
  subtitle?: string; // "Cabane perchée · Brière"
  hostFirstName?: string;
  photoUrl?: string;
  maxGuests: number;
  currency: string;
  checkInFrom?: string | null; // "16:00"
  checkOutUntil?: string | null; // "10:00"
  cancellationSummary?: string | null; // cancellationPolicy.summary.fr
  termsUrl: string; // your CGV / host conditions page
};

export type NightQuote = {
  externalId: string;
  totalCents: number;
  currency: string;
  nights: { date: string; priceCents: number }[];
};

export type SlotQuote = {
  available: boolean;
  totalCents: number;
  currency: string;
  startAt: string | null;
  endAt: string | null;
  nightIncluded: boolean;
};

export type PaymentStart =
  | {
      mode: "payment";
      ref: string; // your externalId
      embedUrl: string;
      url: string;
      expiresAt: string; // end of the 15-minute hold
      totalCents: number; // may differ from the quote if BedLink had to re-quote
      currency: string;
    }
  | { mode: "confirmed"; ref: string; totalCents: number; currency: string };

export type BookingState = "pending" | "confirmed" | "failed" | "expired";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; reason: string; message: string };

/** The server actions the tunnel calls. Pass them as props from the server page. */
export type TunnelActions = {
  loadCalendar(propertyId: string, from: string, to: string): Promise<ActionResult<TunnelDay[]>>;
  quoteNights(input: {
    propertyId: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
  }): Promise<ActionResult<NightQuote>>;
  loadSlots(propertyId: string, from: string, to: string): Promise<ActionResult<{ formules: Formule[]; slots: FreeSlot[] }>>;
  quoteSlot(input: { propertyId: string; formuleId: string; slotId: string; date: string; guests: number }): Promise<ActionResult<SlotQuote>>;
  startPayment(input: StartPaymentInput): Promise<ActionResult<PaymentStart>>;
  bookingStatus(ref: string): Promise<ActionResult<{ state: BookingState }>>;
  release(ref: string): Promise<ActionResult<null>>;
};

export type StartPaymentInput = {
  listingId: string;
  guest: GuestDetails;
  extras: { id: string; name: string; quantity: number; unitPriceCents: number }[];
} & (
  | { kind: "night"; externalId: string }
  | { kind: "slot"; propertyId: string; formuleId: string; slotId: string; date: string; guests: number }
);
