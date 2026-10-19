import type { SqlClient } from "./db/types";
import type { CalendarDay, Message, Property, Reservation } from "./types";
// The adapter picked at install time (neon.ts, pg.ts or prisma.ts).
import { db as defaultDb } from "./db/neon";

// Every query used by the integration, in one place. Plain parameterised
// Postgres: every value is a bound parameter with an explicit cast, every
// statement returns rows (Prisma's $queryRawUnsafe expects it).
// Tables: see schema/ in the kit (Drizzle, Prisma or SQL), all prefixed bedlink_.

export type LocalProperty = {
  id: string;
  timezone: string;
  calendarUntil: string | null;
  lastFullSyncAt: string | null;
};

export type SyncState = {
  changesCursor: string | null;
  reservationsSince: string | null;
  lastFullSyncAt: string | null;
  lastPollAt: string | null;
  lastError: string | null;
};

export type CheckoutStatus = "quoted" | "held" | "paying" | "confirmed" | "failed" | "expired" | "released";

export type Checkout = {
  externalId: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  quoteId: string | null;
  quoteExpiresAt: string | null;
  totalCents: number | null;
  currency: string | null;
  holdId: string | null;
  holdExpiresAt: string | null;
  paymentSessionId: string | null;
  status: CheckoutStatus;
  reservationId: string | null;
};

