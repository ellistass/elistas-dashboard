"use client";
// app/trades/page.tsx — Trades: where are my positions and stops?
//
// You enter the real fills once. Each evening the Yahoo daily bars fill in the
// rest: best price since entry, R now, +1R touched, the trailing stop, stop or
// cap hits and days held. Every number uses YOUR order lines, never the card's.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crosshair, RefreshCw, Plus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../wyckoff/_components/ui";
import { fmtPx, fmtR, fmtUsd, riskForGrade, riskParts, sizeFor, specFor, todayUtc, type InstrumentSpecCfg, type SwingAccountCfg } from "@/lib/swing/core";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const inp = { ...mono, fontSize: 11.5, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-1)", width: "100%" } as const;
const btn = { ...mono, fontSize: 10.5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-strong)", color: "var(--text-1)" } as const;

interface Action { tradeId: string; instrument: string; kind: string; text: string; urgent: boolean }
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
    if (!r.ok) { alertBox(j.error ?? r.statusText); return false; }
    await load();
    return true;
  }, [load]);

  const open = (data?.trades ?? []).filter((t) => t.status === "open");
  const closed = (data?.trades ?? []).filter((t) => t.status === "closed");

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <SectionHeader
        icon={<Crosshair size={14} />}
        title="Trades"
        count={open.length}
        note="your fills · evening maths from Yahoo daily bars"
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setAdding(!adding)} style={{ ...btn, display: "flex", gap: 6, alignItems: "center" }}><Plus size={11} /> add trade</button>
            <button onClick={() => load(true)} disabled={busy} style={{ ...btn, display: "flex", gap: 6, alignItems: "center" }}>
              <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> refresh prices
            </button>
          </div>
        }
      />

      {error ? <ErrorCard message={error} /> : null}
      {!data && !error ? <LoadingCard what="trades" /> : null}

      {data && adding ? <AddTrade accounts={data.accounts} onDone={() => { setAdding(false); load(); }} /> : null}

      {data ? (
        <>
          <AccountStrip accounts={data.accounts} trades={data.trades} />

          {data.actions.length ? (
            <div className="card" style={{ padding: 12, margin: "12px 0" }}>
              <div style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginBottom: 6 }}>TONIGHT</div>
              {data.actions.map((a, i) => (
                <div key={i} style={{ ...mono, fontSize: 11.5, display: "flex", gap: 8, alignItems: "center", color: a.urgent ? "var(--amber)" : "var(--text-2)", padding: "2px 0" }}>
                  <AlertTriangle size={11} /> {a.text}
                </div>
              ))}
            </div>
          ) : null}

          <h3 style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: "20px 0 8px" }}>OPEN · {open.length}</h3>
          {open.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
              {open.map((t) => <OpenCard key={t.id} t={t} actions={data.actions.filter((a) => a.tradeId === t.id)} patch={patch} reload={load} />)}
            </div>
          ) : <EmptyState text="No open trades. Add one when you take a setup." small />}

          <h3 style={{ ...mono, fontSize: 11, color: "var(--text-3)", margin: "24px 0 8px" }}>CLOSED · LAST 90 DAYS · {closed.length}</h3>
          {closed.length ? <ClosedTable rows={closed} patch={patch} /> : <EmptyState text="Nothing closed in the last 90 days." small />}
        </>
      ) : null}
    </div>
  );
}

function alertBox(msg: string) { if (typeof window !== "undefined") window.alert(msg); }

// ── Account strip ────────────────────────────────────────────────────────────

