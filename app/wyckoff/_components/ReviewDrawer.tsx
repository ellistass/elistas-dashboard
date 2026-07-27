"use client";
// app/wyckoff/_components/ReviewDrawer.tsx — resolved-case replay & analysis.
//
// Post-mortem ONLY: the API refuses unresolved ids (403), so nothing here can
// leak engine reasoning about a live range. Step-through playback (spacebar /
// → advances one bar) over [context .. range .. resolution] with volume under
// every bar, the range box, terminal-test & breakout markers, and the §8
// effort/result internals — including the RUNNING ratio, so you can watch
// where the engine's verdict tipped.

import { useCallback, useEffect, useState } from "react";
import { X, ChevronRight, FastForward, RotateCcw, AlertTriangle } from "lucide-react";

interface Bar { o: number; h: number; l: number; c: number; v: number; date: string }

interface ReviewData {
  instrument: string;
  suspectVolume: boolean;
  rangeLo: number;
  rangeHi: number;
  contextPct: number | null;
  terminalTest: string;
  stoppingAction: boolean;
  outcome: string;
  engineVerdict: string;
  loggedBlind: boolean;
  traderVerdict: string | null;
  breakoutDate: string;
  bars: Bar[];
  rangeStartIdx: number;
  breakoutIdx: number;
  resolveIdx: number;
  springIdx: number | null;
  upthrustIdx: number | null;
  upEffortPerPoint: number | null;
  dnEffortPerPoint: number | null;
  ratio: number | null;
  runningRatio: (number | null)[];
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const V_COLOR: Record<string, string> = {
  accum: "var(--green)", distrib: "var(--red)", pass: "var(--text-3)", neutral: "var(--text-3)",
  up: "var(--green)", down: "var(--red)", chop: "var(--text-3)",
};
const fmt = (v: number | null, d = 2) => (v == null ? "—" : v.toFixed(d));
const fmtVol = (v: number | null) =>
  v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0);

export default function ReviewDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(0); // bars revealed so far

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/wyckoff/review?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
        setData(j);
        setVisible(j.rangeStartIdx); // context shown; replay begins at the range
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const step = useCallback(() => {
    setVisible((v) => (data ? Math.min(v + 1, data.bars.length) : v));
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "ArrowRight") { e.preventDefault(); step(); }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer-panel" style={{ width: "min(860px, 96vw)", overflow: "auto", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Review — {data?.instrument ?? "…"}
          </h2>
          {data && (
            <span style={{ ...mono, fontSize: 11, color: "var(--text-3)" }}>
              broke out {data.breakoutDate} · resolved {data.outcome.toUpperCase()}
            </span>
          )}
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", display: "flex" }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {data?.suspectVolume && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--red-border)", marginBottom: 12 }}>
            <AlertTriangle size={14} strokeWidth={2} style={{ color: "var(--red)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ ...mono, fontSize: 11, color: "var(--red)" }}>
              Yahoo volume unreliable for this instrument — the engine verdict may reflect bad DATA,
              not bad reasoning. Do not draw a volume lesson here; read the chart on TradingView&apos;s CME feed instead.
            </span>
          </div>
        )}

        {error && <p style={{ ...mono, fontSize: 12, color: "var(--red)" }}>{error}</p>}
        {!data && !error && <p style={{ ...mono, fontSize: 12, color: "var(--text-3)" }}>Loading bars…</p>}

        {data && (
          <>
            <ReplayChart data={data} visible={visible} />

            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 16px", flexWrap: "wrap" }}>
              <button onClick={step} style={btnStyle(true)}>
                <ChevronRight size={13} strokeWidth={2} /> Step
              </button>
              <button onClick={() => setVisible(data.bars.length)} style={btnStyle(false)}>
                <FastForward size={13} strokeWidth={2} /> Reveal all
              </button>
              <button onClick={() => setVisible(data.rangeStartIdx)} style={btnStyle(false)}>
                <RotateCcw size={13} strokeWidth={2} /> Restart
              </button>
              <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
                space / → to step · bar {Math.max(0, visible)}/{data.bars.length}
                {visible > 0 && visible <= data.bars.length ? ` · ${data.bars[visible - 1]?.date ?? ""}` : ""}
              </span>
              <RunningRatio data={data} visible={visible} />
            </div>

            <Summary data={data} visible={visible} />
          </>
        )}
      </aside>
    </>
  );
}

