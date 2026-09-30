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
import HistorySection from "./HistorySection";
import TakeBar, { type TakeCard } from "./TakeBar";
import RiskBlock from "./RiskBlock";

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
  const [market, setMarket] = useState<"futures" | "forex" | "abcd" | "history">("futures");
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
  const live = rows.filter((s) => s.state !== "armed");
  const armed = rows.filter((s) => s.state === "armed");

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <SectionHeader
        icon={<Target size={14} />}
        title="Setups"
        count={rows.length}
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
        <Chip on={market === "abcd"} onClick={() => setMarket("abcd")}>AB=CD (paper)</Chip>
        <Chip on={market === "history"} onClick={() => setMarket("history")}>history</Chip>
      </div>

      {market === "history" ? (
        <HistorySection />
      ) : market === "forex" ? (
        <ForexSection view="retest" />
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

function Grid({ rows }: { rows: Row[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
      {rows.map((s) => <Card key={`${s.instrument}|${s.entry}|${s.side}|${s.signalDate}`} s={s} />)}
    </div>
  );
}

function Card({ s }: { s: Row }) {
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
        <span style={{ color: "var(--text-3)" }}>then</span><span>trail 1R behind the best price</span>
        <span style={{ color: "var(--text-3)" }}>cap</span><span>{fmt(s.target)}</span>
      </div>
      <RiskBlock instrument={tc.instrument} executeSymbol={tc.executeSymbol} side={tc.side} grade={tc.grade}
        entry={tc.entry} stop={tc.stop} withTrend={s.context.daily === "with-trend"} />
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

      <div style={{ ...mono, fontSize: 10, marginTop: 6, display: "flex", gap: 6, alignItems: "center",
        color: s.readAgrees == null ? "var(--text-3)" : s.readAgrees ? "var(--green)" : "var(--red)" }}>
        <BookOpen size={10} />
        {s.yourRead == null
          ? "no read locked on this range — read it on the desk first"
          : s.yourRead === "pass" ? "you passed on this range"
          : `your read: ${s.yourRead.toUpperCase()} — ${s.readAgrees ? "agrees" : "DISAGREES"}`}
      </div>

      <div style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.6 }}>
        {s.notes.map((n) => <div key={n}>· {n}</div>)}
        <div>· range {fmt(s.rangeLo)}–{fmt(s.rangeHi)} from {s.rangeStart} · signal {s.signalDate} · data to {s.lastBarDate}
          {s.volumeQuality === "suspect" ? " · volume feed unverified" : ""}</div>
      </div>

      <TakeBar card={tc} />
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
    readLocked: s.yourRead != null && s.yourRead !== "pass",
    readAgrees: s.readAgrees,
    entryDate: s.state === "filled" ? s.lastBarDate : new Date().toISOString().slice(0, 10),
  };
}

/** The setup's own accumulation/distribution read (the engine's), next to yours. */
function SetupRead({ s }: { s: Row }) {
  const [shown, setShown] = useState(!s.deskUnread);
  const r = s.setupRead;
  const col = r.agrees == null ? "var(--text-3)" : r.agrees ? "var(--green)" : "var(--red)";
  const word = r.verdict === "accum" ? "ACCUMULATION" : r.verdict === "distrib" ? "DISTRIBUTION" : "NEUTRAL";
  return (
    <div style={{ ...mono, fontSize: 10, marginTop: 10, display: "flex", gap: 6, alignItems: "center", color: shown ? col : "var(--text-3)" }}>
      <Target size={10} />
      {shown ? (
        <span>
          <span style={{ color: "var(--text-3)" }}>info only · </span>setup read: <b>{word}</b>
          {r.agrees == null ? " — no lean" : r.agrees ? " — agrees with the trade" : " — against the trade"}
          {s.entry === "aggressive" && <span style={{ color: "var(--text-3)" }}> (didn't add edge on springs in the backtest)</span>}
        </span>
      ) : (
        <span>
          setup read hidden — this range is still unread on your desk.{" "}
          <button onClick={() => setShown(true)} style={{ ...mono, fontSize: 10, textDecoration: "underline", color: "var(--text-2)" }}>reveal</button>
        </span>
      )}
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
          <b>Both</b> — stop to breakeven at +1R, then trail 1R behind the best price. Cap at far edge + one band.<br />
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
