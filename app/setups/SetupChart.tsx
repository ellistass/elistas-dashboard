"use client";
// app/setups/SetupChart.tsx — the trade plan, drawn on the tape.
//
// Same look as the Wyckoff card chart (candles, range box, volume as effort),
// plus the four prices the setup card lists, drawn where they sit:
//
//   entry   solid accent line        (aggressive: the test's close — the next open fills near it)
//   stop    red dashed               red shading between entry and stop = the 1R you risk
//   +1R     green dotted             where the stop moves to breakeven
//   cap     green dashed             far edge + one band
//
// The levels run into a blank strip on the right: that's tomorrow onward,
// where the plan plays out. The signal bar (the break, or the spring/upthrust)
// gets a marker so you can see what fired.

import { volumeView, type VolBar } from "@/lib/chart/volume";

/** [o, h, l, c, v, date] — same tuple as the Wyckoff card chart. */
export type SparkBar = [number, number, number, number, number, string];

// Card size and expanded size. The expanded view is the same drawing with more
// room: longer window, bigger candles, readable labels and a date axis.
const SIZES = {
  card:  { W: 360,  FUTURE: 46, PH: 150, VH: 30, GAP: 6, LABEL_W: 84,  FONT: 8,  MAXC: 6,  AXIS: 0 },
  large: { W: 1100, FUTURE: 90, PH: 440, VH: 80, GAP: 10, LABEL_W: 150, FONT: 12, MAXC: 11, AXIS: 18 },
} as const;

