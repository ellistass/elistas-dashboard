// lib/data/futuresVolume.ts — REAL futures volume: collect nightly, store, patch.
//
// collectFuturesVolume()  nightly: for each futures instrument, read its live
//                         contracts (this month + next 2 listed), SUM their daily
//                         volume → the true total traded, with no roll artefact.
//                         Upserts every date those contracts cover (≈3 months on
//                         the first run, then keeps the history growing).
// patchVolume(bars, sym)  replaces Yahoo's continuous-series volume with the stored
//                         total wherever we have it. Where we don't (older history),
//                         the bar is left alone and lib/setups/roll.ts still flags
//                         obvious roll garbage.
//
// Why a table: Yahoo deletes contracts at expiry, so the real volume for a
// past roll can't be re-read later. Stored nightly, it's kept for good.

import { db } from "@/lib/db";
import { BASKET } from "@/lib/wyckoff/basket";
import { fetchDailyBars } from "@/lib/wyckoff/daily";
import type { Bar } from "@/lib/wyckoff/engine";
import { CONTRACTS, liveContracts } from "./contracts";
import { rollMask } from "@/lib/setups/roll";

export async function collectFuturesVolume(now = new Date()) {
  const futures = BASKET.filter((i) => CONTRACTS[i.symbol]);
  const written: string[] = [], errors: { instrument: string; error: string }[] = [];
  for (let i = 0; i < futures.length; i += 5) {
    await Promise.all(futures.slice(i, i + 5).map(async (inst) => {
      try {
        const syms = liveContracts(inst.symbol, now, 3);
        const perDay = new Map<string, Record<string, number>>();
        // Yahoo sometimes repeats the previous session's volume on a contract
        // (every future on 12 Oct 2026, Columbus Day: prices right, volume = 9 Oct's).
        // A sum containing a repeat looks plausible and slips past rollMask once
        // patched in, so such a date is never stored, and is deleted if it was.
        const copied = new Set<string>();
        for (const s of syms) {
          let bars: Bar[] = [];
          try { bars = await fetchDailyBars(s, "3mo"); } catch { continue; }   // not listed yet / not on Yahoo
          for (let k = 0; k < bars.length; k++) {
            const b = bars[k];
            const row = perDay.get(b.date) ?? {};
            row[s] = b.v; perDay.set(b.date, row);
            if (k > 0 && b.v > 1 && b.v === bars[k - 1].v) copied.add(b.date);
          }
        }
        if (!perDay.size) throw new Error(`no live contracts returned (${syms.join(", ")})`);
        // Guard: before a roll, the then-front contract may already be deleted from
        // Yahoo, so our sum would only hold small back-month volume. Store a date only
        // when the sum is plausibly complete: ≥80% of the continuous series' volume,
        // or the continuous bar is itself roll garbage (flagged).
        const cont = await fetchDailyBars(inst.yahoo, "3mo");
        const mask = rollMask(cont);
        const contV = new Map(cont.map((b, k) => [b.date, { v: b.v, bad: mask[k] }]));
        for (const [date, contracts] of perDay) {
          if (date >= now.toISOString().slice(0, 10)) continue;          // today's session isn't final yet
          if (copied.has(date)) {
            await (db as any).futuresVolume.deleteMany({ where: { instrument: inst.symbol, date } });
            continue;
          }
          const total = Object.values(contracts).reduce((a, v) => a + v, 0);
          const c = contV.get(date);
          if (c && !c.bad && total < 0.8 * c.v) continue;             // incomplete sum — keep Yahoo's number
          await (db as any).futuresVolume.upsert({
            where: { instrument_date: { instrument: inst.symbol, date } },
            create: { instrument: inst.symbol, date, total, contracts, source: "yahoo-contracts" },
            update: { total, contracts },
          });
        }
        written.push(inst.symbol);
      } catch (e) {
        errors.push({ instrument: inst.symbol, error: e instanceof Error ? e.message : String(e) });
      }
    }));
  }
  return { written, errors };
}

/** Stored real totals for one instrument, keyed by date. */
export async function storedVolume(instrument: string): Promise<Map<string, number>> {
  const rows = await (db as any).futuresVolume.findMany({ where: { instrument }, select: { date: true, total: true } });
  return new Map(rows.map((r: any) => [r.date, r.total]));
}

/** Swap in the real volume wherever it's stored. Returns new bars; input untouched. */
export function patchVolume(bars: Bar[], real: Map<string, number>): { bars: Bar[]; patched: number } {
  let patched = 0;
  const out = bars.map((b) => {
    const v = real.get(b.date);
    if (v != null && v > 0 && v !== b.v) { patched++; return { ...b, v }; }
    return b;
  });
  return { bars: out, patched };
}
