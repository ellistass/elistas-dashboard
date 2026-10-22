// lib/setups/intraday.ts — the 4-hour volume read behind a daily setup (information on the card).
//
// Tested 22 Oct 2026 on Yahoo hourly bars, Jun 2024 – Oct 2026 (all Yahoo keeps), project doc
// intraday-volume-read-oct2026:
//   RETEST — the first 4h candle of the drop back to the edge (seen BEFORE the limit fills).
//     Volume ≥ 0.75 × the break day's average 4h candle = sellers showed up → cancel the limit.
//     Grade A: light +0.26R / 55% win vs heavy −0.04R / 39%. Portfolio +1.53 → +2.05 R/month.
//   SPRING / UPTHRUST — the test day's 4h bars (seen BEFORE the next-open entry):
//     volume formed in our favour +0.43R / 55% vs against +0.11R / 37%;
//     absorption (heavy 4h bar at the extreme that closed off it) 57% win, +0.67R;
//     in our favour + strong last 4h bar 57% win, +0.61R (grade A +1.20R).
// Never changes the grade.

export interface HourBar { t: string; o: number; h: number; l: number; c: number; v: number } // t = ISO UTC

const cache = new Map<string, { at: number; bars: HourBar[] }>();
const TTL_MS = 15 * 60 * 1000;

/** Last month of 1h bars with volume. Empty on any failure — the scan never breaks on this. */
export async function fetchHourBars(
  yahooSymbol: string,
  force = false,
  opts: { range?: "1mo" | "3mo"; keepNoVolume?: boolean } = {},
): Promise<HourBar[]> {
  const range = opts.range ?? "1mo";
  const key = `${yahooSymbol}|${range}|${opts.keepNoVolume ? 1 : 0}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.bars;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=60m&range=${range}&includePrePost=false`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }, cache: "no-store" });
    if (!res.ok) throw new Error(`yahoo ${res.status}`);
    const data: any = await res.json();
    const r = data?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
    const bars: HourBar[] = [];
    for (let i = 0; i < (r?.timestamp?.length ?? 0); i++) {
      const [o, h, l, c, v] = [q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i]];
      if ([o, h, l, c].some((x) => x == null) || h < l) continue;
      if (!opts.keepNoVolume && !(v > 0)) continue;
      bars.push({ t: new Date(r.timestamp[i] * 1000).toISOString(), o, h, l, c, v: v ?? 0 });
    }
    cache.set(key, { at: Date.now(), bars });
    return bars;
  } catch {
    return hit?.bars ?? [];
  }
}

