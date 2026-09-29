"use client";
// app/setups/SetupChartFull.tsx — the expanded setup chart.
//
// Built on the Wyckoff drawer's chart (LiveChartSvg) so it reads the same way:
// daily / weekly / monthly, right-aligned candles with capped spacing, the
// range box with its edge prices, volume as effort with the MA and optional
// effort marks, a hover crosshair with the OHLC + volume tooltip, and S / U / B
// markers. On top of that, the trade plan: entry, stop, +1R and cap, drawn
// from the signal bar into a strip on the right with their exact prices.
//
// Context bars before the range are only lightly dimmed (0.75) — the old
// expanded view dimmed them to 0.4, which washed out most of a long window.

import { useEffect, useState } from "react";
import { volumeView, isPlottableTag } from "@/lib/chart/volume";
import { aggregateBars, indexForDate, viewWindow, TIMEFRAME_LABEL, TIMEFRAME_PURPOSE, MAX_BAR_PITCH, type Timeframe } from "@/lib/chart/timeframe";

interface Bar { o: number; h: number; l: number; c: number; v: number; date: string }

export interface PlanProps {
  instrument: string;
  entry: "conservative" | "aggressive";
  long: boolean;
  rangeLo: number;
  rangeHi: number;
  rangeStart: string;
  signalDate: string;
  entryPrice: number;
  stop: number;
  breakevenAt: number;
  /** Cap / take-profit. Optional: the forex setup has no fixed target (trail only). */
  target?: number;
  fmt: (x: number) => string;
  /** Where to load the bars from. Default: the futures/stocks chart route. */
  dataUrl?: string;
  /** Small note under the timeframe buttons (e.g. where the volume comes from). */
  note?: string;
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmtVol = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0));