function AccountStrip({ accounts, trades }: { accounts: SwingAccountCfg[]; trades: any[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
      {accounts.map((a) => {
        const open = trades.filter((t) => t.account === a.key && t.status === "open");
        let risk = 0, locked = 0;
        for (const t of open) { const p = riskParts(t); risk += p.open; locked += p.locked; }
        return (
          <div key={a.key} className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
            <div style={{ ...mono, fontSize: 11, color: "var(--text-2)", marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span>open {open.length}</span>
              <span>at risk {fmtUsd(risk)}</span>
              <span style={{ color: locked > 0 ? "var(--green)" : undefined }}>locked {fmtUsd(locked)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Open trade card ──────────────────────────────────────────────────────────

function OpenCard({ t, actions, patch, reload }: { t: any; actions: Action[]; patch: (b: Record<string, unknown>) => Promise<boolean>; reload: () => void }) {
  const long = t.side === "long";
  const [closing, setClosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const moveDue = t.suggestedStop != null && Math.abs(t.suggestedStop - t.currentStop) > Math.abs(t.entryPrice - t.initialStop) * 0.01;
  const { open: atRisk, locked } = riskParts(t);
  const row = (k: string, v: React.ReactNode, tone?: string) => (
    <><span style={{ color: "var(--text-3)" }}>{k}</span><span style={{ color: tone }}>{v}</span></>
  );
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 14, background: "var(--surface-1)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{t.instrument}</span>
          {t.executeSymbol && t.executeSymbol !== t.instrument ? <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginLeft: 6 }}>→ {t.executeSymbol}</span> : null}
          <span style={{ ...mono, fontSize: 11, marginLeft: 8, color: long ? "var(--green)" : "var(--red)" }}>{long ? "LONG" : "SHORT"}</span>
        </div>
        <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{t.account} · grade {t.grade}</span>
      </div>

      <div style={{ ...mono, fontSize: 22, marginTop: 8, color: (t.rNow ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
        {fmtR(t.rNow)} <span style={{ fontSize: 11, color: "var(--text-3)" }}>now · peak {fmtR(t.peakR)}{t.touched1R ? " · +1R touched" : ""}</span>
      </div>

      <div style={{ ...mono, fontSize: 11, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 2, marginTop: 8 }}>
        {row("entry", `${fmtPx(t.entryPrice)} on ${t.entryDate} · size ${t.size} · risk ${fmtUsd(t.riskUsd)}`)}
        {row("stop now", fmtPx(t.currentStop) + (t.currentStop !== t.initialStop ? ` (initial ${fmtPx(t.initialStop)})` : ""))}
        {row("rule stop", fmtPx(t.suggestedStop), moveDue ? "var(--amber)" : undefined)}
        {row("best", `${fmtPx(t.bestPrice)}${t.bestDate ? ` on ${t.bestDate}` : ""}${t.brokerBest != null ? " (broker)" : ""}`)}
        {row("close", `${fmtPx(t.lastClose)}${t.lastDate ? ` on ${t.lastDate}` : ""}`)}
        {row("cap", fmtPx(t.capPrice))}
        {row("at risk / locked", `${fmtUsd(atRisk)} / ${fmtUsd(locked)}`, locked > 0 ? "var(--green)" : undefined)}
        {row("held", `${t.daysHeld ?? 0} bars of 60`)}
        {row("feed", t.feed)}
      </div>
      {t.trackError ? <div style={{ ...mono, fontSize: 10, color: "var(--red)", marginTop: 6 }}>feed error: {t.trackError}</div> : null}

      {actions.length ? (
        <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
          {actions.map((a, i) => (
            <div key={i} style={{ ...mono, fontSize: 10.5, color: a.urgent ? "var(--amber)" : "var(--text-3)", display: "flex", gap: 6, alignItems: "center" }}>
              <AlertTriangle size={10} /> {a.text.replace(`${t.instrument}: `, "")}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...mono, fontSize: 10.5, color: "var(--text-3)", marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
          <CheckCircle2 size={10} color="var(--green)" /> nothing to do tonight
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {moveDue ? <button style={{ ...btn, borderColor: "var(--amber)" }} onClick={() => patch({ id: t.id, action: "move-stop", to: t.suggestedStop })}>moved stop to {fmtPx(t.suggestedStop)}</button> : null}
        <button style={btn} onClick={() => setClosing(!closing)}>record exit</button>
        <button style={btn} onClick={() => setEditing(!editing)}>edit</button>
      </div>

      {closing ? <CloseForm t={t} patch={patch} onDone={() => setClosing(false)} /> : null}
      {editing ? <EditForm t={t} patch={patch} reload={reload} onDone={() => setEditing(false)} /> : null}
    </div>
  );
}

function CloseForm({ t, patch, onDone }: { t: any; patch: (b: Record<string, unknown>) => Promise<boolean>; onDone: () => void }) {
  const guess = t.stopHitDate ? { date: t.stopHitDate, price: t.stopHitPrice ?? t.currentStop, reason: t.currentStop === t.initialStop ? "stop" : "trail" }
    : t.capHitDate ? { date: t.capHitDate, price: t.capPrice, reason: "cap" }
    : { date: t.lastDate ?? todayUtc(), price: t.lastClose ?? "", reason: "manual" };
  const [date, setDate] = useState(guess.date);
  const [price, setPrice] = useState(String(guess.price ?? ""));
  const [reason, setReason] = useState(guess.reason);
  return (
    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 6, alignItems: "end" }}>
      <label style={lbl}>date<input style={inp} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label style={lbl}>exit price<input style={inp} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label style={lbl}>why
        <select style={inp} value={reason} onChange={(e) => setReason(e.target.value)}>
          {["stop", "trail", "cap", "event", "effort-result", "time", "manual"].map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      <button style={btn} onClick={async () => { if (await patch({ id: t.id, action: "close", exitDate: date, exitPrice: price, exitReason: reason })) onDone(); }}>save</button>
    </div>
  );
}

function EditForm({ t, patch, reload, onDone }: { t: any; patch: (b: Record<string, unknown>) => Promise<boolean>; reload: () => void; onDone: () => void }) {
  const [brokerBest, setBrokerBest] = useState(t.brokerBest ?? "");
  const [feed, setFeed] = useState(t.feed);
  const [cap, setCap] = useState(t.capPrice ?? "");
  const [notes, setNotes] = useState(t.notes ?? "");
  return (
    <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        <label style={lbl}>broker best (optional)<input style={inp} value={brokerBest} onChange={(e) => setBrokerBest(e.target.value)} /></label>
        <label style={lbl}>cap<input style={inp} value={cap} onChange={(e) => setCap(e.target.value)} /></label>
        <label style={lbl}>feed<input style={inp} value={feed} onChange={(e) => setFeed(e.target.value)} /></label>
      </div>
      <label style={lbl}>notes<input style={inp} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={btn} onClick={async () => { if (await patch({ id: t.id, action: "update", brokerBest, feed, capPrice: cap, notes })) onDone(); }}>save</button>
        <button style={{ ...btn, color: "var(--red)", borderColor: "var(--red-border)" }} onClick={async () => {
          if (!window.confirm(`Delete this ${t.instrument} trade? Only for a trade entered by mistake.`)) return;
          const r = await fetch(`/api/swing/trades?id=${t.id}`, { method: "DELETE" });
          if (r.ok) reload(); else alertBox((await r.json()).error);
        }}>delete</button>
      </div>
      <p style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", margin: 0 }}>
        Broker best: use it when your broker printed a better high/low than Yahoo (CFD pre/after-market). Feed: spot:EURUSD or yahoo:^GSPC.
      </p>
    </div>
  );
}

const lbl = { ...mono, fontSize: 9.5, color: "var(--text-3)", display: "grid", gap: 3 } as const;

// ── Add trade ────────────────────────────────────────────────────────────────

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
    const e = Number(f.entryPrice), s = Number(f.stopPrice);
    if (!f.instrument || !(e > 0) || !(s > 0)) return null;
    const spec = specFor(f.instrument.toUpperCase(), specs);
    return { size: sizeFor(risk, e, s, spec), unit: spec.unit };
  }, [f.instrument, f.entryPrice, f.stopPrice, risk, specs]);

  // The gate runs on save; a block comes back as 409 with the checks.
  const save = async (override = false) => {
    setErr(null);
    const r = await fetch("/api/swing/trades", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, riskUsd: f.riskUsd || risk, size: f.size || suggested?.size, override }) });
    const j = await r.json();
    if (r.status === 409) { setBlocked(j.gate?.checks ?? []); return; }
    if (!r.ok) setErr(j.error ?? r.statusText); else onDone();
  };

  return (
    <div className="card" style={{ padding: 14, margin: "8px 0 16px" }}>
      <div style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginBottom: 8 }}>ADD A TRADE — your real order lines</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        <label style={lbl}>account
          <select style={inp} value={f.account} onChange={set("account")}>{accounts.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select>
        </label>
        <label style={lbl}>instrument<input style={inp} placeholder="TSLA / EURUSD / GC" value={f.instrument} onChange={set("instrument")} /></label>
        <label style={lbl}>you trade (optional)<input style={inp} placeholder="US500 / XAUUSD" value={f.executeSymbol} onChange={set("executeSymbol")} /></label>
        <label style={lbl}>side
          <select style={inp} value={f.side} onChange={set("side")}><option value="long">long (buy)</option><option value="short">short (sell)</option></select>
        </label>
        <label style={lbl}>grade
          <select style={inp} value={f.grade} onChange={set("grade")}><option>A</option><option>B</option></select>
        </label>
        <label style={lbl}>entry date<input style={inp} value={f.entryDate} onChange={set("entryDate")} /></label>
        <label style={lbl}>entry<input style={inp} value={f.entryPrice} onChange={set("entryPrice")} /></label>
        <label style={lbl}>stop<input style={inp} value={f.stopPrice} onChange={set("stopPrice")} /></label>
        <label style={lbl}>cap (take-profit)<input style={inp} value={f.capPrice} onChange={set("capPrice")} /></label>
        <label style={lbl}>risk $<input style={inp} placeholder={String(risk)} value={f.riskUsd} onChange={set("riskUsd")} /></label>
        <label style={lbl}>size<input style={inp} placeholder={suggested ? `${suggested.size} ${suggested.unit}` : ""} value={f.size} onChange={set("size")} /></label>
      </div>
      <label style={{ ...lbl, marginTop: 8 }}>notes<input style={inp} value={f.notes} onChange={set("notes")} /></label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button style={btn} onClick={() => save(false)}>save trade</button>
        {blocked ? <button style={{ ...btn, color: "var(--red)", borderColor: "var(--red)" }} onClick={() => save(true)}>already in it — save and log the breaks</button> : null}
        {suggested ? <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>size for {fmtUsd(risk)}: {suggested.size} {suggested.unit}{suggested.unit === "lot" ? " (check your broker's contract size)" : ""}</span> : null}
        {err ? <span style={{ ...mono, fontSize: 10.5, color: "var(--red)" }}>{err}</span> : null}
      </div>
      {blocked ? (
        <div style={{ marginTop: 8, display: "grid", gap: 3 }}>
          {blocked.filter((c) => c.level !== "ok").map((c, i) => (
            <div key={i} style={{ ...mono, fontSize: 10.5, color: c.level === "block" ? "var(--red)" : "var(--amber)" }}>
              {c.level === "block" ? "BLOCK" : "warn"} · {c.rule} · {c.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Closed trades ────────────────────────────────────────────────────────────

function ClosedTable({ rows, patch }: { rows: any[]; patch: (b: Record<string, unknown>) => Promise<boolean> }) {
  const td = { padding: "6px 8px", whiteSpace: "nowrap" } as const;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ ...mono, fontSize: 11, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--text-3)", textAlign: "left" }}>
            {["exit", "account", "trade", "entry → exit", "why", "R", "$", ""].map((h) => (
              <th key={h} style={{ ...td, borderBottom: "1px solid var(--border-subtle)", fontWeight: 400 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-2)" }}>
              <td style={td}>{t.exitDate}</td>
              <td style={td}>{t.account}</td>
              <td style={{ ...td, color: "var(--text-1)" }}>{t.instrument} <span style={{ color: t.side === "long" ? "var(--green)" : "var(--red)" }}>{t.side}</span></td>
              <td style={td}>{fmtPx(t.entryPrice)} → {fmtPx(t.exitPrice)}</td>
              <td style={td}>{t.exitReason}</td>
              <td style={{ ...td, color: (t.resultR ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{fmtR(t.resultR)}</td>
              <td style={td}>{t.pnlUsd != null ? fmtUsd(t.pnlUsd) : "—"}</td>
              <td style={td}><button style={{ ...btn, fontSize: 9.5, padding: "2px 8px" }} onClick={() => patch({ id: t.id, action: "reopen" })}>reopen</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
