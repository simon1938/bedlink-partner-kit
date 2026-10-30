import { bedlinkConfig } from "@/lib/bedlink/config";
import { BedlinkError, FeatureUnavailableError } from "@/lib/bedlink/client";
import type { Guest } from "@/lib/bedlink/types";

// Day rental (formules and slots) of the BedLink Partner API, server side only.
// Opened per partner with the "formules" whitelist (sandbox for Logement
// Atypique since 28/10/2026). Contract: references/contract.md, section
// "Location à la journée", in the bedlink-integration skill.
//
// Kept in its own file so that it can be added to an integration installed
// before day rental existed. Never import it from a "use client" file.

export type Formule = {
  id: string;
  propertyId: string;
  externalId: string | null;
  name: string;
  nameEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  slots: { id: string; label: string; start: string; end: string; priceCents: number }[];
  capacity: number | null;
  nightIncluded: boolean;
  days: number[]; // ISO weekdays, 1 = Monday
  minNoticeHours: number;
  active: boolean;
  createdBy: "host" | "partner";
};

export type FreeSlot = {
  date: string;
  formuleId: string;
  slotId: string;
  label: string;
  start: string;
  end: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  currency: string;
};

export type SlotQuote = {
  propertyId: string;
  formuleId: string;
  slotId: string;
  date: string;
  available: boolean;
  startAt: string | null;
  endAt: string | null;
  totalCents: number;
  currency: string;
  nightIncluded: boolean;
};

export type SlotReservation = {
  id: string;
  propertyId: string;
  formuleId: string;
  formuleName: string;
  slotId: string;
  slotLabel: string;
  date: string;
  startAt: string;
  endAt: string;
  nightIncluded: boolean;
  status: "pending_payment" | "confirmed" | "cancelled" | "expired";
  externalId: string;
  guests: number;
  guest: Guest;
  totalCents: number;
  currency: string;
  payment: {
    id: string;
    status: "open" | "succeeded" | "expired";
    url: string;
    embedUrl: string;
    expiresAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

/** Slots can be read 62 days at a time at most. */
export const SLOTS_MAX_DAYS = 62;

async function request<T>(path: string, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}): Promise<T> {
  const { apiKey, apiUrl } = bedlinkConfig();
  const res = await fetch(apiUrl + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON answer (proxy, outage)
  }
  if (res.ok) return json as T;
  const err = (json as { error?: { code?: string; message?: string }; requestId?: string } | null) ?? {};
  const message = err.error?.message ?? (text.slice(0, 200) || res.statusText);
  if (res.status === 404 && message === "Endpoint not found.") throw new FeatureUnavailableError("formules");
  throw new BedlinkError(res.status, err.error?.code ?? "http_error", message, err.requestId);
}

const enc = encodeURIComponent;

export const dayRental = {
  /** Formules visible to you. Empty when the host has not turned day rental on. */
  listFormules: (propertyId: string) =>
    request<{ formules: Formule[] }>(`/properties/${enc(propertyId)}/formules`).then((r) => r.formules.filter((f) => f.active)),

  /** FREE slots only, from..to inclusive, 62 days at most. */
  listFreeSlots: (propertyId: string, from: string, to: string) =>
    request<{ slots: FreeSlot[] }>(`/properties/${enc(propertyId)}/creneaux?from=${from}&to=${to}`).then((r) => r.slots),

  /** Price and availability of one slot. Nothing is held. */
  quote: (input: { propertyId: string; formuleId: string; slotId: string; date: string; guests: number }) =>
    request<SlotQuote>("/creneaux/quotes", { method: "POST", body: input }),

  /**
   * With `payment`: status pending_payment, a 15-minute option, and the BedLink
   * payment page (payment.embedUrl → PaymentFrame). Without: sandbox only,
   * confirmed at once. Replaying the same externalId returns the same reservation.
   */
  reserve: (input: {
    propertyId: string;
    formuleId: string;
    slotId: string;
    date: string;
    guests: number;
    externalId: string;
    guest: Guest;
    notes?: string;
    payment?: { returnUrl: string; cancelUrl?: string };
  }) => request<SlotReservation>("/creneaux/reservations", { method: "POST", body: input }),

  get: (id: string) => request<SlotReservation>(`/creneaux/reservations/${enc(id)}`),

  cancel: (id: string) => request<SlotReservation>(`/creneaux/reservations/${enc(id)}`, { method: "DELETE" }),
};
