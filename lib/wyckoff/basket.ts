// lib/wyckoff/basket.ts — the Wyckoff Range Scanner's instrument basket (§7).
//
// REAL VOLUME ONLY. Currencies and commodities use CME/NYMEX/COMEX futures
// (continuous front-month on Yahoo, "=F" suffix) — never spot FX or CFDs,
// whose "volume" is broker tick-count, not traded contracts. Stocks/ETFs use
// consolidated-tape volume.
//
// Caveat carried from the spec: continuous futures series can show a volume
// spike around contract roll — a roll-day spike is participation migrating to
// the next contract, NOT absorption. The trader reads charts with this in mind;
// the engine does not attempt roll detection in v1.

export interface ScannerInstrument {
  symbol: string; // spec ticker, e.g. "6E", "ES", "AAPL" — stored in the DB
  yahoo: string; // Yahoo Finance symbol used to fetch bars
  kind: "currency-future" | "index-future" | "commodity-future" | "stock-etf";
}

const cur = (s: string): ScannerInstrument => ({ symbol: s, yahoo: `${s}=F`, kind: "currency-future" });
const idx = (s: string): ScannerInstrument => ({ symbol: s, yahoo: `${s}=F`, kind: "index-future" });
const com = (s: string): ScannerInstrument => ({ symbol: s, yahoo: `${s}=F`, kind: "commodity-future" });
const stk = (s: string): ScannerInstrument => ({ symbol: s, yahoo: s, kind: "stock-etf" });

// 6E EuroFX, 6B British Pound, 6A Aussie, 6C Canadian, 6J Yen, 6S Swiss, 6N Kiwi
const CURRENCY_FUT = ["6E", "6B", "6A", "6C", "6J", "6S", "6N"].map(cur);
const INDEX_FUT = ["ES", "NQ", "YM", "RTY"].map(idx);
const COMMOD_FUT = ["GC", "SI", "HG", "CL", "NG"].map(com);
const STOCKS_ETF = [
  "SPY", "QQQ", "IWM", "DIA", "AAPL", "MSFT", "NVDA", "AMD", "TSLA", "AMZN",
  "GOOGL", "META", "NFLX", "JPM", "XLE", "XLF", "XLK", "GLD", "SLV", "INTC",
  "BA", "DIS", "KO", "PFE", "WMT", "CVX", "XOM", "MU", "CRM", "ORCL", "V", "MA",
  "HD", "UNH", "PG", "JNJ", "BAC", "WFC", "T", "VZ", "CSCO", "ADBE", "QCOM",
  "AVGO", "COST", "NKE", "MCD",
].map(stk);

export const BASKET: ScannerInstrument[] = [
  ...CURRENCY_FUT,
  ...INDEX_FUT,
  ...COMMOD_FUT,
  ...STOCKS_ETF,
]; // 63 instruments, all real-volume
