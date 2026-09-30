// lib/setups/scanCache.ts — scan once per completed day, not on every page open.
//
// Daily-bar setups can only change when a new daily bar completes, so the page
// reads a stored scan and only rescans when a new bar exists (or on "rescan").
// The in-memory caches in scan.ts / forexDriver.ts died with each serverless
// instance, which is why the page used to rescan on almost every visit.
//
// When is a new bar complete?
//   futures & stocks: completedBars() drops bars dated today in UTC, so the
//                     scan's input changes at 00:00 UTC (01:00 Lagos).
//   forex:            our NY-close candles roll at 17:00 New York (21:00 or
//                     22:00 UTC depending on US daylight saving); we cut at 17:30.
// A stored scan made BEFORE the latest cutoff is stale; after it, it's current.

import { db } from "@/lib/db";
import { logScan } from "./log";

export type ScanKey = "futures" | "forex";

const nyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
/** Minutes New York is behind UTC at `d` (240 in summer, 300 in winter). */
function nyOffsetMin(d: Date): number {
  const p = Object.fromEntries(nyFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((d.getTime() - asUtc) / 60000);
}

/** The most recent moment the scan's input could have changed. */
export function lastCutoff(key: ScanKey, now = new Date()): Date {
  if (key === "futures") {
    const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 5));   // 00:05 UTC
    return c <= now ? c : new Date(c.getTime() - 864e5);
  }
  // forex: 17:30 New York, DST-aware — 30 min after the close so Yahoo's final
  // hourly bar (16:00–17:00) is in before the day counts as complete
  const off = nyOffsetMin(now);
  const nyNow = new Date(now.getTime() - off * 60000);                  // NY wall clock expressed as UTC
  let c = Date.UTC(nyNow.getUTCFullYear(), nyNow.getUTCMonth(), nyNow.getUTCDate(), 17, 30) + off * 60000;
  if (c > now.getTime()) c -= 864e5;
  return new Date(c);
}

/**
 * Return the stored scan if it's current; otherwise run `compute`, store it, return it.
 * `force` (the rescan button) always recomputes. If the database is unreachable the
 * scan still runs — storage is an optimisation, never a point of failure.
 */
export async function cachedScan<T extends object>(key: ScanKey, compute: () => Promise<T>, force = false): Promise<T & { cachedAt?: string }> {
  const table = (db as any).setupScanCache;
  if (!force) {
    try {
      const row = await table.findUnique({ where: { key } });
      if (row && new Date(row.computedAt) >= lastCutoff(key)) return { ...(row.payload as T), cachedAt: new Date(row.computedAt).toISOString() };
    } catch { /* fall through to a live scan */ }
  }
  const payload = await compute();
  // Don't store a scan that came back broken (feed errors), so the next visit retries.
  const broken = Array.isArray((payload as any)?.errors) && (payload as any).errors.length > 0 && !((payload as any).setups?.length);
  if (!broken) {
    try {
      const computedAt = new Date();
      await table.upsert({ where: { key }, create: { key, payload: payload as any, computedAt }, update: { payload: payload as any, computedAt } });
    } catch { /* storage is best-effort */ }
    // Every computed scan feeds the setup log — page visit, rescan or nightly cron.
    try { await logScan(key, payload); } catch (e) { console.error("[setups] log failed:", e); }
  }
  return payload as T & { cachedAt?: string };
}
