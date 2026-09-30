"use client";
// app/setups/ForexSection.tsx — forex reversal-break RETESTS, on the Setups page.
//
// Rule (tested on NY-close candles, 28 pairs): a range at the end of a trend
// breaks AGAINST that trend → buy/sell LIMIT at the broken edge. Retest only —
// no entries on the break. The driver (strength index) is shown as a "go read
// the news" flag, never as a filter: it didn't improve the retest.

import { useCallback, useEffect, useState } from "react";
import { Globe, RefreshCw, Clock, Zap, Eye, Newspaper } from "lucide-react";
import { EmptyState, ErrorCard } from "../wyckoff/_components/ui";
import type { DriverScan, DriverSetup, CurrencyAlert, CotStep } from "@/lib/setups/forexDriver";
import type { AbcdSetup } from "@/lib/setups/abcd";
import SetupChartFull from "./SetupChartFull";
import TakeBar from "./TakeBar";
import RiskBlock from "./RiskBlock";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmt = (x: number) => (Math.abs(x) >= 20 ? x.toFixed(3) : x.toFixed(5));

const STATE: Record<DriverSetup["state"], { label: string; icon: JSX.Element; tone: string }> = {
  filled: { label: "retest filled on the last bar — place the stop now", icon: <Zap size={11} />, tone: "var(--green)" },
  armed: { label: "broke against the trend — limit order at the edge", icon: <Clock size={11} />, tone: "var(--text-2)" },
  watch: { label: "pressing the edge — no break yet, no order", icon: <Eye size={11} />, tone: "var(--text-3)" },
};

