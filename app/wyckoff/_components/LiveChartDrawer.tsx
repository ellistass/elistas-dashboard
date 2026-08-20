"use client";
// app/wyckoff/_components/LiveChartDrawer.tsx — read a LIVE candidate's chart.
//
// Price + volume + range structure for an unresolved candidate, so the read
// can start on the dashboard (TradingView remains the confirmation source —
// the footer names the exact symbol to pull up).
//
// It is also where an alert level is set: arm "Set alert", click the price you
// care about, and the level is drawn on the chart and armed server-side. The
// nightly scan checks it against that day's bar — no intraday polling, and no
// need to remember the number yourself.
//
// THE WALL, client side: this component renders ONLY market data and facts the
// trader payload already discloses. No engine verdict, no effort numbers, no
// running ratio — grep this file: those fields don't exist here. Post-mortem
// internals belong to ReviewDrawer, which the API restricts to resolved rows.

import { useEffect, useState } from "react";
import { volumeView, isPlottableTag } from "@/lib/chart/volume";
import { aggregateBars, indexForDate, TIMEFRAME_LABEL, type Timeframe } from "@/lib/chart/timeframe";
import { describePace, type PaceRead } from "@/lib/wyckoff/pace";
import { X, AlertTriangle, ExternalLink, Bell, BellRing, Crosshair, Lock, ShieldCheck } from "lucide-react";

interface Bar { o: number; h: number; l: number; c: number; v: number; date: string }

interface LiveChart {
  id: string;
  instrument: string;
  watch: string | null;
  watchNote: string | null;
  alertPrice: number | null;
  alertHitAt: string | null;
  resolved: boolean;
  suspectVolume: boolean;
  rangeLo: number;
  rangeHi: number;
  contextPct: number | null;
  terminalTest: string;
  stoppingAction: boolean;
  status: "open" | "broken";
  breakoutDate: string | null;
  traderVerdict: string | null;
  traderReadAt: string | null;
  readable: boolean;
  bars: Bar[];
  rangeStartIdx: number;
  breakoutIdx: number | null;
  springIdx: number | null;
  upthrustIdx: number | null;
  /** Pace WITHOUT the directional lean — the API strips it for live rows. */
  pace?: Omit<PaceRead, "lean"> | null;
  surfacedBarDate: string | null;
  surfacedReason: string | null;
  testBarDate: string | null;
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmtVol = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0);
const verdictLabel = (v: string) => (v === "accum" ? "ACCUM" : v === "distrib" ? "DISTRIB" : "PASS");
const verdictColor = (v: string) => v === "accum" ? "var(--green)" : v === "distrib" ? "var(--red)" : "var(--text-3)";
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

// TradingView + execute mapping come from the instrument config — one source
// of truth (lib/wyckoff/basket) for feed symbol, CFD/spot, and inversion.
import { instrumentInfo, tradingViewSymbol } from "@/lib/wyckoff/basket";

