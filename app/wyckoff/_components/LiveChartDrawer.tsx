"use client";
// app/wyckoff/_components/LiveChartDrawer.tsx — read a LIVE candidate's chart.
//
// Price + volume + range structure for an unresolved candidate, so the read
// can start on the dashboard (TradingView remains the confirmation source —
// the footer names the exact symbol to pull up).
//
// THE WALL, client side: this component renders ONLY market data and facts the
// trader payload already discloses. No engine verdict, no effort numbers, no
// running ratio — grep this file: those fields don't exist here. Post-mortem
// internals belong to ReviewDrawer, which the API restricts to resolved rows.

import { useEffect, useState } from "react";
import { X, AlertTriangle, ExternalLink } from "lucide-react";

interface Bar { o: number; h: number; l: number; c: number; v: number; date: string }

interface LiveChart {
  instrument: string;
  suspectVolume: boolean;
  rangeLo: number;
  rangeHi: number;
  contextPct: number | null;
  terminalTest: string;
  stoppingAction: boolean;
  status: "open" | "broken";
  breakoutDate: string | null;
  traderVerdict: string | null;
  bars: Bar[];
  rangeStartIdx: number;
  breakoutIdx: number | null;
  springIdx: number | null;
  upthrustIdx: number | null;
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmtVol = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0);

// TradingView mapping: futures read on the continuous contract; three currency
// futures are quoted INVERTED versus their MT4 pairs.
const FUTURES = new Set(["6E", "6B", "6A", "6C", "6J", "6S", "6N", "ES", "NQ", "YM", "RTY", "GC", "SI", "HG", "CL", "NG"]);
const INVERTED: Record<string, string> = { "6C": "USDCAD", "6J": "USDJPY", "6S": "USDCHF" };
const tvSymbol = (s: string) => (FUTURES.has(s) ? `${s}1!` : s);

export default function LiveChartDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<LiveChart | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/wyckoff/chart?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
        setData(j);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer-panel" style={{ width: "min(860px, 96vw)", overflow: "auto", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{data?.instrument ?? "…"} — live read</h2>
          {data && (
            <span style={{ ...mono, fontSize: 11, color: data.status === "open" ? "var(--accent)" : "var(--text-3)" }}>
              {data.status === "open" ? "OPEN — decision live" : `broke out ${data.breakoutDate}`}
            </span>
          )}
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", display: "flex" }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {data?.suspectVolume && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--amber-border, var(--border-strong))", marginBottom: 12 }}>
            <AlertTriangle size={14} strokeWidth={2} style={{ color: "var(--amber)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ ...mono, fontSize: 11, color: "var(--amber)" }}>
              Yahoo volume is unreliable for this instrument — the volume bars below are NOT a valid
              effort read. Do the volume read on TradingView&apos;s CME feed; use this chart for price structure only.
            </span>
          </div>
        )}

        {error && <p style={{ ...mono, fontSize: 12, color: "var(--red)" }}>{error}</p>}
        {!data && !error && <p style={{ ...mono, fontSize: 12, color: "var(--text-3)" }}>Loading bars…</p>}

        {data && (
          <>
            <LiveChartSvg data={data} />
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
              <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>
                <span style={{ color: "var(--text-3)" }}>confirm on TradingView: </span>
                <b>{tvSymbol(data.instrument)}</b>
                {INVERTED[data.instrument] && (
                  <span style={{ color: "var(--amber)" }}> · inverse of {INVERTED[data.instrument]} — the read flips on MT4</span>
                )}
                <ExternalLink size={11} strokeWidth={2} style={{ marginLeft: 5, verticalAlign: "-1px", color: "var(--text-3)" }} />
              </span>
              <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginLeft: "auto" }}>
                daily bars · data through {data.bars[data.bars.length - 1]?.date} · lock your read on the card
              </span>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

/* ── Chart: full reveal, crosshair with OHLC + volume. No engine anything. ── */

