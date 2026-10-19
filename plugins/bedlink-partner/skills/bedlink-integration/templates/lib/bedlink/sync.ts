import { bedlink, BedlinkError, FeatureUnavailableError } from "./client";
import { calendarChunkDays, hasFeature, WINDOW_DAYS } from "./config";
import { addDays, daysBetween, maxDate, minDate, todayIn } from "./dates";
import { store as defaultStore, type BedlinkStore, type LocalProperty } from "./store";
import type { Change } from "./types";

// Keeps the local copy in line with BedLink. BedLink stays the source of
// truth: this copy serves display and search, never a booking decision.
//
//   fullSync()      first install, or after cursor_expired: every property, 366 days
//   runCatchUp()    cron: properties, new properties, changes (or polling), window, reservations
//   applyRange()    re-read one property on a date range (webhook availability.changed)

class BudgetExhausted extends Error {}

/** Caps one run: BedLink allows 120 calls/minute/key, Vercel caps the duration. */
export class Budget {
  private used = 0;
  constructor(
    private maxCalls: number,
    private deadline: number,
  ) {}
  spend(calls = 1) {
    if (this.used + calls > this.maxCalls || Date.now() > this.deadline) throw new BudgetExhausted();
    this.used += calls;
  }
  get callsUsed() {
    return this.used;
  }
}

export type SyncReport = {
  calls: number;
  propertiesSynced: number;
  rangesApplied: number;
  reservationsRefreshed: number;
  disconnected: number;
  complete: boolean;
  error?: string;
};

function newReport(): SyncReport {
  return { calls: 0, propertiesSynced: 0, rangesApplied: 0, reservationsRefreshed: 0, disconnected: 0, complete: false };
}

function callsFor(from: string, to: string) {
  return Math.ceil((daysBetween(from, to) + 1) / calendarChunkDays());
}

function windowOf(p: Pick<LocalProperty, "timezone">) {
  const today = todayIn(p.timezone);
  return { today, end: addDays(today, WINDOW_DAYS - 1) };
}