export default function LiveChartDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<LiveChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<number | null>(null);
  const [arming, setArming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alertErr, setAlertErr] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<"accum" | "distrib" | "pass" | null>(null);
  const [tf, setTf] = useState<Timeframe>("D");
  const [readBusy, setReadBusy] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  // Effort marks are an AID, not a leak: ABSORB/CLIMAX use only bars already on
  // screen, no lookahead. But "blind" only means something if the aid set is
  // constant across reads, so they default OFF on the live chart and stay a
  // deliberate choice. (Persisting which aids were on at lock time is the next
  // step if the benchmark is ever to segment aided from unaided reads.)
  const [showEffort, setShowEffort] = useState(false);

  // Writes the level and arms it. Only bars AFTER today can trigger it, so
  // setting a level at a price already trading today won't ping tonight.
  async function saveAlert(price: number | null) {
    setSaving(true);
    setAlertErr(null);
    try {
      const res = await fetch("/api/wyckoff/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, alertPrice: price }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      setAlert(price);
      onChanged?.();
    } catch (e) {
      setAlertErr(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
    setArming(false);
  }

  async function lockRead() {
    if (!verdict || !data || readBusy) return;
    setReadBusy(true);
    setReadErr(null);
    try {
      const res = await fetch("/api/wyckoff/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, verdict }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      const readAt = j.locked?.readAt ?? new Date().toISOString();
      setData({ ...data, traderVerdict: verdict, traderReadAt: readAt, readable: false });
      onChanged?.();
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : String(e));
    }
    setReadBusy(false);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/wyckoff/chart?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
        setData(j);
        setAlert(j.alertPrice ?? null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc backs out of arming first — closing the whole drawer on a stray Esc
      // mid-placement would be the wrong kind of surprise.
      if (arming) { setArming(false); return; }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, arming]);

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
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", display: "flex" }}>
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
            <ReadControl
              data={data}
              verdict={verdict}
              busy={readBusy}
              error={readErr}
              onVerdict={setVerdict}
              onLock={lockRead}
            />

            {/* ── Alert level control ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 10 }}>
              {alert != null ? (
                <>
                  <span style={{
                    ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11,
                    padding: "5px 11px", borderRadius: 999,
                    border: `1px solid ${data.alertHitAt ? "var(--accent)" : "var(--border-strong)"}`,
                    color: data.alertHitAt ? "var(--accent)" : "var(--text-1)",
                  }}>
                    {data.alertHitAt ? <BellRing size={12} strokeWidth={2} /> : <Bell size={12} strokeWidth={2} />}
                    alert {alert.toFixed(data.rangeHi < 10 ? 4 : 2)}
                    {data.alertHitAt && " · already touched"}
                  </span>
                  <SmallBtn onClick={() => setArming(true)} disabled={saving} active={arming}>
                    <Crosshair size={11} strokeWidth={2} /> {arming ? "click a price…" : "Move"}
                  </SmallBtn>
                  <SmallBtn onClick={() => saveAlert(null)} disabled={saving}>
                    <X size={11} strokeWidth={2} /> Clear
                  </SmallBtn>
                </>
              ) : (
                <SmallBtn onClick={() => setArming((v) => !v)} disabled={saving || data.resolved} active={arming}>
                  <Crosshair size={11} strokeWidth={2} />
                  {arming ? "click a price on the chart…" : "Set alert level"}
                </SmallBtn>
              )}
              {!data.suspectVolume && (
                <SmallBtn onClick={() => setShowEffort((v) => !v)} active={showEffort}>
                  effort marks {showEffort ? "on" : "off"}
                </SmallBtn>
              )}
              <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
                {arming
                  ? "click the price you want flagged · snaps to the box edges · Esc to cancel"
                  : "checked once a day against the close bar — reported in the 21:15 digest"}
              </span>
              {alertErr && <span style={{ ...mono, fontSize: 10.5, color: "var(--red)" }}>{alertErr}</span>}
            </div>

            {/* Timeframe. Weekly and monthly are derived from the daily
                series already loaded — first open, max high, min low, last
                close, summed volume — so switching costs nothing and works on
                every case, including ones resolved months ago. Intraday is a
                different problem: a daily bar cannot be split, so it would need
                its own fetch and could never exist for older cases. */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
              <div className="seg" style={{ display: "inline-flex" }}>
                {(["D", "W", "M"] as const).map((t) => (
                  <button key={t} type="button" className={tf === t ? "on" : ""} onClick={() => setTf(t)}>
                    {TIMEFRAME_LABEL[t]}
                  </button>
                ))}
              </div>
              <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
                {tf === "D"
                  ? "daily bars as scanned"
                  : "rolled up from the daily series — markers keep their place"}
              </span>
            </div>

            <LiveChartSvg
              data={data}
              tf={tf}
              alert={alert}
              arming={arming}
              showEffort={showEffort}
              onPick={(p) => saveAlert(p)}
            />
            {/* Pace — effort and result in TIME. Stated as an asymmetry, never
                as a direction: naming a side here would hand over a verdict
                before you have read the chart. Most useful precisely when this
                instrument's volume feed is one of the unreliable ones. */}
            {data.pace?.ratio != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <span style={{ ...mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
                  pace
                </span>
                <span style={{ ...mono, fontSize: 11, color: "var(--text-1)" }}>
                  {describePace({ ...data.pace, lean: null })}
                </span>
                <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
                  bars per point — up {data.pace.upBarsPerUnit?.toPrecision(3)} · down {data.pace.dnBarsPerUnit?.toPrecision(3)}
                  {data.suspectVolume && " · time still works where this feed's volume does not"}
                </span>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
              <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>
                <span style={{ color: "var(--text-3)" }}>confirm on TradingView: </span>
                <b>{tradingViewSymbol(data.instrument)}</b>
                {(() => {
                  const inst = instrumentInfo(data.instrument);
                  if (!inst || !inst.executeSymbol || inst.executeSymbol === data.instrument) return null;
                  return inst.inverted ? (
                    <span style={{ color: "var(--amber)" }}>
                      {" "}· execute on {inst.executeSymbol} — INVERTED, your locked read auto-translates
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-3)" }}> · execute on {inst.executeSymbol}</span>
                  );
                })()}
                <ExternalLink size={11} strokeWidth={2} style={{ marginLeft: 5, verticalAlign: "-1px", color: "var(--text-3)" }} />
              </span>
              <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginLeft: "auto" }}>
                daily bars · data through {data.bars[data.bars.length - 1]?.date}
              </span>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

/* ── Chart: full reveal, crosshair with OHLC + volume. No engine anything. ── */

function ReadControl({
  data,
  verdict,
  busy,
  error,
  onVerdict,
  onLock,
}: {
  data: LiveChart;
  verdict: "accum" | "distrib" | "pass" | null;
  busy: boolean;
  error: string | null;
  onVerdict: (v: "accum" | "distrib" | "pass") => void;
  onLock: () => void;
}) {
  if (data.traderVerdict) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{
          ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11,
          padding: "5px 11px", borderRadius: 999, border: "1px solid var(--border-strong)",
          color: verdictColor(data.traderVerdict),
        }}>
          <ShieldCheck size={12} strokeWidth={2} />
          {verdictLabel(data.traderVerdict)} · locked {day(data.traderReadAt)}
        </span>
      </div>
    );
  }

  if (!data.readable || data.resolved) {
    return (
      <p style={{ ...mono, fontSize: 10.5, color: "var(--text-3)", margin: "0 0 10px", lineHeight: 1.5 }}>
        decision point passed — watching only. A read logged now would not be blind.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 10 }}>
      <div className="seg" style={{ display: "inline-flex" }}>
        {(["accum", "distrib", "pass"] as const).map((v) => (
          <button key={v} type="button" className={verdict === v ? "on" : ""} onClick={() => onVerdict(v)}>
            {verdictLabel(v)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onLock}
        disabled={!verdict || busy}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px",
          borderRadius: 8, border: "none", background: verdict ? "var(--accent)" : "var(--border-subtle)",
          color: verdict ? "var(--accent-on)" : "var(--text-3)", fontSize: 12, fontWeight: 600,
          cursor: verdict && !busy ? "pointer" : "default", opacity: busy ? 0.6 : 1,
          fontFamily: "'Sora', sans-serif",
        }}
      >
        <Lock size={12} strokeWidth={2} />
        {busy ? "Locking..." : "Lock read"}
      </button>
      <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>one shot · blind · immutable</span>
      {error && <span style={{ ...mono, fontSize: 10.5, color: "var(--red)" }}>{error}</span>}
    </div>
  );
}

function SmallBtn({ children, onClick, disabled, active }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "'DM Mono', monospace",
        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5,
        padding: "5px 11px", borderRadius: 999, cursor: disabled ? "default" : "pointer",
        border: `1px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
        background: active ? "var(--accent-dim, transparent)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-1)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function LiveChartSvg({ data, tf, alert, arming, showEffort, onPick }: {
  data: LiveChart; tf: Timeframe; alert: number | null; arming: boolean; showEffort: boolean;
  onPick: (price: number) => void;
}) {
  const W = 900, PH = 300, VH = 90, GAP = 14, PAD = 44;
  const H = PH + GAP + VH;
  const { rangeLo, rangeHi } = data;

  // Every index the API sends (range start, breakout, spring, upthrust) points
  // into the DAILY series. Rolling up invalidates all of them, so they are
  // converted to dates first and re-located in the aggregated series. Without
  // this, switching to weekly silently moves the range box and the markers to
  // whatever happens to sit at the old index.
  const dailyBars = data.bars;
  const bars = tf === "D" ? dailyBars : aggregateBars(dailyBars, tf);
  const dateAt = (i: number | null | undefined): string | null =>
    i != null && i >= 0 && dailyBars[i] ? dailyBars[i].date : null;
  const reloc = (i: number | null | undefined): number | null => {
    if (i == null || i < 0) return null;
    if (tf === "D") return i;
    const j = indexForDate(bars, tf, dateAt(i));
    return j < 0 ? null : j;
  };
  const rangeStartIdx = Math.max(0, reloc(data.rangeStartIdx) ?? 0);
  const breakoutIdx = reloc(data.breakoutIdx);
  const springIdx = reloc(data.springIdx);
  const upthrustIdx = reloc(data.upthrustIdx);
  const n = bars.length;
  const pMin = Math.min(...bars.map((b) => b.l), rangeLo);
  const pMax = Math.max(...bars.map((b) => b.h), rangeHi);
  const pSpan = Math.max(pMax - pMin, 1e-9);
  // Volume pane: clipped ceiling + effort shading. On instruments whose feed we
  // do not trust, `trusted:false` renders volume flat and grey and suppresses
  // the MA and effort marks entirely — brightening a bar READS as information,
  // and doing that on a feed we have called unreliable would be a lie told
  // confidently.
  const vol = volumeView(bars, { trusted: !data.suspectVolume });
  const vMax = vol.maxV;
  const xw = (W - PAD - 8) / n;
  const cw = Math.max(1.5, Math.min(9, xw * 0.62));
  const x = (i: number) => PAD + i * xw + xw / 2;
  const y = (p: number) => 8 + (1 - (p - pMin) / pSpan) * (PH - 16);
  const vy = (v: number) => PH + GAP + (1 - v / vMax) * VH;
  const boxEnd = breakoutIdx ?? n - 1;
  const digits = rangeHi < 10 ? 4 : 2;

  const [hover, setHover] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ xPct: number; yPct: number } | null>(null);
  const [ghost, setGhost] = useState<number | null>(null); // level under the cursor while arming
  const toPoint = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      xPct: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      yPct: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };
  const toIndex = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xv = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round((xv - PAD - xw / 2) / xw);
    return i >= 0 && i < n ? i : null;
  };
  const hb = hover != null ? bars[hover] : null;

  // Inverse of y(): screen position back to a price, with a 7px magnet on the
  // two levels that actually matter in a range so "the top of the box" is one
  // click rather than a pixel-hunt.
  const toPrice = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const yv = ((e.clientY - rect.top) / rect.height) * H;
    if (yv < 4 || yv > PH + 4) return null; // price pane only, not the volume strip
    const raw = pMin + (1 - (yv - 8) / (PH - 16)) * pSpan;
    for (const edge of [rangeHi, rangeLo]) {
      if (Math.abs(y(edge) - yv) <= 7) return edge;
    }
    const step = pSpan / 4000;
    return Math.round(raw / step) * step;
  };

  return (
    <div className="card" style={{ padding: 10, position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", display: "block", touchAction: "none", cursor: "crosshair" }}
        onPointerMove={(e) => {
          setHover(toIndex(e));
          setHoverPos(toPoint(e));
          if (arming) setGhost(toPrice(e));
        }}
        onPointerDown={(e) => {
          setHoverPos(toPoint(e));
          if (arming) {
            const p = toPrice(e);
            if (p != null && p > 0) onPick(p);
            return;
          }
          setHover(toIndex(e));
        }}
        onPointerLeave={() => { setHover(null); setHoverPos(null); setGhost(null); }}
      >
        {[rangeHi, rangeLo].map((p, i) => (
          <text key={i} x={4} y={y(p) + 3} fontSize={9} fill="var(--text-3)" fontFamily="'DM Mono', monospace">
            {p.toFixed(digits)}
          </text>
        ))}
        <line x1={x(rangeStartIdx)} y1={y(rangeHi)} x2={x(boxEnd)} y2={y(rangeHi)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        <line x1={x(rangeStartIdx)} y1={y(rangeLo)} x2={x(boxEnd)} y2={y(rangeLo)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />

        {/* ── Where the scanner spoke ──
            The bar this landed on your desk. The distance from this line to
            the breakout is the warning you actually got. Drawn rather than
            tabulated, because "was it early or late" is a question the eye
            answers faster than a column of numbers does. Amber when the marker
            sits at or past the breakout: reading it then was never a live
            decision. */}
        {(() => {
          if (!data.surfacedBarDate) return null;
          const key = data.surfacedBarDate.slice(0, 10);
          const si = bars.findIndex((b) => b.date.slice(0, 10) === key);
          if (si < 0) return null;
          const late = breakoutIdx != null && si >= breakoutIdx;
          const col = late ? "var(--amber)" : "var(--accent)";
          const lead = breakoutIdx != null ? breakoutIdx - si : null;
          return (
            <g pointerEvents="none">
              <line x1={x(si)} y1={0} x2={x(si)} y2={PH + GAP + VH} stroke={col} strokeWidth={1} strokeDasharray="3 3" opacity={0.75} />
              <polygon points={`${x(si) - 4},0 ${x(si) + 4},0 ${x(si)},6`} fill={col} />
              <text x={x(si) + 6} y={11} fontSize={9} fill={col} fontFamily="'DM Mono', monospace">
                {late ? "surfaced — already broke out" : lead != null ? `surfaced · ${lead} bars before the break` : "surfaced"}
              </text>
            </g>
          );
        })()}

        {bars.map((b, i) => {
          const up = b.c >= b.o;
          const col = up ? "var(--green)" : "var(--red)";
          const bodyTop = y(Math.max(b.o, b.c));
          const bodyH = Math.max(1, Math.abs(y(b.o) - y(b.c)));
          return (
            <g key={i} opacity={i < rangeStartIdx ? 0.55 : 1}>
              <line x1={x(i)} y1={y(b.h)} x2={x(i)} y2={y(b.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={bodyH} fill={col} />
              {/* Volume as EFFORT: opacity from the ratio to the 20-bar mean,
                  so a large print glows against a dim tape instead of being
                  judged by height against whatever the tallest bar happens to
                  be. Colour still carries direction. */}
              <rect
                x={x(i) - cw / 2}
                y={vy(Math.min(b.v, vol.maxV))}
                width={cw}
                height={PH + GAP + VH - vy(Math.min(b.v, vol.maxV))}
                fill={col}
                opacity={vol.alphaAt(i)}
              />
              {/* A clipped bar is taller than shown — say so rather than
                  quietly presenting a shortened bar as the whole story. */}
              {vol.clipped(b.v) && (
                <rect x={x(i) - cw / 2} y={PH + GAP} width={cw} height={2} fill="var(--amber)" />
              )}
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
        {/* ── Volume MA + effort marks ─────────────────────────────────────
            The reference line is what makes "big volume" mean anything: without
            it the eye compares each bar to the tallest one on screen, which
            changes every time the window moves. Suppressed on untrusted feeds. */}
        {vol.trusted && bars.length > 2 && (
          <>
            <polyline
              fill="none"
              stroke="var(--amber)"
              strokeWidth={1.2}
              opacity={0.7}
              points={bars.map((_, i) => `${x(i)},${vy(Math.min(vol.ma[i], vol.maxV))}`).join(" ")}
            />
            <text x={PAD + 4} y={PH + GAP + 9} fontSize={8.5} fill="var(--amber)" opacity={0.65} fontFamily="'DM Mono', monospace">
              vol MA{vol.maN}
            </text>
          </>
        )}
        {showEffort && vol.trusted && bars.map((_, i) => {
          const er = vol.effortAt(i);
          if (!er || !isPlottableTag(er.tag)) return null;
          // ABSORB = heavy effort with no result, someone eating the flow.
          // CLIMAX = heavy effort with a wide result.
          return (
            <circle
              key={`er${i}`}
              cx={x(i)}
              cy={PH + GAP - 4}
              r={2.2}
              fill={er.tag === "CLIMAX" ? "var(--amber)" : "var(--green)"}
            >
              <title>{`${er.tag} — ${er.desc} (vol ${er.vr.toFixed(2)}x, spread ${er.sr.toFixed(2)}x)`}</title>
            </circle>
          );
        })}
        {/* Armed alert level — drawn across the whole price pane so it reads as
            a standing instruction, not a marker tied to one bar. */}
        {alert != null && alert >= pMin && alert <= pMax && (
          <g pointerEvents="none">
            <line x1={PAD - 6} y1={y(alert)} x2={W - 6} y2={y(alert)} stroke="var(--accent)" strokeWidth={1.1} strokeDasharray="6 4" opacity={0.9} />
            <text x={W - 8} y={y(alert) - 4} fontSize={9} fill="var(--accent)" textAnchor="end" fontFamily="'DM Mono', monospace">
              alert {alert.toFixed(digits)}
            </text>
          </g>
        )}
        {arming && ghost != null && (
          <g pointerEvents="none">
            <line x1={PAD - 6} y1={y(ghost)} x2={W - 6} y2={y(ghost)} stroke="var(--accent)" strokeWidth={0.9} opacity={0.45} />
            <text x={W - 8} y={y(ghost) - 4} fontSize={9} fill="var(--accent)" textAnchor="end" fontFamily="'DM Mono', monospace" opacity={0.8}>
              {ghost.toFixed(digits)}
            </text>
          </g>
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

      {hover != null && hb && hoverPos && (
        <div
          style={{
            position: "absolute", pointerEvents: "none", zIndex: 5,
            left: `${hoverPos.xPct}%`,
            top: `${hoverPos.yPct}%`,
            transform: `translate(${hoverPos.xPct < 58 ? "14px" : "calc(-100% - 14px)"}, ${hoverPos.yPct < 58 ? "14px" : "calc(-100% - 14px)"})`,
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
