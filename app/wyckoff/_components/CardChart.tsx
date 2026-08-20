"use client";
// app/wyckoff/_components/CardChart.tsx — the chart on the card.
//
// The desk exists to let you read charts, and until now every read required
// opening a drawer: twelve candidates meant twelve open-and-close cycles, and
// the grid itself was unscannable text. This puts the tape on the card so
// triage happens with your eyes and the drawer becomes the place you go to
// COMMIT rather than the place you go to SEE.
//
// Bars arrive pre-trimmed on the candidate row (scan time writes ~70 of them),
// so rendering a dozen of these costs nothing — no fetch per card.
//
// It is a thumbnail, so it shows only what survives at this size: candles, the
// range box, and the volume strip with the same effort treatment as the full
// charts. No axes, no crosshair, no labels competing for 110 pixels.

import { volumeView, type VolBar } from "@/lib/chart/volume";

/** [o, h, l, c, v, date] — tuples rather than objects, so shipping 70 bars per
 *  card stays cheap on the wire. */
export type SparkBar = [number, number, number, number, number, string];

const W = 320;
const PH = 74;   // price pane
const VH = 24;   // volume strip
const GAP = 6;
const H = PH + GAP + VH;

export default function CardChart({
  bars,
  rangeLo,
  rangeHi,
  rangeStartDate,
  breakoutDate,
  alertPrice,
  suspectVolume,
}: {
  bars?: SparkBar[] | null;
  rangeLo: number;
  rangeHi: number;
  rangeStartDate?: string | null;
  breakoutDate?: string | null;
  alertPrice?: number | null;
  suspectVolume?: boolean;
}) {
  if (!bars || bars.length < 5) return <NoChart />;

  const n = bars.length;
  const highs = bars.map((b) => b[1]);
  const lows = bars.map((b) => b[2]);
  // The box must always be visible even if price has run away from it, so the
  // range edges join the price extent rather than being clipped out of frame.
  const pMin = Math.min(...lows, rangeLo);
  const pMax = Math.max(...highs, rangeHi);
  const pSpan = Math.max(pMax - pMin, 1e-9);

  const volBars: VolBar[] = bars.map((b) => ({ o: b[0], h: b[1], l: b[2], c: b[3], v: b[4] }));
  const vol = volumeView(volBars, { trusted: !suspectVolume });

  const xw = W / n;
  const cw = Math.max(1, Math.min(6, xw * 0.62));
  const x = (i: number) => i * xw + xw / 2;
  const y = (p: number) => 3 + (1 - (p - pMin) / pSpan) * (PH - 6);
  const vy = (v: number) => PH + GAP + (1 - Math.min(v, vol.maxV) / vol.maxV) * VH;

  const dateIdx = (d?: string | null) => {
    if (!d) return -1;
    const key = d.slice(0, 10);
    return bars.findIndex((b) => String(b[5]).slice(0, 10) === key);
  };
  const startIdx = dateIdx(rangeStartDate);
  const boxEnd = dateIdx(breakoutDate);
  const boxFrom = startIdx >= 0 ? x(startIdx) : 0;
  const boxTo = boxEnd >= 0 ? x(boxEnd) : W;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} aria-hidden="true">
      {/* Range box — the structure the whole read is about, so it sits under
          the candles rather than over them. */}
      <rect
        x={boxFrom}
        y={y(rangeHi)}
        width={Math.max(2, boxTo - boxFrom)}
        height={Math.max(1, y(rangeLo) - y(rangeHi))}
        fill="var(--accent)"
        opacity={0.05}
      />
      <line x1={boxFrom} y1={y(rangeHi)} x2={boxTo} y2={y(rangeHi)} stroke="var(--accent)" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.6} />
      <line x1={boxFrom} y1={y(rangeLo)} x2={boxTo} y2={y(rangeLo)} stroke="var(--accent)" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.6} />

      {bars.map((b, i) => {
        const [o, h, l, c] = b;
        const up = c >= o;
        const col = up ? "var(--green)" : "var(--red)";
        const bodyTop = y(Math.max(o, c));
        const bodyH = Math.max(0.8, Math.abs(y(o) - y(c)));
        // Context bars (before the range began) sit back so the eye lands on
        // the range itself.
        const inCtx = startIdx >= 0 && i < startIdx;
        return (
          <g key={i} opacity={inCtx ? 0.4 : 1}>
            <line x1={x(i)} y1={y(h)} x2={x(i)} y2={y(l)} stroke={col} strokeWidth={0.7} />
            <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={bodyH} fill={col} />
            {/* Volume as effort — same treatment as the full charts, so the
                thumbnail and the drawer never tell different stories. */}
            <rect
              x={x(i) - cw / 2}
              y={vy(b[4])}
              width={cw}
              height={PH + GAP + VH - vy(b[4])}
              fill={col}
              opacity={vol.alphaAt(i)}
            />
            {vol.clipped(b[4]) && (
              <rect x={x(i) - cw / 2} y={PH + GAP} width={cw} height={1.5} fill="var(--amber)" />
            )}
          </g>
        );
      })}

      {/* Volume MA — suppressed on feeds we do not trust, same rule as the
          full charts. */}
      {vol.trusted && (
        <polyline
          fill="none"
          stroke="var(--amber)"
          strokeWidth={0.9}
          opacity={0.55}
          points={bars.map((_, i) => `${x(i)},${vy(vol.ma[i])}`).join(" ")}
        />
      )}

      {alertPrice != null && alertPrice >= pMin && alertPrice <= pMax && (
        <line x1={0} y1={y(alertPrice)} x2={W} y2={y(alertPrice)} stroke="var(--accent)" strokeWidth={0.8} strokeDasharray="1 3" />
      )}

      <line x1={0} y1={PH + GAP - 0.5} x2={W} y2={PH + GAP - 0.5} stroke="var(--border-subtle)" strokeWidth={0.8} />
    </svg>
  );
}

/** Rows scanned before sparkBars existed carry no window. Say so plainly rather
 *  than rendering an empty box that looks like a broken chart. */
function NoChart() {
  return (
    <div style={{
      height: 104, display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: "var(--text-3)",
    }}>
      no chart window — re-run the scan
    </div>
  );
}
