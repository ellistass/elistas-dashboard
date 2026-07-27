// app/api/wyckoff/feed-audit/route.ts — §7 feed audit, runnable on demand.
//
// GET → probes every non-stock instrument in the basket (plus SPY as a
// known-good control) against the ACTUAL feed and classifies its volume:
//   real     — varies bar-to-bar, plausible magnitude
//   suspect  — present but implausibly small, constant, or lagging
//   unusable — zero/absent (the engine cannot even scan it)
//
// This is the evidence for upgrading an instrument's volumeQuality in
// lib/wyckoff/basket.ts. The config ships conservative (suspect until proven);
// run this, compare a few medians against TradingView's exchange feed, then
// flip the ones that check out to "real". Session auth; takes ~1–2 min.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import axios from "axios";
import { BASKET } from "@/lib/wyckoff/basket";

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawVolumes(symbol: string): Promise<number[]> {
  const delays = [0, 2_000, 5_000];
  let lastErr: unknown;
  for (let a = 0; a < delays.length; a++) {
    if (delays[a]) await sleep(delays[a]);
    try {
      const r = await axios.get(
        `https://${HOSTS[a % 2]}/v8/finance/chart/${encodeURIComponent(symbol)}`,
        {
          params: { interval: "1d", range: "3mo", includePrePost: false },
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
          timeout: 30_000,
        },
      );
      const res = r.data.chart.result?.[0];
      if (!res?.timestamp?.length) throw new Error("empty response");
      const q = res.indicators.quote[0];
      const out: number[] = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        if (q.close[i] != null) out.push(q.volume[i] ?? 0);
      }
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Plausibility floor for liquid futures (contracts/day). Stocks use 500k shares.
const FLOOR: Record<string, number> = { index: 50_000, commodity: 20_000, ag: 5_000, currency: 20_000, stock: 500_000 };

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const probes = [
    ...BASKET.filter((i) => i.assetClass !== "stock"),
    BASKET.find((i) => i.symbol === "SPY")!, // known-good control
  ];

  const rows: Array<Record<string, unknown>> = [];
  for (const inst of probes) {
    try {
      const vols = (await rawVolumes(inst.yahoo)).slice(-15);
      const nonzero = vols.filter((v) => v > 0);
      const zeroFrac = vols.length ? 1 - nonzero.length / vols.length : 1;
      const median = [...nonzero].sort((a, b) => a - b)[Math.floor(nonzero.length / 2)] ?? 0;
      const distinct = new Set(nonzero).size;
      const dupTail = vols.length >= 2 && vols[vols.length - 1] === vols[vols.length - 2];
      const audit =
        zeroFrac > 0.5 || median === 0 ? "unusable"
        : median < (FLOOR[inst.assetClass] ?? 20_000) || distinct < nonzero.length * 0.6 ? "suspect"
        : "real";
      rows.push({
        symbol: inst.symbol,
        yahoo: inst.yahoo,
        assetClass: inst.assetClass,
        configured: inst.volumeQuality,
        audit,
        medianVol: median,
        zeroPct: Math.round(zeroFrac * 100),
        distinct: `${distinct}/${nonzero.length}`,
        lastBarDuplicatesPrior: dupTail,
        action:
          audit === "real" && inst.volumeQuality === "suspect"
            ? "candidate to upgrade → real (verify median vs TradingView first)"
            : audit !== "real" && inst.volumeQuality === "real"
              ? "DOWNGRADE → suspect"
              : "keep",
      });
    } catch (e) {
      rows.push({
        symbol: inst.symbol,
        yahoo: inst.yahoo,
        assetClass: inst.assetClass,
        configured: inst.volumeQuality,
        audit: "fetch-failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await sleep(300);
  }

  return NextResponse.json({
    ok: true,
    note:
      "audit=real is necessary but not sufficient — spot-check medians against TradingView's " +
      "exchange feed before editing volumeQuality in lib/wyckoff/basket.ts. Config stays " +
      "conservative until you do.",
    rows,
  });
}