export default function SetupChartFull(plan: PlanProps) {
  const [data, setData] = useState<{ bars: Bar[]; suspectVolume: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tf, setTf] = useState<Timeframe>("D");
  const [showEffort, setShowEffort] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(plan.dataUrl ?? `/api/setups/chart?instrument=${encodeURIComponent(plan.instrument)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j; })
      .then((j) => { if (live) setData(j); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [plan.instrument, plan.dataUrl]);

  if (err) return <div style={{ ...mono, fontSize: 11, color: "var(--red)", padding: 20 }}>chart failed: {err}</div>;
  if (!data) return <div style={{ ...mono, fontSize: 11, color: "var(--text-3)", padding: 40, textAlign: "center" }}>loading chart…</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9, flexWrap: "wrap" }}>
        <div className="seg" style={{ display: "inline-flex" }}>
          {(["D", "W", "M"] as const).map((t) => (
            <button key={t} type="button" className={tf === t ? "on" : ""} onClick={() => setTf(t)}>{TIMEFRAME_LABEL[t]}</button>
          ))}
        </div>
        <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{TIMEFRAME_PURPOSE[tf]}{plan.note ? ` · ${plan.note}` : ""}</span>
        {!data.suspectVolume && (
          <button type="button" onClick={() => setShowEffort((v) => !v)}
            style={{ ...mono, fontSize: 10.5, padding: "5px 11px", borderRadius: 999, marginLeft: "auto",
              border: `1px solid ${showEffort ? "var(--accent)" : "var(--border-strong)"}`, color: showEffort ? "var(--accent)" : "var(--text-1)", background: "transparent" }}>
            effort marks {showEffort ? "on" : "off"}
          </button>
        )}
      </div>
      <PlanSvg daily={data.bars} suspectVolume={data.suspectVolume} tf={tf} showEffort={showEffort} plan={plan} />
    </div>
  );
}

function PlanSvg({ daily, suspectVolume, tf, showEffort, plan }: {
  daily: Bar[]; suspectVolume: boolean; tf: Timeframe; showEffort: boolean; plan: PlanProps;
}) {
  const W = 1000, PH = 360, VH = 100, GAP = 14, PAD = 64, LABEL_W = 150, FUTURE = 56;
  const H = PH + GAP + VH;
  const { rangeLo, rangeHi, fmt } = plan;

  // Same re-location rule as the Wyckoff drawer: dates, not indices, survive
  // rolling up to weekly/monthly.
  const all = tf === "D" ? daily : aggregateBars(daily, tf);
  const at = (d: string) => (tf === "D" ? all.findIndex((b) => b.date.slice(0, 10) === d.slice(0, 10)) : indexForDate(all, tf, d));
  const fullStart = Math.max(0, at(plan.rangeStart));
  const win = viewWindow(all.length, tf, fullStart);
  const bars = all.slice(win.from, win.to);
  const shift = (i: number) => (i < 0 ? null : i - win.from >= 0 && i - win.from < bars.length ? i - win.from : null);
  const startIdx = shift(fullStart) ?? 0;
  const sigIdx = shift(at(plan.signalDate));
  const n = bars.length;

  const levels = [plan.target, plan.breakevenAt, plan.entryPrice, plan.stop].filter((p): p is number => p != null);
  const pMin = Math.min(...bars.map((b) => b.l), rangeLo, ...levels);
  const pMax = Math.max(...bars.map((b) => b.h), rangeHi, ...levels);
  const pSpan = Math.max(pMax - pMin, 1e-9);

  const vol = volumeView(bars, { trusted: !suspectVolume });
  const rightEdge = W - LABEL_W - FUTURE;            // last candle sits here; the plan strip is to its right
  const xw = Math.min((rightEdge - PAD) / n, MAX_BAR_PITCH);
  const cw = Math.max(1.5, Math.min(9, xw * 0.62));
  const x = (i: number) => rightEdge - (n - 1 - i) * xw - xw / 2;
  const y = (p: number) => 10 + (1 - (p - pMin) / pSpan) * (PH - 20);
  const vy = (v: number) => PH + GAP + (1 - Math.min(v, vol.maxV) / vol.maxV) * VH;
  const boxEnd = sigIdx ?? n - 1;
  const planFrom = sigIdx != null ? x(sigIdx) : rightEdge;
  const plotRight = W - LABEL_W;

  const [hover, setHover] = useState<number | null>(null);
  const [pos, setPos] = useState<{ xPct: number; yPct: number } | null>(null);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const xv = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(n - 1 - (rightEdge - xv - xw / 2) / xw);
    setHover(i >= 0 && i < n ? i : null);
    setPos({ xPct: ((e.clientX - r.left) / r.width) * 100, yPct: ((e.clientY - r.top) / r.height) * 100 });
  };
  const hb = hover != null ? bars[hover] : null;
  // The rules measure volume against the RANGE's own average (bars in the box,
  // up to the signal). Shown in the tooltip on the daily view so the break
  // candle's 1.0–2.0× check can be read by eye.
  const rangeAvg = (() => {
    const inR = bars.slice(startIdx, sigIdx ?? n);
    return inR.length ? inR.reduce((t, b) => t + b.v, 0) / inR.length : 0;
  })();

  const lv = [
    ...(plan.target != null ? [{ key: "cap", p: plan.target, col: "var(--green)", dash: "6 4", w: 1.2 }] : []),
    { key: "+1R→BE", p: plan.breakevenAt, col: "var(--green)", dash: "2 3", w: 1.2 },
    { key: plan.entry === "aggressive" ? "entry~" : "entry", p: plan.entryPrice, col: "var(--accent)", dash: "", w: 1.8 },
    { key: "stop", p: plan.stop, col: "var(--red)", dash: "5 3", w: 1.5 },
  ].sort((a, b) => y(a.p) - y(b.p));
  const ly: number[] = [];
  for (const l of lv) { let v = y(l.p) + 4; if (ly.length && v - ly[ly.length - 1] < 14) v = ly[ly.length - 1] + 14; ly.push(Math.min(v, PH - 2)); }

  const sigLabel = plan.entry === "conservative" ? "B" : plan.long ? "S" : "U";
  const sigTitle = plan.entry === "conservative" ? "the break that qualified" : plan.long ? "spring" : "upthrust";

  return (
    <div className="card" style={{ padding: 10, position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", touchAction: "none", cursor: "crosshair" }}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => { setHover(null); setPos(null); }}>
        {/* range edges + prices */}
        <rect x={x(startIdx) - xw / 2} y={y(rangeHi)} width={Math.max(2, x(boxEnd) - x(startIdx))} height={Math.max(1, y(rangeLo) - y(rangeHi))} fill="var(--accent)" opacity={0.05} />
        {[rangeHi, rangeLo].map((p, i) => (
          <g key={i}>
            <line x1={x(startIdx)} y1={y(p)} x2={x(boxEnd)} y2={y(p)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
            <text x={4} y={y(p) + 3} fontSize={10} fill="var(--text-3)" {...mono}>{fmt(p)}</text>
          </g>
        ))}

        {/* plan zones from the signal bar into the plan strip */}
        <rect x={planFrom} y={Math.min(y(plan.entryPrice), y(plan.stop))} width={plotRight - planFrom} height={Math.abs(y(plan.stop) - y(plan.entryPrice))} fill="var(--red)" opacity={0.1} />
        <rect x={planFrom} y={Math.min(y(plan.entryPrice), y(plan.breakevenAt))} width={plotRight - planFrom} height={Math.abs(y(plan.breakevenAt) - y(plan.entryPrice))} fill="var(--green)" opacity={0.08} />

        {bars.map((b, i) => {
          const col = b.c >= b.o ? "var(--green)" : "var(--red)";
          return (
            <g key={i} opacity={i < startIdx ? 0.75 : 1}>
              <line x1={x(i)} y1={y(b.h)} x2={x(i)} y2={y(b.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - cw / 2} y={y(Math.max(b.o, b.c))} width={cw} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))} fill={col} />
              <rect x={x(i) - cw / 2} y={vy(b.v)} width={cw} height={PH + GAP + VH - vy(b.v)} fill={col} opacity={vol.alphaAt(i)} />
              {vol.clipped(b.v) && <rect x={x(i) - cw / 2} y={PH + GAP} width={cw} height={2} fill="var(--amber)" />}
            </g>
          );
        })}

        {vol.trusted && n > 2 && (
          <>
            <polyline fill="none" stroke="var(--amber)" strokeWidth={1.2} opacity={0.7}
              points={bars.map((_, i) => `${x(i)},${vy(Math.min(vol.ma[i], vol.maxV))}`).join(" ")} />
            <text x={PAD + 4} y={PH + GAP + 10} fontSize={9} fill="var(--amber)" opacity={0.7} {...mono}>vol MA{vol.maN}</text>
          </>
        )}
        {showEffort && vol.trusted && bars.map((_, i) => {
          const er = vol.effortAt(i);
          if (!er || !isPlottableTag(er.tag)) return null;
          return (
            <circle key={`e${i}`} cx={x(i)} cy={PH + GAP - 4} r={2.4} fill={er.tag === "CLIMAX" ? "var(--amber)" : "var(--green)"}>
              <title>{`${er.tag} — ${er.desc} (vol ${er.vr.toFixed(2)}x, spread ${er.sr.toFixed(2)}x)`}</title>
            </circle>
          );
        })}

        {/* the bar that fired */}
        {sigIdx != null && (
          <g>
            <line x1={x(sigIdx)} y1={0} x2={x(sigIdx)} y2={PH} stroke="var(--text-2)" strokeWidth={0.9} strokeDasharray="3 3" opacity={0.6} />
            <Marker x={x(sigIdx)} y={sigLabel === "S" ? y(bars[sigIdx].l) + 13 : y(bars[sigIdx].h) - 7} label={sigLabel} title={sigTitle} />
          </g>
        )}

        {/* "next" strip */}
        <line x1={rightEdge + xw / 2} y1={0} x2={rightEdge + xw / 2} y2={PH + GAP + VH} stroke="var(--border-subtle)" strokeWidth={1} />
        <text x={rightEdge + xw / 2 + 5} y={PH + GAP + 12} fontSize={9} fill="var(--text-3)" {...mono}>next →</text>

        {/* plan levels with exact prices */}
        {lv.map((l, i) => (
          <g key={l.key}>
            <line x1={planFrom} y1={y(l.p)} x2={plotRight} y2={y(l.p)} stroke={l.col} strokeWidth={l.w} strokeDasharray={l.dash || undefined} />
            <text x={plotRight + 6} y={ly[i]} fontSize={11} fill={l.col} {...mono}>{l.key} {fmt(l.p)}</text>
          </g>
        ))}

        {hover != null && hb && (
          <g pointerEvents="none">
            <line x1={x(hover)} y1={4} x2={x(hover)} y2={H} stroke="var(--text-3)" strokeWidth={0.8} strokeDasharray="3 3" opacity={0.7} />
            <line x1={PAD - 4} y1={y(hb.c)} x2={plotRight} y2={y(hb.c)} stroke="var(--text-3)" strokeWidth={0.6} strokeDasharray="2 4" opacity={0.45} />
            <circle cx={x(hover)} cy={y(hb.c)} r={3.2} fill="var(--accent)" />
            <text x={4} y={y(hb.c) + 3} fontSize={10} fill="var(--accent)" {...mono}>{fmt(hb.c)}</text>
          </g>
        )}
        <line x1={0} y1={PH + GAP - 0.5} x2={plotRight} y2={PH + GAP - 0.5} stroke="var(--border-subtle)" strokeWidth={0.8} />
      </svg>

      {hover != null && hb && pos && (
        <div style={{
          position: "absolute", pointerEvents: "none", zIndex: 5, left: `${pos.xPct}%`, top: `${pos.yPct}%`,
          transform: `translate(${pos.xPct < 58 ? "14px" : "calc(-100% - 14px)"}, ${pos.yPct < 58 ? "14px" : "calc(-100% - 14px)"})`,
          background: "var(--bg-elevated, var(--bg-card-raised, #14161d))", border: "1px solid var(--border-strong)", borderRadius: 9,
          padding: "8px 11px", boxShadow: "0 6px 22px rgba(0,0,0,0.45)", ...mono, fontSize: 10.5, lineHeight: 1.65, color: "var(--text-2)", whiteSpace: "nowrap",
        }}>
          <div style={{ color: "var(--text-1)", fontWeight: 500 }}>
            {hb.date}
            <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
              {" "}· {hover < startIdx ? "context" : sigIdx != null && hover > sigIdx ? "after the signal" : hover === sigIdx ? sigTitle : `range bar ${hover - startIdx + 1}`}
            </span>
          </div>
          <div>O {fmt(hb.o)} · H {fmt(hb.h)} · L {fmt(hb.l)} · C <span style={{ color: hb.c >= hb.o ? "var(--green)" : "var(--red)" }}>{fmt(hb.c)}</span></div>
          <div>vol <span style={{ color: "var(--text-1)" }}>{fmtVol(hb.v)}</span>
            {vol.ma[hover] > 0 && <span> · {(hb.v / vol.ma[hover]).toFixed(2)}× 20-day avg</span>}
            {rangeAvg > 0 && tf === "D" && <span style={{ color: "var(--text-1)" }}> · {(hb.v / rangeAvg).toFixed(2)}× range avg</span>}
            {hover > 0 && (() => { const d = hb.c - bars[hover - 1].c; return <span style={{ color: d >= 0 ? "var(--green)" : "var(--red)" }}>{"  "}Δ {d >= 0 ? "+" : ""}{fmt(d)}</span>; })()}
          </div>
        </div>
      )}
    </div>
  );
}

function Marker({ x, y, label, title }: { x: number; y: number; label: string; title: string }) {
  return (
    <g>
      <title>{title}</title>
      <circle cx={x} cy={y} r={8} fill="var(--bg-sidebar, #0a0b0f)" stroke="var(--accent)" strokeWidth={1.2} />
      <text x={x} y={y + 3.4} fontSize={9.5} fontWeight={700} fill="var(--accent)" textAnchor="middle" {...mono}>{label}</text>
    </g>
  );
}