export function createSync(store: BedlinkStore = defaultStore) {
  /** Reads [from, to] (clamped to the window) and writes it. */
  async function applyRange(p: LocalProperty, from: string, to: string, budget: Budget) {
    const { today, end } = windowOf(p);
    const start = maxDate(from, today);
    const stop = minDate(to, p.calendarUntil ?? end);
    if (daysBetween(start, stop) < 0) return false;
    budget.spend(callsFor(start, stop));
    const days = await bedlink.getCalendarRange(p.id, start, stop);
    await store.writeCalendarDays(p.id, days);
    return true;
  }

  async function syncWholeProperty(p: LocalProperty, budget: Budget) {
    const { today, end } = windowOf(p);
    budget.spend(callsFor(today, end));
    const days = await bedlink.getCalendarRange(p.id, today, end);
    await store.writeCalendarDays(p.id, days);
    await store.markCalendarSynced(p.id, end, true);
  }

  /** GET /properties → local list. Missing ones are taken off sale. */
  async function refreshProperties(budget: Budget, report: SyncReport) {
    budget.spend();
    const remote = await bedlink.listProperties();
    for (const p of remote) await store.upsertProperty(p);
    const ids = new Set(remote.map((p) => p.id));
    for (const local of await store.listActiveProperties()) {
      if (!ids.has(local.id)) {
        await store.markPropertyDisconnected(local.id);
        report.disconnected++;
      }
    }
    return store.listActiveProperties();
  }

  async function applyChange(change: Change, byId: Map<string, LocalProperty>, budget: Budget, report: SyncReport) {
    const p = byId.get(change.propertyId);
    if (change.kind === "calendar" && p && change.from && change.to) {
      if (await applyRange(p, change.from, change.to, budget)) report.rangesApplied++;
    } else if (change.kind === "property") {
      budget.spend();
      try {
        await store.upsertProperty(await bedlink.getProperty(change.propertyId));
      } catch (e) {
        if (e instanceof BedlinkError && e.status === 404) {
          await store.markPropertyDisconnected(change.propertyId);
          report.disconnected++;
        } else throw e;
      }
    } else if (change.kind === "reservation" && change.reservationId) {
      budget.spend();
      await store.upsertReservation(await bedlink.getReservation(change.reservationId));
      report.reservationsRefreshed++;
    }
  }

  async function pullChanges(budget: Budget, report: SyncReport) {
    const state = await store.getSyncState();
    let cursor = state.changesCursor;
    if (!cursor) return; // no starting point yet: fullSync() sets it
    const byId = new Map((await store.listActiveProperties()).map((p) => [p.id, p]));
    for (;;) {
      budget.spend();
      let page;
      try {
        page = await bedlink.getChanges(cursor);
      } catch (e) {
        if (e instanceof BedlinkError && e.code === "cursor_expired") {
          // Too old: start over. The next run does a full sync.
          await store.saveSyncState({ changesCursor: null, lastError: "cursor_expired: full sync needed" });
          return;
        }
        throw e;
      }
      for (const change of page.changes) await applyChange(change, byId, budget, report);
      cursor = page.nextCursor;
      await store.saveSyncState({ changesCursor: cursor });
      if (!page.hasMore) return;
    }
  }

  /** Without the changes feed (today's sandbox): re-read the next 91 days, oldest first. */
  async function pollCalendars(properties: LocalProperty[], budget: Budget, report: SyncReport) {
    for (const p of properties) {
      const { today } = windowOf(p);
      if (await applyRange(p, today, addDays(today, 90), budget)) report.rangesApplied++;
    }
  }

  /** Each day one more day enters the 366-day window. */
  async function extendWindows(properties: LocalProperty[], budget: Budget) {
    for (const p of properties) {
      const { end } = windowOf(p);
      if (!p.calendarUntil || p.calendarUntil >= end) continue;
      const from = addDays(p.calendarUntil, 1);
      budget.spend(callsFor(from, end));
      await store.writeCalendarDays(p.id, await bedlink.getCalendarRange(p.id, from, end));
      await store.markCalendarSynced(p.id, end, false);
    }
  }

  async function refreshReservations(budget: Budget, report: SyncReport) {
    if (hasFeature("reservations_list")) {
      const state = await store.getSyncState();
      let since = state.reservationsSince ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
      let cursor: string | null = null;
      do {
        budget.spend();
        const page = await bedlink.listReservations(since, cursor);
        for (const r of page.reservations) {
          await store.upsertReservation(r);
          report.reservationsRefreshed++;
          if (r.updatedAt && r.updatedAt > since) since = r.updatedAt;
        }
        cursor = page.hasMore ? page.nextCursor : null;
      } while (cursor);
      await store.saveSyncState({ reservationsSince: since });
      return;
    }
    // Fallback: re-read the reservations that can still change.
    for (const id of await store.reservationsToRefresh(20)) {
      budget.spend();
      try {
        await store.upsertReservation(await bedlink.getReservation(id));
        report.reservationsRefreshed++;
      } catch (e) {
        if (!(e instanceof BedlinkError && e.status === 404)) throw e;
      }
    }
  }

  async function guarded(lockSeconds: number, run: (report: SyncReport) => Promise<void>): Promise<SyncReport> {
    const report = newReport();
    if (!(await store.acquireLock(lockSeconds))) return { ...report, error: "another sync is running" };
    try {
      await run(report);
      report.complete = true;
      await store.saveSyncState({ lastError: null, polled: true });
    } catch (e) {
      if (e instanceof BudgetExhausted) {
        await store.saveSyncState({ polled: true }); // resumes on the next run
      } else {
        const msg =
          e instanceof BedlinkError
            ? `${e.status} ${e.code} (requestId ${e.requestId ?? "?"})`
            : e instanceof FeatureUnavailableError
              ? e.message
              : String(e);
        report.error = msg;
        await store.saveSyncState({ lastError: msg.slice(0, 500), polled: true });
      }
    } finally {
      await store.releaseLock();
    }
    return report;
  }

  return {
    applyRange,

    /** One property, whole window (webhook property.connected). */
    async syncOneProperty(id: string, budget = new Budget(8, Date.now() + 8_000)) {
      await store.upsertProperty(await bedlink.getProperty(id));
      const p = await store.getLocalProperty(id);
      if (p) await syncWholeProperty(p, budget);
    },

    /**
     * Every property, the whole window. With the changes feed, the head
     * cursor is taken BEFORE reading the calendars: whatever changes during
     * the read is read again afterwards, nothing is lost.
     */
    fullSync(opts: { maxCalls?: number; maxMs?: number } = {}) {
      const budget = new Budget(opts.maxCalls ?? Infinity, Date.now() + (opts.maxMs ?? 60 * 60_000));
      return guarded(Math.ceil((opts.maxMs ?? 60 * 60_000) / 1000) + 60, async (report) => {
        let head: string | null = null;
        if (hasFeature("changes")) {
          budget.spend();
          head = (await bedlink.getChanges(null)).nextCursor;
        }
        try {
          const properties = await refreshProperties(budget, report);
          for (const p of properties) {
            await syncWholeProperty(p, budget);
            report.propertiesSynced++;
          }
          if (head) await store.saveSyncState({ changesCursor: head });
          await store.saveSyncState({ fullSync: true });
          await refreshReservations(budget, report);
        } finally {
          report.calls = budget.callsUsed;
        }
      });
    },

    /** The cron. Bounded: what does not fit resumes on the next run. */
    runCatchUp(opts: { maxCalls?: number; maxMs?: number } = {}) {
      const maxMs = opts.maxMs ?? 45_000;
      const budget = new Budget(opts.maxCalls ?? 90, Date.now() + maxMs);
      return guarded(Math.ceil(maxMs / 1000) + 30, async (report) => {
        try {
          const state = await store.getSyncState();
          if (hasFeature("changes") && !state.changesCursor) {
            // First run, or cursor expired: take the head now, then sync everything.
            budget.spend();
            await store.saveSyncState({ changesCursor: (await bedlink.getChanges(null)).nextCursor });
            await store.forgetFullSync();
          }
          const properties = await refreshProperties(budget, report);
          // Properties never synced (new, reconnected, or after cursor_expired).
          for (const p of properties.filter((x) => !x.lastFullSyncAt)) {
            await syncWholeProperty(p, budget);
            report.propertiesSynced++;
          }
          if (hasFeature("changes")) await pullChanges(budget, report);
          else await pollCalendars(properties, budget, report);
          await extendWindows(properties, budget);
          await refreshReservations(budget, report);
          await store.purgeDaysBefore(addDays(todayIn("UTC"), -1));
          await store.purgeWebhookEvents(30);
        } finally {
          report.calls = budget.callsUsed;
        }
      });
    },
  };
}

export const sync = createSync();
