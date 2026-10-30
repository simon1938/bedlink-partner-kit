"use client";

import { useMemo, type ReactNode } from "react";
import { departureRefusal, minStayFrom, nightCell, pickDay, refusalMessage, toDayMap, type Range } from "./calendar-rules";
import { addDays, addMonths, formatDay, formatMonth, lastOfMonth, plural, weekdayMon0, daysBetween } from "./format";
import type { TunnelDay } from "./types";

// Period calendar of our direct sites, without any date library.
// Two months side by side when the tunnel is wide, one on a phone (CSS
// container query, the second month is hidden). No price per day: only the
// BedLink quote gives a price, once the dates are set.

const WEEKDAYS = ["LU", "MA", "ME", "JE", "VE", "SA", "DI"];
const NO_DAYS: TunnelDay[] = [];

type Common = {
  today: string; // property's today (todayIn(property.timezone) on the server)
  month: string; // first day of the first visible month
  onMonthChange: (month: string) => void;
  maxMonth?: string; // last month that can be shown first
};

type NightProps = Common & {
  mode: "range";
  days: TunnelDay[];
  range: Range;
  onRangeChange: (range: Range) => void;
};

type DayProps = Common & {
  mode: "single";
  selected: string | null;
  onSelect: (date: string | null) => void;
  isEnabled: (date: string) => boolean;
  legend?: string;
};

export function StayCalendar(props: NightProps | DayProps) {
  const nightDays = props.mode === "range" ? props.days : NO_DAYS;
  const map = useMemo(() => toDayMap(nightDays), [nightDays]);
  const minMonth = props.today.slice(0, 8) + "01";
  const canPrev = props.month > minMonth;
  const canNext = !props.maxMonth || props.month < props.maxMonth;

  function cell(date: string) {
    if (props.mode === "range") {
      const s = nightCell(date, props.range, map, props.today);
      const cls = ["bt-day", s.half && "is-half", s.selected && "is-selected", s.inRange && "is-range", s.today && "is-today"];
      return (
        <button
          key={date}
          type="button"
          className={cls.filter(Boolean).join(" ")}
          disabled={s.disabled}
          aria-pressed={s.selected}
          aria-label={formatDay(date, "long")}
          onClick={() => props.onRangeChange(pickDay(props.range, date, map, props.today))}
        >
          {Number(date.slice(8))}
        </button>
      );
    }
    const on = props.selected === date;
    const enabled = date >= props.today && props.isEnabled(date);
    return (
      <button
        key={date}
        type="button"
        className={["bt-day", on && "is-selected", date === props.today && "is-today"].filter(Boolean).join(" ")}
        disabled={!enabled}
        aria-pressed={on}
        aria-label={formatDay(date, "long")}
        onClick={() => props.onSelect(on ? null : date)}
      >
        {Number(date.slice(8))}
      </button>
    );
  }

  function monthGrid(start: string, second: boolean) {
    const end = lastOfMonth(start);
    const cells: ReactNode[] = [];
    for (let i = 0; i < weekdayMon0(start); i++) cells.push(<span key={"pad" + i} />);
    for (let d = start; d <= end; d = addDays(d, 1)) cells.push(cell(d));
    return (
      <div className={second ? "bt-cal-month bt-cal-second" : "bt-cal-month"}>
        <div className="bt-cal-nav">
          {second ? (
            <span className="bt-cal-navspace" />
          ) : (
            <button type="button" aria-label="Mois précédent" disabled={!canPrev} onClick={() => props.onMonthChange(addMonths(props.month, -1))}>
              ‹
            </button>
          )}
          <span className="bt-cal-title">{formatMonth(start)}</span>
          <button
            type="button"
            className={second ? undefined : "bt-cal-next-first"}
            aria-label="Mois suivant"
            disabled={!canNext}
            onClick={() => props.onMonthChange(addMonths(props.month, 1))}
          >
            ›
          </button>
        </div>
        <div className="bt-cal-grid">
          {WEEKDAYS.map((w) => (
            <span key={w} className="bt-cal-wd">
              {w}
            </span>
          ))}
          {cells}
        </div>
      </div>
    );
  }

  const hasHalf = props.mode === "range" && props.days.some((d) => !d.available);
  const r = props.mode === "range" ? props.range : null;

  return (
    <div className="bt-card bt-cal">
      <div className="bt-cal-wrap">
        {monthGrid(props.month, false)}
        {monthGrid(addMonths(props.month, 1), true)}
      </div>
      <div className="bt-cal-foot">
        {props.mode === "range" && hasHalf ? (
          <p className="bt-legend">
            <span className="bt-swatch" aria-hidden="true" />
            Jour à demi teinté : la nuit est déjà réservée, mais vous pouvez repartir ce jour-là.
          </p>
        ) : props.mode === "single" && props.legend ? (
          <p className="bt-legend">{props.legend}</p>
        ) : (
          <span />
        )}
        {(r?.from || (props.mode === "single" && props.selected)) && (
          <button
            type="button"
            className="bt-ghost"
            onClick={() => (props.mode === "range" ? props.onRangeChange({ from: null, to: null }) : props.onSelect(null))}
          >
            ✕ Effacer les dates
          </button>
        )}
      </div>
      {r?.from && (
        <p className="bt-sel-line" aria-live="polite">
          {r.to
            ? `${formatDay(r.from)} → ${formatDay(r.to)} · ${plural(daysBetween(r.from, r.to), "nuit", "nuits")}`
            : `Arrivée ${formatDay(r.from)} · choisissez le départ` +
              (minStayFrom(map, r.from) > 1 ? ` (minimum ${minStayFrom(map, r.from)} nuits)` : "")}
        </p>
      )}
    </div>
  );
}

/** Why a departure is refused, for an error line under the calendar. */
export function explainDeparture(days: TunnelDay[], from: string, to: string): string | null {
  const map = toDayMap(days);
  const r = departureRefusal(map, from, to);
  return r ? refusalMessage(r, minStayFrom(map, from)) : null;
}
