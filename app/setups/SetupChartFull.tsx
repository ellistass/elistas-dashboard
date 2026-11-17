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

import { useEffect, useMemo, useRef, useState } from "react";
import { volumeView, isPlottableTag } from "@/lib/chart/volume";
import { engineReadDetail, stoppingActionAt, structureRead } from "@/lib/wyckoff/engine";
import { firstDropRead, dropShare, springRead, volumeFavour, type HourBar } from "@/lib/setups/intraday";
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
  /** AB=CD: the swing points to draw (A, B, C) — the leg to D is drawn into the plan strip. */
  swing?: { date: string; price: number; label: string }[];
  /** No breakeven step (AB=CD exits at its target only). */
  hideBreakeven?: boolean;
  /** No range box (patterns that aren't ranges). */
  hideBox?: boolean;
  /** Letter on the signal bar (default B / S / U). */
  signalLabel?: string;
  /** After the fact (Filled page): how it played out under the rules. */
  /** Futures/stocks setups: show the engine read on the chart and the 4H view. */
  withRead?: boolean;
  /** The engine read's window from the card, so the chart reads exactly what the card read. */
  readWindow?: { from: string; to: string };
  /** Filled page: 4 hour and 1 hour views (price + volume, no read), 6 months of hourly data. */
  intraday?: boolean;
  /** Filled page: step through the chart bar by bar from the signal, as it happened. */
  replay?: boolean;
  played?: {
    fillDate: string | null; fillPrice: number | null;
    exitDate: string | null; exitPrice: number | null; win: boolean | null;
    stops: { date: string; stop: number }[];
  };
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmtVol = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0));

type View = Timeframe | "4H" | "2H" | "1H";
const isIntra = (v: View) => v === "4H" || v === "2H" || v === "1H";
const VIEW_LABEL: Record<string, string> = { "4H": "4 hour", "2H": "2 hour", "1H": "1 hour" };
type Intra = { bars: Bar[]; hasVolume: boolean; error?: string } | null;
const loadIntra = (url: string, set: (v: Intra) => void) =>
  fetch(url)
    .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j; })
    .then((j) => set({ bars: j.bars, hasVolume: j.hasVolume }))
    .catch((e) => set({ bars: [], hasVolume: false, error: e instanceof Error ? e.message : String(e) }));
/** Your own marks on the chart — kept while the popup is open, gone when it closes. */
type Draw =
  | { kind: "point"; date: string; price: number; label: string }
  | { kind: "line"; date: string; price: number }
  | { kind: "zone"; date: string; p1: number; p2: number }
  | { kind: "trend"; d1: string; p1: number; d2: string; p2: number };
type Tool = "move" | "point" | "line" | "zone" | "trend";
const TOOLS: { key: Tool; label: string; hint: string }[] = [
  { key: "move", label: "✋ move", hint: "drag to move, scroll to zoom" },
  { key: "point", label: "• point", hint: "click a candle to mark a point (P1, P2 …)" },
  { key: "line", label: "— pool", hint: "click a level — snaps to the nearest wick high/low" },
  { key: "zone", label: "▭ zone", hint: "press, drag up/down, release" },
  { key: "trend", label: "╱ line", hint: "click the start, then the end" },
];
const DRAW_COL = "#b48cff";
/** A labelled point on the chart (H1, SC, 1st, A, F …). */
interface Mark { date: string; label: string; title: string; col: string; below: boolean }

