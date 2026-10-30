import { db } from "@/lib/bedlink/db/neon"; // the adapter picked at install time (neon, pg or prisma)
import type { TunnelDay } from "@/components/tunnel/types";

// Every query of the tunnel, plain parameterised Postgres (same style as
// lib/bedlink/store.ts). Table: schema/tunnel.sql.

/** An extra paid online with the stay, as BedLink priced it (31/10/2026). */
export type TunnelExtra = { id: string; name: string; quantity: number; units: number; unitPriceCents: number; totalCents: number };

export type TunnelBooking = {
  externalId: string;
  kind: "night" | "slot";
  listingId: string;
  propertyId: string;
  slotReservationId: string | null;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string | null;
  guestMessage: string | null;
  extras: TunnelExtra[];
  status: "pending" | "confirmed" | "expired" | "released";
};

export type ListingProperty = {
  propertyId: string;
  name: string;
  currency: string;
  timezone: string;
  maxGuests: number | null;
  checkInFrom: string | null;
  checkOutUntil: string | null;
  cancellationPolicy: { summary?: Record<string, string> } | null;
};

const SELECT_BOOKING = `select external_id as "externalId", kind, listing_id as "listingId",
  bedlink_property_id::text as "propertyId", bedlink_slot_reservation_id::text as "slotReservationId",
  guest_first_name as "guestFirstName", guest_last_name as "guestLastName", guest_email as "guestEmail",
  guest_phone as "guestPhone", guest_message as "guestMessage", extras, status
  from tunnel_bookings`;

export const tunnelStore = {
  /** The BedLink property linked to one of your listings (bedlink_properties.listing_id). */
  async propertyForListing(listingId: string): Promise<ListingProperty | null> {
    const rows = await db.query<ListingProperty>(
      `select bedlink_property_id::text as "propertyId", name, currency, timezone, max_guests as "maxGuests",
         check_in_from as "checkInFrom", check_out_until as "checkOutUntil", cancellation_policy as "cancellationPolicy"
       from bedlink_properties where listing_id = $1::text and status = 'active'`,
      [listingId],
    );
    return rows[0] ?? null;
  },

  /** Night calendar from the local copy (no price: only the quote prices). */
  async calendarDays(propertyId: string, from: string, to: string): Promise<TunnelDay[]> {
    return db.query<TunnelDay>(
      `select to_char(date, 'YYYY-MM-DD') as date, available, arrival_allowed as "arrivalAllowed",
         departure_allowed as "departureAllowed", min_nights as "minNights",
         min_nights_through as "minNightsThrough", max_nights as "maxNights"
       from bedlink_calendar_days
       where bedlink_property_id = $1::uuid and date between $2::date and $3::date order by date`,
      [propertyId, from, to],
    );
  },

  async create(b: Omit<TunnelBooking, "status" | "slotReservationId">) {
    await db.query(
      `insert into tunnel_bookings (external_id, kind, listing_id, bedlink_property_id, guest_first_name,
         guest_last_name, guest_email, guest_phone, guest_message, extras)
       values ($1::text, $2::text, $3::text, $4::uuid, $5::text, $6::text, $7::text, $8::text, $9::text, $10::jsonb)
       on conflict (external_id) do update set guest_first_name = excluded.guest_first_name,
         guest_last_name = excluded.guest_last_name, guest_email = excluded.guest_email,
         guest_phone = excluded.guest_phone, guest_message = excluded.guest_message,
         extras = excluded.extras, status = 'pending', updated_at = now()
       returning external_id`,
      [
        b.externalId,
        b.kind,
        b.listingId,
        b.propertyId,
        b.guestFirstName,
        b.guestLastName,
        b.guestEmail,
        b.guestPhone,
        b.guestMessage,
        JSON.stringify(b.extras),
      ],
    );
  },

  async get(externalId: string): Promise<TunnelBooking | null> {
    const rows = await db.query<TunnelBooking>(`${SELECT_BOOKING} where external_id = $1::text`, [externalId]);
    return rows[0] ?? null;
  },

  async setSlotReservation(externalId: string, reservationId: string) {
    await db.query(
      `update tunnel_bookings set bedlink_slot_reservation_id = $2::uuid, updated_at = now()
       where external_id = $1::text returning external_id`,
      [externalId, reservationId],
    );
  },

  async setStatus(externalId: string, status: TunnelBooking["status"]) {
    await db.query(
      `update tunnel_bookings set status = $2::text, updated_at = now(),
         confirmed_at = case when $2::text = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end
       where external_id = $1::text returning external_id`,
      [externalId, status],
    );
  },

  /** Takes the right to send the e-mails: true for ONE caller only. */
  async claimEmails(externalId: string): Promise<boolean> {
    const rows = await db.query(
      `update tunnel_bookings set emails_sent_at = now(), updated_at = now()
       where external_id = $1::text and status = 'confirmed' and emails_sent_at is null returning external_id`,
      [externalId],
    );
    return rows.length > 0;
  },

  /** Bookings to re-check: still pending, or confirmed without e-mails, from the last 2 hours. */
  async toSweep(limit: number): Promise<string[]> {
    const rows = await db.query<{ ref: string }>(
      `select external_id as ref from tunnel_bookings
       where created_at > now() - interval '2 hours'
         and (status = 'pending' or (status = 'confirmed' and emails_sent_at is null))
       order by created_at limit $1::int`,
      [limit],
    );
    return rows.map((r) => r.ref);
  },

  /** Sending failed: give the right back so that the next check retries. */
  async unclaimEmails(externalId: string) {
    await db.query(
      `update tunnel_bookings set emails_sent_at = null, updated_at = now() where external_id = $1::text returning external_id`,
      [externalId],
    );
  },
};
