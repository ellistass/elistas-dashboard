// lib/screener/universe.ts — the markets the trend-strength screener sweeps.
// Yahoo Finance symbols. `tradeable` = available on the MT4 account, so the
// dashboard can visually separate "trade this" from "context only".

export type AssetClass = "forex" | "metal" | "index" | "stock" | "crypto" | "energy";

export interface Market {
  symbol: string;       // Yahoo symbol
  displayName: string;
  assetClass: AssetClass;
  tradeable: boolean;   // on the user's MT4 account
  alwaysOpen?: boolean; // 24h markets (forex/crypto) vs session markets (stocks/indices)
}

// ── Forex: ALL 28 pairs from the 8 majors ────────────────────────────────────
// It's a trend strategy — it works on any market. Scan everything, let the
// numbers pick the market, then check whether the fundamentals (RFDM) hold.
// Pair convention follows market standard (EUR/USD not USD/EUR), enforced by
// this priority order: EUR > GBP > AUD > NZD > USD > CAD > CHF > JPY.

const FX_PRIORITY = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];

function allForexPairs(): Market[] {
  const pairs: Market[] = [];
  for (let i = 0; i < FX_PRIORITY.length; i++) {
    for (let j = i + 1; j < FX_PRIORITY.length; j++) {
      const base = FX_PRIORITY[i];
      const quote = FX_PRIORITY[j];
      pairs.push({
        symbol: `${base}${quote}=X`,
        displayName: `${base}/${quote}`,
        assetClass: "forex",
        tradeable: true,
        alwaysOpen: true,
      });
    }
  }
  return pairs; // 28 pairs
}

export const UNIVERSE: Market[] = [
  ...allForexPairs(),

  // ── Metals ────────────────────────────────────────────────────────────────
  { symbol: "GC=F", displayName: "Gold (XAU)", assetClass: "metal", tradeable: true },
  { symbol: "SI=F", displayName: "Silver (XAG)", assetClass: "metal", tradeable: true },

  // ── Indices ───────────────────────────────────────────────────────────────
  { symbol: "^GSPC", displayName: "S&P 500", assetClass: "index", tradeable: true },
  { symbol: "^NDX", displayName: "Nasdaq 100", assetClass: "index", tradeable: true },
  { symbol: "^DJI", displayName: "Dow 30", assetClass: "index", tradeable: true },
  { symbol: "^GDAXI", displayName: "DAX 40", assetClass: "index", tradeable: true },
  { symbol: "^FTSE", displayName: "FTSE 100", assetClass: "index", tradeable: false },
  { symbol: "^N225", displayName: "Nikkei 225", assetClass: "index", tradeable: false },

  // ── Energy ────────────────────────────────────────────────────────────────
  { symbol: "CL=F", displayName: "WTI Crude", assetClass: "energy", tradeable: true },

  // ── Crypto (24h, good trend context) ─────────────────────────────────────
  { symbol: "BTC-USD", displayName: "Bitcoin", assetClass: "crypto", tradeable: false, alwaysOpen: true },
  { symbol: "ETH-USD", displayName: "Ethereum", assetClass: "crypto", tradeable: false, alwaysOpen: true },

  // ── Big liquid stocks (context / numbers game; not tradeable on MT4) ─────
  { symbol: "AAPL", displayName: "Apple", assetClass: "stock", tradeable: false },
  { symbol: "MSFT", displayName: "Microsoft", assetClass: "stock", tradeable: false },
  { symbol: "NVDA", displayName: "Nvidia", assetClass: "stock", tradeable: false },
  { symbol: "AMZN", displayName: "Amazon", assetClass: "stock", tradeable: false },
  { symbol: "GOOGL", displayName: "Alphabet", assetClass: "stock", tradeable: false },
  { symbol: "META", displayName: "Meta", assetClass: "stock", tradeable: false },
  { symbol: "TSLA", displayName: "Tesla", assetClass: "stock", tradeable: false },
  { symbol: "JPM", displayName: "JPMorgan", assetClass: "stock", tradeable: false },
  { symbol: "XOM", displayName: "Exxon", assetClass: "stock", tradeable: false },
];

// Map a forex Yahoo symbol back to base/quote for the RFDM cross-check.
export function forexParts(symbol: string): { base: string; quote: string } | null {
  const m = symbol.match(/^([A-Z]{3})([A-Z]{3})=X$/);
  if (!m) return null;
  return { base: m[1], quote: m[2] };
}
