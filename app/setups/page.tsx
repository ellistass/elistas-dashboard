"use client";
// app/setups/page.tsx — the mechanical setups. Not the read.
//
// The Wyckoff desk is where you read a range and lock a call. This page only
// says: a setup has printed that fits the rules we backtested, here are the
// prices, here is the plan. If you've read the range, your read shows beside
// it — the read is the basis; the setup is the confirmation.

import { useCallback, useEffect, useState } from "react";
import { Target, RefreshCw, CheckCircle2, XCircle, Clock, Zap, BookOpen } from "lucide-react";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../wyckoff/_components/ui";
import type { InstrumentSetup } from "@/lib/setups/scan";
import SetupChart from "./SetupChart";
import SetupChartFull from "./SetupChartFull";
import ForexSection from "./ForexSection";
import TrendSection from "./TrendSection";
import HistorySection from "./HistorySection";
import TakeBar, { type TakeCard } from "./TakeBar";
import RiskBlock from "./RiskBlock";
import VolLine from "./VolLine";
import PriceCheck from "./PriceCheck";
import type { ValRead } from "@/lib/setups/valuation";

type Row = InstrumentSetup & { yourRead: string | null; readAgrees: boolean | null; deskUnread: boolean };
interface Payload { at: string; setups: Row[]; scanned: number; errors: { instrument: string; error: string }[] }

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toFixed(5));

const STATE: Record<Row["state"], { label: string; icon: JSX.Element; tone: string }> = {
  filled: { label: "entry hit on the last bar", icon: <Zap size={11} />, tone: "var(--green)" },
  trigger: { label: "trigger — enter at the next open", icon: <Zap size={11} />, tone: "var(--green)" },
  armed: { label: "armed — limit order at the edge", icon: <Clock size={11} />, tone: "var(--text-2)" },
};

