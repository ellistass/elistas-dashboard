// lib/setups/scan.ts — run the setup rules across the whole basket.
//
// Stateless on purpose for v1: fetch daily bars (the same Yahoo feed + 10-min
// cache the Wyckoff scanner uses), run lib/setups/rules.ts, return what's live.
// No table, no migration. If the page gets slow we move this into the daily
// cron and persist — the rules module doesn't change either way.

import { BASKET, type ScannerInstrument } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import type { Bar } from "@/lib/wyckoff/engine";
import { findSetups, type Setup } from "./rules";
import { CONTRACTS } from "@/lib/data/contracts";
import { storedVolume, patchVolume } from "@/lib/data/futuresVolume";
import { volRead, INDEX_TRAIL_ATR, type VolRead } from "@/lib/swing/vol";
import { specClass } from "@/lib/swing/core";

export interface InstrumentSetup extends Setup {
  instrument: string;
  executeSymbol: string;
  assetClass: ScannerInstrument["assetClass"];
  inverted: boolean;
  volumeQuality: ScannerInstrument["volumeQuality"];
  lastBarDate: string;
  /** Set when the feed is missing the latest finished session (e.g. Yahoo's empty
   *  HO bar for 7 Oct 2026): the session Yahoo skipped. An aggressive setup with a
   *  gap is stale — its next open has already happened. Can also be a market holiday. */
  feedGap: string | null;
  /** How volatile the market is now (information), and the trail rule for indices. */
  vol: VolRead | null;
  /** Trail after +1R as × ATR (indices); null = 1R. */
  trailAtr: number | null;
  /** Chart window: the range plus a little context, as [o,h,l,c,v,date] tuples. */
  bars: [number, number, number, number, number, string][];
}

export interface SetupScan {
  at: string;
  setups: InstrumentSetup[];
  scanned: number;
  errors: { instrument: string; error: string }[];
}

// ── When is a daily bar finished? ────────────────────────────────────────────
// Yahoo dates futures/stock bars by SESSION date. A session is over at the
// 17:00 New York close (US stocks close at 16:00, so 17:00 covers both); we wait
// 15 minutes for Yahoo to settle the bar. Until Oct 2026 this cut at the UTC date
// instead (01:00 Lagos), which hid every futures spring/upthrust until after the
// 18:00 NY reopen it's meant to be entered at (HO, 6 Oct 2026).
const nyParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const SESSION_DONE_MIN = 17 * 60 + 15;

const prevDay = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** The latest session date whose close (+15 min) has passed in New York. */
export function lastClosedSession(now = new Date()): string {
  const p = Object.fromEntries(nyParts.formatToParts(now).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return +p.hour * 60 + +p.minute >= SESSION_DONE_MIN ? date : prevDay(date);
}

/** The weekday a complete feed should end on (weekends skipped; holidays aren't known). */
export function expectedLastSession(now = new Date()): string {
  let d = lastClosedSession(now);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = prevDay(d);
  return d;
}

/** Keep finished bars only: drops the session still trading and the next session's
 *  bar, which Yahoo opens at the 18:00 NY reopen. Every rule is defined on COMPLETED bars. */
export function completedBars(bars: Bar[], now = new Date()): Bar[] {
  const done = lastClosedSession(now);
  return bars.filter((b) => b.date <= done);
}

let cache: { at: number; scan: SetupScan } | null = null;
const TTL_MS = 15 * 60 * 1000;

export async function scanSetups(force = false): Promise<SetupScan> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.scan;

  const setups: InstrumentSetup[] = [];
  const errors: SetupScan["errors"] = [];
  const BATCH = 5; // same politeness as the Wyckoff scan
  for (let i = 0; i < BASKET.length; i += BATCH) {
    await Promise.all(
      BASKET.slice(i, i + BATCH).map(async (inst) => {
        try {
          // 5y, not 2y: the monthly context needs 12+3 completed months before the signal.
          const raw = completedBars(await fetchDailyBars(inst.yahoo, "5y"));
          // Futures: swap in the real (summed-contract) volume where it's stored.
          // A DB hiccup must never kill the scan — fall back to Yahoo's numbers.
          let bars = raw;
          if (CONTRACTS[inst.symbol]) {
            try { bars = patchVolume(raw, await storedVolume(inst.symbol)).bars; } catch { bars = raw; }
          }
          if (bars.length < 120) return;
          const expected = expectedLastSession();
          const feedGap = bars[bars.length - 1].date < expected ? expected : null;
          for (const s of findSetups(bars)) {
            // Window for the EXPANDED chart: ~160 bars, reaching back to 20 bars before
            // the range if it started earlier (cap 250). The card trims its own view.
            const rs = bars.findIndex((b) => b.date === s.rangeStart);
            const from = Math.max(0, bars.length - 250, Math.min(rs - 20, bars.length - 160));
            const win = bars.slice(from).map((b) => [b.o, b.h, b.l, b.c, b.v, b.date] as [number, number, number, number, number, string]);
            const trailAtr = specClass(inst.symbol) === "index" ? INDEX_TRAIL_ATR : null;
            if (trailAtr) s.order.manage = s.order.manage.map((m) => m.startsWith("After that: trail")
              ? `After that: trail the stop ${trailAtr} × ATR behind the best price (indices: tested +0.64R / +0.96R vs 1R +0.37 / +0.42).` : m);
            setups.push({
              bars: win,
              vol: volRead(bars, s.entryPrice, s.stop),
              trailAtr,
              ...s,
              instrument: inst.symbol,
              executeSymbol: inst.executeSymbol,
              assetClass: inst.assetClass,
              inverted: inst.inverted,
              volumeQuality: inst.volumeQuality,
              lastBarDate: bars[bars.length - 1].date,
              feedGap,
            });
          }
        } catch (e) {
          errors.push({ instrument: inst.symbol, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  }

  // Grade A first, then what needs action soonest.
  const stateRank = { filled: 0, trigger: 1, armed: 2 } as const;
  setups.sort((a, b) =>
    a.grade.localeCompare(b.grade) ||
    stateRank[a.state] - stateRank[b.state] ||
    (a.barsLeft ?? -1) - (b.barsLeft ?? -1));

  const scan = { at: new Date().toISOString(), setups, scanned: BASKET.length, errors };
  cache = { at: Date.now(), scan };
  return scan;
}
