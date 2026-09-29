// lib/swing/events.ts — earnings, delivery numbers, central-bank meetings.
// Entered by hand (Discipline page → Event dates). An event belongs to a trade
// when its symbol is the instrument, what you execute, or one of its currencies
// (a USD central-bank meeting belongs to EURUSD, USDJPY and gold alike).

import { db } from "@/lib/db";
import { exposures, fxPairFor } from "./core";
import { instrumentInfo } from "@/lib/wyckoff/basket";

export interface TradingEventRow { id: string; date: string; symbol: string; type: string; note: string | null }

export function symbolsFor(instrument: string): string[] {
  const out = new Set<string>([instrument]);
  const exec = instrumentInfo(instrument)?.executeSymbol;
  if (exec) out.add(exec);
  const pair = fxPairFor(instrument);
  if (pair) out.add(pair);
  for (const e of exposures(instrument, "long")) if (e.factor.startsWith("ccy:")) out.add(e.factor.slice(4));
  return [...out];
}

/** Events for an instrument between two dates (inclusive), soonest first. */
export async function eventsFor(instrument: string, from: string, to: string): Promise<TradingEventRow[]> {
  try {
    return await (db as any).tradingEvent.findMany({
      where: { symbol: { in: symbolsFor(instrument) }, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    });
  } catch { return []; }
}
