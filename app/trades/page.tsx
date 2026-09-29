"use client";
// app/trades/page.tsx — Trades: where are my positions and stops?
//
// You enter the real fills once; each evening the Yahoo daily bars do the
// maths. Each open trade is a card with its chart and ONE instruction. Closed
// trades show as R per trade with the running total.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { kit as s, Btn, PageHead, RBars, Section, Tag, px, rr, usd } from "../_components/swing/kit";
import TradeCard, { type Action } from "../_components/swing/TradeCard";
import AccountCard from "../_components/swing/AccountCard";
import {
  ledger, riskForGrade, riskParts, sizeFor, specFor, todayUtc, type InstrumentSpecCfg, type SwingAccountCfg,
} from "@/lib/swing/core";

interface Payload { trades: any[]; actions: Action[]; accounts: SwingAccountCfg[] }

export default function TradesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/swing/trades${refresh ? "?refresh=1" : ""}`);
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

  const open = (data?.trades ?? []).filter((t) => t.status === "open");
  const closed = (data?.trades ?? []).filter((t) => t.status === "closed");
  const month = todayUtc().slice(0, 7);
  let atRisk = 0, locked = 0;
  for (const t of open) { const p = riskParts(t); atRisk += p.open; locked += p.locked; }
  const closedChrono = [...closed].sort((a, b) => String(a.exitDate).localeCompare(String(b.exitDate)));
  const totalR = closed.reduce((x, t) => x + (t.resultR ?? 0), 0);

  return (
    <div className={s.page}>
      <PageHead title="Trades"
        sub={data ? `${open.length} open · ${usd(atRisk)} at risk · ${usd(locked)} locked by stops` : error ?? "Loading trades…"}
        right={
          <div className={s.row}>
            <Btn primary onClick={() => setAdding(!adding)}><Plus size={12} /> Add trade</Btn>
            <Btn onClick={() => load(true)} disabled={busy} title="Re-price open trades from Yahoo"><RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh prices</Btn>
          </div>
        } />
      {error && data ? <div className={s.small} style={{ color: "var(--red)" }}>{error}</div> : null}

      {data && adding ? <AddTrade accounts={data.accounts} onDone={() => { setAdding(false); load(); }} /> : null}

      {data ? (
        <>
          <div className={s.grid2}>
            {data.accounts.map((a) => <AccountCard key={a.key} a={{ ...a, ledger: ledger(a, data.trades, month) }} />)}
          </div>

          <Section title="Open" count={open.length}>
            {open.length
              ? open.map((t) => <TradeCard key={t.id} t={t} editable actions={data.actions.filter((a) => a.tradeId === t.id)} patch={patch} onDeleted={() => load()} />)
              : <div className={`${s.card} ${s.empty}`}>No open trades. Use <b>Add trade</b> for a position you took at your broker, or <b>Took it</b> on a setup card.</div>}
          </Section>

          <Section title="Closed · last 90 days" count={closed.length} right={closed.length ? <span className={s.mono} style={{ color: totalR >= 0 ? "var(--green)" : "var(--red)" }}>{rr(totalR)} · {usd(closed.reduce((x, t) => x + (t.pnlUsd ?? 0), 0))}</span> : null}>
            <div className={s.card}><RBars items={closedChrono.map((t) => ({ r: t.resultR ?? 0, label: `${t.exitDate} ${t.instrument} ${t.side}` }))} /></div>
            {closed.length ? (
              <div className={`${s.card} ${s.tableWrap}`} style={{ padding: 4 }}>
                <table className={s.table}>
                  <thead><tr>{["exit", "trade", "account", "entry → exit", "why", "R", "$", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {closed.map((t) => (
                      <tr key={t.id}>
                        <td>{t.exitDate}</td>
                        <td style={{ color: "var(--text-1)" }}><b>{t.instrument}</b> <Tag tone={t.side === "long" ? "long" : "short"}>{t.side}</Tag></td>
                        <td>{t.account}</td>
                        <td>{px(t.entryPrice)} → {px(t.exitPrice)}</td>
                        <td><Tag tone={t.exitReason === "cap" || t.exitReason === "trail" ? "good" : t.exitReason === "stop" ? "bad" : "plain"}>{t.exitReason}</Tag></td>
                        <td style={{ color: (t.resultR ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{rr(t.resultR)}</td>
                        <td>{t.pnlUsd != null ? usd(t.pnlUsd) : "—"}</td>
                        <td><Btn style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => patch({ id: t.id, action: "reopen" })}>Reopen</Btn></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>
        </>
      ) : null}
    </div>
  );
}

// ── Add a trade (runs the pre-trade gate on save) ────────────────────────────

function AddTrade({ accounts, onDone }: { accounts: SwingAccountCfg[]; onDone: () => void }) {
  const [specs, setSpecs] = useState<InstrumentSpecCfg[]>([]);
  useEffect(() => { fetch("/api/swing/context").then((r) => r.json()).then((j) => setSpecs(j.specs ?? [])).catch(() => {}); }, []);
  const [f, setF] = useState({
    account: accounts[0]?.key ?? "15k", instrument: "", side: "long", grade: "A", entryDate: todayUtc(),
    entryPrice: "", stopPrice: "", capPrice: "", size: "", riskUsd: "", executeSymbol: "", notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ rule: string; level: string; text: string }[] | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setBlocked(null); };
  const acc = accounts.find((a) => a.key === f.account);
  const risk = f.riskUsd ? Number(f.riskUsd) : riskForGrade(f.grade, acc?.riskPerTrade ?? 100);
  const suggested = useMemo(() => {
    const e = Number(f.entryPrice), st = Number(f.stopPrice);
    if (!f.instrument || !(e > 0) || !(st > 0)) return null;
    const spec = specFor(f.instrument.toUpperCase(), specs);
    return { size: sizeFor(risk, e, st, spec), unit: spec.unit };
  }, [f.instrument, f.entryPrice, f.stopPrice, risk, specs]);

  const save = async (override = false) => {
    setErr(null);
    const r = await fetch("/api/swing/trades", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, riskUsd: f.riskUsd || risk, size: f.size || suggested?.size, override }) });
    const j = await r.json();
    if (r.status === 409) { setBlocked(j.gate?.checks ?? []); return; }
    if (!r.ok) setErr(j.error ?? r.statusText); else onDone();
  };

  const field = (k: keyof typeof f, label: string, ph?: string) => (
    <label className={s.field}>{label}<input className={s.input} placeholder={ph} value={f[k]} onChange={set(k)} /></label>
  );

  return (
    <div className={s.card} style={{ display: "grid", gap: 12, borderColor: "var(--accent)" }}>
      <div style={{ fontWeight: 600 }}>Add a trade — your real order lines</div>
      <div className={s.formGrid}>
        <label className={s.field}>account
          <select className={s.input} value={f.account} onChange={set("account")}>{accounts.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select>
        </label>
        {field("instrument", "instrument", "TSLA / EURUSD / GC")}
        {field("executeSymbol", "you trade (optional)", "US500 / XAUUSD")}
        <label className={s.field}>side
          <select className={s.input} value={f.side} onChange={set("side")}><option value="long">long (buy)</option><option value="short">short (sell)</option></select>
        </label>
        <label className={s.field}>grade
          <select className={s.input} value={f.grade} onChange={set("grade")}><option>A</option><option>B</option></select>
        </label>
        {field("entryDate", "entry date")}
        {field("entryPrice", "entry")}
        {field("stopPrice", "stop")}
        {field("capPrice", "cap (take-profit)")}
        {field("riskUsd", "risk $", String(risk))}
        {field("size", "size", suggested ? `${suggested.size} ${suggested.unit}` : "")}
      </div>
      {field("notes", "notes")}
      {blocked ? (
        <div style={{ display: "grid", gap: 4 }}>
          {blocked.filter((c) => c.level !== "ok").map((c, i) => (
            <div key={i} className={s.small} style={{ color: c.level === "block" ? "var(--red)" : "var(--amber)" }}>{c.level === "block" ? "BLOCK" : "warn"} · <b>{c.rule}</b> · {c.text}</div>
          ))}
        </div>
      ) : null}
      <div className={s.row}>
        <Btn primary onClick={() => save(false)}>Save trade</Btn>
        {blocked ? <Btn danger onClick={() => save(true)}>Already in it — save and log the breaks</Btn> : null}
        {suggested ? <span className={s.small}>size for {usd(risk)}: <b style={{ color: "var(--text-1)" }}>{suggested.size} {suggested.unit}</b>{suggested.unit === "lot" ? " (check your broker's contract size)" : ""}</span> : null}
        {err ? <span className={s.small} style={{ color: "var(--red)" }}>{err}</span> : null}
      </div>
    </div>
  );
}
