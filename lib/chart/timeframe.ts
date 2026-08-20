// lib/chart/timeframe.ts — roll daily bars up to weekly or monthly.
//
// WHY AGGREGATE RATHER THAN FETCH
// The scanner, its ranges, its outcomes and two years of history are all daily.
// Weekly and monthly are strictly derivable from that — first open, highest
// high, lowest low, last close, summed volume — so a higher-timeframe view
// costs one pure function and no new data source. Every chart in the app can
// offer it, including thumbnails and resolved cases from months ago.
//
// WHAT IS NOT POSSIBLE HERE
// Going the other way. A daily bar cannot be split into H4s, so intraday needs
// a separate fetch with its own history limits, and could never exist for older
// resolved cases. Different feature, different constraints — deliberately not
// pretended at in this module.

export interface TfBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  date: string; // YYYY-MM-DD
}

export type Timeframe = "D" | "W" | "M";

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  D: "daily",
  W: "weekly",
  M: "context",
};

/** What each timeframe is actually FOR here.
 *
 *  The scanner detects ranges of 15-90 DAILY bars. That is ~8 weekly bars and
 *  ~2 monthly bars — so monthly physically cannot render the range as a shape.
 *  It is kept for the one question it answers well (where does this range sit
 *  in the multi-year picture) and labelled "context" rather than pretending to
 *  show structure. */
export const TIMEFRAME_PURPOSE: Record<Timeframe, string> = {
  D: "bars as scanned — the range as the engine sees it",
  W: "the range plus the trend that built it",
  M: "where this sits in the multi-year picture — too coarse to show the range itself",
};

/** How many bars belong ON SCREEN per timeframe.
 *
 *  Nothing windowed before this: charts rendered every bar the fetch returned,
 *  so a 5y daily pull meant ~1250 candles in 850px, and rolling that up to
 *  monthly left 60 bars stretched across the same width with canyons between
 *  them. Bar count — and therefore spacing — was a side effect of the fetch
 *  range rather than a decision. */
export const BARS_IN_VIEW: Record<Timeframe, number> = { D: 180, W: 130, M: 90 };

/** Widest a single bar's slot may get. Without a ceiling, a short series
 *  inflates each candle to fill the width and the chart reads as a bar chart of
 *  six things rather than a tape. */
export const MAX_BAR_PITCH = 16;

/**
 * The slice to draw: the tail of the series, widened when necessary so the
 * range and its lead-in stay on screen. A window that cropped the range out
 * would be worse than no windowing at all.
 */
export function viewWindow(
  total: number,
  tf: Timeframe,
  mustIncludeFrom?: number | null,
): { from: number; to: number } {
  const want = BARS_IN_VIEW[tf];
  if (total <= want) return { from: 0, to: total };

  let from = Math.max(0, total - want);
  if (mustIncludeFrom != null && mustIncludeFrom >= 0) {
    // Keep a little air before the range start so the context leading into it
    // is visible rather than clipped flush against the left edge.
    const withAir = Math.max(0, mustIncludeFrom - Math.round(want * 0.15));
    from = Math.min(from, withAir);
  }
  return { from, to: total };
}

/** ISO week key (YYYY-Www), Monday-anchored.
 *
 *  Uses the ISO rule rather than "day of year / 7" because the naive version
 *  splits the turn of the year into a stub week, which then renders as a fake
 *  narrow-range bar every January. */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 10);
  const day = d.getUTCDay() || 7;            // Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - day);    // move to the week's Thursday
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export const monthKeyOf = (dateStr: string): string => dateStr.slice(0, 7);

/**
 * Roll bars up. Returns the input untouched for "D".
 *
 * The aggregated bar carries the date of its LAST constituent day, not its
 * first: a partial current week must read as "as of today", and marker lookups
 * elsewhere match on the most recent bar the data actually covers.
 */
export function aggregateBars(bars: TfBar[], tf: Timeframe): TfBar[] {
  if (tf === "D" || bars.length === 0) return bars;
  const keyOf = tf === "W" ? isoWeekKey : monthKeyOf;

  const out: TfBar[] = [];
  let curKey: string | null = null;
  let acc: TfBar | null = null;

  for (const b of bars) {
    const key = keyOf(b.date);
    if (key !== curKey) {
      if (acc) out.push(acc);
      curKey = key;
      acc = { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, date: b.date };
      continue;
    }
    if (!acc) continue;
    acc.h = Math.max(acc.h, b.h);
    acc.l = Math.min(acc.l, b.l);
    acc.c = b.c;      // last close wins
    acc.v += b.v;     // volume sums
    acc.date = b.date; // period is dated by its most recent day
  }
  if (acc) out.push(acc);
  return out;
}

/** Map a daily date onto the aggregated bar that contains it, so markers
 *  (surfaced bar, terminal test, breakout) survive a timeframe switch instead
 *  of silently disappearing when the exact date is no longer a bar. */
export function indexForDate(bars: TfBar[], tf: Timeframe, dateStr: string | null | undefined): number {
  if (!dateStr || bars.length === 0) return -1;
  const target = dateStr.slice(0, 10);
  if (tf === "D") return bars.findIndex((b) => b.date.slice(0, 10) === target);

  const keyOf = tf === "W" ? isoWeekKey : monthKeyOf;
  const want = keyOf(target);
  return bars.findIndex((b) => keyOf(b.date) === want);
}
