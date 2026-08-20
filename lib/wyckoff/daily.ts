// lib/wyckoff/daily.ts — daily OHLCV bars WITH volume from Yahoo Finance.
//
// Sibling of lib/screener/yahoo.ts (which fetches 1h and drops volume — fine
// for the ADX trend screener, useless for Wyckoff). The Wyckoff scanner needs
// real daily volume, so this fetcher pulls interval=1d and keeps `v`.
// Same host-rotation + growing-backoff retry strategy as the H4 fetcher.
//
// Range "2y" ≈ 500 trading days — comfortably above the 300-bar minimum the
// spec requires (60 context + up to 90 range + 12 resolution + detection room).

import axios from "axios";
import { cleanBars, type Bar } from "./engine";

interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// In-process cache. One instrument commonly has several candidates, and a
// drawer gets opened, closed and reopened while reading — all of which hit the
// same series. Serverless means this only survives inside a warm instance,
// which is exactly the window where the repeats happen.
//
// TTL is 10 minutes: these are DAILY bars, so nothing changes intraday except
// the still-forming last bar, and a ten-minute-old view of a forming bar is not
// a decision anyone loses money on.
const barCache = new Map<string, { at: number; bars: Bar[] }>();
const BAR_TTL_MS = 10 * 60 * 1000;

export function clearBarCache(): void {
  barCache.clear();
}

export async function fetchDailyBars(yahooSymbol: string, range = "2y"): Promise<Bar[]> {
  const cacheKey = `${yahooSymbol}|${range}`;
  const hit = barCache.get(cacheKey);
  if (hit && Date.now() - hit.at < BAR_TTL_MS) return hit.bars;

  const get = (host: string) =>
    axios.get<YahooChartResponse>(
      `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
      {
        params: { interval: "1d", range, includePrePost: false },
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
        timeout: 30_000,
      },
    );

  const delays = [0, 2_000, 5_000, 10_000];
  let lastError: unknown;
  let data: YahooChartResponse | undefined;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt]);
    try {
      data = (await get(YAHOO_HOSTS[attempt % YAHOO_HOSTS.length])).data;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!data) throw lastError instanceof Error ? lastError : new Error(String(lastError));

  if (data.chart.error) throw new Error(`Yahoo ${yahooSymbol}: ${data.chart.error.description}`);
  const result = data.chart.result?.[0];
  if (!result?.timestamp?.length) throw new Error(`Yahoo ${yahooSymbol}: empty response`);

  const q = result.indicators.quote[0];
  const bars: Bar[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const [o, h, l, c, v] = [q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i]];
    if (o == null || h == null || l == null || c == null || v == null) continue;
    bars.push({
      o,
      h,
      l,
      c,
      v,
      // Bucket timestamps to a UTC date string — daily bars only need the day.
      date: new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10),
    });
  }
  // cleanBars drops zero-volume bars (holidays / bad prints) per spec §1.
  const cleaned = cleanBars(bars);
  barCache.set(cacheKey, { at: Date.now(), bars: cleaned });
  return cleaned;
}