export default function SetupChart({
  bars, rangeLo, rangeHi, rangeStart, signalDate,
  entry, stop, breakevenAt, target, long, suspectVolume, fmt, large = false,
}: {
  bars: SparkBar[];
  rangeLo: number;
  rangeHi: number;
  rangeStart: string;
  signalDate: string;
  entry: number;
  stop: number;
  breakevenAt: number;
  target: number;
  long: boolean;
  suspectVolume?: boolean;
  fmt: (x: number) => string;
  /** Expanded view: bigger canvas, full window, date axis. */
  large?: boolean;
}) {
  if (!bars || bars.length < 5) return null;
  const { W, FUTURE, PH, VH, GAP, LABEL_W, FONT, MAXC, AXIS } = SIZES[large ? "large" : "card"];
  const H = PH + GAP + VH + AXIS;

  const n = bars.length;
  const plotW = W - LABEL_W;
  const barsW = plotW - FUTURE;
  const pMin = Math.min(...bars.map((b) => b[2]), rangeLo, stop, target, entry);
  const pMax = Math.max(...bars.map((b) => b[1]), rangeHi, stop, target, entry);
  const pad = (pMax - pMin) * 0.04;
  const lo = pMin - pad, span = Math.max(pMax + pad - lo, 1e-9);

  const vol = volumeView(bars.map((b) => ({ o: b[0], h: b[1], l: b[2], c: b[3], v: b[4] })) as VolBar[], { trusted: !suspectVolume });
  const xw = barsW / n;
  const cw = Math.max(1, Math.min(MAXC, xw * 0.62));
  const x = (i: number) => i * xw + xw / 2;
  const y = (p: number) => (1 - (p - lo) / span) * PH;
  const vy = (v: number) => PH + GAP + (1 - Math.min(v, vol.maxV) / vol.maxV) * VH;

  const idx = (d: string) => bars.findIndex((b) => String(b[5]).slice(0, 10) === d.slice(0, 10));
  const si = idx(rangeStart), sig = idx(signalDate);
  const boxFrom = si >= 0 ? x(si) - xw / 2 : 0;
  const boxTo = sig >= 0 ? x(sig) - xw / 2 : barsW;
  const planFrom = sig >= 0 ? x(sig) : barsW - 4;

  // Keep the four labels from sitting on top of each other.
  const levels = [
    { key: "cap", p: target, col: "var(--green)", dash: "5 3", w: 1 },
    { key: "+1R", p: breakevenAt, col: "var(--green)", dash: "1.5 2.5", w: 1 },
    { key: "entry", p: entry, col: "var(--accent)", dash: "", w: 1.4 },
    { key: "stop", p: stop, col: "var(--red)", dash: "4 2", w: 1.2 },
  ].sort((a, b) => y(a.p) - y(b.p));
  const labelY: number[] = [];
  for (const l of levels) {
    let ly = y(l.p);
    if (labelY.length && ly - labelY[labelY.length - 1] < FONT + 3) ly = labelY[labelY.length - 1] + FONT + 3;
    labelY.push(Math.min(ly, PH - 2));
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img"
      aria-label={`${long ? "long" : "short"} setup: entry ${fmt(entry)}, stop ${fmt(stop)}, breakeven at ${fmt(breakevenAt)}, cap ${fmt(target)}`}>
      {/* range box */}
      <rect x={boxFrom} y={y(rangeHi)} width={Math.max(2, boxTo - boxFrom)} height={Math.max(1, y(rangeLo) - y(rangeHi))} fill="var(--accent)" opacity={0.05} />
      <line x1={boxFrom} y1={y(rangeHi)} x2={boxTo} y2={y(rangeHi)} stroke="var(--accent)" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.6} />
      <line x1={boxFrom} y1={y(rangeLo)} x2={boxTo} y2={y(rangeLo)} stroke="var(--accent)" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.6} />

      {/* risk (entry→stop) and first reward leg (entry→+1R), from the signal bar into the future strip */}
      <rect x={planFrom} y={Math.min(y(entry), y(stop))} width={plotW - planFrom} height={Math.abs(y(stop) - y(entry))} fill="var(--red)" opacity={0.10} />
      <rect x={planFrom} y={Math.min(y(entry), y(breakevenAt))} width={plotW - planFrom} height={Math.abs(y(breakevenAt) - y(entry))} fill="var(--green)" opacity={0.08} />

      {/* candles + volume */}
      {bars.map((b, i) => {
        const [o, h, l, c, v] = b;
        const col = c >= o ? "var(--green)" : "var(--red)";
        return (
          <g key={i} opacity={si >= 0 && i < si ? 0.4 : 1}>
            <line x1={x(i)} y1={y(h)} x2={x(i)} y2={y(l)} stroke={col} strokeWidth={0.7} />
            <rect x={x(i) - cw / 2} y={y(Math.max(o, c))} width={cw} height={Math.max(0.8, Math.abs(y(o) - y(c)))} fill={col} />
            <rect x={x(i) - cw / 2} y={vy(v)} width={cw} height={PH + GAP + VH - vy(v)} fill={col} opacity={vol.alphaAt(i)} />
            {vol.clipped(v) && <rect x={x(i) - cw / 2} y={PH + GAP} width={cw} height={1.5} fill="var(--amber)" />}
          </g>
        );
      })}
      {vol.trusted && (
        <polyline fill="none" stroke="var(--amber)" strokeWidth={0.9} opacity={0.55}
          points={bars.map((_, i) => `${x(i)},${vy(vol.ma[i])}`).join(" ")} />
      )}

      {/* the bar that fired */}
      {sig >= 0 && (
        <g>
          <line x1={x(sig)} y1={0} x2={x(sig)} y2={PH} stroke="var(--text-2)" strokeWidth={0.8} strokeDasharray="2 2" opacity={0.7} />
          <polygon points={`${x(sig) - 3.5},0 ${x(sig) + 3.5},0 ${x(sig)},5`} fill="var(--text-1)" />
        </g>
      )}

      {/* "today" divider: right of it is the plan, not price */}
      <line x1={barsW} y1={0} x2={barsW} y2={PH} stroke="var(--border-subtle)" strokeWidth={0.8} />
      <text x={barsW + 3} y={PH + GAP + FONT + 2} fontSize={FONT - 1} fill="var(--text-3)" fontFamily="'DM Mono', monospace">next →</text>

      {/* levels + labels */}
      {levels.map((l, i) => (
        <g key={l.key}>
          <line x1={planFrom} y1={y(l.p)} x2={plotW} y2={y(l.p)} stroke={l.col} strokeWidth={l.w} strokeDasharray={l.dash || undefined} />
          <line x1={plotW} y1={y(l.p)} x2={plotW + 3} y2={labelY[i] - 2.5} stroke={l.col} strokeWidth={0.6} />
          <text x={plotW + 5} y={labelY[i]} fontSize={FONT} fill={l.col} fontFamily="'DM Mono', monospace">
            {l.key} {fmt(l.p)}
          </text>
        </g>
      ))}

      <line x1={0} y1={PH + GAP - 0.5} x2={plotW} y2={PH + GAP - 0.5} stroke="var(--border-subtle)" strokeWidth={0.8} />

      {/* date axis (expanded view only) */}
      {AXIS > 0 && Array.from({ length: 6 }, (_, k) => Math.round((k * (n - 1)) / 5)).map((i, k) => (
        <text key={i} x={x(i)} y={H - 4} fontSize={FONT - 2} textAnchor={k === 0 ? "start" : k === 5 ? "end" : "middle"} fill="var(--text-3)" fontFamily="'DM Mono', monospace">
          {String(bars[i][5]).slice(0, 10)}
        </text>
      ))}
    </svg>
  );
}