export default function SetupsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [market, setMarket] = useState<"futures" | "forex" | "trend" | "abcd" | "history">("futures");
  const [entry, setEntry] = useState<"all" | "conservative" | "aggressive">("all");
  const [gradeA, setGradeA] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/setups${fresh ? "?fresh=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.setups ?? []).filter((s) => (entry === "all" || s.entry === entry) && (!gradeA || s.grade === "A"));
  // Markets FTMO doesn't offer (executeSymbol "") are information only.
  const onFtmo = rows.filter((s) => !!s.executeSymbol);
  const offFtmo = rows.filter((s) => !s.executeSymbol);
  const live = onFtmo.filter((s) => s.state !== "armed");
  const armed = onFtmo.filter((s) => s.state === "armed");

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <SectionHeader
        icon={<Target size={14} />}
        title="Setups"
        count={onFtmo.length}
        note={`mechanical triggers from the backtested rules · ${data?.scanned ?? 0} instruments · scanned ${data ? new Date(data.at).toLocaleTimeString() : ""}`}
        right={
          <button onClick={() => load(true)} disabled={busy} style={{ ...mono, fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> rescan
          </button>
        }
      />

      <div style={{ display: "flex", gap: 8, margin: "8px 0 16px", flexWrap: "wrap" }}>
        <Chip on={market === "futures"} onClick={() => setMarket("futures")}>futures / stocks</Chip>
        <Chip on={market === "forex"} onClick={() => setMarket("forex")}>forex</Chip>
        <Chip on={market === "trend"} onClick={() => setMarket("trend")}>trend slot (paper)</Chip>
        <Chip on={market === "abcd"} onClick={() => setMarket("abcd")}>AB=CD (paper)</Chip>
        <Chip on={market === "history"} onClick={() => setMarket("history")}>history</Chip>
      </div>

      {market === "history" ? (
        <HistorySection />
      ) : market === "forex" ? (
        <ForexSection view="retest" />
      ) : market === "trend" ? (
        <TrendSection />
      ) : market === "abcd" ? (
        <ForexSection view="abcd" />
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, margin: "0 0 16px", flexWrap: "wrap" }}>
            {(["all", "conservative", "aggressive"] as const).map((e) => (
              <Chip key={e} on={entry === e} onClick={() => setEntry(e)}>{e}</Chip>
            ))}
            <Chip on={gradeA} onClick={() => setGradeA(!gradeA)}>grade A only</Chip>
          </div>

          {!data && !error ? <LoadingCard what="setups (scanning the basket — up to a minute on a cold start)" /> : null}
          {error && !data ? <ErrorCard message={error} /> : null}

          {data ? (
            <>
              <Rules />

              <h3 style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: "20px 0 8px" }}>ACT NOW · {live.length}</h3>
              {live.length ? <Grid rows={live} /> : <EmptyState text="Nothing triggered on the last completed bar." small />}

              <h3 style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: "20px 0 8px" }}>ARMED — ORDERS WAITING · {armed.length}</h3>
              {armed.length ? <Grid rows={armed} /> : <EmptyState text="No qualified breaks waiting for a retest." small />}

              {offFtmo.length > 0 && (
                <details style={{ marginTop: 20 }}>
                  <summary style={{ ...mono, fontSize: 11, color: "var(--text-3)", cursor: "pointer" }}>
                    NOT ON FTMO — INFORMATION ONLY · {offFtmo.length}
                  </summary>
                  <div style={{ marginTop: 8 }}><Grid rows={offFtmo} readOnly /></div>
                </details>
              )}

              {data.errors.length ? (
                <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginTop: 16 }}>
                  feed errors: {data.errors.map((e) => e.instrument).join(", ")}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function Grid({ rows, readOnly = false }: { rows: Row[]; readOnly?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
      {rows.map((s) => <Card key={`${s.instrument}|${s.entry}|${s.side}|${s.signalDate}`} s={s} readOnly={readOnly} />)}
    </div>
  );
}

function Card({ s, readOnly = false }: { s: Row; readOnly?: boolean }) {
  const long = s.side === "long";
  // Inverted futures (6C/6J/6S): show the EXECUTE direction, never make the trader flip it.
  const execLong = s.inverted ? !long : long;
  const tc = takeCard(s, execLong);   // the card's orders in the terms you execute
  const st = STATE[s.state];
  const [open, setOpen] = useState(false);
  const chartProps = {
    bars: s.bars, rangeLo: s.rangeLo, rangeHi: s.rangeHi, rangeStart: s.rangeStart, signalDate: s.signalDate,
    entry: s.entryPrice, stop: s.stop, breakevenAt: s.breakevenAt, target: s.target,
    long, suspectVolume: s.volumeQuality === "suspect", fmt,
  };
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 14, background: "var(--surface-1)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{s.instrument}</span>
          {s.executeSymbol && s.executeSymbol !== s.instrument && (
            <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginLeft: 6 }}>→ {s.executeSymbol}</span>
          )}
        </div>
        <span style={{ ...mono, fontSize: 10, padding: "2px 8px", borderRadius: 999, border: `1px solid ${s.grade === "A" ? "var(--green)" : "var(--border-subtle)"}`, color: s.grade === "A" ? "var(--green)" : "var(--text-3)" }}>
          grade {s.grade}
        </span>
      </div>

      <div style={{ ...mono, fontSize: 11, marginTop: 6, color: execLong ? "var(--green)" : "var(--red)" }}>
        {execLong ? "BUY" : "SELL"} {s.executeSymbol || s.instrument} · {s.entry}
        {s.entry === "aggressive" ? (long ? " (spring)" : " (upthrust)") : " (retest)"}
      </div>
      {s.volumeUnverified && (
        <div style={{ ...mono, fontSize: 10, color: "var(--amber)", marginTop: 4 }}>
          ⚠ volume unavailable on the signal bar (futures contract roll or a bad print) — check volume on the live contract before trading
        </div>
      )}
      {s.feedGap && (
        <div style={{ ...mono, fontSize: 10, color: s.entry === "aggressive" ? "var(--red)" : "var(--amber)", marginTop: 4 }}>
          {s.entry === "aggressive"
            ? `✕ stale: Yahoo has no bar for ${s.feedGap}, so the next open has already passed — don't enter (or a market holiday: check)`
            : `⚠ Yahoo has no bar for ${s.feedGap} (bad print or holiday) — check the live chart before placing`}
        </div>
      )}
      <div style={{ ...mono, fontSize: 10, color: st.tone, marginTop: 4, display: "flex", gap: 5, alignItems: "center" }}>
        {st.icon} {st.label}{s.barsLeft != null && s.state !== "filled" ? ` · ${s.barsLeft} bars left` : ""}
      </div>

      <button
        onClick={() => setOpen(true)}
        title="Click to expand"
        style={{ marginTop: 10, display: "block", width: "100%", padding: 0, background: "none", border: "none", cursor: "zoom-in" }}
      >
        <SetupChart {...chartProps} bars={cardWindow(s)} />
      </button>
      {open && <ChartModal s={s} onClose={() => setOpen(false)} chartProps={chartProps} execLong={execLong} />}

      <OrderBox s={s} execLong={execLong} />

      <div style={{ ...mono, fontSize: 11, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 2, marginTop: 10 }}>
        <span style={{ color: "var(--text-3)" }}>entry</span><span>{s.entry === "aggressive" ? `next open (ref ${fmt(s.entryPrice)})` : fmt(s.entryPrice)}</span>
        <span style={{ color: "var(--text-3)" }}>stop</span><span>{fmt(s.stop)}</span>
        <span style={{ color: "var(--text-3)" }}>+1R → breakeven</span><span>{fmt(s.breakevenAt)}</span>
        <span style={{ color: "var(--text-3)" }}>then</span><span>{s.trailAtr ? `trail ${s.trailAtr} × ATR behind the best price` : "trail 1R behind the best price"}</span>
        <span style={{ color: "var(--text-3)" }}>cap</span><span>{fmt(s.target)}</span>
      </div>
      <VolLine v={s.vol} fmt={fmt} trailAtr={s.trailAtr} />
      {readOnly ? (
        <p style={{ ...mono, fontSize: 10, color: "var(--amber)", marginTop: 8 }}>
          not tradeable on FTMO — shown for information only
        </p>
      ) : (
        <RiskBlock instrument={tc.instrument} executeSymbol={tc.executeSymbol} side={tc.side} grade={tc.grade}
          entry={tc.entry} stop={tc.stop} withTrend={s.context.daily === "with-trend"} />
      )}
      {s.inverted && (
        <p style={{ ...mono, fontSize: 9.5, color: "var(--amber)", marginTop: 6 }}>
          Prices are the FUTURE's. Execute {s.executeSymbol} in the opposite direction; translate levels on your chart.
        </p>
      )}

      <div style={{ marginTop: 10, display: "grid", gap: 3 }}>
        {s.checks.map((c) => (
          <div key={c.label} style={{ ...mono, fontSize: 10, display: "flex", gap: 6, alignItems: "center", color: c.pass ? "var(--text-2)" : "var(--text-3)" }}>
            {c.pass ? <CheckCircle2 size={10} color="var(--green)" /> : <XCircle size={10} color="var(--amber)" />}
            <span style={{ flex: 1 }}>{c.label}</span>
            {c.value && <span style={{ color: "var(--text-3)" }}>{c.value}</span>}
          </div>
        ))}
      </div>

      <SetupRead s={s} />
      <ValuationLine v={s.valuation ?? null} entry={s.entry} />

      {s.yourRead != null && (
        <div style={{ ...mono, fontSize: 10, marginTop: 6, display: "flex", gap: 6, alignItems: "center",
          color: s.readAgrees == null ? "var(--text-3)" : s.readAgrees ? "var(--green)" : "var(--red)" }}>
          <BookOpen size={10} />
          {s.yourRead === "pass" ? "you passed on this range"
            : `your read: ${s.yourRead.toUpperCase()} — ${s.readAgrees ? "agrees" : "DISAGREES"}`}
        </div>
      )}

      <div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.6 }}>
        {s.notes.map((n) => <div key={n}>· {n}</div>)}
        <div>· range {fmt(s.rangeLo)}–{fmt(s.rangeHi)} from {s.rangeStart} · signal {s.signalDate} · data to {s.lastBarDate}
          {s.volumeQuality === "suspect" ? " · volume feed unverified" : ""}</div>
      </div>

      {!readOnly && s.state !== "filled" && (
        <PriceCheck card={{
          entryKind: s.entry === "aggressive" ? "open" : "limit",
          long: execLong,
          entry: tc.entry, stop: tc.stop, cap: tc.cap ?? tc.entry,
          // Inverted FX futures flip to the spot pair, same as the order lines.
          plus1R: s.inverted ? 1 / s.breakevenAt : s.breakevenAt,
          rangeLo: s.inverted ? 1 / s.rangeHi : s.rangeLo,
          rangeHi: s.inverted ? 1 / s.rangeLo : s.rangeHi,
          symbol: s.instrument, inverted: s.inverted,
        }} />
      )}
      {!readOnly && <TakeBar card={tc} />}
    </div>
  );
}