export default function ForexSection({ view = "retest" }: { view?: "retest" | "abcd" }) {
  const [data, setData] = useState<DriverScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/setups/forex${fresh ? "?fresh=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const live = (data?.setups ?? []).filter((s) => s.state !== "watch");
  const watch = (data?.setups ?? []).filter((s) => s.state === "watch");

  return (
    <section style={{ marginTop: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
        <h2 style={{ ...mono, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
          <Globe size={14} /> {view === "abcd" ? "FOREX · AB=CD at D" : "FOREX · reversal-break retests"}
          <span style={{ fontSize: 9.5, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--amber)", color: "var(--amber)" }}>FORWARD TEST — paper only</span>
          <span style={{ color: "var(--text-3)", fontSize: 10 }}>
            28 spot pairs · NY-close candles{data?.lastBarDate ? ` · data to ${data.lastBarDate}` : ""}
          </span>
        </h2>
        <button onClick={() => load(true)} disabled={busy} style={{ ...mono, fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> rescan
        </button>
      </div>

      {error && <ErrorCard message={error} />}
      {!data && !error && <p style={{ ...mono, fontSize: 11, color: "var(--text-3)" }}>scanning 28 pairs…</p>}
      {data?.errors.length ? (
        <p style={{ ...mono, fontSize: 10, color: "var(--amber)" }}>
          feed errors ({data.errors.map((e) => e.pair).join(", ")}) — the strength index needs all 28 pairs, so nothing is shown rather than a skewed read.
        </p>
      ) : null}

      {data && view === "retest" && <Alerts alerts={data.alerts} />}
      {data?.cotError && (
        <p style={{ ...mono, fontSize: 10, color: "var(--amber)" }}>CFTC positioning unavailable right now ({data.cotError}) — cards show no positioning line.</p>
      )}

      {data && view === "abcd" && <AbcdSection rows={data.abcd ?? []} />}
      {data && view === "retest" && (
        <>
          <h3 style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: "20px 0 8px" }}>ORDERS · {live.length}</h3>
          {live.length ? <Grid rows={live} /> : <EmptyState text="No reversal breaks waiting for a retest." small />}
          <h3 style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: "20px 0 8px" }}>WATCH — PRESSING THE EDGE · {watch.length}</h3>
          {watch.length ? <Grid rows={watch} /> : <EmptyState text="No ranges pressing a reversal edge." small />}
          <ForexRules />
        </>
      )}
    </section>
  );
}

/** The "go check the fundamentals" row: currencies at a 20-day low/high against all seven others. */
function Alerts({ alerts }: { alerts: CurrencyAlert[] }) {
  return (
    <div style={{ ...mono, fontSize: 11, margin: "12px 0", padding: "8px 10px", border: "1px solid var(--border-subtle)", borderRadius: 9 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--text-3)", fontSize: 9.5, marginBottom: 4 }}>
        <Newspaper size={11} /> CHECK THE NEWS — currencies moving against all seven others (20-day low/high, last 5 days) · info only
      </div>
      {alerts.length ? (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {alerts.map((a) => (
            <span key={a.ccy} style={{ color: a.move === "cracking" ? "var(--red)" : "var(--green)" }}>
              <b>{a.ccy}</b> {a.move === "cracking" ? "▼ cracking" : "▲ surging"} since {a.date.slice(5)}
            </span>
          ))}
        </div>
      ) : (
        <span style={{ color: "var(--text-3)" }}>nothing unusual — no currency at a 20-day extreme</span>
      )}
    </div>
  );
}

function Grid({ rows }: { rows: DriverSetup[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
      {rows.map((s) => <Card key={`${s.pair}|${s.range.start}`} s={s} />)}
    </div>
  );
}

const gradeLabel = (s: DriverSetup) => s.skip ? "SKIP" : s.grade === "A" ? "A · trapped z≥1" : "B · trapped";

function Card({ s }: { s: DriverSetup }) {
  const long = s.side === "long";
  const st = STATE[s.state];
  const [open, setOpen] = useState(false);
  const buy = long ? "BUY" : "SELL", sell = long ? "SELL" : "BUY";
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 14, background: "var(--surface-1)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>{s.pair}</span>
        <span style={{ ...mono, fontSize: 10, padding: "2px 8px", borderRadius: 999, border: `1px solid ${s.skip ? "var(--amber)" : s.grade === "A" ? "var(--green)" : "var(--border-subtle)"}`, color: s.skip ? "var(--amber)" : s.grade === "A" ? "var(--green)" : "var(--text-3)" }}>
          {gradeLabel(s)} · {s.range.bars}-bar range
        </span>
      </div>
      <div style={{ ...mono, fontSize: 11, marginTop: 6, color: long ? "var(--green)" : "var(--red)" }}>
        {buy} {s.pair} · reversal of a {s.trendAtr.toFixed(1)} ATR {long ? "down" : "up"}trend
      </div>
      <div style={{ ...mono, fontSize: 10.5, marginTop: 4, color: st.tone, display: "flex", gap: 6, alignItems: "center" }}>
        {st.icon} {st.label}
      </div>
      {s.skip && (
        <div style={{ ...mono, fontSize: 11, marginTop: 8, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--amber)", color: "var(--amber)" }}>
          SKIP: {s.skip}. Card kept for the record only; no order.
        </div>
      )}
      {s.wyckoffRead?.agrees === false && (
        <div style={{ ...mono, fontSize: 11, marginTop: 8, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--red)", color: "var(--red)" }}>
          ⚠ Wyckoff read (futures volume) says {s.wyckoffRead.verdict === "accum" ? "accumulation" : "distribution"}, against this trade. Tested −0.33R / −0.49R. Skip or size down.
        </div>
      )}

      <button
        onClick={() => setOpen(true)}
        title="Click to expand"
        style={{ display: "block", width: "100%", padding: 0, background: "none", border: "none", cursor: "zoom-in" }}
      >
        <MiniChart s={s} />
      </button>
      {open && <ForexChartModal s={s} onClose={() => setOpen(false)} />}

      <div style={{ ...mono, fontSize: 10.5, marginTop: 10, padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border-subtle)", lineHeight: 1.7 }}>
        {s.state === "watch" ? (
          <>
            <div style={{ color: "var(--text-3)", fontSize: 9.5 }}>NO ORDER YET</div>
            <div>Needs a daily close {long ? "above" : "below"} <b>{fmt(s.breakLevel)}</b> (NY 5pm = 22:00 Lagos)</div>
            <div style={{ color: "var(--text-3)" }}>then: {buy} LIMIT {fmt(s.order.entry)} · stop {fmt(s.order.stopLoss)} · +1R {fmt(s.order.breakEven)}</div>
          </>
        ) : (
          <>
            <div style={{ color: "var(--text-3)", fontSize: 9.5 }}>ORDERS · broke {s.breakDate} ({s.barsSinceBreak} bars ago)</div>
            {s.state === "filled"
              ? <div style={{ color: "var(--green)" }}>Filled at {fmt(s.order.entry)} on the last bar.</div>
              : <div><b>1. {buy} LIMIT</b> at {fmt(s.order.entry)} · good for {s.order.goodForBars} more bars</div>}
            {s.retest && <RetestLine r={s.retest} buy={buy} />}
            <div><b style={{ color: "var(--red)" }}>2. {sell} STOP</b> at {fmt(s.order.stopLoss)}</div>
            <div style={{ color: "var(--text-3)" }}>no fixed take-profit — {s.order.manage.map((m) => <div key={m}>· {m} {m.startsWith("At +1R") ? `(${fmt(s.order.breakEven)})` : ""}</div>)}</div>
          </>
        )}
      </div>

      {!s.skip && <RiskBlock instrument={s.pair} executeSymbol={null} side={s.side} grade={s.grade} entry={s.order.entry} stop={s.order.stopLoss} />}

      {s.positioning && <Positioning p={s.positioning} />}
      {s.cotPath?.length ? <CotPathLine path={s.cotPath} /> : null}
      <Driver s={s} />

      {!s.skip && s.state !== "watch" && (
        <TakeBar card={{
          ref: { market: "forex", instrument: s.pair, side: s.side, entry: "forex", rangeLo: s.range.lo, rangeHi: s.range.hi },
          instrument: s.pair, executeSymbol: null, side: s.side, grade: s.grade,
          entry: s.order.entry, stop: s.order.stopLoss, cap: null, entryKind: "limit", samePrices: true,
          readLocked: null, readAgrees: null,
          entryDate: s.state === "filled" ? s.lastBarDate : new Date().toISOString().slice(0, 10),
        }} />
      )}
    </div>
  );
}

/** Pesavento AB=CD at D: paper only. No Take button, no risk block, never on Tonight; logged to the Journal. */
function AbcdSection({ rows }: { rows: AbcdSetup[] }) {
  return (
    <>
      <h3 style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: "20px 0 4px", display: "flex", gap: 8, alignItems: "center" }}>
        AB=CD AT D · {rows.length}
        <span style={{ fontSize: 9.5, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--amber)", color: "var(--amber)" }}>PAPER ONLY — not traded</span>
      </h3>
      <div style={{ ...mono, fontSize: 10.5, color: "var(--text-3)", marginBottom: 8, lineHeight: 1.6 }}>
        Larry Pesavento AB=CD on 2 × ATR swings: C retraces 0.618–0.786 of AB, limit at D = C ∓ AB, stop at the 1.272 extension, target the 0.618 retrace of CD (≈ +2.3R), no trail.
        Tested +0.32R / +0.34R per trade (222 trades 2021–26, win 41%, worst drawdown −8.3R), but fragile: only this swing size held up. COT shown for information (it didn't help AB=CD).
        Never coincided with a COT retest. Logged to the Journal so the live result decides.
      </div>
      {rows.length
        ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>{rows.map((a) => <AbcdCard key={`${a.pair}|${a.c.date}`} a={a} />)}</div>
        : <EmptyState text="No AB=CD waiting at D." small />}
    </>
  );
}

function AbcdCard({ a }: { a: AbcdSetup }) {
  const long = a.side === "long";
  const R = Math.abs(a.entry - a.stop), tR = Math.abs(a.target - a.entry) / R;
  return (
    <div style={{ border: "1px dashed var(--border-subtle)", borderRadius: 12, padding: 14, background: "var(--surface-1)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>{a.pair}</span>
        <span style={{ ...mono, fontSize: 10, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--amber)", color: "var(--amber)" }}>PAPER · BC/AB {a.retrace.toFixed(3)}</span>
      </div>
      <div style={{ ...mono, fontSize: 11, marginTop: 6, color: long ? "var(--green)" : "var(--red)" }}>
        {long ? "BUY" : "SELL"} {a.pair} at D · {a.state === "filled" ? "D reached on the last bar" : `limit live ${a.barsLeft} more bars`}
      </div>
      <AbcdChart a={a} />
      <div style={{ ...mono, fontSize: 10.5, marginTop: 10, padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border-subtle)", lineHeight: 1.7 }}>
        <div style={{ color: "var(--text-3)", fontSize: 9.5 }}>PAPER ORDER · pattern known {a.knownDate}</div>
        <div><b>1. {long ? "BUY" : "SELL"} LIMIT</b> at D {fmt(a.entry)}{a.state === "armed" ? ` · cancel if price breaks C (${fmt(a.c.price)})` : ""}</div>
        <div><b style={{ color: "var(--red)" }}>2. STOP</b> at {fmt(a.stop)} (1.272 extension)</div>
        <div><b style={{ color: "var(--green)" }}>3. TARGET</b> at {fmt(a.target)} (0.618 of CD, +{tR.toFixed(1)}R) · no trail</div>
        <div style={{ color: "var(--text-3)" }}>A {fmt(a.a.price)} ({a.a.date}) · B {fmt(a.b.price)} ({a.b.date}) · C {fmt(a.c.price)} ({a.c.date})</div>
      </div>
      {a.positioning && (
        <div style={{ ...mono, fontSize: 10.5, marginTop: 8, color: "var(--text-3)" }}>
          COT (info only): {a.positioning.sell.ccy} you sell · {a.positioning.sell.verdict} · z {a.positioning.sell.z == null ? "—" : a.positioning.sell.z.toFixed(2)}
        </div>
      )}
    </div>
  );
}

/** Candles with the A-B-C swing, the projected C-D leg, and entry / stop / target. */
function AbcdChart({ a }: { a: AbcdSetup }) {
  const bars = a.bars.slice(-120);
  const W = 360, PH = 150, FUT = 50, plotW = W - 70, barsW = plotW - FUT;
  const lvls = [a.entry, a.stop, a.target, a.a.price, a.b.price, a.c.price];
  const pMin = Math.min(...bars.map((b) => b[2]), ...lvls), pMax = Math.max(...bars.map((b) => b[1]), ...lvls);
  const pad = (pMax - pMin) * 0.05, lo = pMin - pad, span = pMax - pMin + 2 * pad;
  const xw = barsW / bars.length, cw = Math.max(1, Math.min(4, xw * 0.62));
  const x = (i: number) => i * xw + xw / 2, y = (p: number) => (1 - (p - lo) / span) * PH;
  const xi = (d: string) => { const i = bars.findIndex((b) => b[4] >= d); return i < 0 ? 0 : x(i); };
  const pts = [
    { k: "A", x: xi(a.a.date), p: a.a.price }, { k: "B", x: xi(a.b.date), p: a.b.price },
    { k: "C", x: xi(a.c.date), p: a.c.price }, { k: "D", x: barsW + FUT / 2, p: a.entry },
  ];
  const levels = [
    { k: "D", p: a.entry, c: "var(--accent)", d: "" },
    { k: "stop", p: a.stop, c: "var(--red)", d: "4 2" },
    { k: "target", p: a.target, c: "var(--green)", d: "1.5 2.5" },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${PH}`} style={{ width: "100%", display: "block", marginTop: 8 }} role="img"
      aria-label={`${a.pair} AB=CD: D ${fmt(a.entry)}, stop ${fmt(a.stop)}, target ${fmt(a.target)}`}>
      {bars.map((b, i) => {
        const [o, h, l, c] = b, col = c >= o ? "var(--green)" : "var(--red)";
        return (
          <g key={i} opacity={0.75}>
            <line x1={x(i)} y1={y(h)} x2={x(i)} y2={y(l)} stroke={col} strokeWidth={0.7} />
            <rect x={x(i) - cw / 2} y={y(Math.max(o, c))} width={cw} height={Math.max(0.8, Math.abs(y(o) - y(c)))} fill={col} />
          </g>
        );
      })}
      <polyline points={pts.map((p) => `${p.x},${y(p.p)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="0" opacity={0.9} />
      {pts.map((p) => (
        <g key={p.k}>
          <circle cx={p.x} cy={y(p.p)} r={2.5} fill="var(--accent)" />
          <text x={p.x} y={y(p.p) + (p.k === "B" || p.k === "D" ? (a.side === "long" ? 12 : -6) : (a.side === "long" ? -6 : 12))} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-1)" style={mono}>{p.k}</text>
        </g>
      ))}
      {levels.map((l) => (
        <g key={l.k}>
          <line x1={0} x2={plotW} y1={y(l.p)} y2={y(l.p)} stroke={l.c} strokeWidth={1} strokeDasharray={l.d} />
          <text x={plotW + 4} y={y(l.p) + 3.5} fontSize={10} fill={l.c} style={mono}>{l.k} {fmt(l.p)}</text>
        </g>
      ))}
    </svg>
  );
}

/** Tested result for each COT path an A can take between the break and the fill
 *  (reversal-break retests, 28 pairs, 2021–26, after a 2-pip spread; recent = Dec 2023–). */
type PathKind = "none" | "held" | "eased" | "turned";
const PATH_PROOF: Record<PathKind, { label: string; proof: string; tone: string }> = {
  none:   { label: "A · no new report yet",      proof: "tested 35 trades · +0.81R · win 63% (recent +1.11 / earlier +0.14)", tone: "var(--green)" },
  held:   { label: "A · held A through reports", proof: "tested 17 trades · +0.61R · win 71% (recent +0.85 / earlier +0.44)", tone: "var(--green)" },
  eased:  { label: "A → eased to B",             proof: "untested (0 cases): cancelled as a precaution, A-only", tone: "var(--amber)" },
  turned: { label: "A → turned flat/late",       proof: "tested 4 trades · −0.60R · win 25%: cancel the limit", tone: "var(--red)" },
};
const pathKind = (p: CotStep[]): PathKind =>
  p.length === 1 ? "none"
  : p.every((s) => s.state === "A") ? "held"
  : p.some((s) => s.state === "flat" || s.state === "late" || s.state === "n/a") ? "turned"
  : "eased";

/** How the sell-leg COT moved since the break. Flat/late before the fill = cancel. */
function CotPathLine({ path }: { path: NonNullable<DriverSetup["cotPath"]> }) {
  const tone = (st: string) => st === "A" ? "var(--green)" : st === "B" ? "var(--text-1)" : "var(--red)";
  const last = path[path.length - 1];
  const turned = last.state !== "A" && last.state !== "B";
  const pp = path[0].state === "A" ? PATH_PROOF[pathKind(path)] : null;
  return (
    <div style={{ ...mono, fontSize: 11, marginTop: 8, padding: "6px 10px", borderRadius: 8, border: `1px solid ${turned ? "var(--red)" : "var(--border-subtle)"}`, lineHeight: 1.7 }}>
      <div style={{ color: "var(--text-3)", fontSize: 10 }}>COT SINCE THE BREAK (sell leg, each weekly report)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
        {path.map((p, i) => (
          <span key={p.at}>
            {i > 0 && <span style={{ color: "var(--text-3)" }}>→ </span>}
            <b style={{ color: tone(p.state) }}>{p.state}</b>
            <span style={{ color: "var(--text-2)" }}> z{p.z == null ? "—" : p.z.toFixed(2)}</span>
            <span style={{ color: "var(--text-3)" }}> ({p.at.slice(5)})</span>
          </span>
        ))}
      </div>
      {pp && <div style={{ color: pp.tone }}>{pp.label}: {pp.proof}</div>}
      {path.length === 1 && <div style={{ color: "var(--text-3)" }}>no new report since the break yet; next one lands Friday 20:30 Lagos</div>}
      {turned && <div style={{ color: "var(--red)" }}>turned before the fill → cancel the limit</div>}
    </div>
  );
}

/** The retest day at its close — volume from the currency futures legs. */
function RetestLine({ r, buy }: { r: NonNullable<DriverSetup["retest"]>; buy: string }) {
  const tone = r.low === true ? "var(--green)" : r.low === false ? "var(--amber)" : "var(--text-3)";
  return (
    <div style={{ margin: "4px 0", padding: "4px 8px", borderRadius: 7, border: `1px solid ${tone}` }}>
      <div style={{ color: tone }}>
        retest volume (futures) {r.vol == null ? "unavailable" : `${r.vol.toFixed(2)}× range avg — ${r.low ? "LOW ✓ quiet retest" : "not low — heavier retest"}`}
        {" · "}{r.held ? "held the edge" : "closed back inside"}
      </div>
      <div style={{ color: "var(--text-3)" }}>
        confirmation entry: {r.confirmEntry ? <b style={{ color: "var(--green)" }}>{buy} at the next open</b> : "skip"}
      </div>
    </div>
  );
}

/** Real money (CFTC asset managers) through the range. The SELL leg is the read. */
function Positioning({ p }: { p: NonNullable<DriverSetup["positioning"]> }) {
  const tone = p.tone === "good" ? "var(--green)" : p.tone === "warn" ? "var(--amber)" : "var(--text-3)";
  const z = (x: number | null) => (x == null ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(1)}`);
  const leg = (l: typeof p.buy, side: string) =>
    l.verdict === "n/a" ? `${l.ccy} (${side}): no futures positioning`
    : `${l.ccy} (${side}): ${l.verdict === "trapped" ? "trapped on the old trend" : l.verdict === "late" ? "already on your side" : "quiet"} · z ${z(l.z)}`;
  return (
    <div style={{ ...mono, fontSize: 10, marginTop: 8, padding: "6px 8px", borderRadius: 8, border: `1px solid ${tone}` }}>
      <div style={{ color: tone }}>{p.headline}</div>
      <div style={{ color: "var(--text-3)", marginTop: 2 }}>
        {leg(p.sell, "you sell")} · {leg(p.buy, "you buy — info only")}
        {p.reportDate ? ` · CFTC as of ${p.reportDate} (weekly, out Fridays)` : ""}
      </div>
    </div>
  );
}

/** Driver = information. Tells you which side is moving so you know which news to read. */
function Driver({ s }: { s: DriverSetup }) {
  const d = s.driver;
  const pts = (v: number[], lo: number, hi: number) =>
    v.map((x, i) => `${(i / Math.max(1, v.length - 1)) * 120},${24 - ((x - lo) / Math.max(1e-9, hi - lo)) * 22}`).join(" ");
  const all = [...s.strength.loser, ...s.strength.winner];
  const lo = Math.min(...all), hi = Math.max(...all);
  const text = d.confirmed
    ? `${d.loser} cracking against everyone (${d.loserLowDate}), ${d.winner} holding — read the ${d.loser} news`
    : d.loserLowDate && d.winnerCracking
      ? `${d.loser} and ${d.winner} both weak — no single story`
      : `no driver — the move isn't one currency's story`;
  return (
    <div style={{ ...mono, fontSize: 10, marginTop: 8, color: "var(--text-3)", display: "flex", gap: 10, alignItems: "center" }}>
      <svg width={120} height={26} role="img" aria-label={`strength: ${d.loser} vs ${d.winner}, last 60 days`}>
        <polyline points={pts(s.strength.winner, lo, hi)} fill="none" stroke="var(--green)" strokeWidth={1.2} />
        <polyline points={pts(s.strength.loser, lo, hi)} fill="none" stroke="var(--red)" strokeWidth={1.2} />
      </svg>
      <span>
        <span style={{ color: "var(--green)" }}>{d.winner}</span> vs <span style={{ color: "var(--red)" }}>{d.loser}</span> · {text} · <i>info only</i>
      </span>
    </div>
  );
}

/** Expanded chart — the same full chart as futures (D / W / M, crosshair, volume
 *  tooltip), on NY-close candles with the currency futures' volume. */
function ForexChartModal({ s, onClose }: { s: DriverSetup; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const long = s.side === "long";
  const legs = [s.pair.slice(0, 3), s.pair.slice(3)].filter((c) => c !== "USD");
  return (
    <div role="dialog" aria-modal="true" aria-label={`${s.pair} chart`} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1180px, 100%)", maxHeight: "100%", overflow: "auto", background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ ...mono, fontSize: 13 }}>
            <b style={{ fontSize: 16 }}>{s.pair}</b>
            <span style={{ marginLeft: 10, color: long ? "var(--green)" : "var(--red)" }}>
              {long ? "BUY" : "SELL"} {s.pair} · retest · {gradeLabel(s)} · {STATE[s.state].label}
            </span>
          </div>
          <button onClick={onClose} style={{ ...mono, fontSize: 11, color: "var(--text-3)" }}>close (esc)</button>
        </div>
        <div style={{ ...mono, fontSize: 11, color: "var(--text-2)", margin: "8px 0 12px", display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>range {fmt(s.range.lo)}–{fmt(s.range.hi)} · {s.range.bars} bars</span>
          {s.state === "watch" && <span>break needs a close {long ? "above" : "below"} {fmt(s.breakLevel)}</span>}
          <span>entry {fmt(s.order.entry)}</span>
          <span style={{ color: "var(--red)" }}>stop {fmt(s.order.stopLoss)}</span>
          <span style={{ color: "var(--green)" }}>+1R → BE {fmt(s.order.breakEven)}</span>
          <span style={{ color: "var(--text-3)" }}>no cap — trail 1R · {s.breakDate ? `broke ${s.breakDate}` : "not broken yet"} · data to {s.lastBarDate}</span>
        </div>
        {s.positioning && <Positioning p={s.positioning} />}
        <div style={{ marginTop: 10 }}>
          <SetupChartFull
            instrument={s.pair} entry="conservative" long={long}
            rangeLo={s.range.lo} rangeHi={s.range.hi} rangeStart={s.range.start}
            signalDate={s.breakDate ?? s.lastBarDate}
            entryPrice={s.order.entry} stop={s.order.stopLoss} breakevenAt={s.order.breakEven}
            fmt={fmt}
            dataUrl={`/api/setups/forex/chart?pair=${encodeURIComponent(s.pair)}`}
            note={legs.length ? `volume = ${legs.join(" + ")} currency futures` : "no futures volume"}
          />
        </div>
      </div>
    </div>
  );
}

/** Candles + range box + entry/stop/+1R. No volume: spot FX has none. */
function MiniChart({ s }: { s: DriverSetup }) {
  const bars = s.bars.slice(-90);
  const W = 360, PH = 140, FUT = 40, plotW = W - 70, barsW = plotW - FUT;
  const lvls = [s.order.entry, s.order.stopLoss, s.order.breakEven, s.breakLevel];
  const pMin = Math.min(...bars.map((b) => b[2]), ...lvls), pMax = Math.max(...bars.map((b) => b[1]), ...lvls);
  const pad = (pMax - pMin) * 0.05, lo = pMin - pad, span = pMax - pMin + 2 * pad;
  const xw = barsW / bars.length, cw = Math.max(1, Math.min(5, xw * 0.62));
  const x = (i: number) => i * xw + xw / 2, y = (p: number) => (1 - (p - lo) / span) * PH;
  const si = bars.findIndex((b) => b[4] >= s.range.start);
  const bi = s.breakDate ? bars.findIndex((b) => b[4] === s.breakDate) : -1;
  const boxFrom = si >= 0 ? x(si) - xw / 2 : 0, boxTo = bi >= 0 ? x(bi) - xw / 2 : barsW;
  const levels = [
    { k: "entry", p: s.order.entry, c: "var(--accent)", d: "" },
    { k: "stop", p: s.order.stopLoss, c: "var(--red)", d: "4 2" },
    { k: "+1R", p: s.order.breakEven, c: "var(--green)", d: "1.5 2.5" },
    ...(s.state === "watch" ? [{ k: "break", p: s.breakLevel, c: "var(--text-3)", d: "2 2" }] : []),
  ];
  return (
    <svg viewBox={`0 0 ${W} ${PH}`} style={{ width: "100%", display: "block", marginTop: 8 }} role="img"
      aria-label={`${s.pair} daily chart: range ${fmt(s.range.lo)}–${fmt(s.range.hi)}, entry ${fmt(s.order.entry)}, stop ${fmt(s.order.stopLoss)}`}>
      <rect x={boxFrom} y={y(s.range.hi)} width={Math.max(2, boxTo - boxFrom)} height={Math.max(1, y(s.range.lo) - y(s.range.hi))} fill="var(--accent)" opacity={0.06} />
      {bars.map((b, i) => {
        const [o, h, l, c] = b, col = c >= o ? "var(--green)" : "var(--red)";
        return (
          <g key={i} opacity={si >= 0 && i < si ? 0.6 : 1}>
            <line x1={x(i)} y1={y(h)} x2={x(i)} y2={y(l)} stroke={col} strokeWidth={0.7} />
            <rect x={x(i) - cw / 2} y={y(Math.max(o, c))} width={cw} height={Math.max(0.8, Math.abs(y(o) - y(c)))} fill={col} />
          </g>
        );
      })}
      {levels.map((l) => (
        <g key={l.k}>
          <line x1={0} x2={plotW} y1={y(l.p)} y2={y(l.p)} stroke={l.c} strokeWidth={1} strokeDasharray={l.d} opacity={0.9} />
          <text x={plotW + 4} y={y(l.p) + 3} fontSize={8} fill={l.c} style={mono}>{l.k} {fmt(l.p)}</text>
        </g>
      ))}
    </svg>
  );
}

function ForexRules() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...mono, fontSize: 10.5, marginTop: 16, color: "var(--text-3)" }}>
      <button onClick={() => setOpen(!open)} style={{ ...mono, fontSize: 10.5, color: "var(--text-2)" }}>{open ? "▾" : "▸"} the forex rules & what was tested</button>
      {open && (
        <div style={{ lineHeight: 1.7, marginTop: 6 }}>
          <div>· Range (≥15 bars) at the end of a 60-day trend breaks AGAINST it: a daily close beyond the edge ± 15% of the band.</div>
          <div>· Entry: LIMIT at the broken edge, live 20 bars. Retest only — buying the break didn't pay.</div>
          <div>· Stop 1.5 × tolerance back inside. Break-even at +1R, then trail 1R behind the best price. Out after 60 days.</div>
          <div>· Tested (fair fills, 28 pairs, 2024–26): +0.19R gross / +0.14R after spread per trade, 129 trades — NOT yet a proven edge, hence paper only.</div>
          <div>· Stronger: a QUIET retest (futures volume ≤ 0.8×) +0.34R, and normal-volatility markets +0.34R. High-vol markets lost (−0.11R).</div>
          <div>· Real money (CFTC asset managers) through the RANGE, in the currency you SELL: still buying it = trapped, the Composite Man's counterparty → +0.48R / +0.34R. Already selling it = late → −0.39R / −0.16R. Two separate periods; small samples — a strong lead.</div>
          <div>· GRADE (graded at the break, 2021–26, after spread): A = COT trapped z≥1 → +0.98R / +0.19R, win 63%. A ONLY: B (trapped z 0.5–1) = SKIP (−0.49R / +0.15R). Quiet or late COT = SKIP (−0.19R / −0.16R).</div>
          <div>· Selling USD = SKIP: no USD read helps (DXY / other leg tested) and those setups lost (−0.19R / −0.23R, 1 in 43 reached +2R).</div>
          <div>· COT re-checked on every new report after the break: turned flat/late before the fill → cancel (−0.73R / −0.48R). An A that eases to B or turns flat/late before the fill = cancel. Once filled, COT changes don't matter (tested: no gain from exiting on them); the stop and trail manage the exit.</div>
          <div style={{ margin: "4px 0 6px" }}>· COT path after an A break → what it did (2021–26):
            <table style={{ borderCollapse: "collapse", marginTop: 4 }}>
              <tbody>
                {(Object.keys(PATH_PROOF) as PathKind[]).map((k) => (
                  <tr key={k}>
                    <td style={{ padding: "2px 12px 2px 0", color: PATH_PROOF[k].tone }}>{PATH_PROOF[k].label}</td>
                    <td style={{ padding: "2px 0", color: "var(--text-2)" }}>{PATH_PROOF[k].proof}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>· Wyckoff read (futures volume over the range) DISAGREES with the trade → −0.33R / −0.49R: warning, skip or size down. Agreeing adds nothing.</div>
          <div>· Driver, news & rate cycle: shown for your read only. None improved the retest. With-trend breaks right after a central-bank move failed (−0.50R).</div>
          <div>· Candles are rebuilt from hourly data with the New York 5pm close — Yahoo's daily FX close is stale.</div>
        </div>
      )}
    </div>
  );
}