function LiveChartSvg({ data }: { data: LiveChart }) {
  const W = 900, PH = 300, VH = 90, GAP = 14, PAD = 44;
  const H = PH + GAP + VH;
  const { bars, rangeLo, rangeHi, rangeStartIdx, breakoutIdx, springIdx, upthrustIdx } = data;
  const n = bars.length;
  const pMin = Math.min(...bars.map((b) => b.l), rangeLo);
  const pMax = Math.max(...bars.map((b) => b.h), rangeHi);
  const pSpan = Math.max(pMax - pMin, 1e-9);
  const vMax = Math.max(...bars.map((b) => b.v), 1);
  const xw = (W - PAD - 8) / n;
  const cw = Math.max(1.5, Math.min(9, xw * 0.62));
  const x = (i: number) => PAD + i * xw + xw / 2;
  const y = (p: number) => 8 + (1 - (p - pMin) / pSpan) * (PH - 16);
  const vy = (v: number) => PH + GAP + (1 - v / vMax) * VH;
  const boxEnd = breakoutIdx ?? n - 1;
  const digits = rangeHi < 10 ? 4 : 2;

  const [hover, setHover] = useState<number | null>(null);
  const toIndex = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xv = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round((xv - PAD - xw / 2) / xw);
    return i >= 0 && i < n ? i : null;
  };
  const hb = hover != null ? bars[hover] : null;

  return (
    <div className="card" style={{ padding: 10, position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", display: "block", touchAction: "none", cursor: "crosshair" }}
        onPointerMove={(e) => setHover(toIndex(e))}
        onPointerDown={(e) => setHover(toIndex(e))}
        onPointerLeave={() => setHover(null)}
      >
        {[rangeHi, rangeLo].map((p, i) => (
          <text key={i} x={4} y={y(p) + 3} fontSize={9} fill="var(--text-3)" fontFamily="'DM Mono', monospace">
            {p.toFixed(digits)}
          </text>
        ))}
        <line x1={x(rangeStartIdx)} y1={y(rangeHi)} x2={x(boxEnd)} y2={y(rangeHi)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        <line x1={x(rangeStartIdx)} y1={y(rangeLo)} x2={x(boxEnd)} y2={y(rangeLo)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        {bars.map((b, i) => {
          const up = b.c >= b.o;
          const col = up ? "var(--green)" : "var(--red)";
          const bodyTop = y(Math.max(b.o, b.c));
          const bodyH = Math.max(1, Math.abs(y(b.o) - y(b.c)));
          return (
            <g key={i} opacity={i < rangeStartIdx ? 0.55 : 1}>
              <line x1={x(i)} y1={y(b.h)} x2={x(i)} y2={y(b.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={bodyH} fill={col} />
              <rect x={x(i) - cw / 2} y={vy(b.v)} width={cw} height={PH + GAP + VH - vy(b.v)} fill={col} opacity={0.45} />
            </g>
          );
        })}
        {springIdx != null && (
          <ChartMarker x={x(springIdx)} y={y(bars[springIdx].l) + 12} label="S" title="spring" />
        )}
        {upthrustIdx != null && (
          <ChartMarker x={x(upthrustIdx)} y={y(bars[upthrustIdx].h) - 6} label="U" title="upthrust" />
        )}
        {breakoutIdx != null && (
          <ChartMarker x={x(breakoutIdx)} y={y(bars[breakoutIdx].h) - 6} label="B" title="breakout" />
        )}
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
              {" "}· {hover < rangeStartIdx ? "context" : breakoutIdx != null && hover > breakoutIdx ? "post-break" : hover === breakoutIdx ? "breakout" : `range bar ${hover - rangeStartIdx + 1}`}
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
          </div>
        </div>
      )}
    </div>
  );
}

/* Neutral marker — accent ring, no direction color (live = no hints). */
function ChartMarker({ x, y, label, title }: { x: number; y: number; label: string; title: string }) {
  return (
    <g>
      <title>{title}</title>
      <circle cx={x} cy={y} r={7.5} fill="var(--bg-sidebar, #0a0b0f)" stroke="var(--accent)" strokeWidth={1.2} />
      <text x={x} y={y + 3.2} fontSize={9} fontWeight={700} fill="var(--accent)" textAnchor="middle" fontFamily="'DM Mono', monospace">{label}</text>
    </g>
  );
}
