// lib/setups/trendMarkets.ts — client-safe constants/types for the trend slot (no server imports).
export const TREND_MARKETS = ["GC", "HO", "HG", "BZ", "CT", "NKY", "NQ", "ES", "NVDA", "DIS"];

/** The crypto slot: its own single slot, half risk, same 55-day rules. BTC/ETH only
 *  (Oct 2026 test: +0.65R/trade; the other coins were about 0). Yahoo symbol → FTMO symbol. */
export const CRYPTO_MARKETS: Record<string, { yahoo: string; ftmo: string }> = {
  BTC: { yahoo: "BTC-USD", ftmo: "BTCUSD" },
  ETH: { yahoo: "ETH-USD", ftmo: "ETHUSD" },
};

export interface TrendSetup {
  slot: "trend" | "crypto";
  instrument: string;
  executeSymbol: string;
  side: "long" | "short";
  signalDate: string;
  close: number;
  channel: number;            // the 55-day high/low that was broken
  entryRef: number;           // the signal close — the real entry is the next open
  stop: number;
  atr: number;
  breakevenAt: number;
  trailDistance: number;
  lastBarDate: string;
  channelHi: number;          // 55-day high before the signal (the box on the chart)
  channelLo: number;          // 55-day low before the signal
  channelStart: string;       // first bar of the 55-day window
  bars: [number, number, number, number, number, string][];   // last 120 daily bars [o,h,l,c,v,date] for the card chart
  /** How far the close is above (+) / below (−) its 200-day average, as a fraction. */
  vs200: number | null;
  /** Trend-slot rule says don't take it (Nov 2026 test); null on the crypto slot. */
  ruleSkip: string | null;
}
