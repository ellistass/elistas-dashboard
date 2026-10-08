"use client";
// app/_components/swing/TradeCard.tsx — one open swing trade: the big R number,
// ONE plain instruction for tonight, the buttons to do it, and a candle chart
// with your own order lines drawn on it. Used on Tonight and Trades.

import { useState } from "react";
import {
  kit as s, Btn, CandleChart, Do, Legend, SideTag, Tag, px, rr, usd, type Candle, type ChartLine,
} from "./kit";
import { specClass } from "@/lib/swing/core";

export interface Action { tradeId: string; instrument: string; kind: string; text: string; urgent: boolean }

type Patch = (body: Record<string, unknown>) => Promise<boolean>;

export default function TradeCard({ t, actions, patch, editable = false, onDeleted }: {
  t: any; actions: Action[]; patch: Patch; editable?: boolean; onDeleted?: () => void;
}) {
  const [mode, setMode] = useState<null | "close" | "edit">(null);
  const long = t.side === "long", d = long ? 1 : -1;
  const R = Math.abs(t.entryPrice - t.initialStop);
  const lockedR = R > 0 ? Math.max(0, (d * (t.currentStop - t.entryPrice)) / R) : 0;
  const atRiskR = R > 0 ? Math.max(0, (-d * (t.currentStop - t.entryPrice)) / R) : 1;
  const moveDue = t.suggestedStop != null && Math.abs(t.suggestedStop - t.currentStop) > R * 0.01 && !t.stopHitDate && !t.capHitDate;
  const nextLockedR = moveDue && R > 0 ? Math.max(0, (d * (t.suggestedStop - t.entryPrice)) / R) : null;

  // The ONE instruction, by priority.
  const by = (k: string) => actions.find((a) => a.kind === k);
  const strip = (x?: Action) => x?.text.replace(`${t.instrument}: `, "") ?? "";
  let instr: { what: string; why?: string; tone: "info" | "warn" | "bad" };
  // Indices trail 2 × ATR(20) after +1R (tested +0.64R / +0.96R vs 1R +0.37 / +0.42); everything else 1R.
  const trailTxt = specClass(t.instrument) === "index" ? "2 × ATR" : "1R";
  if (t.stopHitDate) instr = { what: `Your stop ${px(t.stopHitPrice ?? t.currentStop)} traded on ${t.stopHitDate}`, why: "Record the exit with your broker's fill.", tone: "bad" };
  else if (t.capHitDate) instr = { what: `Cap ${px(t.capPrice)} reached on ${t.capHitDate}`, why: "Record the exit at the cap.", tone: "info" };
  else if (by("event-exit")) instr = { what: strip(by("event-exit")), why: "Planned exit before the event — the only manual close besides effort/result.", tone: "warn" };
  else if (moveDue) instr = {
    what: `After the close, move your stop to ${px(t.suggestedStop)}`,
    why: t.touched1R && Math.abs(t.suggestedStop - t.entryPrice) <= R * 0.01
      ? "+1R touched: stop to breakeven. From here it trails 1R behind the best price."
      : `New ${long ? "high" : "low"} (${px(t.bestPrice)}). Rule: trail ${trailTxt} ${long ? "below" : "above"} the best. Only moves in your favour.`,
    tone: "info",
  };
  else if (by("time-exit")) instr = { what: strip(by("time-exit")), tone: "warn" };
  else instr = { what: `Nothing to do tonight — stop stays at ${px(t.currentStop)}`, why: t.touched1R ? `Trailing ${trailTxt} behind the best price.` : `Breakeven once price reaches ${px(t.entryPrice + d * R)} (+1R).`, tone: "info" };
  const mismatch = by("mismatch");

  const lines: ChartLine[] = [
    { label: "entry", value: t.entryPrice, tone: "fg2", dash: true },
    { label: "stop", value: t.currentStop, tone: "red" },
  ];
  if (moveDue) lines.push({ label: "new stop", value: t.suggestedStop, tone: "accent" });
  if (t.bestPrice != null && Math.abs(t.bestPrice - t.entryPrice) > R * 0.05) lines.push({ label: "best", value: t.bestPrice, tone: "green", dash: true });
  if (t.capPrice != null) lines.push({ label: "cap", value: t.capPrice, tone: "green" });
  const bars: Candle[] = (t.recentBars ?? []) as Candle[];
  const entryIdx = bars.findIndex((b) => b[0] >= t.entryDate);

  return (
    <div className={`${s.card} ${s.trade}`}>
      <div style={{ display: "grid", gap: 12, alignContent: "start", minWidth: 0 }}>
        <div className={s.row}>
          <span className={s.sym} style={{ fontSize: 20 }}>{t.instrument}</span>
          <SideTag side={t.side} />
          <Tag>{t.account} · {t.grade}</Tag>
          {t.executeSymbol && t.executeSymbol !== t.instrument ? <Tag>→ {t.executeSymbol}</Tag> : null}
        </div>
        <div className={s.row} style={{ alignItems: "baseline", gap: 10 }}>
          <span className={s.big} style={{ color: (t.rNow ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{rr(t.rNow)}</span>
          <span className={s.small}>
            now · peak {rr(t.peakR)} · {lockedR > 0 ? `${usd(lockedR * t.riskUsd)} locked` : `${usd(atRiskR * t.riskUsd)} at risk`}
            {nextLockedR != null && nextLockedR > lockedR ? ` · ${usd(nextLockedR * t.riskUsd)} locked after tonight` : ""}
          </span>
        </div>
        <Do what={instr.what} why={instr.why} tone={instr.tone} />
        {mismatch ? <div className={s.small} style={{ color: "var(--amber)" }}>⚠ {strip(mismatch)}</div> : null}
        <div className={s.row}>
          {moveDue ? <Btn primary onClick={() => patch({ id: t.id, action: "move-stop", to: t.suggestedStop })}>I moved it to {px(t.suggestedStop)}</Btn> : null}
          <Btn primary={!!(t.stopHitDate || t.capHitDate)} onClick={() => setMode(mode === "close" ? null : "close")}>Record exit</Btn>
          <Btn onClick={() => setMode(mode === "edit" ? null : "edit")}>{editable ? "Edit" : "Broker best…"}</Btn>
        </div>
        {mode === "close" ? <CloseForm t={t} patch={patch} onDone={() => setMode(null)} /> : null}
        {mode === "edit" ? <EditForm t={t} patch={patch} editable={editable} onDone={() => setMode(null)} onDeleted={onDeleted} /> : null}
        <div className={s.small} style={{ color: "var(--text-3)" }}>
          entry {px(t.entryPrice)} on {t.entryDate} · size {t.size} · risk {usd(t.riskUsd)} · {t.daysHeld ?? 0}/60 bars
          {t.trackError ? <span style={{ color: "var(--red)" }}> · feed error: {t.trackError}</span> : null}
        </div>
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 6, alignContent: "start" }}>
        <CandleChart bars={bars} lines={lines} height={230}
          zones={lockedR > 0 ? [{ from: t.entryPrice, to: t.currentStop, tone: "greenDim", startIdx: entryIdx }]
            : [{ from: t.entryPrice, to: t.currentStop, tone: "redDim", startIdx: entryIdx }]}
          marks={entryIdx >= 0 ? [{ date: t.entryDate, label: "in", tone: "fg3" }] : []} />
        <Legend items={[{ label: "entry", tone: "fg2" }, { label: "stop", tone: "red" }, ...(moveDue ? [{ label: "new stop", tone: "accent" }] : []), { label: "best / cap", tone: "green" }]} />
      </div>
    </div>
  );
}

function CloseForm({ t, patch, onDone }: { t: any; patch: Patch; onDone: () => void }) {
  const guess = t.stopHitDate ? { date: t.stopHitDate, price: t.stopHitPrice ?? t.currentStop, reason: t.currentStop === t.initialStop ? "stop" : "trail" }
    : t.capHitDate ? { date: t.capHitDate, price: t.capPrice, reason: "cap" }
    : { date: t.lastDate ?? new Date().toISOString().slice(0, 10), price: t.lastClose ?? "", reason: "manual" };
  const [f, setF] = useState({ date: guess.date, price: String(guess.price ?? ""), reason: guess.reason });
  return (
    <div className={s.formGrid} style={{ alignItems: "end" }}>
      <label className={s.field}>exit date<input className={s.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label className={s.field}>exit price<input className={s.input} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
      <label className={s.field}>why
        <select className={s.input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
          {["stop", "trail", "cap", "event", "effort-result", "time", "manual"].map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      <Btn primary onClick={async () => { if (await patch({ id: t.id, action: "close", exitDate: f.date, exitPrice: f.price, exitReason: f.reason })) onDone(); }}>Save exit</Btn>
    </div>
  );
}

function EditForm({ t, patch, editable, onDone, onDeleted }: { t: any; patch: Patch; editable: boolean; onDone: () => void; onDeleted?: () => void }) {
  const [f, setF] = useState({ brokerBest: String(t.brokerBest ?? ""), cap: String(t.capPrice ?? ""), feed: t.feed, notes: t.notes ?? "" });
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className={s.formGrid}>
        <label className={s.field}>broker best<input className={s.input} placeholder="your broker's high/low" value={f.brokerBest} onChange={(e) => setF({ ...f, brokerBest: e.target.value })} /></label>
        {editable ? <label className={s.field}>cap<input className={s.input} value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} /></label> : null}
        {editable ? <label className={s.field}>price feed<input className={s.input} value={f.feed} onChange={(e) => setF({ ...f, feed: e.target.value })} /></label> : null}
      </div>
      {editable ? <label className={s.field}>notes<input className={s.input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label> : null}
      <div className={s.row}>
        <Btn primary onClick={async () => {
          const body: Record<string, unknown> = { id: t.id, action: "update", brokerBest: f.brokerBest };
          if (editable) Object.assign(body, { capPrice: f.cap, feed: f.feed, notes: f.notes });
          if (await patch(body)) onDone();
        }}>Save</Btn>
        {editable && onDeleted ? (confirmDel
          ? <Btn danger onClick={async () => { const r = await fetch(`/api/swing/trades?id=${t.id}`, { method: "DELETE" }); if (r.ok) onDeleted(); }}>Yes, delete {t.instrument}</Btn>
          : <Btn danger onClick={() => setConfirmDel(true)}>Delete (entered by mistake)</Btn>) : null}
      </div>
      <div className={s.small} style={{ color: "var(--text-3)" }}>Broker best: use it when your broker printed a better {t.side === "long" ? "high" : "low"} than Yahoo (CFD pre/after-market).</div>
    </div>
  );
}
