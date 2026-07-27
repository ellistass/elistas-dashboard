// lib/wyckoff/basket.ts — instrument config: the source-of-truth basket.
//
// Per instrument (Mapping & Config spec):
//   symbol        — the READ code (stored in scanner_candidates.instrument)
//   yahoo         — the feed symbol the scanner fetches (real-volume source
//                   where one exists on Yahoo)
//   executeSymbol — the CFD/spot the trader actually executes (common
//                   convention — VERIFY against your broker; see cfdNote)
//   volumeQuality — GOVERNING RULE: an engine verdict is only trustworthy if
//                   this is "real". Set from a FEED AUDIT, never assumed.
//                   Defaults below are CONSERVATIVE: only feeds verified
//                   bar-by-bar (2026-07-25 audit) are "real"; everything
//                   unproven is "suspect" until /api/wyckoff/feed-audit says
//                   otherwise. Suspect instruments still scan & surface for
//                   chart reads — their engine verdicts are badged and
//                   excluded from the blind score (lib/wyckoff/benchmark).
//   inverted      — read direction is OPPOSITE the execute direction
//                   (6C/6J/6S: future is XXX/USD, spot is USD/XXX). The UI
//                   always shows the post-inversion execute call — the trader
//                   never flips in their head.
//   accounts      — which trading accounts offer executeSymbol (user fills in).
//
// Yahoo coverage note: CME/NYMEX/COMEX/CBOT/ICE-US futures exist as "=F".
// Eurex/ICE-EU/JPX/HKEX index futures (FDAX, FESX, FTSE, CAC, NKY, HSI, SPI)
// do NOT — those read the CASH INDEX ticker instead, volume unverified, so
// they default to "suspect" and may not scan at all if the feed has zero
// volume (cleanBars drops zero-volume bars; such instruments error out
// visibly in the scan log rather than producing fake verdicts).

export type AssetClass = "index" | "commodity" | "ag" | "currency" | "stock";
export type VolumeQuality = "real" | "suspect";

export interface ScannerInstrument {
  symbol: string;
  yahoo: string;
  executeSymbol: string; // "" = no common CFD — read/score only
  assetClass: AssetClass;
  volumeQuality: VolumeQuality;
  inverted: boolean;
  cfdNote?: string;
  accounts?: string[];
}

const I = (
  symbol: string,
  yahoo: string,
  executeSymbol: string,
  assetClass: AssetClass,
  volumeQuality: VolumeQuality,
  inverted = false,
  cfdNote?: string,
): ScannerInstrument => ({ symbol, yahoo, executeSymbol, assetClass, volumeQuality, inverted, cfdNote, accounts: [] });

// ── Indices — read the future, execute the CFD. CME complex verified real
//    (2026-07-25: ES ~1M+/day, plausible NQ/YM/RTY). Never inverted. ──────────
const INDEX: ScannerInstrument[] = [
  I("ES", "ES=F", "US500", "index", "real", false, "also SPX500 / US500Cash"),
  I("NQ", "NQ=F", "US100", "index", "real", false, "also NAS100 / USTEC"),
  I("YM", "YM=F", "US30", "index", "real", false, "also DJ30 / WS30"),
  I("RTY", "RTY=F", "US2000", "index", "real", false, "also RUT; less common on CFD"),
  // Yahoo has no Eurex/ICE/JPX/HKEX futures — reading the CASH index, volume
  // unverified => suspect until the feed audit proves otherwise.
  I("DAX", "^GDAXI", "GER40", "index", "suspect", false, "was GER30 — cash-index read, not FDAX"),
  I("STOXX", "^STOXX50E", "EU50", "index", "suspect", false, "also STOXX50 / ESTX50 — cash-index read"),
  I("FTSE", "^FTSE", "UK100", "index", "suspect", false, "also FTSE100 — cash-index read"),
  I("CAC", "^FCHI", "FRA40", "index", "suspect", false, "also FR40 — cash-index read"),
  I("NKY", "^N225", "JP225", "index", "suspect", false, "also JPN225 — cash-index read"),
  I("HSI", "^HSI", "HK50", "index", "suspect", false, "also HSI50 — cash-index read"),
  I("ASX", "^AXJO", "AUS200", "index", "suspect", false, "also AU200 — cash-index read"),
];

// ── Commodities — read the future, execute the CFD. GC volume VERIFIED broken
//    on Yahoo (2026-07-25: ~59-1300/day vs real ~250k) — the whole class stays
//    suspect until the feed audit upgrades individual symbols. ────────────────
const COMMOD: ScannerInstrument[] = [
  I("GC", "GC=F", "XAUUSD", "commodity", "suspect", false, "also GOLD"),
  I("SI", "SI=F", "XAGUSD", "commodity", "suspect", false, "also SILVER"),
  I("HG", "HG=F", "COPPER", "commodity", "suspect", false, "also XCUUSD"),
  I("PL", "PL=F", "XPTUSD", "commodity", "suspect", false, "not all brokers"),
  I("PA", "PA=F", "XPDUSD", "commodity", "suspect", false, "rare on CFD"),
  I("CL", "CL=F", "USOIL", "commodity", "suspect", false, "also WTI / OIL"),
  I("BZ", "BZ=F", "UKOIL", "commodity", "suspect", false, "also BRENT"),
  I("NG", "NG=F", "NATGAS", "commodity", "suspect", false, "also XNGUSD / NGAS"),
  I("RB", "RB=F", "GASOLINE", "commodity", "suspect", false, "rare on CFD"),
  I("HO", "HO=F", "", "commodity", "suspect", false, "often unavailable on CFD — read/score only"),
];

