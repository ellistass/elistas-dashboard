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
import { epsFor, ETF } from "@/lib/data/eps";
import { valuationRead, type ValRead, type EpsReport } from "./valuation";
import { fetchFuturesCot, cotRead, fetchShortInterest, siRead, positioningVerdict, type FuturesCot, type SiPoint, type SiRead } from "@/lib/data/positioning";
import { fetchHourBars, to4h, firstDropRead, springRead, type HourBar } from "./intraday";

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
  /** Stocks only: P/E vs its own 2y. Conservative "against" → grade B; aggressive → warning only. */
  valuation: ValRead | null;
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
  // Weekly CFTC positioning for every futures market, once per scan. A CFTC hiccup never kills the scan.
  const cot: FuturesCot = await fetchFuturesCot().catch(() => ({}));
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
          const eps = specClass(inst.symbol) === "stock" && !ETF.has(inst.symbol)
            ? await epsFor(inst.symbol).catch(() => [] as EpsReport[]) : null;
          let h4: HourBar[] | null = null;      // fetched once per instrument, only when it has a setup
          let siPts: SiPoint[] | null = null;
          for (const s of findSetups(bars)) {
            // Window for the EXPANDED chart: ~160 bars, reaching back to 20 bars before
            // the range if it started earlier (cap 250). The card trims its own view.
            const rs = bars.findIndex((b) => b.date === s.rangeStart);
            const from = Math.max(0, bars.length - 250, Math.min(rs - 20, bars.length - 160));
            const win = bars.slice(from).map((b) => [b.o, b.h, b.l, b.c, b.v, b.date] as [number, number, number, number, number, string]);
            // Retests only: springs/upthrusts trail 1R everywhere (Oct 2026: aggressive A +0.49R with 1R vs +0.40R with 2×ATR).
            const trailAtr = specClass(inst.symbol) === "index" && s.entry === "conservative" ? INDEX_TRAIL_ATR : null;
            if (trailAtr) s.order.manage = s.order.manage.map((m) => m.startsWith("After that: trail")
              ? `After that: trail the stop ${trailAtr} × ATR behind the best price, never below breakeven (index retests).` : m);
            const valuation = eps ? valuationRead(bars, eps, s.side) : null;
            if (valuation && s.entry === "conservative" && valuation.vsTrade === "against") {
              s.grade = "B";
              s.checks.push({ label: "valuation not against the trade", pass: false, value: `${valuation.val} · P/E ${valuation.pe}` });
            }
            // Positioning — COT (futures/ETFs) and short interest (stocks), graded exactly as the Oct 2026 replay.
            const cr = cotRead(cot, inst.symbol, s.side, s.rangeStart, s.signalDate);
            let sr: SiRead | null = null;
            if (specClass(inst.symbol) === "stock" && !ETF.has(inst.symbol)) {
              siPts ??= await fetchShortInterest(inst.symbol);
              sr = siRead(siPts, s.rangeStart, s.signalDate);
            }
            const pv = positioningVerdict(s.entry, s.side, s.grade, cr, sr);
            s.checks.push(...pv.checks);
            if (pv.downgrade && s.grade === "A") s.grade = "B";
            if (pv.upgrade && s.grade === "B") s.grade = "A";
            // 4h read — information on the card, never changes the grade.
            if (s.entry === "conservative" || s.state === "trigger") {
              h4 ??= to4h(await fetchHourBars(inst.yahoo));
              if (h4.length && s.entry === "conservative") {
                const r = firstDropRead(h4, s.side, s.entryPrice, s.signalDate);
                if (r) s.checks.push({
                  label: "4h: first candle of the drop back to the edge is light (heavy = cancel the limit)",
                  pass: !r.heavy, value: `${r.ratio}× break volume · ${r.at.slice(5, 16).replace("T", " ")} UTC`,
                });
              } else if (h4.length) {
                const sp = springRead(h4, s.side, s.signalDate);
                if (sp) {
                  s.checks.push({ label: "4h: test-day volume formed in our favour (against = skip or half size)", pass: (sp.favour ?? 0) > 0, value: `${sp.favour ?? "n/a"} · 3 sessions ${sp.favour3 ?? "n/a"}` });
                  s.checks.push({ label: "4h: absorption — heavy bar at the extreme that closed off it", pass: sp.absorption });
                  s.checks.push({ label: "4h: last 4h bar of the test day finished strong", pass: sp.strongFinish });
                }
              }
            }
            setups.push({
              bars: win,
              valuation,
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
