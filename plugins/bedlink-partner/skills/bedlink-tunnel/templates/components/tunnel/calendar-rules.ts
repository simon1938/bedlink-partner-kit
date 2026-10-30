// The night-calendar rules of our direct-booking sites, on the BedLink calendar.
// Pure functions, no React: easy to test, same rules on server and browser.
//
// A stay from the 16th to the 20th uses the NIGHTS 16, 17, 18, 19. The night of
// the 20th belongs to the next guest: leaving on a sold night is fine (same-day
// turnover), staying over a sold night is not.
//
// The calendar only helps choosing. The quote (POST /quotes) is the only judge:
// a date the calendar allows can still be refused (409 dates_unavailable).

import { addDays, daysBetween } from "./format";
import type { TunnelDay } from "./types";

export type DayMap = Map<string, TunnelDay>;
export type Range = { from: string | null; to: string | null };

export function toDayMap(days: TunnelDay[]): DayMap {
  return new Map(days.map((d) => [d.date, d]));
}

function nightFree(map: DayMap, date: string): boolean {
  return map.get(date)?.available === true;
}

/** Can a stay START this day? */
export function canArrive(map: DayMap, date: string, today: string): boolean {
  const d = map.get(date);
  return date >= today && !!d && d.available && d.arrivalAllowed;
}

export type DepartureRefusal = "before_arrival" | "night_taken" | "min_nights" | "max_nights" | "departure_closed";

/** Can a stay that started on `from` END on `to`? null = yes, otherwise why not. */
export function departureRefusal(map: DayMap, from: string, to: string): DepartureRefusal | null {
  const n = daysBetween(from, to);
  if (n < 1) return "before_arrival";
  for (let night = from; night < to; night = addDays(night, 1)) {
    if (!nightFree(map, night)) return "night_taken"; // the range would STRADDLE a sold night
    const through = map.get(night)?.minNightsThrough;
    if (through && n < through) return "min_nights";
  }
  const first = map.get(from);
  if (first && n < first.minNights) return "min_nights";
  if (first?.maxNights && n > first.maxNights) return "max_nights";
  // Unknown day (outside the loaded window): allowed here, the quote decides.
  if (map.get(to)?.departureAllowed === false) return "departure_closed";
  return null;
}

/**
 * "Half" day: its night is taken but the night before is free, so a guest can
 * LEAVE that day. Shown half-tinted from the start: without it the day looks
 * dead until an arrival is picked, and nobody can guess it opens.
 */
export function isCheckoutOnly(map: DayMap, date: string): boolean {
  const d = map.get(date);
  if (!d || d.available) return false;
  return nightFree(map, addDays(date, -1)) && d.departureAllowed !== false;
}

/** What the next click means, and the new range. */
export function pickDay(range: Range, date: string, map: DayMap, today: string): Range {
  const choosingDeparture = !!range.from && !range.to && date > range.from;
  if (choosingDeparture && departureRefusal(map, range.from!, date) === null) {
    return { from: range.from, to: date };
  }
  if (canArrive(map, date, today)) return { from: date, to: null };
  return range;
}

export type CellState = {
  disabled: boolean;
  half: boolean;
  selected: boolean; // arrival or departure
  inRange: boolean;
  today: boolean;
};

export function nightCell(date: string, range: Range, map: DayMap, today: string): CellState {
  const choosingDeparture = !!range.from && !range.to;
  let disabled: boolean;
  if (date < today) disabled = true;
  else if (choosingDeparture && date > range.from!) disabled = departureRefusal(map, range.from!, date) !== null;
  else disabled = !canArrive(map, date, today);
  return {
    disabled,
    half: date >= today && isCheckoutOnly(map, date),
    selected: date === range.from || date === range.to,
    inRange: !!range.from && !!range.to && date > range.from && date < range.to,
    today: date === today,
  };
}

/** Minimum stay for an arrival on `from` (to tell the guest before the click). */
export function minStayFrom(map: DayMap, from: string): number {
  return Math.max(1, map.get(from)?.minNights ?? 1);
}

/** Message for a refused departure, in French. */
export function refusalMessage(r: DepartureRefusal, minNights: number): string {
  switch (r) {
    case "night_taken":
      return "Une nuit est déjà réservée entre ces dates.";
    case "min_nights":
      return `Séjour minimum : ${minNights} nuits.`;
    case "max_nights":
      return "Ce séjour dépasse la durée maximale.";
    case "departure_closed":
      return "Les départs ne sont pas possibles ce jour-là.";
    default:
      return "Choisissez un départ après l’arrivée.";
  }
}