export default function SetupChartFull(plan: PlanProps) {
  const [data, setData] = useState<{ bars: Bar[]; suspectVolume: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("D");
  const [showEffort, setShowEffort] = useState(false);
  const [showRead, setShowRead] = useState(true);
  const [showAdx, setShowAdx] = useState(true);
  const [draws, setDraws] = useState<Draw[]>([]);
  const [tool, setTool] = useState<Tool>("move");
  const [h4, setH4] = useState<{ bars: Bar[]; hasVolume: boolean; error?: string } | null>(null);
  const [h2, setH2] = useState<{ bars: Bar[]; hasVolume: boolean; error?: string } | null>(null);
  const [h1, setH1] = useState<Intra>(null);
  // Replay: the last bar shown (its date / timestamp). null = the whole chart.
  const [rpAt, setRpAt] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const long6m = plan.intraday ? "&range=6mo" : "";

  useEffect(() => {
    let live = true;
    fetch(plan.dataUrl ?? `/api/setups/chart?instrument=${encodeURIComponent(plan.instrument)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j; })
      .then((j) => { if (live) setData(j); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [plan.instrument, plan.dataUrl]);

  // 4H bars load on first use only.
  useEffect(() => {
    if (view !== "4H" || h4) return;
    loadIntra(`/api/setups/chart4h?instrument=${encodeURIComponent(plan.instrument)}${long6m}`, setH4);
  }, [view, h4, plan.instrument, long6m]);
  useEffect(() => {
    if (view !== "1H" || h1) return;
    loadIntra(`/api/setups/chart4h?instrument=${encodeURIComponent(plan.instrument)}&tf=1h${long6m}`, setH1);
  }, [view, h1, plan.instrument, long6m]);
  useEffect(() => {
    if (view !== "2H" || h2) return;
    fetch(`/api/setups/chart4h?instrument=${encodeURIComponent(plan.instrument)}&tf=2h`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j; })
      .then((j) => setH2({ bars: j.bars, hasVolume: j.hasVolume }))
      .catch((e) => setH2({ bars: [], hasVolume: false, error: e instanceof Error ? e.message : String(e) }));
  }, [view, h2, plan.instrument]);

  const side = plan.long ? "long" : "short";
  // Daily read — the same functions the scan runs, on the same window.
  const daily = useMemo(() => {
    if (!plan.withRead || !data) return null;
    const bars = data.bars;
    const from = plan.readWindow?.from ?? plan.rangeStart;
    const i0 = bars.findIndex((b) => b.date.slice(0, 10) >= from.slice(0, 10));
    let i1 = plan.readWindow ? bars.findIndex((b) => b.date.slice(0, 10) > plan.readWindow!.to.slice(0, 10)) - 1
      : bars.findIndex((b) => b.date.slice(0, 10) >= plan.signalDate.slice(0, 10)) - 1;
    if (i1 < -1) i1 = bars.length - 1;
    // Replay before the signal: read only the range bars seen so far — the read as it stood that day.
    const asOf = rpAt?.slice(0, 10);
    if (asOf && asOf < plan.signalDate.slice(0, 10)) {
      let k = -1; for (let j = 0; j < bars.length && bars[j].date.slice(0, 10) <= asOf; j++) k = j;
      i1 = Math.min(i1, k);
    }
    if (i0 < 0 || i1 - i0 < 4) return null;
    const detail = engineReadDetail(bars, i0, i1 + 1);
    const sa = stoppingActionAt(bars, i0, i1 + 1, plan.long);
    const st = structureRead(bars, i0, i1 + 1, plan.rangeLo, plan.rangeHi);
    const marks: Mark[] = [];
    if (!data.suspectVolume) {
      detail.heavy.forEach((h, k) => marks.push({
        date: h.date, label: `H${k + 1}`, col: h.dir === "up" ? "var(--green)" : h.dir === "down" ? "var(--red)" : "var(--text-2)",
        below: h.dir !== "up",
        title: `heavy day: ${h.volX.toFixed(1)}× avg volume, ${h.dir}, closed in the ${h.closePos > 0.66 ? "top" : h.closePos < 0.33 ? "bottom" : "middle"} third`,
      }));
      if (sa) {
        marks.push({ date: bars[sa.sc].date, label: plan.long ? "SC" : "BC", col: "var(--amber)", below: plan.long, title: plan.long ? "selling climax" : "buying climax" });
        marks.push({ date: bars[sa.ar].date, label: "AR", col: "var(--amber)", below: !plan.long, title: plan.long ? "automatic rally" : "automatic reaction" });
      }
    }
    return { detail, st, marks, shade: { from: bars[i0].date, to: bars[i1].date } };
  }, [plan.withRead, plan.readWindow, plan.rangeStart, plan.signalDate, plan.long, plan.rangeLo, plan.rangeHi, data, rpAt]);

  // 4H read — firstDropRead / dropShare / springRead, exactly as the card.
  const four = useMemo(() => {
    if (!plan.withRead || !h4 || !h4.bars.length) return null;
    const hb: HourBar[] = h4.bars.map((b) => ({ t: b.date, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    const sig = plan.signalDate.slice(0, 10);
    const dayBars = h4.bars.filter((b) => b.date.slice(0, 10) === sig);
    const shade = dayBars.length ? { from: dayBars[0].date, to: dayBars[dayBars.length - 1].date } : null;
    const marks: Mark[] = [];
    const lines: string[] = [];
    if (!h4.hasVolume) return { marks, shade, lines: ["no 4h volume for this market — price only"] };
    if (plan.entry === "conservative") {
      const drop = firstDropRead(hb, side, plan.entryPrice, sig);
      const share = dropShare(hb, side, plan.entryPrice, sig);
      if (drop) {
        marks.push({ date: drop.at, label: "1st", col: drop.heavy ? "var(--red)" : "var(--green)", below: !plan.long,
          title: `first candle of the drop: ${drop.ratio}× the break day's average 4h candle` });
        lines.push(`first 4h candle of the drop back to the edge: ${drop.ratio}× the break day's average 4h candle — ${drop.heavy ? "HEAVY → cancel the limit (tested: heavy −0.04R / 39% win vs light +0.26R / 55%)" : "light → keep the limit"}`);
      } else lines.push("no counter-candle yet on the way back to the edge (first-drop read not available)");
      if (share) lines.push(`whole drop so far (${share.bars} bars): ${Math.round(share.share * 100)}% of its volume on candles against us — ${share.share < 0.5 ? "coming back on little selling (under half: 62% win, +0.37R)" : "selling is doing most of the work"}`);
    } else {
      const sp = springRead(hb, side, sig);
      if (sp) {
        if (sp.absorption) marks.push({ date: sp.extAt, label: "A", col: "var(--green)", below: plan.long, title: "absorption: heavy 4h bar at the extreme that closed off it" });
        marks.push({ date: sp.lastAt, label: "F", col: sp.strongFinish ? "var(--green)" : "var(--red)", below: !plan.long, title: sp.strongFinish ? "last 4h bar finished strong" : "last 4h bar finished weak" });
        lines.push(`test-day volume formed ${(sp.favour ?? 0) > 0 ? "IN OUR FAVOUR" : "AGAINST US"} (${sp.favour ?? "n/a"}; +1 = all for us, −1 = all against)`);
        lines.push(`last 3 sessions: ${sp.favour3 == null ? "n/a" : (sp.favour3 > 0 ? "in our favour" : "against us") + ` (${sp.favour3})`} — in favour won 61% / +0.54R vs against 34% / +0.03R`);
        lines.push(sp.absorption ? "absorption: a heavy 4h bar at the extreme closed back off it (A) — 57% win, +0.67R" : "no absorption bar at the extreme");
        lines.push(sp.strongFinish ? "the test day's last 4h bar finished strong (F)" : "the test day's last 4h bar finished weak (F)");
      } else lines.push("not enough 4h bars on the test day for a read");
    }
    return { marks, shade, lines };
  }, [plan.withRead, h4, plan.signalDate, plan.entry, plan.entryPrice, plan.long, side]);

  // 2H read — springs: the test day's 2h volume (the grade on futures; information on stocks).
  const two = useMemo(() => {
    if (!plan.withRead || !h2 || !h2.bars.length) return null;
    const sig = plan.signalDate.slice(0, 10);
    const dayBars = h2.bars.filter((b) => b.date.slice(0, 10) === sig);
    const shade = dayBars.length ? { from: dayBars[0].date, to: dayBars[dayBars.length - 1].date } : null;
    if (!h2.hasVolume) return { marks: [] as Mark[], shade, lines: ["no 2h volume for this market — price only"] };
    if (plan.entry === "conservative") return { marks: [] as Mark[], shade, lines: ["retest reads (first drop candle) use the 4-hour view"] };
    const hb: HourBar[] = dayBars.map((b) => ({ t: b.date, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    const f = hb.length >= 2 ? volumeFavour(hb, side, sig, 1) : null;
    const lines = f == null ? ["not enough 2h bars on the test day for a read"] : [
      `test-day 2h volume formed ${f > 0 ? "IN OUR FAVOUR" : "AGAINST US"} (${f}; +1 = all for us, −1 = all against) over ${hb.length} bars`,
      f > 0 ? "futures/commodities/indices: in favour → tradeable (grade A) — tested 69% win, +1.36R on grade A"
            : "futures/commodities/indices: against → skip (grade B) — tested grade A 0 of 5 won",
      "stocks: information only — this read did not separate winners on stocks",
    ];
    return { marks: [] as Mark[], shade, lines };
  }, [plan.withRead, h2, plan.signalDate, plan.entry, side]);

  // ── Replay ── steps through the bars of the view on screen (W / M step day by day).
  const stepBars: Bar[] = (view === "4H" ? h4?.bars : view === "2H" ? h2?.bars : view === "1H" ? h1?.bars : data?.bars) ?? [];
  const rpIdx = rpAt == null ? -1 : (() => { let k = -1; for (let i = 0; i < stepBars.length && stepBars[i].date <= rpAt; i++) k = i; return k; })();
  const startAt = () => {
    const sig = plan.signalDate.slice(0, 10);
    const i = stepBars.findIndex((b) => b.date.slice(0, 10) >= sig);
    return i < 0 ? null : stepBars[isIntra(view) ? Math.max(0, i - 1) : i].date;   // intraday: from the bar before the signal day
  };
  const stepTo = (k: number) => { if (stepBars.length) setRpAt(stepBars[Math.max(0, Math.min(stepBars.length - 1, k))].date); };
  useEffect(() => {
    if (!playing || rpAt == null) return;
    if (rpIdx >= stepBars.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => stepTo(rpIdx + 1), 450);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    if (!plan.replay || rpAt == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); stepTo(rpIdx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); stepTo(rpIdx - 1); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // What the trade looked like at the replay bar (Filled page).
  const rpState = (() => {
    const pl = plan.played;
    if (rpAt == null || !pl) return null;
    const day = rpAt.slice(0, 10);
    const bar = stepBars[rpIdx];
    if (!pl.fillDate || pl.fillDate > day) return `${rpAt.slice(0, 16).replace("T", " ")} · not filled yet · order ${plan.fmt(plan.entryPrice)}`;
    if (pl.exitDate && pl.exitDate <= day && pl.exitPrice != null) return `${rpAt.slice(0, 16).replace("T", " ")} · out at ${plan.fmt(pl.exitPrice)} (${pl.exitDate})`;
    const stop = [...pl.stops].filter((s) => s.date.slice(0, 10) <= day).pop()?.stop ?? plan.stop;
    const R = Math.abs((pl.fillPrice ?? plan.entryPrice) - plan.stop) || 1e-9;
    const rNow = bar ? ((plan.long ? 1 : -1) * (bar.c - (pl.fillPrice ?? plan.entryPrice))) / R : null;
    return `${rpAt.slice(0, 16).replace("T", " ")} · in at ${plan.fmt(pl.fillPrice ?? plan.entryPrice)} · stop ${plan.fmt(stop)}${rNow != null ? ` · ${rNow >= 0 ? "+" : ""}${rNow.toFixed(2)}R at this close` : ""}`;
  })();

  if (err) return <div style={{ ...mono, fontSize: 11, color: "var(--red)", padding: 20 }}>chart failed: {err}</div>;
  if (!data) return <div style={{ ...mono, fontSize: 11, color: "var(--text-3)", padding: 40, textAlign: "center" }}>loading chart…</div>;

  const views: View[] = ["D", "W", "M", ...(plan.withRead || plan.intraday ? ["4H" as const] : []),
    ...(plan.withRead ? ["2H" as const] : []), ...(plan.intraday ? ["1H" as const] : [])];
  const upTo = rpAt;
  const readOn = plan.withRead && showRead;
  const verdictWord = (v: string) => (v === "accum" ? "ACCUMULATION" : v === "distrib" ? "DISTRIBUTION" : "NEUTRAL");
  const effortText = daily
    ? `up effort ÷ down effort per point = ${daily.detail.ratio ?? "—"} → ${verdictWord(daily.detail.verdict)}${data.suspectVolume ? " · cash-index volume (suspect) — lean on the price read" : ""}`
    : null;
  // Direction: what the read favours, and whether that's with this trade — as of the replay bar when replaying.
  const direction = daily ? (() => {
    const v = daily.detail.verdict;
    const fav = v === "accum" ? "longs" : v === "distrib" ? "shorts" : null;
    const withTrade = fav == null ? null : (fav === "longs") === plan.long;
    return { text: `${verdictWord(v)}${fav ? ` → favours ${fav}` : " → no side"}`, withTrade, asOf: daily.shade.to.slice(0, 10) };
  })() : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9, flexWrap: "wrap" }}>
        <div className="seg" style={{ display: "inline-flex" }}>
          {views.map((t) => (
            <button key={t} type="button" className={view === t ? "on" : ""} onClick={() => setView(t)}>{VIEW_LABEL[t] ?? TIMEFRAME_LABEL[t as Timeframe]}</button>
          ))}
        </div>
        <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
          {isIntra(view) ? "the composite man inside the daily bar — break / test day shaded" : TIMEFRAME_PURPOSE[view as Timeframe]}{plan.note ? ` · ${plan.note}` : ""}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {plan.replay && stepBars.length > 1 && (rpAt == null ? (
            <button type="button" onClick={() => { setRpAt(startAt()); setPlaying(false); }} style={pill(false)}>▶ replay from the signal</button>
          ) : (
            <>
              <button type="button" title="back to the signal" onClick={() => { setPlaying(false); setRpAt(startAt()); }} style={pill(false)}>⏮</button>
              <button type="button" title="one bar back (←)" onClick={() => { setPlaying(false); stepTo(rpIdx - 1); }} style={pill(false)}>◀</button>
              <button type="button" title="play / pause (space)" onClick={() => setPlaying((p) => !p)} style={pill(playing)}>{playing ? "⏸ pause" : "▶ play"}</button>
              <button type="button" title="one bar forward (→)" onClick={() => { setPlaying(false); stepTo(rpIdx + 1); }} style={pill(false)}>▶</button>
              <button type="button" onClick={() => { setPlaying(false); setRpAt(null); }} style={pill(false)}>show all</button>
            </>
          ))}
          {plan.withRead && (view === "D" || isIntra(view)) && (
            <button type="button" onClick={() => setShowRead((v) => !v)} style={pill(showRead)}>engine read {showRead ? "on" : "off"}</button>
          )}
          {!data.suspectVolume && !isIntra(view) && (
            <button type="button" onClick={() => setShowEffort((v) => !v)} style={pill(showEffort)}>effort marks {showEffort ? "on" : "off"}</button>
          )}
          {(
            <button type="button" onClick={() => setShowAdx((v) => !v)} style={pill(showAdx)}>ADX {showAdx ? "on" : "off"}</button>
          )}
        </div>
      </div>
      {rpState && <div style={{ ...mono, fontSize: 11, color: "var(--amber)", marginBottom: 6 }}>replay · {rpState} · ← → step, space play</div>}
      {direction && (
        <div style={{ ...mono, fontSize: 11.5, marginBottom: 6, color: direction.withTrade == null ? "var(--text-2)" : direction.withTrade ? "var(--green)" : "var(--red)" }}>
          engine read (range up to {direction.asOf}): <b>{direction.text}</b>
          {direction.withTrade == null ? "" : direction.withTrade ? " · with this trade" : " · against this trade"}
          {data.suspectVolume ? <span style={{ color: "var(--amber)" }}> · volume suspect on this market</span> : null}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        {TOOLS.map((t) => <button key={t.key} type="button" title={t.hint} onClick={() => setTool(t.key)} style={pill(tool === t.key)}>{t.label}</button>)}
        <button type="button" disabled={!draws.length} onClick={() => setDraws((d) => d.slice(0, -1))} style={pill(false)}>undo</button>
        <button type="button" disabled={!draws.length} onClick={() => setDraws([])} style={pill(false)}>clear marks</button>
        <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{TOOLS.find((t) => t.key === tool)!.hint} · marks stay while this popup is open</span>
      </div>
      {view === "1H" ? (
        !h1 ? <div style={{ ...mono, fontSize: 11, color: "var(--text-3)", padding: 40, textAlign: "center" }}>loading 1-hour bars…</div>
        : h1.error || !h1.bars.length ? <div style={{ ...mono, fontSize: 11, color: "var(--red)", padding: 20 }}>1-hour chart failed: {h1.error ?? "no bars"}</div>
        : <PlanSvg adx={showAdx} draws={draws} tool={tool} onDraw={(d) => setDraws((x) => [...x, d])} daily={h1.bars} suspectVolume={!h1.hasVolume} tf="1H" showEffort={false} plan={plan} upTo={upTo} />
      ) : view === "2H" ? (
        !h2 ? <div style={{ ...mono, fontSize: 11, color: "var(--text-3)", padding: 40, textAlign: "center" }}>loading 2-hour bars…</div>
        : h2.error || !h2.bars.length ? <div style={{ ...mono, fontSize: 11, color: "var(--red)", padding: 20 }}>2-hour chart failed: {h2.error ?? "no bars"}</div>
        : <PlanSvg adx={showAdx} draws={draws} tool={tool} onDraw={(d) => setDraws((x) => [...x, d])} daily={h2.bars} suspectVolume={!h2.hasVolume} tf="2H" showEffort={false} plan={plan}
            marks={readOn ? two?.marks : undefined} shade={two?.shade ?? null} upTo={upTo} />
      ) : view === "4H" ? (
        !h4 ? <div style={{ ...mono, fontSize: 11, color: "var(--text-3)", padding: 40, textAlign: "center" }}>loading 4-hour bars…</div>
        : h4.error || !h4.bars.length ? <div style={{ ...mono, fontSize: 11, color: "var(--red)", padding: 20 }}>4-hour chart failed: {h4.error ?? "no bars"}</div>
        : <PlanSvg adx={showAdx} draws={draws} tool={tool} onDraw={(d) => setDraws((x) => [...x, d])} daily={h4.bars} suspectVolume={!h4.hasVolume} tf="4H" showEffort={false} plan={plan}
            marks={readOn ? four?.marks : undefined} shade={four?.shade ?? null} upTo={upTo} />
      ) : (
        <PlanSvg adx={showAdx} draws={draws} tool={tool} onDraw={(d) => setDraws((x) => [...x, d])} daily={data.bars} suspectVolume={data.suspectVolume} tf={view} showEffort={showEffort} plan={plan}
          marks={readOn && view === "D" ? daily?.marks : undefined} shade={readOn && view === "D" ? daily?.shade ?? null : null}
          box={readOn && view === "D" ? effortText : null} upTo={upTo} />
      )}
      {readOn && (
        <div style={{ ...mono, fontSize: 10.5, marginTop: 10, display: "grid", gap: 10, lineHeight: 1.6 }}>
          <div style={{ color: "var(--text-1)", fontWeight: 500 }}>What the engine sees</div>
          {view === "2H" ? (
            <ReadBlock title="2-hour read (springs: sets the grade on futures, information on stocks)" lines={two?.lines ?? ["loading…"]} />
          ) : view === "4H" ? (
            <ReadBlock title="4-hour read (information — never changes the grade)" lines={four?.lines ?? ["loading…"]} />
          ) : daily ? (
            <>
              <ReadBlock title={`Volume read (daily) · ${daily.shade.from.slice(0, 10)} → ${daily.shade.to.slice(0, 10)}`} lines={daily.detail.reasons}
                warn={data.suspectVolume ? "this market's volume is a cash-index feed (suspect) — treat the volume read as weak" : null} />
              <ReadBlock title="Price structure (no volume) — description, not backtested" lines={daily.st.reasons} />
            </>
          ) : (
            <div style={{ color: "var(--text-3)" }}>range too short for a read</div>
          )}
        </div>
      )}
    </div>
  );
}

const pill = (on: boolean) => ({
  ...mono, fontSize: 10.5, padding: "5px 11px", borderRadius: 999,
  border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`, color: on ? "var(--accent)" : "var(--text-1)", background: "transparent",
}) as const;

function ReadBlock({ title, lines, warn }: { title: string; lines: string[]; warn?: string | null }) {
  return (
    <div>
      <div style={{ color: "var(--text-2)" }}>{title}</div>
      {warn && <div style={{ color: "var(--amber)" }}>⚠ {warn}</div>}
      {lines.map((l) => <div key={l} style={{ color: "var(--text-3)" }}>· {l}</div>)}
    </div>
  );
}

function PlanSvg({ daily: fullBars, suspectVolume, tf, showEffort, plan: fullPlan, marks, shade, box, upTo, adx: adxOn, draws = [], tool = "move", onDraw }: {
  daily: Bar[]; suspectVolume: boolean; tf: View; showEffort: boolean; plan: PlanProps;
  /** ADX(14) panel under the volume (Wilder, on the timeframe shown). */
  adx?: boolean;
  draws?: Draw[]; tool?: Tool; onDraw?: (d: Draw) => void;
  marks?: Mark[]; shade?: { from: string; to: string } | null; box?: string | null;
  /** Replay: draw only the bars up to this date / timestamp, and the trade only as far as it had got. */
  upTo?: string | null;
}) {
  const cut = upTo ? fullBars.filter((b) => b.date <= upTo) : fullBars;
  const daily = cut.length >= 2 ? cut : fullBars.slice(0, 2);
  const day = upTo?.slice(0, 10);
  const fp = fullPlan.played;
  const plan: PlanProps = !day || !fp ? fullPlan : {
    ...fullPlan,
    played: {
      ...fp,
      // hidden until they happen — also kept out of the price scale, so the chart doesn't hint at the outcome
      ...(fp.fillDate && fp.fillDate.slice(0, 10) <= day ? {} : { fillDate: null, fillPrice: null }),
      ...(fp.exitDate && fp.exitDate.slice(0, 10) <= day ? {} : { exitDate: null, exitPrice: null, win: null }),
      stops: fp.stops.filter((s) => s.date.slice(0, 10) <= day),
    },
  };
  const W = 1000, PH = 360, VH = 100, GAP = 14, PAD = 64, LABEL_W = 150, FUTURE = 56, AH = 80;
  const AT = PH + GAP + VH + GAP;                    // top of the ADX panel
  const H = PH + GAP + VH + (adxOn ? GAP + AH : 0);
  const { rangeLo, rangeHi, fmt } = plan;

  // Same re-location rule as the Wyckoff drawer: dates, not indices, survive
  // rolling up to weekly/monthly.
  const all = tf === "D" || isIntra(tf) ? daily : aggregateBars(daily, tf as Timeframe);
  // 4H: a full timestamp matches its bar; a plain date matches that day's first 4h bar.
  const at = (d: string) => (isIntra(tf)
    ? (d.length > 10 ? all.findIndex((b) => b.date === d) : all.findIndex((b) => b.date.slice(0, 10) >= d.slice(0, 10)))
    : tf === "D" ? all.findIndex((b) => b.date.slice(0, 10) === d.slice(0, 10)) : indexForDate(all, tf, d));
  const fullStart = Math.max(0, at(plan.rangeStart));
  const baseWin = isIntra(tf)
    ? viewWindow(all.length, "D", Math.max(0, at(plan.signalDate) - 60))
    : viewWindow(all.length, tf, fullStart);
  // Zoom / pan: your own window into the bars (scroll = zoom around the cursor, drag = move).
  const [zw, setZw] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => { setZw(null); }, [tf]);           // a new timeframe starts unzoomed
  const win = (() => {
    if (!zw) return baseWin;
    const to = Math.max(Math.min(all.length, zw.to), Math.min(all.length, 8));
    return { from: Math.max(0, Math.min(zw.from, to - 8)), to };
  })();
  const bars = all.slice(win.from, win.to);
  // ADX on the whole series up to the last bar shown (only past bars feed each value), then cut to the window.
  const adxAll = adxOn ? adxSeries(all) : null;
  const ax = adxAll ? { adx: adxAll.adx.slice(win.from, win.to), pdi: adxAll.pdi.slice(win.from, win.to), mdi: adxAll.mdi.slice(win.from, win.to) } : null;
  const shift = (i: number) => (i < 0 ? null : i - win.from >= 0 && i - win.from < bars.length ? i - win.from : null);
  const startIdx = shift(fullStart) ?? 0;
  const sigIdx = shift(at(plan.signalDate));
  const n = bars.length;

  const pl = plan.played;
  const levels = [plan.target, plan.breakevenAt, plan.entryPrice, plan.stop, pl?.exitPrice ?? undefined, ...(pl?.stops.map((s) => s.stop) ?? [])]
    .filter((p): p is number => p != null);
  const pMin = Math.min(...bars.map((b) => b.l), rangeLo, ...levels);
  const pMax = Math.max(...bars.map((b) => b.h), rangeHi, ...levels);
  const pSpan = Math.max(pMax - pMin, 1e-9);

  const vol = volumeView(bars, { trusted: !suspectVolume });
  const noVolume = !bars.some((b) => b.v > 0);
  const rightEdge = W - LABEL_W - FUTURE;            // last candle sits here; the plan strip is to its right
  const xw = zw ? (rightEdge - PAD) / n : Math.min((rightEdge - PAD) / n, MAX_BAR_PITCH);
  const cw = Math.max(1.5, Math.min(zw ? 40 : 9, xw * 0.62));
  const x = (i: number) => rightEdge - (n - 1 - i) * xw - xw / 2;
  const y = (p: number) => 10 + (1 - (p - pMin) / pSpan) * (PH - 20);
  const vy = (v: number) => PH + GAP + (1 - Math.min(v, vol.maxV) / vol.maxV) * VH;
  const boxEnd = sigIdx ?? n - 1;
  const planFrom = sigIdx != null ? x(sigIdx) : rightEdge;
  const plotRight = W - LABEL_W;

  const [hover, setHover] = useState<number | null>(null);
  const [pos, setPos] = useState<{ xPct: number; yPct: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; from: number; to: number } | null>(null);
  const [pending, setPending] = useState<{ kind: "zone" | "trend"; date: string; price: number } | null>(null);
  const [cursorP, setCursorP] = useState<number | null>(null);
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { xv: ((e.clientX - r.left) / r.width) * W, yv: ((e.clientY - r.top) / r.height) * H, r };
  };
  const idxAt = (xv: number) => Math.round(n - 1 - (rightEdge - xv - xw / 2) / xw);
  const priceAt = (yv: number) => pMin + (1 - (yv - 10) / (PH - 20)) * pSpan;
  /** Pool line / point: snap to the hovered candle's high or low when within 8 px. */
  const snap = (i: number, yv: number) => {
    const b = bars[i]; if (!b) return priceAt(yv);
    const dh = Math.abs(y(b.h) - yv), dl = Math.abs(y(b.l) - yv);
    return Math.min(dh, dl) <= 8 ? (dh <= dl ? b.h : b.l) : priceAt(yv);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const { xv, yv, r } = toSvg(e);
    const i = idxAt(xv);
    setHover(i >= 0 && i < n ? i : null);
    setPos({ xPct: ((e.clientX - r.left) / r.width) * 100, yPct: ((e.clientY - r.top) / r.height) * 100 });
    setCursorP(yv < PH ? priceAt(yv) : null);
    if (drag.current && tool === "move") {
      const k = Math.round((drag.current.x - xv) / xw);
      const span = drag.current.to - drag.current.from;
      const from = Math.max(0, Math.min(all.length - span, drag.current.from + k));
      setZw({ from, to: from + span });
    }
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    onMove(e);
    const { xv, yv } = toSvg(e);
    const i = Math.max(0, Math.min(n - 1, idxAt(xv)));
    if (tool === "move") { drag.current = { x: xv, from: win.from, to: win.to }; e.currentTarget.setPointerCapture(e.pointerId); return; }
    if (yv > PH || !onDraw) return;
    const date = bars[i].date;
    if (tool === "point") onDraw({ kind: "point", date, price: snap(i, yv), label: `P${draws.filter((d) => d.kind === "point").length + 1}` });
    else if (tool === "line") onDraw({ kind: "line", date, price: snap(i, yv) });
    else if (tool === "zone") { setPending({ kind: "zone", date, price: priceAt(yv) }); e.currentTarget.setPointerCapture(e.pointerId); }
    else if (tool === "trend") {
      if (pending?.kind === "trend") { onDraw({ kind: "trend", d1: pending.date, p1: pending.price, d2: date, p2: snap(i, yv) }); setPending(null); }
      else setPending({ kind: "trend", date, price: snap(i, yv) });
    }
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (pending?.kind === "zone" && onDraw) {
      const { yv } = toSvg(e);
      const p2 = priceAt(Math.min(yv, PH));
      if (Math.abs(y(p2) - y(pending.price)) > 3) onDraw({ kind: "zone", date: pending.date, p1: pending.price, p2 });
      setPending(null);
    }
  };
  // Scroll = zoom around the bar under the cursor (native listener: React's wheel handler can't preventDefault).
  const zoomRef = useRef({ win, len: all.length, n, idxAt });
  zoomRef.current = { win, len: all.length, n, idxAt };
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { win: w, len, n: cnt, idxAt: ia } = zoomRef.current;
      const { xv } = toSvg(e);
      const a = w.from + Math.max(0, Math.min(cnt - 1, ia(xv)));
      const span = Math.max(8, Math.min(len, Math.round(cnt * (e.deltaY > 0 ? 1.2 : 1 / 1.2))));
      const f = cnt > 1 ? (a - w.from) / (cnt - 1) : 1;
      const from = Math.max(0, Math.min(len - span, Math.round(a - f * (span - 1))));
      setZw({ from, to: from + span });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
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
    ...(plan.hideBreakeven ? [] : [{ key: "+1R→BE", p: plan.breakevenAt, col: "var(--green)", dash: "2 3", w: 1.2 }]),
    { key: plan.entry === "aggressive" ? "entry~" : "entry", p: plan.entryPrice, col: "var(--accent)", dash: "", w: 1.8 },
    { key: "stop", p: plan.stop, col: "var(--red)", dash: "5 3", w: 1.5 },
  ].sort((a, b) => y(a.p) - y(b.p));
  const ly: number[] = [];
  for (const l of lv) { let v = y(l.p) + 4; if (ly.length && v - ly[ly.length - 1] < 14) v = ly[ly.length - 1] + 14; ly.push(Math.min(v, PH - 2)); }

  // Stop trail: one step per bar; on weekly/monthly the last stop in each bar wins.
  const stopPts = (() => {
    const byIdx = new Map<number, number>();
    for (const s of pl?.stops ?? []) { const i = shift(at(s.date)); if (i != null) byIdx.set(i, s.stop); }
    return [...byIdx].sort((a, b) => a[0] - b[0]);
  })();
  const stopPath = stopPts.map(([i, v], k) => `${k ? "L" : "M"}${x(i) - xw / 2} ${y(v)} H${x(i) + xw / 2}`).join(" ");
  const fillIdx = pl?.fillDate ? shift(at(pl.fillDate)) : null;
  const exitIdx = pl?.exitDate ? shift(at(pl.exitDate)) : null;
  const exitCol = pl?.win ? "var(--green)" : pl?.win === false ? "var(--red)" : "var(--text-2)";

  const sigLabel = plan.signalLabel ?? (plan.entry === "conservative" ? "B" : plan.long ? "S" : "U");
  const sigTitle = plan.entry === "conservative" ? "the break that qualified" : plan.long ? "spring" : "upthrust";

  return (
    <div className="card" style={{ padding: 10, position: "relative" }}>
      {zw && <button type="button" onClick={() => setZw(null)}
        style={{ position: "absolute", top: 14, left: 14, zIndex: 4, ...mono, fontSize: 10, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--border-strong)", background: "var(--surface-1)", color: "var(--text-1)" }}>reset zoom</button>}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", touchAction: "none", cursor: tool === "move" ? (drag.current ? "grabbing" : "grab") : "crosshair" }}
        onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => { setHover(null); setPos(null); setCursorP(null); }}>
        {/* range edges + prices */}
        {!plan.hideBox && <rect x={x(startIdx) - xw / 2} y={y(rangeHi)} width={Math.max(2, x(boxEnd) - x(startIdx))} height={Math.max(1, y(rangeLo) - y(rangeHi))} fill="var(--accent)" opacity={0.05} />}
        {!plan.hideBox && [rangeHi, rangeLo].map((p, i) => (
          <g key={i}>
            <line x1={x(startIdx)} y1={y(p)} x2={x(boxEnd)} y2={y(p)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
            <text x={4} y={y(p) + 3} fontSize={10} fill="var(--text-3)" {...mono}>{fmt(p)}</text>
          </g>
        ))}

        {/* plan zones from the signal bar into the plan strip */}
        <rect x={planFrom} y={Math.min(y(plan.entryPrice), y(plan.stop))} width={plotRight - planFrom} height={Math.abs(y(plan.stop) - y(plan.entryPrice))} fill="var(--red)" opacity={0.1} />
        {!plan.hideBreakeven && <rect x={planFrom} y={Math.min(y(plan.entryPrice), y(plan.breakevenAt))} width={plotRight - planFrom} height={Math.abs(y(plan.breakevenAt) - y(plan.entryPrice))} fill="var(--green)" opacity={0.08} />}

        {bars.map((b, i) => {
          const col = b.c >= b.o ? "var(--green)" : "var(--red)";
          return (
            <g key={i} opacity={i < startIdx ? 0.75 : 1}>
              <line x1={x(i)} y1={y(b.h)} x2={x(i)} y2={y(b.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - cw / 2} y={y(Math.max(b.o, b.c))} width={cw} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))} fill={col} />
              {!noVolume && <rect x={x(i) - cw / 2} y={vy(b.v)} width={cw} height={PH + GAP + VH - vy(b.v)} fill={col} opacity={vol.alphaAt(i)} />}
              {!noVolume && vol.clipped(b.v) && <rect x={x(i) - cw / 2} y={PH + GAP} width={cw} height={2} fill="var(--amber)" />}
            </g>
          );
        })}

        {noVolume && <text x={PAD + 4} y={PH + GAP + 40} fontSize={10} fill="var(--text-3)" {...mono}>no volume for this market on this timeframe</text>}
        {vol.trusted && !noVolume && n > 2 && (
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

        {/* engine read: the window it read (daily) / the break or test day (4H) */}
        {shade && (() => {
          const a = shift(at(shade.from)), b = shift(at(shade.to));
          if (a == null && b == null) return null;
          const xa = x(a ?? 0) - xw / 2, xb = x(b ?? n - 1) + xw / 2;
          return <rect x={xa} y={0} width={Math.max(2, xb - xa)} height={PH} fill="var(--accent)" opacity={0.07} />;
        })()}
        {marks?.map((m) => {
          const i = shift(at(m.date));
          if (i == null) return null;
          const b = bars[i];
          return <Marker key={m.label + m.date} x={x(i)} y={m.below ? y(b.l) + 14 : y(b.h) - 9} label={m.label} title={m.title} col={m.col} />;
        })}
        {box && <text x={PAD} y={16} fontSize={10.5} fill="var(--text-2)" {...mono}>{box}</text>}

        {/* the bar that fired */}
        {sigIdx != null && (
          <g>
            <line x1={x(sigIdx)} y1={0} x2={x(sigIdx)} y2={PH} stroke="var(--text-2)" strokeWidth={0.9} strokeDasharray="3 3" opacity={0.6} />
            {!isIntra(tf) && <Marker x={x(sigIdx)} y={sigLabel === "S" ? y(bars[sigIdx].l) + 13 : y(bars[sigIdx].h) - 7} label={sigLabel} title={sigTitle} />}
          </g>
        )}

        {/* AB=CD swing: A-B-C, then the projected leg to D in the plan strip */}
        {plan.swing && (() => {
          const pts = plan.swing.map((p) => ({ ...p, i: shift(at(p.date)) })).filter((p) => p.i != null) as { date: string; price: number; label: string; i: number }[];
          if (pts.length < 2) return null;
          const dX = plotRight - 20, last = pts[pts.length - 1];
          return (
            <g>
              <polyline fill="none" stroke="var(--accent)" strokeWidth={1.6} points={pts.map((p) => `${x(p.i)},${y(p.price)}`).join(" ")} />
              <line x1={x(last.i)} y1={y(last.price)} x2={dX} y2={y(plan.entryPrice)} stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="5 4" />
              {pts.map((p) => <text key={p.label} x={x(p.i) + 4} y={y(p.price) + ((p.label !== "B") === plan.long ? -6 : 14)} fontSize={11} fill="var(--accent)" {...mono}>{p.label}</text>)}
              <text x={dX + 4} y={y(plan.entryPrice) - 6} fontSize={11} fill="var(--accent)" {...mono}>D</text>
            </g>
          );
        })()}

        {/* how it played out (Filled page) */}
        {stopPath && <path d={stopPath} fill="none" stroke="var(--amber)" strokeWidth={1.8} />}
        {fillIdx != null && pl?.fillPrice != null && (
          <g>
            <circle cx={x(fillIdx)} cy={y(pl.fillPrice)} r={4} fill="var(--accent)" />
            <text x={x(fillIdx) + 6} y={y(pl.fillPrice) - 6} fontSize={10} fill="var(--accent)" {...mono}>in {fmt(pl.fillPrice)}</text>
          </g>
        )}
        {exitIdx != null && pl?.exitPrice != null && (
          <g>
            <line x1={x(exitIdx)} y1={0} x2={x(exitIdx)} y2={PH} stroke={exitCol} strokeWidth={0.9} strokeDasharray="3 3" opacity={0.7} />
            <circle cx={x(exitIdx)} cy={y(pl.exitPrice)} r={4} fill={exitCol} />
            <text x={x(exitIdx) + 6} y={y(pl.exitPrice) + 14} fontSize={10} fill={exitCol} {...mono}>out {fmt(pl.exitPrice)}</text>
          </g>
        )}

        {/* your marks */}
        {draws.map((d, k) => {
          const xi = (date: string) => { const i = at(date) - win.from; return i < 0 ? x(0) - xw / 2 : i >= n ? null : x(i); };
          if (d.kind === "point") { const xx = xi(d.date); return xx == null ? null : (
            <g key={k}><circle cx={xx} cy={y(d.price)} r={5} fill="none" stroke={DRAW_COL} strokeWidth={1.6} />
              <text x={xx + 8} y={y(d.price) - 6} fontSize={10.5} fill={DRAW_COL} {...mono}>{d.label} {fmt(d.price)}</text></g>); }
          if (d.kind === "line") { const xx = xi(d.date); return xx == null ? null : (
            <g key={k}><line x1={xx} y1={y(d.price)} x2={plotRight} y2={y(d.price)} stroke={DRAW_COL} strokeWidth={1.3} strokeDasharray="6 3" />
              <text x={plotRight - 4} y={y(d.price) - 4} fontSize={10} fill={DRAW_COL} textAnchor="end" {...mono}>pool {fmt(d.price)}</text></g>); }
          if (d.kind === "zone") { const xx = xi(d.date); return xx == null ? null : (
            <g key={k}><rect x={xx} y={Math.min(y(d.p1), y(d.p2))} width={plotRight - xx} height={Math.abs(y(d.p1) - y(d.p2))} fill={DRAW_COL} opacity={0.12} stroke={DRAW_COL} strokeOpacity={0.5} />
              <text x={plotRight - 4} y={Math.min(y(d.p1), y(d.p2)) - 4} fontSize={10} fill={DRAW_COL} textAnchor="end" {...mono}>zone {fmt(Math.min(d.p1, d.p2))}–{fmt(Math.max(d.p1, d.p2))}</text></g>); }
          const x1 = xi(d.d1), x2 = xi(d.d2);
          return x1 == null || x2 == null ? null : <line key={k} x1={x1} y1={y(d.p1)} x2={x2} y2={y(d.p2)} stroke={DRAW_COL} strokeWidth={1.5} />;
        })}
        {/* ghost: where the mark will land before you click (pool / point snap to the wick like the click does) */}
        {tool !== "move" && !pending && hover != null && cursorP != null && (() => {
          const gp = tool === "line" || tool === "point" || tool === "trend" ? snap(hover, y(cursorP)) : cursorP;
          const gx = x(hover), gy = y(gp);
          return (
            <g pointerEvents="none" opacity={0.45}>
              {tool === "line" && <line x1={gx} y1={gy} x2={plotRight} y2={gy} stroke={DRAW_COL} strokeWidth={1.3} strokeDasharray="6 3" />}
              {tool === "zone" && <line x1={gx} y1={gy} x2={plotRight} y2={gy} stroke={DRAW_COL} strokeWidth={1} />}
              {(tool === "point" || tool === "trend") && <circle cx={gx} cy={gy} r={5} fill="none" stroke={DRAW_COL} strokeWidth={1.4} />}
              <text x={tool === "line" || tool === "zone" ? plotRight - 4 : gx + 8} y={gy - 5} fontSize={10} fill={DRAW_COL} textAnchor={tool === "line" || tool === "zone" ? "end" : "start"} {...mono}>{fmt(gp)}</text>
            </g>
          );
        })()}
        {pending && hover != null && cursorP != null && (pending.kind === "zone"
          ? <rect x={x(Math.max(0, at(pending.date) - win.from))} y={Math.min(y(pending.price), y(cursorP))} width={plotRight - x(Math.max(0, at(pending.date) - win.from))} height={Math.abs(y(pending.price) - y(cursorP))} fill={DRAW_COL} opacity={0.1} />
          : <line x1={x(Math.max(0, at(pending.date) - win.from))} y1={y(pending.price)} x2={x(hover)} y2={y(cursorP)} stroke={DRAW_COL} strokeWidth={1.2} strokeDasharray="4 3" />)}

        {/* ADX(14) panel */}
        {ax && (() => {
          const ay = (v: number) => AT + (1 - Math.min(v, 60) / 60) * AH;
          const line = (arr: (number | null)[]) => arr.map((v, i) => (v == null ? null : `${x(i)},${ay(v)}`)).filter(Boolean).join(" ");
          return (
            <g>
              <line x1={0} y1={AT - GAP / 2} x2={plotRight} y2={AT - GAP / 2} stroke="var(--border-subtle)" strokeWidth={0.8} />
              {[20, 25].map((lv) => (
                <g key={lv}>
                  <line x1={PAD} y1={ay(lv)} x2={plotRight} y2={ay(lv)} stroke="var(--text-3)" strokeWidth={0.6} strokeDasharray="3 4" opacity={0.6} />
                  <text x={plotRight + 6} y={ay(lv) + 3} fontSize={9} fill="var(--text-3)" {...mono}>{lv}</text>
                </g>
              ))}
              <polyline fill="none" stroke="var(--green)" strokeWidth={0.9} opacity={0.6} points={line(ax.pdi)} />
              <polyline fill="none" stroke="var(--red)" strokeWidth={0.9} opacity={0.6} points={line(ax.mdi)} />
              <polyline fill="none" stroke="var(--text-1)" strokeWidth={1.6} points={line(ax.adx)} />
              <text x={4} y={AT + 10} fontSize={9.5} fill="var(--text-2)" {...mono}>ADX 14</text>
              <text x={4} y={AT + 22} fontSize={9} fill="var(--green)" {...mono}>+DI</text>
              <text x={26} y={AT + 22} fontSize={9} fill="var(--red)" {...mono}>−DI</text>
            </g>
          );
        })()}

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
            {isIntra(tf) ? `${hb.date.slice(0, 16).replace("T", " ")} UTC` : hb.date}
            <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
              {" "}· {hover < startIdx ? "context" : sigIdx != null && hover > sigIdx ? "after the signal" : hover === sigIdx ? sigTitle : `range bar ${hover - startIdx + 1}`}
            </span>
          </div>
          <div>O {fmt(hb.o)} · H {fmt(hb.h)} · L {fmt(hb.l)} · C <span style={{ color: hb.c >= hb.o ? "var(--green)" : "var(--red)" }}>{fmt(hb.c)}</span></div>
          {ax && ax.adx[hover] != null && (
            <div>ADX <span style={{ color: "var(--text-1)" }}>{ax.adx[hover]!.toFixed(1)}</span>
              {" "}· <span style={{ color: "var(--green)" }}>+DI {ax.pdi[hover]!.toFixed(1)}</span>
              {" "}· <span style={{ color: "var(--red)" }}>−DI {ax.mdi[hover]!.toFixed(1)}</span>
              {hover >= 5 && ax.adx[hover - 5] != null ? <span> · {ax.adx[hover]! - ax.adx[hover - 5]! >= 0 ? "rising" : "falling"} over 5 bars</span> : null}
            </div>
          )}
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

function Marker({ x, y, label, title, col = "var(--accent)" }: { x: number; y: number; label: string; title: string; col?: string }) {
  const r = label.length > 2 ? 10 : 8;
  return (
    <g>
      <title>{title}</title>
      <circle cx={x} cy={y} r={r} fill="var(--bg-sidebar, #0a0b0f)" stroke={col} strokeWidth={1.2} />
      <text x={x} y={y + 3.4} fontSize={label.length > 2 ? 8 : 9.5} fontWeight={700} fill={col} textAnchor="middle" {...mono}>{label}</text>
    </g>
  );
}

/** ADX / +DI / −DI, Wilder smoothing (the same ADX(14) as the Nov 2026 tests). null until there's enough history. */
function adxSeries(b: Bar[], n = 14) {
  const len = b.length;
  const adx: (number | null)[] = new Array(len).fill(null), pdi: (number | null)[] = new Array(len).fill(null), mdi: (number | null)[] = new Array(len).fill(null);
  let tr = 0, pdm = 0, mdm = 0, adxV = 0, dxSum = 0;
  for (let i = 1; i < len; i++) {
    const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l;
    const p = up > dn && up > 0 ? up : 0, m = dn > up && dn > 0 ? dn : 0;
    const t = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    if (i <= n) { tr += t; pdm += p; mdm += m; if (i < n) continue; }
    else { tr = tr - tr / n + t; pdm = pdm - pdm / n + p; mdm = mdm - mdm / n + m; }
    const pd = tr > 0 ? (100 * pdm) / tr : 0, md = tr > 0 ? (100 * mdm) / tr : 0;
    pdi[i] = pd; mdi[i] = md;
    const dx = pd + md > 0 ? (100 * Math.abs(pd - md)) / (pd + md) : 0;
    if (i < 2 * n) { dxSum += dx; if (i === 2 * n - 1) { adxV = dxSum / n; adx[i] = adxV; } }
    else { adxV = (adxV * (n - 1) + dx) / n; adx[i] = adxV; }
  }
  return { adx, pdi, mdi };
}