/** The card's orders in the terms you execute. Inverted futures (6C/6J/6S) quote
 *  XXX/USD; the spot pair is USD/XXX, so every level is 1 ÷ the future's. */
function takeCard(s: Row, execLong: boolean): TakeCard {
  const px = (x: number) => (s.inverted ? 1 / x : x);
  return {
    ref: { market: "futures", instrument: s.instrument, side: s.side, entry: s.entry, rangeLo: s.rangeLo, rangeHi: s.rangeHi },
    instrument: s.instrument,
    executeSymbol: s.executeSymbol || null,
    side: execLong ? "long" : "short",
    grade: s.grade,
    entry: px(s.entryPrice), stop: px(s.stop), cap: px(s.target),
    entryKind: s.entry === "aggressive" ? "open" : "limit",
    samePrices: s.assetClass === "stock",
    // The engine read always exists; yours wins where you've locked one.
    readLocked: true,
    readAgrees: s.yourRead != null && s.yourRead !== "pass" ? s.readAgrees : s.setupRead.agrees,
    entryDate: s.state === "filled" ? s.lastBarDate : new Date().toISOString().slice(0, 10),
  };
}

/** Stocks only: P/E vs the stock's own last 2 years (Yahoo EPS). */
function ValuationLine({ v, entry }: { v: ValRead | null; entry: string }) {
  if (!v) return null;
  if (v.val === "no data" || v.val === "loss-making")
    return <div style={{ ...mono, fontSize: 10, marginTop: 6, color: "var(--text-3)" }}>valuation: {v.val === "no data" ? "not enough EPS history yet" : "loss-making (no P/E)"}</div>;
  const col = v.vsTrade === "against" ? "var(--red)" : v.vsTrade === "aligned" ? "var(--green)" : "var(--text-3)";
  return (
    <div style={{ ...mono, fontSize: 10, marginTop: 6, color: col }}>
      valuation: <b>{v.val.toUpperCase()}</b> · P/E {v.pe} ({Math.round((v.pct ?? 0) * 100)}th pct of its 2y)
      {v.vsTrade === "against" && (entry === "conservative"
        ? " — against the trade → graded B (retests buying expensive: 17% win, −0.71R)"
        : " — against the trade · warning only (aggressive: fewer losers but skipping it cost −7.8R)")}
    </div>
  );
}

