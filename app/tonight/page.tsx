"use client";
// app/tonight/page.tsx — Tonight: what do I do right now?
//
// Top to bottom by urgency: the clock to tonight's closes, the two accounts
// against their monthly stop and target, open trades that need you (one plain
// instruction each, with the chart), setups filled or triggering, orders
// working (closest to filling first), and event housekeeping.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";
import {
  kit as s, Btn, CandleChart, Clocks, DistBar, Grade, Legend, Level, PageHead, Pips, Section, SideTag,
  Sparkline, Tag, px, rr, usd, type Candle,
} from "../_components/swing/kit";
import TradeCard, { type Action } from "../_components/swing/TradeCard";
import AccountCard from "../_components/swing/AccountCard";
import TakeBar, { type TakeCard } from "../setups/TakeBar";
import type { Ledger, SwingAccountCfg } from "@/lib/swing/core";

interface ActNow {
  market: string; instrument: string; executeSymbol: string | null; side: string; grade: string; inverted: boolean; inTrade: boolean;
  state: string; entryKind: string; entry: number; stop: number; cap: number | null; breakeven: number; candles: Candle[];
  rNow: number | null; risk: number; accounts: string[]; reward: number | null; take: TakeCard;
}
interface Working {
  market: string; instrument: string; side: string; grade: string; inverted: boolean; inTrade: boolean;
  kind: "limit" | "close"; level: number; stop: number; left: number; total: number; closes: number[]; away: number | null; last: number | null;
}
interface Payload {
  today: string; closes: { label: string; at: string }[];
  accounts: (SwingAccountCfg & { ledger: Ledger })[];
  trades: any[]; actions: Action[]; actNow: ActNow[]; working: Working[];
  scannedAt: { futures: string | null; forex: string | null };
  alerts: { id: string; date: string; instrument: string; rule: string; detail: string }[];
  missingEarnings: string[]; upcoming: string[];
}

const weekday = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

