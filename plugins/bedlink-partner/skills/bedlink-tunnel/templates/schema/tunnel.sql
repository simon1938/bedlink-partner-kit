-- Booking tunnel table (your side). Idempotent: safe to re-run.
-- Complements the bedlink_* tables of the integration: what BedLink does not
-- keep for you (the listing, the extras paid on site, the e-mails sent).
-- Night stays: dates, price and BedLink reservation are in bedlink_checkouts
-- (same external_id). Slots: in BedLink, read by bedlink_slot_reservation_id.

create table if not exists tunnel_bookings (
  external_id text primary key,
  kind text not null check (kind in ('night', 'slot')),
  listing_id text not null,
  bedlink_property_id uuid not null,
  bedlink_slot_reservation_id uuid,
  guest_first_name text not null,
  guest_last_name text not null,
  guest_email text not null,
  guest_phone text,
  guest_message text,
  -- [{ "id", "name", "quantity", "unitPriceCents" }] paid on site, not online
  extras jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired', 'released')),
  confirmed_at timestamptz,
  emails_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tunnel_bookings_listing_idx on tunnel_bookings (listing_id, created_at desc);
