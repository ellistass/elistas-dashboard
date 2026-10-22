// lib/setups/trendMarkets.ts — client-safe constants/types for the trend slot (no server imports).
export const TREND_MARKETS = ["GC", "HO", "HG", "BZ", "CT", "NKY", "NQ", "ES", "NVDA", "DIS"];

export interface TrendSetup {
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
}