/** The engine's accumulation/distribution read — always shown, with its reasons, re-runnable. */
function SetupRead({ s }: { s: Row }) {
  const r = s.setupRead;
  const d = r.detail;
  const [why, setWhy] = useState(false);
  const [rerun, setRerun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const word = (v: string) => (v === "accum" ? "ACCUMULATION" : v === "distrib" ? "DISTRIBUTION" : "NEUTRAL");
  const lean = (a: boolean | null) => (a == null ? "no lean" : a ? "agrees with the trade" : "against the trade");
  const col = (a: boolean | null) => (a == null ? "var(--text-3)" : a ? "var(--green)" : "var(--red)");
  const link = { ...mono, fontSize: 10, textDecoration: "underline", color: "var(--text-2)" } as const;
  const go = async () => {
    setBusy(true);
    // Cards stored before this build carry no window; fall back to range start → signal.
    const p = new URLSearchParams({ symbol: s.instrument, from: d?.from ?? s.rangeStart, to: d?.to ?? s.signalDate, side: s.side });
    try { setRerun(await (await fetch(`/api/setups/read?${p}`)).json()); }
    catch (e) { setRerun({ error: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const reasons: string[] = rerun?.asFired?.reasons ?? d?.reasons ?? [];
  return (
    <div style={{ ...mono, fontSize: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", color: col(r.agrees) }}>
        <Target size={10} />
        <span>
          engine read: <b>{word(r.verdict)}</b> — {lean(r.agrees)}
          <span style={{ color: "var(--text-3)" }}>
            {d ? ` · ${d.from} → ${d.to} (${d.bars} bars)` : ""}
            {s.entry === "aggressive" ? " · didn't add edge on springs in the backtest" : ""}
          </span>
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 4, marginLeft: 16 }}>
        <button onClick={() => { setWhy(!why); if (!d && !rerun) go(); }} style={link}>{why ? "hide why" : "why?"}</button>
        <button onClick={go} disabled={busy} style={link}>{busy ? "re-running…" : "re-run"}</button>
      </div>
      {why && reasons.length > 0 && (
        <div style={{ marginLeft: 16, marginTop: 4, color: "var(--text-3)", lineHeight: 1.6 }}>
          {reasons.map((x) => <div key={x}>· {x}</div>)}
        </div>
      )}
      {rerun && !rerun.error && (
        <div style={{ marginLeft: 16, marginTop: 4, lineHeight: 1.6 }}>
          <div style={{ color: col(rerun.asFired.agrees) }}>
            as fired (to {rerun.asFired.to}): <b>{word(rerun.asFired.verdict)}</b> · ratio {rerun.asFired.ratio ?? "—"}
          </div>
          <div style={{ color: col(rerun.now.agrees) }}>
            re-run to {rerun.now.to}: <b>{word(rerun.now.verdict)}</b> · ratio {rerun.now.ratio ?? "—"}
            {rerun.changed ? " — CHANGED since the card fired" : " — unchanged"}
            <span style={{ color: "var(--text-3)" }}> (includes the break/test bars — not what was backtested)</span>
          </div>
          {why && rerun.now.reasons.map((x: string) => <div key={"n" + x} style={{ color: "var(--text-3)" }}>· now: {x}</div>)}
        </div>
      )}
      {rerun?.error && <div style={{ marginLeft: 16, color: "var(--amber)" }}>re-run failed: {rerun.error}</div>}
    </div>
  );
}

/** The orders to place, worded for the direction you actually execute. */
function OrderBox({ s, execLong }: { s: Row; execLong: boolean }) {
  const buy = execLong ? "BUY" : "SELL", sell = execLong ? "SELL" : "BUY";
  const o = s.order;
  const filled = s.state === "filled";
  return (
    <div style={{ ...mono, fontSize: 10.5, marginTop: 10, padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border-subtle)", lineHeight: 1.7 }}>
      <div style={{ color: "var(--text-3)", fontSize: 9.5, marginBottom: 2 }}>ORDERS{s.inverted ? " — prices are the future's; translate to " + s.executeSymbol : ""}</div>
      {filled ? (
        <>
          <div style={{ color: "var(--green)" }}>Entry filled on the last bar — place the stop and take-profit now.</div>
          {s.retest && <RetestLine s={s} buy={buy} />}
        </>
      ) : o.entry.kind === "limit" ? (
        <div>
          <b>1. {buy} LIMIT</b> at {fmt(o.entry.price)} · good for {o.entry.goodFor} bars
          <div style={{ color: "var(--text-3)" }}>&nbsp;&nbsp;&nbsp;cancel if {o.entry.cancelIf}</div>
        </div>
      ) : (
        <div>
          <b>1. {buy} MARKET at the next open</b>{s.assetClass === "stock" ? " (market-on-open order)" : ""}
          <div style={{ color: "var(--text-3)" }}>&nbsp;&nbsp;&nbsp;skip if {o.entry.skipIf}</div>
        </div>
      )}
      <div><b style={{ color: "var(--red)" }}>2. {sell} STOP</b> (stop-loss) at {fmt(o.stopLoss)}</div>
      <div><b style={{ color: "var(--green)" }}>3. {sell} LIMIT</b> (take-profit) at {fmt(o.takeProfit)}</div>
      <div style={{ color: "var(--text-3)", marginTop: 2 }}>{o.manage.map((m) => <div key={m}>· {m}</div>)}</div>
    </div>
  );
}

/** The retest day, read at its close: was it the quiet LPS/LPSY we want? */
function RetestLine({ s, buy }: { s: Row; buy: string }) {
  const r = s.retest!;
  const tone = r.low === true ? "var(--green)" : r.low === false ? "var(--amber)" : "var(--text-3)";
  return (
    <div style={{ margin: "4px 0", padding: "4px 8px", borderRadius: 7, border: `1px solid ${tone}` }}>
      <div style={{ color: tone }}>
        retest volume {r.vol == null ? "unreadable (roll / bad print) — check the live contract" : `${r.vol.toFixed(2)}× range avg — ${r.low ? "LOW ✓ quiet pullback, the stronger trade" : "not low — heavier retest, weaker trade (still positive on average)"}`}
        {" · "}{r.held ? "held the edge at the close" : "closed back inside the range"}
      </div>
      <div style={{ color: "var(--text-3)" }}>
        waiting for confirmation instead? {r.confirmEntry ? <b style={{ color: "var(--green)" }}>{buy} at the next open</b> : "skip — needs a close that holds the edge on low volume"}
      </div>
    </div>
  );
}

/** The card shows the range plus 10 bars of context (max 90); the expanded view shows everything sent. */
function cardWindow(s: Row) {
  const i = s.bars.findIndex((b) => String(b[5]).slice(0, 10) === s.rangeStart);
  return s.bars.slice(Math.max(0, i - 10, s.bars.length - 90));
}

function ChartModal({ s, onClose, chartProps, execLong }: {
  s: Row; onClose: () => void; chartProps: React.ComponentProps<typeof SetupChart>; execLong: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`${s.instrument} chart`}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1180px, 100%)", maxHeight: "100%", overflow: "auto", background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 16 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ ...mono, fontSize: 13 }}>
            <b style={{ fontSize: 16 }}>{s.instrument}</b>
            <span style={{ marginLeft: 10, color: execLong ? "var(--green)" : "var(--red)" }}>
              {execLong ? "BUY" : "SELL"} {s.executeSymbol || s.instrument} · {s.entry} · grade {s.grade}
            </span>
          </div>
          <button onClick={onClose} style={{ ...mono, fontSize: 11, color: "var(--text-3)" }}>close (esc)</button>
        </div>
        <div style={{ ...mono, fontSize: 11, color: "var(--text-2)", margin: "8px 0 12px", display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>entry {s.entry === "aggressive" ? `next open (ref ${fmt(s.entryPrice)})` : fmt(s.entryPrice)}</span>
          <span style={{ color: "var(--red)" }}>stop {fmt(s.stop)}</span>
          <span style={{ color: "var(--green)" }}>+1R → BE {fmt(s.breakevenAt)}</span>
          <span style={{ color: "var(--green)" }}>cap {fmt(s.target)}</span>
          <span style={{ color: "var(--text-3)" }}>signal {s.signalDate} · data to {s.lastBarDate}</span>
        </div>
        <SetupChartFull
          instrument={s.instrument} entry={s.entry} long={s.side === "long"}
          rangeLo={s.rangeLo} rangeHi={s.rangeHi} rangeStart={s.rangeStart} signalDate={s.signalDate}
          entryPrice={s.entryPrice} stop={s.stop} breakevenAt={s.breakevenAt} target={s.target} fmt={fmt}
          withRead
          readWindow={s.setupRead.detail ? { from: s.setupRead.detail.from, to: s.setupRead.detail.to } : undefined}
        />
      </div>
    </div>
  );
}

function Rules() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...mono, fontSize: 10.5, color: "var(--text-3)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "8px 12px" }}>
      <button onClick={() => setOpen(!open)} style={{ ...mono, fontSize: 10.5 }}>{open ? "▾" : "▸"} the rules (daily, backtested on 84 instruments × 5y)</button>
      {open && (
        <div style={{ lineHeight: 1.7, marginTop: 6 }}>
          <b>Conservative</b> — close beyond the range within 3 bars on 1.0–2.0× range volume · limit at the edge · cancel on a gap through it · stop 1.5 tol inside · valid 20 bars. Grade A = the range reversed the prior move and the weekly isn't against, OR the retest came in quiet (≤ 0.8× range volume, read at the fill day's close). Place the order after the break day closes (futures reopen the same evening). Fair-fill replay: all +0.12R · grade A +0.34R · quiet retest +0.48R · quiet retest on a reversal +0.73R. Grade B on its own earns ~0 — take A.<br />
          <b>Aggressive</b> — spring/upthrust once the range is established · test volume ≤ 1.0× · pierce ≤ 10% of the band · monthly not against · stop ¼ tol past the wick · enter at the NEXT OPEN (US stocks: the cash open), skip if it opens past the stop. Grade A = weekly with. Replay +0.57R.<br />
          <b>Both</b> — stop to breakeven at +1R, then trail 1R behind the best price (indices: from +1R, trail 2 × ATR(20) behind the best instead — tested +0.64R / +0.96R vs +0.37 / +0.42). Cap at far edge + one band.<br />
          Not advice from the engine: the read is yours. Daily bars, no costs; results are averages across many trades.
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ ...mono, fontSize: 10.5, padding: "4px 10px", borderRadius: 999,
      border: `1px solid ${on ? "var(--text-2)" : "var(--border-subtle)"}`, color: on ? "var(--text-1)" : "var(--text-3)" }}>
      {children}
    </button>
  );
}
