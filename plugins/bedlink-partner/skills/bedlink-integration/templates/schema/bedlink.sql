-- BedLink integration tables (Postgres / Neon). Idempotent: safe to re-run.
-- Same names and columns in schema/drizzle.ts and schema/prisma.prisma.
-- Field by field: references/data-model.md.

create table if not exists bedlink_properties (
  bedlink_property_id uuid primary key,
  listing_id text unique,
  name text not null,
  currency text not null,
  timezone text not null default 'Europe/Paris',
  max_guests integer,
  check_in_from text,
  check_in_until text,
  check_out_until text,
  cancellation_policy jsonb,
  environment text not null,
  status text not null default 'active',
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  calendar_until date,
  last_full_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists bedlink_calendar_days (
  bedlink_property_id uuid not null references bedlink_properties (bedlink_property_id) on delete cascade,
  date date not null,
  price_cents integer,
  available boolean not null,
  min_nights integer not null default 1,
  min_nights_through integer,
  max_nights integer,
  arrival_allowed boolean not null default true,
  departure_allowed boolean not null default true,
  synced_at timestamptz not null default now(),
  primary key (bedlink_property_id, date)
);
create index if not exists bedlink_calendar_days_search on bedlink_calendar_days (date, available);

create table if not exists bedlink_sync_state (
  id text primary key,
  changes_cursor text,
  reservations_since timestamptz,
  last_full_sync_at timestamptz,
  last_poll_at timestamptz,
  locked_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists bedlink_webhook_events (
  event_id text primary key,
  type text not null,
  created_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  payload jsonb not null
);
create index if not exists bedlink_webhook_events_received on bedlink_webhook_events (received_at);

create table if not exists bedlink_checkouts (
  external_id text primary key,
  bedlink_property_id uuid not null,
  check_in date not null,
  check_out date not null,
  adults integer not null,
  children integer not null default 0,
  quote_id uuid,
  quote_expires_at timestamptz,
  total_cents integer,
  currency text,
  hold_id uuid,
  hold_expires_at timestamptz,
  payment_session_id text,
  status text not null,
  bedlink_reservation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bedlink_reservations (
  bedlink_reservation_id uuid primary key,
  external_id text not null unique,
  bedlink_property_id uuid not null,
  status text not null,
  check_in date not null,
  check_out date not null,
  adults integer not null,
  children integer not null default 0,
  total_cents integer not null,
  currency text not null,
  guest_name text,
  guest_email text,
  guest_phone text,
  notes text,
  payment_status text,
  host_amount_cents integer,
  partner_fee_cents integer,
  paid_at timestamptz,
  cancelled_by text,
  bedlink_created_at timestamptz,
  bedlink_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists bedlink_reservations_property on bedlink_reservations (bedlink_property_id, check_in);

create table if not exists bedlink_messages (
  bedlink_message_id uuid primary key,
  bedlink_reservation_id uuid not null,
  external_id text unique,
  sender text not null,
  source text not null,
  body text not null,
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index if not exists bedlink_messages_thread on bedlink_messages (bedlink_reservation_id, created_at);
