// lib/screener/yahoo.ts — fetch 1h candles from Yahoo Finance and resample to H4.
//
// Yahoo has no native 4h interval, so we pull 1h and bucket every 4 hours
// (UTC-aligned): open = first open, high = max, low = min, close = last close.
// ADX/EMA on resampled H4 matches native H4 — only the bucket offset differs
// from a GMT+2 broker chart, which barely moves a 14-period ADX.
//
// Note: forex volume on Yahoo is zero/absent by design (no central exchange).
// The screener is price-only; volume/effort reads happen manually on MT4.

import axios from "axios";

export interface Candle {
  time: number; // unix seconds (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
}

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
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

// Two hosts serving the same API — retried in order across attempts, which
// also survives flaky DNS (ENOTFOUND) and per-host rate limiting.
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchHourly(symbol: string, range = "3mo"): Promise<Candle[]> {
  const get = (host: string) =>
    axios.get<YahooChartResponse>(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      params: { interval: "1h", range, includePrePost: false },
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      timeout: 30_000,
    });

  // 4 attempts alternating hosts, with growing pauses (0s, 2s, 5s, 10s) —
  // rides out slow links, transient DNS failures, and brief rate limits.
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

  if (data.chart.error) throw new Error(`Yahoo ${symbol}: ${data.chart.error.description}`);
  const result = data.chart.result?.[0];
  if (!result?.timestamp?.length) throw new Error(`Yahoo ${symbol}: empty response`);

  const q = result.indicators.quote[0];
  const candles: Candle[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if (o == null || h == null || l == null || c == null) continue; // gaps / halted bars
    candles.push({ time: result.timestamp[i], open: o, high: h, low: l, close: c });
  }
  return candles;
}

// Bucket 1h candles into H4 (UTC-aligned: 00, 04, 08, 12, 16, 20).
// For session markets (stocks/indices) buckets simply contain fewer bars —
// standard screener behaviour.
export function resampleToH4(hourly: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of hourly) {
    const bucketStart = Math.floor(c.time / 14_400) * 14_400; // 4h = 14400s
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { ...c, time: bucketStart });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close; // hourly candles arrive in time order
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export async function fetchH4(symbol: string, range = "3mo"): Promise<Candle[]> {
  return resampleToH4(await fetchHourly(symbol, range));
}
