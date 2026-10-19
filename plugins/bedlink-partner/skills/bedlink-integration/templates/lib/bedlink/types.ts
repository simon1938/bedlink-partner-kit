// Types of the BedLink Partner API v1.
// Source of truth: references/contract.md in the bedlink-partner-kit plugin.
// Fields marked "planned" are not returned by BedLink yet: they are optional so
// that the code keeps working on the current sandbox. Ignore unknown fields.

export type Environment = "sandbox" | "live";

export type CancellationPolicy = {
  type: "free" | "non_refundable" | "tiered";
  tiers?: { daysBefore: number; charge: "none" | "deposit" | "full" }[];
  depositPercent?: number | null;
  taxesRefunded?: boolean;
  summary?: Record<string, string>;
};

export type Property = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string | null;
  address?: string | null;
  maxGuests?: number | null;
  currency: string;
  timezone?: string;
  channel: string;
  environment: Environment;
  // planned
  checkInFrom?: string | null;
  checkInUntil?: string | null;
  checkOutUntil?: string | null;
  cancellationPolicy?: CancellationPolicy | null;
  securityDepositCents?: number | null;
  status?: "active";
  connectedAt?: string;
  updatedAt?: string;
};

export type CalendarDay = {
  date: string;
  priceCents: number | null;
  available: boolean;
  minNights: number;
  minNightsThrough: number | null;
  maxNights: number | null;
  arrivalAllowed: boolean;
  departureAllowed: boolean;
};

export type Calendar = {
  propertyId: string;
  channel: string;
  currency: string;
  from: string;
  to: string;
  days: CalendarDay[];
  generatedAt?: string; // planned
};

export type Night = { date: string; priceCents: number };

export type QuoteInput = {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  adults?: number;
  children?: number;
};

export type Quote = {
  id: string;
  propertyId: string;
  channel: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  totalCents: number;
  currency: string;
  nights: Night[];
  expiresAt: string;
};

export type Hold = {
  id: string;
  quoteId: string;
  status: "active" | "released" | "used" | "expired";
  expiresAt: string;
};

export type Guest = { name: string; email: string; phone?: string };

export type Payment = {
  status: "pending" | "paid" | "failed" | "refunded" | "partially_refunded";
  amountCents: number;
  hostAmountCents: number;
  partnerFeeCents: number;
  currency: string;
  paidAt?: string | null;
  refundedCents?: number;
};

export type Reservation = {
  id: string;
  externalId: string;
  propertyId: string;
  channel: string;
  checkIn: string;
  checkOut: string;
  status: "confirmed" | "cancelled" | "completed" | "pending";
  adults: number;
  children: number;
  totalCents: number;
  currency: string;
  guest: Guest;
  notes?: string | null;
  // planned
  createdAt?: string;
  updatedAt?: string;
  cancelledBy?: "host" | "partner" | null;
  payment?: Payment | null;
};

/** planned: GET /changes */
export type Change = {
  id: string;
  kind: "calendar" | "property" | "reservation";
  propertyId: string;
  from?: string;
  to?: string;
  reservationId?: string;
  occurredAt: string;
};

export type ChangesPage = {
  changes: Change[];
  nextCursor: string;
  hasMore: boolean;
};

/** planned: messages */
export type Message = {
  id: string;
  reservationId: string;
  externalId?: string | null;
  sender: "guest" | "host" | "system";
  source: "partner" | "bedlink";
  body: string;
  createdAt: string;
};

/** planned: POST /payment-sessions */
export type PaymentSession = {
  id: string;
  status: "open" | "processing" | "succeeded" | "failed" | "expired";
  embedUrl?: string;
  url?: string;
  amountCents: number;
  hostAmountCents: number;
  partnerFeeCents: number;
  currency: string;
  expiresAt: string;
  reservationId?: string | null;
};

export type Page<K extends string, T> = { [key in K]: T[] } & {
  nextCursor: string | null;
  hasMore: boolean;
};

/** planned: outgoing webhooks */
export type WebhookEvent =
  | Envelope<"property.connected", { propertyId: string }>
  | Envelope<"property.disconnected", { propertyId: string }>
  | Envelope<"availability.changed", { propertyId: string; from: string; to: string }>
  | Envelope<"reservation.confirmed", { reservation: Reservation }>
  | Envelope<"reservation.cancelled", { reservation: Reservation }>
  | Envelope<"reservation.modified", { reservation: Reservation }>
  | Envelope<"message.created", { reservationId: string; message: Message }>
  | Envelope<"ping", Record<string, never>>;

type Envelope<T extends string, D> = {
  id: string;
  type: T;
  createdAt: string;
  apiVersion?: string;
  environment?: Environment;
  data: D;
};