// ── Agriculture — liquid core; gap/headline-prone (expect messier ranges;
//    prune what surfaces badly). Suspect until audited. ───────────────────────
const AGS: ScannerInstrument[] = [
  I("ZC", "ZC=F", "CORN", "ag", "suspect", false, "limited broker coverage"),
  I("ZW", "ZW=F", "WHEAT", "ag", "suspect", false, "limited"),
  I("ZS", "ZS=F", "SOYBEAN", "ag", "suspect", false, "limited"),
  I("ZL", "ZL=F", "", "ag", "suspect", false, "rare on CFD — read/score only"),
  I("ZM", "ZM=F", "", "ag", "suspect", false, "rare on CFD — read/score only"),
  I("SB", "SB=F", "SUGAR", "ag", "suspect", false, "some brokers"),
  I("KC", "KC=F", "COFFEE", "ag", "suspect", false, "some brokers"),
  I("CT", "CT=F", "COTTON", "ag", "suspect", false, "rare"),
  I("CC", "CC=F", "COCOA", "ag", "suspect", false, "rare"),
];

// ── Currencies — read the future, execute SPOT. Yahoo volume VERIFIED broken
//    on 6E (2026-07-25) — all seven suspect. THREE ARE INVERTED: the future is
//    XXX/USD, the spot is USD/XXX. accum on 6J = SELL USDJPY. ─────────────────
const CURRENCY: ScannerInstrument[] = [
  I("6E", "6E=F", "EURUSD", "currency", "suspect", false),
  I("6B", "6B=F", "GBPUSD", "currency", "suspect", false),
  I("6A", "6A=F", "AUDUSD", "currency", "suspect", false),
  I("6N", "6N=F", "NZDUSD", "currency", "suspect", false),
  I("6C", "6C=F", "USDCAD", "currency", "suspect", true, "CAD strength = USDCAD down"),
  I("6J", "6J=F", "USDJPY", "currency", "suspect", true, "JPY strength = USDJPY down"),
  I("6S", "6S=F", "USDCHF", "currency", "suspect", true, "CHF strength = USDCHF down"),
];

// ── Stocks / ETFs — read == execute, consolidated tape = real volume. ─────────
const STOCK_NAMES = [
  "SPY", "QQQ", "IWM", "DIA", "AAPL", "MSFT", "NVDA", "AMD", "TSLA", "AMZN",
  "GOOGL", "META", "NFLX", "JPM", "XLE", "XLF", "XLK", "GLD", "SLV", "INTC",
  "BA", "DIS", "KO", "PFE", "WMT", "CVX", "XOM", "MU", "CRM", "ORCL", "V", "MA",
  "HD", "UNH", "PG", "JNJ", "BAC", "WFC", "T", "VZ", "CSCO", "ADBE", "QCOM",
  "AVGO", "COST", "NKE", "MCD",
];
const STOCKS: ScannerInstrument[] = STOCK_NAMES.map((s) =>
  I(s, s, s, "stock", "real", false, "tag accounts that offer stock CFDs (e.g. FTMO)"),
);

export const BASKET: ScannerInstrument[] = [...CURRENCY, ...INDEX, ...COMMOD, ...AGS, ...STOCKS];

// ── Derived lookups ───────────────────────────────────────────────────────────

const BY_SYMBOL = new Map(BASKET.map((i) => [i.symbol, i]));
export const instrumentInfo = (symbol: string): ScannerInstrument | undefined => BY_SYMBOL.get(symbol);

/** Instruments whose engine verdict rests on unproven/broken volume. Derived
 *  from config — upgrade an instrument's volumeQuality (after a feed audit)
 *  and every consumer (badges, learnable filter, blind score) follows. */
export const SUSPECT_VOLUME: Set<string> = new Set(
  BASKET.filter((i) => i.volumeQuality !== "real").map((i) => i.symbol),
);

/** Map a READ verdict to the EXECUTE call — inversion applied so the trader
 *  never flips it mentally. accum = bullish READ; on 6J that means SELL USDJPY. */
export function executeCall(
  symbol: string,
  verdict: string,
): { action: "BUY" | "SELL"; symbol: string } | null {
  const inst = BY_SYMBOL.get(symbol);
  if (!inst || !inst.executeSymbol) return null;
  if (verdict !== "accum" && verdict !== "distrib") return null;
  const bullishRead = verdict === "accum";
  const buy = inst.inverted ? !bullishRead : bullishRead;
  return { action: buy ? "BUY" : "SELL", symbol: inst.executeSymbol };
}

/** TradingView symbol for the read chart: futures = continuous contract. */
export function tradingViewSymbol(symbol: string): string {
  const inst = BY_SYMBOL.get(symbol);
  if (!inst) return symbol;
  return inst.yahoo.endsWith("=F") ? `${symbol}1!` : inst.yahoo.startsWith("^") ? inst.yahoo.slice(1) : symbol;
}