export function createStore(db: SqlClient = defaultDb) {
  return {
    // ── Properties ─────────────────────────────────────────────────────
    async upsertProperty(p: Property) {
      await db.query(
        `insert into bedlink_properties (bedlink_property_id, name, currency, timezone, max_guests,
           check_in_from, check_in_until, check_out_until, cancellation_policy, environment, status,
           connected_at, disconnected_at, updated_at)
         values ($1::uuid, $2::text, $3::text, $4::text, $5::int, $6::text, $7::text, $8::text, $9::jsonb,
           $10::text, 'active', now(), null, now())
         on conflict (bedlink_property_id) do update set
           name = excluded.name, currency = excluded.currency, timezone = excluded.timezone,
           max_guests = excluded.max_guests, check_in_from = excluded.check_in_from,
           check_in_until = excluded.check_in_until, check_out_until = excluded.check_out_until,
           cancellation_policy = excluded.cancellation_policy, environment = excluded.environment,
           status = 'active', disconnected_at = null, updated_at = now()
         returning bedlink_property_id`,
        [
          p.id,
          p.name,
          p.currency,
          p.timezone ?? "Europe/Paris",
          p.maxGuests ?? null,
          p.checkInFrom ?? null,
          p.checkInUntil ?? null,
          p.checkOutUntil ?? null,
          p.cancellationPolicy ? JSON.stringify(p.cancellationPolicy) : null,
          p.environment,
        ],
      );
    },

    /** Removed from sale: kept for history, calendar rows deleted. */
    async markPropertyDisconnected(id: string) {
      await db.query(
        `with p as (
           update bedlink_properties set status = 'disconnected', disconnected_at = now(), updated_at = now(),
             calendar_until = null, last_full_sync_at = null
           where bedlink_property_id = $1::uuid and status <> 'disconnected' returning bedlink_property_id)
         , d as (delete from bedlink_calendar_days where bedlink_property_id = $1::uuid returning 1)
         select (select count(*) from p)::int as properties, (select count(*) from d)::int as days`,
        [id],
      );
    },

    async listActiveProperties(): Promise<LocalProperty[]> {
      return db.query<LocalProperty>(
        `select bedlink_property_id::text as id, timezone,
           to_char(calendar_until, 'YYYY-MM-DD') as "calendarUntil",
           last_full_sync_at::text as "lastFullSyncAt"
         from bedlink_properties where status = 'active' order by bedlink_property_id`,
      );
    },

    async getLocalProperty(id: string): Promise<LocalProperty | null> {
      const rows = await db.query<LocalProperty>(
        `select bedlink_property_id::text as id, timezone,
           to_char(calendar_until, 'YYYY-MM-DD') as "calendarUntil",
           last_full_sync_at::text as "lastFullSyncAt"
         from bedlink_properties where bedlink_property_id = $1::uuid and status = 'active'`,
        [id],
      );
      return rows[0] ?? null;
    },

    async markCalendarSynced(id: string, until: string, full: boolean) {
      await db.query(
        `update bedlink_properties set calendar_until = greatest(coalesce(calendar_until, $2::date), $2::date),
           last_full_sync_at = case when $3::boolean then now() else last_full_sync_at end, updated_at = now()
         where bedlink_property_id = $1::uuid returning bedlink_property_id`,
        [id, until, full],
      );
    },

    /** After cursor_expired: every property is read again in full. */
    async forgetFullSync() {
      await db.query(
        `update bedlink_properties set last_full_sync_at = null where status = 'active' returning bedlink_property_id`,
      );
    },

    // ── Calendar ───────────────────────────────────────────────────────
    async writeCalendarDays(propertyId: string, days: CalendarDay[]) {
      if (days.length === 0) return;
      await db.query(
        `insert into bedlink_calendar_days (bedlink_property_id, date, price_cents, available, min_nights,
           min_nights_through, max_nights, arrival_allowed, departure_allowed, synced_at)
         select $1::uuid, d.date, d."priceCents", d.available, d."minNights", d."minNightsThrough",
           d."maxNights", d."arrivalAllowed", d."departureAllowed", now()
         from jsonb_to_recordset($2::jsonb) as d(date date, "priceCents" int, available boolean,
           "minNights" int, "minNightsThrough" int, "maxNights" int, "arrivalAllowed" boolean,
           "departureAllowed" boolean)
         on conflict (bedlink_property_id, date) do update set
           price_cents = excluded.price_cents, available = excluded.available,
           min_nights = excluded.min_nights, min_nights_through = excluded.min_nights_through,
           max_nights = excluded.max_nights, arrival_allowed = excluded.arrival_allowed,
           departure_allowed = excluded.departure_allowed, synced_at = excluded.synced_at
         returning 1 as ok`,
        [propertyId, JSON.stringify(days)],
      );
    },

    async purgeDaysBefore(date: string) {
      await db.query(
        `with d as (delete from bedlink_calendar_days where date < $1::date returning 1)
         select count(*)::int as n from d`,
        [date],
      );
    },

    // ── Sync state (one row) ───────────────────────────────────────────
    async getSyncState(): Promise<SyncState> {
      const rows = await db.query<SyncState>(
        `insert into bedlink_sync_state (id) values ('default') on conflict (id) do update set id = excluded.id
         returning changes_cursor as "changesCursor", reservations_since::text as "reservationsSince",
           last_full_sync_at::text as "lastFullSyncAt", last_poll_at::text as "lastPollAt",
           last_error as "lastError"`,
      );
      return rows[0];
    },

    async saveSyncState(patch: Partial<Record<"changesCursor" | "reservationsSince" | "lastError", string | null>> & {
      fullSync?: boolean;
      polled?: boolean;
    }) {
      await db.query(
        `update bedlink_sync_state set
           changes_cursor = case when $1::boolean then $2::text else changes_cursor end,
           reservations_since = case when $3::boolean then $4::timestamptz else reservations_since end,
           last_error = case when $5::boolean then $6::text else last_error end,
           last_full_sync_at = case when $7::boolean then now() else last_full_sync_at end,
           last_poll_at = case when $8::boolean then now() else last_poll_at end,
           updated_at = now()
         where id = 'default' returning id`,
        [
          "changesCursor" in patch,
          patch.changesCursor ?? null,
          "reservationsSince" in patch,
          patch.reservationsSince ?? null,
          "lastError" in patch,
          patch.lastError ?? null,
          patch.fullSync ?? false,
          patch.polled ?? false,
        ],
      );
    },

    /** One sync at a time (cron, script, webhook follow-up). */
    async acquireLock(seconds: number): Promise<boolean> {
      await this.getSyncState();
      const rows = await db.query(
        `update bedlink_sync_state set locked_until = now() + make_interval(secs => $1::int)
         where id = 'default' and (locked_until is null or locked_until < now()) returning id`,
        [seconds],
      );
      return rows.length === 1;
    },

    async releaseLock() {
      await db.query(`update bedlink_sync_state set locked_until = null where id = 'default' returning id`);
    },

    // ── Webhooks ───────────────────────────────────────────────────────
    /** "new" the first time, "done" if already processed, "retry" if seen but not processed. */
    async recordWebhookEvent(e: { id: string; type: string; createdAt?: string; payload: unknown }) {
      const rows = await db.query<{ inserted: boolean; processed: boolean }>(
        `with ins as (
           insert into bedlink_webhook_events (event_id, type, created_at, payload)
           values ($1::text, $2::text, $3::timestamptz, $4::jsonb)
           on conflict (event_id) do nothing returning true as inserted)
         select coalesce((select inserted from ins), false) as inserted,
           coalesce((select processed_at is not null from bedlink_webhook_events where event_id = $1::text), false) as processed`,
        [e.id, e.type, e.createdAt ?? null, JSON.stringify(e.payload)],
      );
      const r = rows[0];
      return r.inserted ? "new" : r.processed ? "done" : "retry";
    },

    async markWebhookProcessed(id: string, error: string | null = null) {
      await db.query(
        `update bedlink_webhook_events set processed_at = case when $2::text is null then now() else null end,
           error = $2::text where event_id = $1::text returning event_id`,
        [id, error],
      );
    },

    async purgeWebhookEvents(days = 30) {
      await db.query(
        `with d as (delete from bedlink_webhook_events where received_at < now() - make_interval(days => $1::int) returning 1)
         select count(*)::int as n from d`,
        [days],
      );
    },

    // ── Reservations ───────────────────────────────────────────────────
    async upsertReservation(r: Reservation) {
      await db.query(
        `insert into bedlink_reservations (bedlink_reservation_id, external_id, bedlink_property_id, status,
           check_in, check_out, adults, children, total_cents, currency, guest_name, guest_email, guest_phone,
           notes, payment_status, host_amount_cents, partner_fee_cents, paid_at, cancelled_by,
           bedlink_created_at, bedlink_updated_at, synced_at)
         values ($1::uuid, $2::text, $3::uuid, $4::text, $5::date, $6::date, $7::int, $8::int, $9::int, $10::text,
           $11::text, $12::text, $13::text, $14::text, $15::text, $16::int, $17::int, $18::timestamptz, $19::text,
           $20::timestamptz, $21::timestamptz, now())
         on conflict (bedlink_reservation_id) do update set
           status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out,
           adults = excluded.adults, children = excluded.children, total_cents = excluded.total_cents,
           currency = excluded.currency, guest_name = excluded.guest_name, guest_email = excluded.guest_email,
           guest_phone = excluded.guest_phone, notes = excluded.notes,
           payment_status = coalesce(excluded.payment_status, bedlink_reservations.payment_status),
           host_amount_cents = coalesce(excluded.host_amount_cents, bedlink_reservations.host_amount_cents),
           partner_fee_cents = coalesce(excluded.partner_fee_cents, bedlink_reservations.partner_fee_cents),
           paid_at = coalesce(excluded.paid_at, bedlink_reservations.paid_at),
           cancelled_by = coalesce(excluded.cancelled_by, bedlink_reservations.cancelled_by),
           bedlink_created_at = coalesce(excluded.bedlink_created_at, bedlink_reservations.bedlink_created_at),
           bedlink_updated_at = coalesce(excluded.bedlink_updated_at, bedlink_reservations.bedlink_updated_at),
           synced_at = now()
         returning bedlink_reservation_id`,
        [
          r.id,
          r.externalId,
          r.propertyId,
          r.status,
          r.checkIn,
          r.checkOut,
          r.adults,
          r.children,
          r.totalCents,
          r.currency,
          r.guest?.name ?? null,
          r.guest?.email ?? null,
          r.guest?.phone ?? null,
          r.notes ?? null,
          r.payment?.status ?? null,
          r.payment?.hostAmountCents ?? null,
          r.payment?.partnerFeeCents ?? null,
          r.payment?.paidAt ?? null,
          r.cancelledBy ?? null,
          r.createdAt ?? null,
          r.updatedAt ?? null,
        ],
      );
    },

    /** Reservations whose status can still change (fallback when reservations_list is off). */
    async reservationsToRefresh(limit: number): Promise<string[]> {
      const rows = await db.query<{ id: string }>(
        `select bedlink_reservation_id::text as id from bedlink_reservations
         where status in ('confirmed', 'pending') and check_out >= current_date
         order by synced_at asc limit $1::int`,
        [limit],
      );
      return rows.map((r) => r.id);
    },

    // ── Checkouts (quote → hold → payment → reservation) ───────────────
    async saveCheckout(c: Checkout) {
      await db.query(
        `insert into bedlink_checkouts (external_id, bedlink_property_id, check_in, check_out, adults, children,
           quote_id, quote_expires_at, total_cents, currency, hold_id, hold_expires_at, payment_session_id,
           status, bedlink_reservation_id, created_at, updated_at)
         values ($1::text, $2::uuid, $3::date, $4::date, $5::int, $6::int, $7::uuid, $8::timestamptz, $9::int,
           $10::text, $11::uuid, $12::timestamptz, $13::text, $14::text, $15::uuid, now(), now())
         on conflict (external_id) do update set
           quote_id = excluded.quote_id, quote_expires_at = excluded.quote_expires_at,
           total_cents = excluded.total_cents, currency = excluded.currency, hold_id = excluded.hold_id,
           hold_expires_at = excluded.hold_expires_at, payment_session_id = excluded.payment_session_id,
           status = excluded.status, bedlink_reservation_id = excluded.bedlink_reservation_id, updated_at = now()
         returning external_id`,
        [
          c.externalId,
          c.propertyId,
          c.checkIn,
          c.checkOut,
          c.adults,
          c.children,
          c.quoteId,
          c.quoteExpiresAt,
          c.totalCents,
          c.currency,
          c.holdId,
          c.holdExpiresAt,
          c.paymentSessionId,
          c.status,
          c.reservationId,
        ],
      );
    },

    async getCheckout(externalId: string): Promise<Checkout | null> {
      const rows = await db.query<Checkout>(
        `select external_id as "externalId", bedlink_property_id::text as "propertyId",
           to_char(check_in, 'YYYY-MM-DD') as "checkIn", to_char(check_out, 'YYYY-MM-DD') as "checkOut",
           adults, children, quote_id::text as "quoteId", quote_expires_at::text as "quoteExpiresAt",
           total_cents as "totalCents", currency, hold_id::text as "holdId",
           hold_expires_at::text as "holdExpiresAt", payment_session_id as "paymentSessionId", status,
           bedlink_reservation_id::text as "reservationId"
         from bedlink_checkouts where external_id = $1::text`,
        [externalId],
      );
      return rows[0] ?? null;
    },

    async confirmCheckoutByExternalId(externalId: string, reservationId: string) {
      await db.query(
        `update bedlink_checkouts set status = 'confirmed', bedlink_reservation_id = $2::uuid, updated_at = now()
         where external_id = $1::text returning external_id`,
        [externalId, reservationId],
      );
    },

    // ── Messages ───────────────────────────────────────────────────────
    async upsertMessage(m: Message) {
      await db.query(
        `insert into bedlink_messages (bedlink_message_id, bedlink_reservation_id, external_id, sender, source,
           body, created_at, synced_at)
         values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, now())
         on conflict (bedlink_message_id) do update set body = excluded.body, synced_at = now()
         returning bedlink_message_id`,
        [m.id, m.reservationId, m.externalId ?? null, m.sender, m.source, m.body, m.createdAt],
      );
    },
  };
}

export type BedlinkStore = ReturnType<typeof createStore>;
export const store = createStore();