export default function TonightPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(true); setError(null);
    try {
      if (refresh) await fetch("/api/swing/trades?status=open&refresh=1");
      const r = await fetch("/api/swing/tonight");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/swing/trades", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { setError(j.error ?? r.statusText); return false; }
    await load();
    return true;
  }, [load]);

  if (!data) {
    return (
      <div className={s.page}>
        <PageHead title="Tonight" sub={error ? <span style={{ color: "var(--red)" }}>{error}</span> : "Loading tonight…"} />
      </div>
    );
  }

  const needs = data.trades.filter((t) => data.actions.some((a) => a.tradeId === t.id && a.urgent));
  const quiet = data.trades.filter((t) => !needs.includes(t));
  const filled = data.actNow.filter((a) => !a.inTrade);
  const sub = [
    weekday(data.today),
    `${needs.length} trade${needs.length === 1 ? "" : "s"} need${needs.length === 1 ? "s" : ""} you`,
    `${filled.length} setup${filled.length === 1 ? "" : "s"} to act on`,
    `${data.working.length} order${data.working.length === 1 ? "" : "s"} working`,
  ].join(" · ");

  return (
    <div className={s.page}>
      <PageHead title="Tonight" sub={sub} right={
        <div className={s.row} style={{ alignItems: "stretch" }}>
          <Clocks closes={data.closes} />
          <Btn onClick={() => load(true)} disabled={busy} title="Re-price open trades from Yahoo"><RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh</Btn>
        </div>
      } />
      {error ? <div className={s.small} style={{ color: "var(--red)" }}>{error}</div> : null}

      {data.alerts.length ? (
        <div className={s.card} style={{ borderColor: "var(--red)", display: "grid", gap: 6 }}>
          <div className={s.row} style={{ color: "var(--red)", fontWeight: 600 }}><ShieldAlert size={15} /> {data.alerts.length} rule break{data.alerts.length > 1 ? "s" : ""} not reviewed</div>
          {data.alerts.slice(0, 3).map((a) => <div key={a.id} className={s.small}>{a.date} · {a.instrument} · <b>{a.rule}</b> — {a.detail}</div>)}
          <Link href="/discipline" className={s.small} style={{ color: "var(--accent)" }}>Review on Discipline →</Link>
        </div>
      ) : null}

      <div className={s.grid2}>
        {data.accounts.map((a) => <AccountCard key={a.key} a={a} />)}
      </div>

      <Section title="Needs you tonight" count={needs.length}>
        {needs.length ? needs.map((t) => <TradeCard key={t.id} t={t} actions={data.actions.filter((a) => a.tradeId === t.id)} patch={patch} />)
          : <div className={`${s.card} ${s.empty}`}>{data.trades.length ? "Your open trades need nothing tonight." : <>No open trades. Took one at your broker? <Link href="/trades" style={{ color: "var(--accent)" }}>Add it on Trades</Link> so the stop maths runs.</>}</div>}
      </Section>

      {quiet.length ? (
        <Section title="Open, nothing to do" count={quiet.length}>
          {quiet.map((t) => <TradeCard key={t.id} t={t} actions={data.actions.filter((a) => a.tradeId === t.id)} patch={patch} />)}
        </Section>
      ) : null}

      <Section title="Act on these" count={filled.length} hint="filled on the last bar, or entering at the next open">
        {filled.length ? (
          <>
            <div className={s.grid2}>{filled.map((a, i) => <ActCard key={i} a={a} />)}</div>
            <Legend items={[{ label: "entry", tone: "fg2" }, { label: "stop", tone: "red" }, { label: "+1R → breakeven", tone: "accent" }, { label: "cap", tone: "green" }]} />
          </>
        ) : <div className={`${s.card} ${s.empty}`}>Nothing filled or triggering on the last bar.</div>}
      </Section>

      <Section title="Orders working" count={data.working.length} hint="closest to filling first">
        {data.working.length ? (
          <div className={s.list}>
            {data.working.map((w, i) => (
              <div key={i} className={`${s.listRow} ${s.ord}`} style={{ opacity: w.inTrade ? 0.5 : 1 }}>
                <Grade g={w.grade} />
                <span style={{ fontWeight: 700 }}>{w.instrument}</span>
                <Tag tone={w.side === "long" ? "long" : "short"}>{w.side === "long" ? "BUY" : "SELL"}</Tag>
                <div className={s.fullNarrow}>
                  <DistBar near={(w.away ?? 99) < 2} pct={w.away ?? 99}
                    label={<>{w.kind === "close" ? `needs a close ${w.side === "long" ? "above" : "below"}` : "limit"} <b style={{ color: "var(--text-1)" }}>{px(w.level)}</b>{w.away != null ? ` · ${w.away.toFixed(1)}% away` : ""}{w.inverted ? " · future's price" : ""}{w.inTrade ? " · in a trade" : ""}</>} />
                </div>
                <div className={s.hideNarrow}><Sparkline values={w.closes} level={w.level} /></div>
                <div className={s.hideNarrow}>
                  {w.kind === "limit" ? <Pips left={w.left} total={Math.min(20, Math.max(w.total, w.left))} /> : <span className={s.small}>decided at tonight's close</span>}
                </div>
              </div>
            ))}
          </div>
        ) : <div className={`${s.card} ${s.empty}`}>No orders working.</div>}
        <div className={s.small} style={{ color: "var(--text-3)" }}>
          From the last stored scans (futures {data.scannedAt.futures ? new Date(data.scannedAt.futures).toLocaleString() : "never"} · forex {data.scannedAt.forex ? new Date(data.scannedAt.forex).toLocaleString() : "never"}).
          Take or skip them on <Link href="/setups" style={{ color: "var(--accent)" }}>Setups</Link>.
        </div>
      </Section>

      {data.upcoming.length || data.missingEarnings.length ? (
        <div className={s.dashed} style={{ display: "grid", gap: 12 }}>
          {data.upcoming.length ? (
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 600 }}>This week's events on your trades</div>
              {data.upcoming.map((u) => <div key={u} className={s.small} style={{ color: "var(--amber)" }}>{u}</div>)}
            </div>
          ) : null}
          {data.missingEarnings.length ? (
            <div className={s.spread}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 600 }}>{data.missingEarnings.length} stock{data.missingEarnings.length > 1 ? "s have" : " has"} no earnings date</div>
                <div className={s.chips}>{data.missingEarnings.map((m) => <span key={m} className={s.chip}>{m}</span>)}</div>
              </div>
              <Link href="/discipline#events" className={s.btn}>Add dates</Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActCard({ a }: { a: ActNow }) {
  const lines = [
    ...(a.cap != null ? [{ label: "cap", value: a.cap, tone: "green" }] : []),
    { label: "+1R", value: a.breakeven, tone: "accent", dash: true },
    { label: "entry", value: a.entry, tone: "fg2", dash: true },
    { label: "stop", value: a.stop, tone: "red" },
  ];
  const zones = [
    ...(a.cap != null ? [{ from: a.entry, to: a.cap, tone: "greenDim" }] : []),
    { from: a.stop, to: a.entry, tone: "redDim" },
  ];
  return (
    <div className={s.card} style={{ display: "grid", gap: 10 }}>
      <div className={s.row}>
        <span className={s.sym}>{a.instrument}</span>
        <SideTag side={a.side} />
        <Tag>grade {a.grade} · {a.accounts.join(" & ") || "no account"} · {usd(a.risk)}</Tag>
        <span className={s.mono} style={{ marginLeft: "auto", fontSize: 12, color: a.rNow == null ? "var(--text-2)" : a.rNow >= 0 ? "var(--green)" : "var(--red)" }}>
          {a.state === "filled" ? `${rr(a.rNow)} now` : "enter at the next open"}
        </span>
      </div>
      {a.inverted ? <div className={s.small} style={{ color: "var(--amber)" }}>Prices are the future's — execute {a.executeSymbol} in the opposite terms.</div> : null}
      <CandleChart bars={a.candles} lines={lines} zones={zones} height={180} />
      <div className={s.levels}>
        <Level k="stop" v={px(a.stop)} tone="red" />
        <Level k="+1R → BE" v={px(a.breakeven)} tone="accent" />
        <Level k={a.cap != null ? "cap" : "exit"} v={a.cap != null ? px(a.cap) : "trail only"} tone="green" />
      </div>
      <div className={s.small}>risk {px(Math.abs(a.entry - a.stop))}{a.reward != null ? ` · reward ${a.reward.toFixed(2)}R` : ""} · entry {px(a.entry)}{a.entryKind === "open" ? " (reference — market at the open)" : ""}</div>
      <TakeBar card={a.take} />
    </div>
  );
}
