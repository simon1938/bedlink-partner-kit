// The tunnel's calendar rules and e-mails (bedlink-tunnel skill), no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  departureRefusal,
  isCheckoutOnly,
  nightCell,
  pickDay,
  toDayMap,
} from "../plugins/bedlink-partner/skills/bedlink-tunnel/templates/components/tunnel/calendar-rules.ts";
import { addDays } from "../plugins/bedlink-partner/skills/bedlink-tunnel/templates/components/tunnel/format.ts";
import type { TunnelDay } from "../plugins/bedlink-partner/skills/bedlink-tunnel/templates/components/tunnel/types.ts";
import { guestEmail, hostEmail } from "../plugins/bedlink-partner/skills/bedlink-tunnel/templates/lib/tunnel/emails/booking-emails.ts";

const TODAY = "2026-11-01";
function calendar(taken: string[], over: Partial<Record<string, Partial<TunnelDay>>> = {}) {
  const days: TunnelDay[] = [];
  for (let d = TODAY; d <= "2026-11-30"; d = addDays(d, 1)) {
    days.push({
      date: d,
      available: !taken.includes(d),
      arrivalAllowed: true,
      departureAllowed: true,
      minNights: 1,
      minNightsThrough: null,
      maxNights: null,
      ...over[d],
    });
  }
  return toDayMap(days);
}

describe("tunnel calendar rules", () => {
  // Nights of the 10th and 11th sold: a stay 10 → 12 is someone else's.
  const map = calendar(["2026-11-10", "2026-11-11"]);

  it("a departure on the first sold night is allowed (same-day turnover)", () => {
    assert.equal(departureRefusal(map, "2026-11-07", "2026-11-10"), null);
    assert.equal(isCheckoutOnly(map, "2026-11-10"), true);
    assert.equal(isCheckoutOnly(map, "2026-11-11"), false);
  });

  it("a departure that straddles a sold night is refused", () => {
    assert.equal(departureRefusal(map, "2026-11-07", "2026-11-13"), "night_taken");
    const cell = nightCell("2026-11-13", { from: "2026-11-07", to: null }, map, TODAY);
    assert.equal(cell.disabled, true);
  });

  it("a sold night cannot be an arrival, the next free one can", () => {
    assert.deepEqual(pickDay({ from: null, to: null }, "2026-11-10", map, TODAY), { from: null, to: null });
    assert.deepEqual(pickDay({ from: null, to: null }, "2026-11-12", map, TODAY), { from: "2026-11-12", to: null });
  });

  it("second click sets the departure, a click before the arrival restarts", () => {
    const r = pickDay({ from: "2026-11-03", to: null }, "2026-11-05", map, TODAY);
    assert.deepEqual(r, { from: "2026-11-03", to: "2026-11-05" });
    assert.deepEqual(pickDay({ from: "2026-11-05", to: null }, "2026-11-02", map, TODAY), { from: "2026-11-02", to: null });
  });

  it("minimum stay, through-minimum, closed departure and closed arrival", () => {
    const m = calendar([], {
      "2026-11-20": { minNights: 3 },
      "2026-11-25": { minNightsThrough: 2 },
      "2026-11-15": { departureAllowed: false },
      "2026-11-14": { arrivalAllowed: false },
    });
    assert.equal(departureRefusal(m, "2026-11-20", "2026-11-22"), "min_nights");
    assert.equal(departureRefusal(m, "2026-11-20", "2026-11-23"), null);
    assert.equal(departureRefusal(m, "2026-11-25", "2026-11-26"), "min_nights");
    assert.equal(departureRefusal(m, "2026-11-13", "2026-11-15"), "departure_closed");
    assert.equal(nightCell("2026-11-14", { from: null, to: null }, m, TODAY).disabled, true);
  });

  it("past days are closed", () => {
    assert.equal(nightCell("2026-10-31", { from: null, to: null }, map, TODAY).disabled, true);
  });
});

describe("tunnel e-mails", () => {
  const booking = {
    ref: "la_123",
    kind: "night" as const,
    listingName: "La <Cabane>",
    listingUrl: "https://example.test/cabane",
    hostFirstName: "Claire",
    when: "ven. 13 nov. → dim. 15 nov. · 2 nuits",
    guestsLabel: "2 adultes",
    priceLines: [{ label: "2 nuits", cents: 27800 }],
    totalCents: 27800,
    currency: "EUR",
    extras: [{ label: "Petit-déjeuner × 2", cents: 2800 }],
    guest: { name: "Camille Martin", email: "camille@example.test", phone: "+33 6 12 34 56 78", message: "Arrivée vers 18 h" },
    supportEmail: "contact@example.test",
  };

  it("guest e-mail: escaped, paid total, extras on site", () => {
    const e = guestEmail(booking);
    assert.match(e.html, /La &lt;Cabane&gt;/);
    assert.doesNotMatch(e.html, /La <Cabane>/);
    assert.match(e.html, /278/);
    assert.match(e.text, /Extras à régler sur place/);
  });

  it("host e-mail: guest contact, reply-to, link to BedLink", () => {
    const e = hostEmail(booking);
    assert.equal(e.replyTo, "camille@example.test");
    assert.match(e.html, /Ouvrir dans BedLink/);
    assert.match(e.html, /app\.bedlink\.fr\/fr\/dashboard\/reservations/);
    assert.match(e.html, /Arrivée vers 18 h/);
  });

  it("no em dash in the e-mails", () => {
    assert.doesNotMatch(guestEmail(booking).html + hostEmail(booking).html, /\u2014/);
  });
});
