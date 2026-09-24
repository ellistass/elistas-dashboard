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

export interface InstrumentSetup extends Setup {
  instrument: string;
  executeSymbol: string;
  assetClass: ScannerInstrument["assetClass"];
  inverted: boolean;
  volumeQuality: ScannerInstrument["volumeQuality"];
  lastBarDate: string;
  /** Chart window: the range plus a little context, as [o,h,l,c,v,date] tuples. */
  bars: [number, number, number, number, number, string][];
}

export interface SetupScan {
  at: string;
  setups: InstrumentSetup[];
  scanned: number;
  errors: { instrument: string; error: string }[];
}

/** Drop today's still-forming bar: every rule is defined on COMPLETED bars. */
export function completedBars(bars: Bar[], now = new Date()): Bar[] {
  const today = now.toISOString().slice(0, 10);
  return bars.length && bars[bars.length - 1].date >= today ? bars.slice(0, -1) : bars;
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
          const bars = completedBars(await fetchDailyBars(inst.yahoo, "5y"));
          if (bars.length < 120) return;
          for (const s of findSetups(bars)) {
            // Window for the EXPANDED chart: ~160 bars, reaching back to 20 bars before
            // the range if it started earlier (cap 250). The card trims its own view.
            const rs = bars.findIndex((b) => b.date === s.rangeStart);
            const from = Math.max(0, bars.length - 250, Math.min(rs - 20, bars.length - 160));
            const win = bars.slice(from).map((b) => [b.o, b.h, b.l, b.c, b.v, b.date] as [number, number, number, number, number, string]);
            setups.push({
              bars: win,
              ...s,
              instrument: inst.symbol,
              executeSymbol: inst.executeSymbol,
              assetClass: inst.assetClass,
              inverted: inst.inverted,
              volumeQuality: inst.volumeQuality,
              lastBarDate: bars[bars.length - 1].date,
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