/** 1h → 4h bars on UTC 00/04/08/12/16/20 boundaries (as tested). */
export function to4h(bars: HourBar[]): HourBar[] {
  const out: HourBar[] = [];
  let key = "";
  for (const b of bars) {
    const k = b.t.slice(0, 11) + Math.floor(+b.t.slice(11, 13) / 4);
    const cur = out[out.length - 1];
    if (k !== key) { out.push({ ...b }); key = k; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  return out;
}

const day = (b: HourBar) => b.t.slice(0, 10);
const clv = (b: HourBar, d: number) => (b.h > b.l ? (d * (2 * b.c - b.h - b.l)) / (b.h - b.l) : 0);

export interface DropRead { ratio: number; at: string; heavy: boolean }

/** RETEST: the first 4h candle closing against us after the post-break extreme, before price reaches the edge. */
export function firstDropRead(h4: HourBar[], side: "long" | "short", edge: number, breakDate: string): DropRead | null {
  const d = side === "long" ? 1 : -1;
  const k = h4.findIndex((b) => day(b) >= breakDate);
  if (k < 0) return null;
  const brk = h4.filter((b) => day(b) === breakDate);
  const avgV = brk.reduce((s, b) => s + b.v, 0) / (brk.length || 1);
  if (!(avgV > 0)) return null;
  let end = h4.length;                                   // stop at the touch: only what is known before the fill counts
  for (let i = k + 1; i < h4.length; i++) if (d > 0 ? h4[i].l <= edge : h4[i].h >= edge) { end = i; break; }
  if (end - k < 2) return null;
  const ext = (b: HourBar) => (d > 0 ? b.h : b.l);
  let peak = k;
  for (let i = k; i < end; i++) if (d * (ext(h4[i]) - ext(h4[peak])) > 0) peak = i;
  for (let i = peak + 1; i < end; i++) {
    if (d * (h4[i].c - h4[i].o) < 0) {
      const ratio = h4[i].v / avgV;
      return { ratio: Math.round(ratio * 100) / 100, at: h4[i].t, heavy: ratio >= 0.75 };
    }
  }
  return null;
}

/** In whose favour the volume formed over the last `days` sessions up to `asOfDate`: +1 all for us, −1 all against. */
export function volumeFavour(h4: HourBar[], side: "long" | "short", asOfDate: string, days = 1): number | null {
  const d = side === "long" ? 1 : -1;
  const sessions = new Set([...new Set(h4.filter((b) => day(b) <= asOfDate).map(day))].slice(-days));
  let num = 0, den = 0;
  for (const b of h4) if (sessions.has(day(b)) && b.h > b.l) { num += b.v * clv(b, 1); den += b.v; }
  return den > 0 ? Math.round(((d * num) / den) * 100) / 100 : null;
}

export interface SpringRead { favour: number | null; favour3: number | null; absorption: boolean; strongFinish: boolean; extAt: string; lastAt: string }

/** SPRING / UPTHRUST: the test day's 4h bars. */
export function springRead(h4: HourBar[], side: "long" | "short", testDate: string): SpringRead | null {
  const d = side === "long" ? 1 : -1;
  const bars = h4.filter((b) => day(b) === testDate);
  if (bars.length < 2) return null;
  const avgV = bars.reduce((s, b) => s + b.v, 0) / bars.length;
  const extBar = bars.reduce((a, b) => (d * ((d > 0 ? b.l : b.h) - (d > 0 ? a.l : a.h)) < 0 ? b : a));
  return {
    favour: volumeFavour(h4, side, testDate, 1),
    favour3: volumeFavour(h4, side, testDate, 3),
    absorption: extBar.v >= 1.3 * avgV && clv(extBar, d) > 0,
    strongFinish: clv(bars[bars.length - 1], d) > 0.33,
    extAt: extBar.t,
    lastAt: bars[bars.length - 1].t,
  };
}

export interface DropShare { share: number; from: string; to: string; bars: number }

/** RETEST: the whole drop back to the edge — share of its volume on candles closing against us,
 *  from the post-break extreme up to (not including) the touch. Under 0.5 = coming back on no
 *  selling: 62% win, +0.37R (n=42, all grades, Jun 2024 – Oct 2026). Information only. */
export function dropShare(h4: HourBar[], side: "long" | "short", edge: number, breakDate: string): DropShare | null {
  const d = side === "long" ? 1 : -1;
  const k = h4.findIndex((b) => day(b) >= breakDate);
  if (k < 0) return null;
  let end = h4.length;
  for (let i = k + 1; i < h4.length; i++) if (d > 0 ? h4[i].l <= edge : h4[i].h >= edge) { end = i; break; }
  const ext = (b: HourBar) => (d > 0 ? b.h : b.l);
  let peak = k;
  for (let i = k; i < end; i++) if (d * (ext(h4[i]) - ext(h4[peak])) > 0) peak = i;
  const seg = h4.slice(peak + 1, end);
  const tot = seg.reduce((s, b) => s + b.v, 0);
  if (seg.length < 2 || !(tot > 0)) return null;
  const against = seg.filter((b) => d * (b.c - b.o) < 0).reduce((s, b) => s + b.v, 0);
  return { share: Math.round((against / tot) * 100) / 100, from: seg[0].t, to: seg[seg.length - 1].t, bars: seg.length };
}
