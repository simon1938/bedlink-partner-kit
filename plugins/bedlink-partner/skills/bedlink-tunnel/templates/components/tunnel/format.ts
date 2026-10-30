// Display helpers. Calendar dates are "YYYY-MM-DD" strings handled at noon UTC:
// no timezone or daylight-saving change can shift a day.

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000);
}

export function firstOfMonth(date: string): string {
  return date.slice(0, 8) + "01";
}

export function addMonths(monthStart: string, n: number): string {
  const d = new Date(monthStart.slice(0, 8) + "01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function lastOfMonth(monthStart: string): string {
  return addDays(addMonths(monthStart, 1), -1);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon0(date: string): number {
  return (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
}

/** ISO weekday 1 = Monday … 7 = Sunday (the `days` of a formule). */
export function isoWeekday(date: string): number {
  return weekdayMon0(date) + 1;
}

export function formatMoney(cents: number, currency = "EUR", locale = "fr-FR"): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** "ven. 13 nov." (short) or "vendredi 13 novembre" (long). */
export function formatDay(date: string, style: "short" | "long" = "short", locale = "fr-FR"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: style,
    day: "numeric",
    month: style,
  }).format(new Date(date + "T12:00:00Z"));
}

export function formatMonth(monthStart: string, locale = "fr-FR"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(monthStart + "T12:00:00Z"),
  );
}

/** "16:00" → "16 h", "09:30" → "9 h 30". */
export function formatHour(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":");
  return `${Number(h)} h${m && m !== "00" ? " " + m : ""}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}
