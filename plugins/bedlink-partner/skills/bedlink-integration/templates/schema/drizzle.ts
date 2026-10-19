// BedLink integration tables for Drizzle (Postgres). Merge into the project's
// schema file (or export it from there), then generate a migration:
//   npx drizzle-kit generate && npx drizzle-kit migrate
// Names and columns are identical to schema/bedlink.sql: the store uses SQL.
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const bedlinkProperties = pgTable("bedlink_properties", {
  bedlinkPropertyId: uuid("bedlink_property_id").primaryKey(),
  listingId: text("listing_id").unique(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  maxGuests: integer("max_guests"),
  checkInFrom: text("check_in_from"),
  checkInUntil: text("check_in_until"),
  checkOutUntil: text("check_out_until"),
  cancellationPolicy: jsonb("cancellation_policy"),
  environment: text("environment").notNull(),
  status: text("status").notNull().default("active"),
  connectedAt: tz("connected_at").notNull().default(sql`now()`),
  disconnectedAt: tz("disconnected_at"),
  calendarUntil: date("calendar_until", { mode: "string" }),
  lastFullSyncAt: tz("last_full_sync_at"),
  updatedAt: tz("updated_at").notNull().default(sql`now()`),
});

export const bedlinkCalendarDays = pgTable(
  "bedlink_calendar_days",
  {
    bedlinkPropertyId: uuid("bedlink_property_id")
      .notNull()
      .references(() => bedlinkProperties.bedlinkPropertyId, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    priceCents: integer("price_cents"),
    available: boolean("available").notNull(),
    minNights: integer("min_nights").notNull().default(1),
    minNightsThrough: integer("min_nights_through"),
    maxNights: integer("max_nights"),
    arrivalAllowed: boolean("arrival_allowed").notNull().default(true),
    departureAllowed: boolean("departure_allowed").notNull().default(true),
    syncedAt: tz("synced_at").notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.bedlinkPropertyId, t.date] }),
    index("bedlink_calendar_days_search").on(t.date, t.available),
  ],
);

export const bedlinkSyncState = pgTable("bedlink_sync_state", {
  id: text("id").primaryKey(),
  changesCursor: text("changes_cursor"),
  reservationsSince: tz("reservations_since"),
  lastFullSyncAt: tz("last_full_sync_at"),
  lastPollAt: tz("last_poll_at"),
  lockedUntil: tz("locked_until"),
  lastError: text("last_error"),
  updatedAt: tz("updated_at").notNull().default(sql`now()`),
});

export const bedlinkWebhookEvents = pgTable(
  "bedlink_webhook_events",
  {
    eventId: text("event_id").primaryKey(),
    type: text("type").notNull(),
    createdAt: tz("created_at"),
    receivedAt: tz("received_at").notNull().default(sql`now()`),
    processedAt: tz("processed_at"),
    error: text("error"),
    payload: jsonb("payload").notNull(),
  },
  (t) => [index("bedlink_webhook_events_received").on(t.receivedAt)],
);

export const bedlinkCheckouts = pgTable("bedlink_checkouts", {
  externalId: text("external_id").primaryKey(),
  bedlinkPropertyId: uuid("bedlink_property_id").notNull(),
  checkIn: date("check_in", { mode: "string" }).notNull(),
  checkOut: date("check_out", { mode: "string" }).notNull(),
  adults: integer("adults").notNull(),
  children: integer("children").notNull().default(0),
  quoteId: uuid("quote_id"),
  quoteExpiresAt: tz("quote_expires_at"),
  totalCents: integer("total_cents"),
  currency: text("currency"),
  holdId: uuid("hold_id"),
  holdExpiresAt: tz("hold_expires_at"),
  paymentSessionId: text("payment_session_id"),
  status: text("status").notNull(),
  bedlinkReservationId: uuid("bedlink_reservation_id"),
  createdAt: tz("created_at").notNull().default(sql`now()`),
  updatedAt: tz("updated_at").notNull().default(sql`now()`),
});

export const bedlinkReservations = pgTable(
  "bedlink_reservations",
  {
    bedlinkReservationId: uuid("bedlink_reservation_id").primaryKey(),
    externalId: text("external_id").notNull().unique(),
    bedlinkPropertyId: uuid("bedlink_property_id").notNull(),
    status: text("status").notNull(),
    checkIn: date("check_in", { mode: "string" }).notNull(),
    checkOut: date("check_out", { mode: "string" }).notNull(),
    adults: integer("adults").notNull(),
    children: integer("children").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull(),
    guestName: text("guest_name"),
    guestEmail: text("guest_email"),
    guestPhone: text("guest_phone"),
    notes: text("notes"),
    paymentStatus: text("payment_status"),
    hostAmountCents: integer("host_amount_cents"),
    partnerFeeCents: integer("partner_fee_cents"),
    paidAt: tz("paid_at"),
    cancelledBy: text("cancelled_by"),
    bedlinkCreatedAt: tz("bedlink_created_at"),
    bedlinkUpdatedAt: tz("bedlink_updated_at"),
    syncedAt: tz("synced_at").notNull().default(sql`now()`),
  },
  (t) => [index("bedlink_reservations_property").on(t.bedlinkPropertyId, t.checkIn)],
);

export const bedlinkMessages = pgTable(
  "bedlink_messages",
  {
    bedlinkMessageId: uuid("bedlink_message_id").primaryKey(),
    bedlinkReservationId: uuid("bedlink_reservation_id").notNull(),
    externalId: text("external_id").unique(),
    sender: text("sender").notNull(),
    source: text("source").notNull(),
    body: text("body").notNull(),
    createdAt: tz("created_at").notNull(),
    syncedAt: tz("synced_at").notNull().default(sql`now()`),
  },
  (t) => [index("bedlink_messages_thread").on(t.bedlinkReservationId, t.createdAt)],
);