const btnStyle = (primary: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px",
  borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
  fontFamily: "'Sora', sans-serif",
  background: primary ? "var(--accent)" : "var(--border-subtle)",
  color: primary ? "var(--accent-on)" : "var(--text-1)",
  border: primary ? "none" : "1px solid var(--border-strong)",
});

/* ── The replay chart: candles + volume, fixed scales, progressive reveal.
     Hover/drag anywhere on the plot for a crosshair + per-bar tooltip
     (date · OHLC · volume · Δclose · running ratio) — trainer-style. ── */

function ReplayChart({ data, visible }: { data: ReviewData; visible: number }) {
  const W = 900, PH = 300, VH = 90, GAP = 14, PAD = 44;
  const H = PH + GAP + VH;
  const { bars, rangeLo, rangeHi, rangeStartIdx, breakoutIdx, resolveIdx, springIdx, upthrustIdx } = data;
  const n = bars.length;
  const lows = bars.map((b) => b.l), highs = bars.map((b) => b.h);
  const pMin = Math.min(...lows, rangeLo), pMax = Math.max(...highs, rangeHi);
  const pSpan = Math.max(pMax - pMin, 1e-9);
  const vMax = Math.max(...bars.map((b) => b.v), 1);
  const xw = (W - PAD - 8) / n;
  const cw = Math.max(1.5, Math.min(9, xw * 0.62));
  const x = (i: number) => PAD + i * xw + xw / 2;
  const y = (p: number) => 8 + (1 - (p - pMin) / pSpan) * (PH - 16);
  const vy = (v: number) => PH + GAP + (1 - v / vMax) * VH;

  const shown = bars.slice(0, visible);
  const boxEndX = x(Math.min(Math.max(visible - 1, rangeStartIdx), breakoutIdx));

  // ── Crosshair state: pointer position → revealed bar index ──
  const [hover, setHover] = useState<number | null>(null);
  const toIndex = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xv = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round((xv - PAD - xw / 2) / xw);
    return i >= 0 && i < visible ? i : null;
  };
  const hb = hover != null ? bars[hover] : null;
  const digits = rangeHi < 10 ? 4 : 2;

  return (
    <div className="card" style={{ padding: 10, position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", display: "block", touchAction: "none", cursor: "crosshair" }}
        onPointerMove={(e) => setHover(toIndex(e))}
        onPointerDown={(e) => setHover(toIndex(e))}
        onPointerLeave={() => setHover(null)}
      >
        {/* price gridline labels */}
        {[rangeHi, rangeLo].map((p, i) => (
          <text key={i} x={4} y={y(p) + 3} fontSize={9} fill="var(--text-3)" fontFamily="'DM Mono', monospace">
            {p < 10 ? p.toFixed(4) : p.toFixed(2)}
          </text>
        ))}
        {/* range box: floor + ceiling from range start to breakout (revealed portion) */}
        {visible > rangeStartIdx && (
          <>
            <line x1={x(rangeStartIdx)} y1={y(rangeHi)} x2={boxEndX} y2={y(rangeHi)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
            <line x1={x(rangeStartIdx)} y1={y(rangeLo)} x2={boxEndX} y2={y(rangeLo)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
          </>
        )}
        {/* candles + volume */}
        {shown.map((b, i) => {
          const up = b.c >= b.o;
          const col = up ? "var(--green)" : "var(--red)";
          const bodyTop = y(Math.max(b.o, b.c));
          const bodyH = Math.max(1, Math.abs(y(b.o) - y(b.c)));
          const inCtx = i < rangeStartIdx;
          return (
            <g key={i} opacity={inCtx ? 0.55 : 1}>
              <line x1={x(i)} y1={y(b.h)} x2={x(i)} y2={y(b.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={bodyH} fill={col} />
              <rect x={x(i) - cw / 2} y={vy(b.v)} width={cw} height={PH + GAP + VH - vy(b.v)} fill={col} opacity={0.45} />
            </g>
          );
        })}
        {/* markers appear as the replay reaches them */}
        {springIdx != null && visible > springIdx && (
          <Marker x={x(springIdx)} y={y(bars[springIdx].l) + 12} label="S" title="spring" color="var(--green)" />
        )}
        {upthrustIdx != null && visible > upthrustIdx && (
          <Marker x={x(upthrustIdx)} y={y(bars[upthrustIdx].h) - 6} label="U" title="upthrust" color="var(--red)" />
        )}
        {visible > breakoutIdx && (
          <Marker x={x(breakoutIdx)} y={y(bars[breakoutIdx].h) - 6} label="B" title="breakout" color="var(--accent)" />
        )}
        {visible > resolveIdx && (
          <Marker x={x(resolveIdx)} y={y(bars[resolveIdx].h) - 6} label={data.outcome === "up" ? "↑" : data.outcome === "down" ? "↓" : "·"} title="outcome" color={V_COLOR[data.outcome]} />
        )}

        {/* ── Crosshair ── */}
        {hover != null && hb && (
          <g pointerEvents="none">
            <line x1={x(hover)} y1={4} x2={x(hover)} y2={H} stroke="var(--text-3)" strokeWidth={0.8} strokeDasharray="3 3" opacity={0.7} />
            <line x1={PAD - 4} y1={y(hb.c)} x2={W - 6} y2={y(hb.c)} stroke="var(--text-3)" strokeWidth={0.6} strokeDasharray="2 4" opacity={0.45} />
            <circle cx={x(hover)} cy={y(hb.c)} r={3.2} fill="var(--accent)" stroke="var(--bg-card, #0a0b0f)" strokeWidth={1.2} />
            <rect x={x(hover) - cw / 2 - 1.5} y={vy(hb.v) - 1.5} width={cw + 3} height={PH + GAP + VH - vy(hb.v) + 1.5} fill="none" stroke="var(--accent)" strokeWidth={1} opacity={0.9} />
            <text x={4} y={y(hb.c) + 3} fontSize={9} fill="var(--accent)" fontFamily="'DM Mono', monospace">
              {hb.c.toFixed(digits)}
            </text>
          </g>
        )}
      </svg>

      {/* ── Tooltip (flips side past mid-chart) ── */}
      {hover != null && hb && (
        <div
          style={{
            position: "absolute", top: 14, pointerEvents: "none", zIndex: 5,
            ...(x(hover) / W < 0.58
              ? { left: `calc(${(x(hover) / W) * 100}% + 14px)` }
              : { right: `calc(${100 - (x(hover) / W) * 100}% + 14px)` }),
            background: "var(--bg-elevated, var(--bg-card-raised, #14161d))",
            border: "1px solid var(--border-strong)", borderRadius: 9,
            padding: "8px 11px", boxShadow: "0 6px 22px rgba(0,0,0,0.45)",
            fontFamily: "'DM Mono', monospace", fontSize: 10.5, lineHeight: 1.65,
            color: "var(--text-2)", whiteSpace: "nowrap",
          }}
        >
          <div style={{ color: "var(--text-1)", fontWeight: 500 }}>
            {hb.date}
            <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
              {" "}· {hover < rangeStartIdx ? "context" : hover < breakoutIdx ? `range bar ${hover - rangeStartIdx + 1}` : hover === breakoutIdx ? "breakout" : "resolution"}
            </span>
          </div>
          <div>
            O {hb.o.toFixed(digits)} · H {hb.h.toFixed(digits)} · L {hb.l.toFixed(digits)} · C{" "}
            <span style={{ color: hb.c >= hb.o ? "var(--green)" : "var(--red)" }}>{hb.c.toFixed(digits)}</span>
          </div>
          <div>
            vol <span style={{ color: "var(--text-1)" }}>{fmtVol(hb.v)}</span>
            {hover > 0 && (() => {
              const d = hb.c - bars[hover - 1].c;
              return (
                <span style={{ color: d >= 0 ? "var(--green)" : "var(--red)" }}>
                  {"  "}Δ {d >= 0 ? "+" : ""}{d.toFixed(digits)}
                </span>
              );
            })()}
            {data.runningRatio[hover] != null && (
              <span style={{ color: "var(--text-3)" }}>{"  "}ratio {data.runningRatio[hover]!.toFixed(3)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Marker({ x, y, label, title, color }: { x: number; y: number; label: string; title: string; color: string }) {
  return (
    <g>
      <title>{title}</title>
      <circle cx={x} cy={y} r={7.5} fill="var(--bg-sidebar, #0a0b0f)" stroke={color} strokeWidth={1.2} />
      <text x={x} y={y + 3.2} fontSize={9} fontWeight={700} fill={color} textAnchor="middle" fontFamily="'DM Mono', monospace">{label}</text>
    </g>
  );
}

/* ── Live running ratio while stepping through the range ── */

function RunningRatio({ data, visible }: { data: ReviewData; visible: number }) {
  let current: number | null = null;
  for (let k = Math.min(visible, data.runningRatio.length) - 1; k >= 0; k--) {
    if (data.runningRatio[k] != null) { current = data.runningRatio[k]; break; }
  }
  if (current == null) return null;
  const tone = current >= 1.12 ? "var(--red)" : current <= 0.89 ? "var(--green)" : "var(--text-2)";
  const lean = current >= 1.12 ? "→ distrib zone" : current <= 0.89 ? "→ accum zone" : "neutral zone";
  return (
    <span style={{ ...mono, fontSize: 11, marginLeft: "auto", color: tone }}>
      running effort/result ratio {current.toFixed(3)} {lean}
    </span>
  );
}

/* ── Summary + the analysis prompt ── */

function Summary({ data, visible }: { data: ReviewData; visible: number }) {
  const done = visible >= data.bars.length;
  const chip = (label: string, v: string | null, color?: string) => (
    <span style={{ ...mono, fontSize: 11, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border-strong)", color: color ?? "var(--text-2)" }}>
      {label}: <b>{v ?? "—"}</b>
    </span>
  );
  const q =
    data.springIdx != null
      ? "Did the stab below support come on volume that got ABSORBED — demand stepping in, price reclaiming with conviction — or on thin/continuation volume with no real demand behind the reclaim? The engine's whole-range average cannot tell these apart. Can you?"
      : data.upthrustIdx != null
        ? "Did the poke above resistance attract real demand, or was the volume there SUPPLY being distributed into the breakout — effort with no upward result? The engine's whole-range average cannot tell these apart. Can you?"
        : "No terminal test printed — what in the bar-by-bar effort/result told you which side was absorbing before the break? That is what the whole-range ratio flattens.";

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <p className="kicker" style={{ margin: "0 0 8px" }}>Post-mortem</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {chip("engine", data.engineVerdict.toUpperCase(), V_COLOR[data.engineVerdict])}
        {chip("your read", data.traderVerdict ? data.traderVerdict.toUpperCase() : "none", data.traderVerdict ? V_COLOR[data.traderVerdict] : undefined)}
        {chip("outcome", data.outcome.toUpperCase(), V_COLOR[data.outcome])}
        {!data.loggedBlind && chip("sample", "seed — excluded from score")}
      </div>
      <div style={{ ...mono, fontSize: 11, color: "var(--text-2)", display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12 }}>
        <span>up effort/point <b>{fmtVol(data.upEffortPerPoint)}</b></span>
        <span>down effort/point <b>{fmtVol(data.dnEffortPerPoint)}</b></span>
        <span>final ratio <b>{fmt(data.ratio, 3)}</b> <span style={{ color: "var(--text-3)" }}>(≥1.12 distrib · ≤0.89 accum)</span></span>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: done ? "var(--text-1)" : "var(--text-3)", lineHeight: 1.55 }}>
        {done ? q : "Step through to the end, then sit with the question…"}
      </p>
    </div>
  );
}
