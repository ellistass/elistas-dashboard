"use client";
// app/setups/TakeBar.tsx — "Took it" / "Skip" on a setup card.
//
// Took it: prefilled with the card's order lines (translated to what you
// execute), runs the pre-trade gate, then saves the trade. A block can still be
// saved (you may already be in it at the broker) — every failed rule is then
// written to the rule-break log. Skip: the reason goes to the skip log; skips
// are decisions too, and they're reviewed like trades.

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, LogIn, SkipForward } from "lucide-react";
import { invalidateRiskContext } from "./RiskBlock";
import { fmtPx, fmtUsd, riskForGrade, sizeFor, specFor, todayUtc, type InstrumentSpecCfg, type SwingAccountCfg } from "@/lib/swing/core";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const inp = { ...mono, fontSize: 11, padding: "4px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-1)", width: "100%" } as const;
const btn = { ...mono, fontSize: 11, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--bg-card-2)", color: "var(--text-1)", cursor: "pointer", display: "inline-flex", gap: 5, alignItems: "center" } as const;
const lbl = { ...mono, fontSize: 9.5, color: "var(--text-3)", display: "grid", gap: 3 } as const;

export interface TakeCard {
  /** Identifies the logged setup (READ side for futures). */
  ref: { market: "futures" | "forex"; instrument: string; side: string; entry: string; rangeLo: number; rangeHi: number };
  instrument: string;
  executeSymbol: string | null;
  side: "long" | "short";            // EXECUTE direction
  grade: "A" | "B";
  entry: number;
  stop: number;
  cap: number | null;
  entryKind: "limit" | "open";
  samePrices: boolean;
  readLocked: boolean | null;
  readAgrees: boolean | null;
  entryDate: string;
}

interface Check { rule: string; level: "ok" | "warn" | "block"; text: string }
interface Gate { checks: Check[]; blocked: boolean; plannedExitDate: string | null }

const SKIP_REASONS = ["monthly stop", "slots full", "correlation", "event in the hold", "B-grade in 50k", "no read / read disagrees", "levels already gone", "other"];

export default function TakeBar({ card }: { card: TakeCard }) {
  const [mode, setMode] = useState<null | "take" | "skip" | "done">(null);
  const [doneText, setDoneText] = useState("");
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
      {mode === "done" ? (
        <div style={{ ...mono, fontSize: 10.5, color: "var(--green)" }}>{doneText}</div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <button style={{ ...btn, borderColor: mode === "take" ? "var(--accent)" : undefined }} onClick={() => setMode(mode === "take" ? null : "take")}><LogIn size={11} /> took it</button>
          <button style={{ ...btn, borderColor: mode === "skip" ? "var(--accent)" : undefined }} onClick={() => setMode(mode === "skip" ? null : "skip")}><SkipForward size={11} /> skip</button>
        </div>
      )}
      {mode === "take" ? <TakeForm card={card} onDone={(t) => { setDoneText(t); setMode("done"); }} /> : null}
      {mode === "skip" ? <SkipForm card={card} onDone={(t) => { setDoneText(t); setMode("done"); }} /> : null}
    </div>
  );
}

function TakeForm({ card, onDone }: { card: TakeCard; onDone: (text: string) => void }) {
  const [accounts, setAccounts] = useState<SwingAccountCfg[] | null>(null);
  const [f, setF] = useState({
    account: "", entryDate: card.entryDate, entryPrice: fmtPx(card.entry), stopPrice: fmtPx(card.stop),
    capPrice: card.cap != null ? fmtPx(card.cap) : "", riskUsd: "", size: "", notes: "",
  });
  const [specs, setSpecs] = useState<InstrumentSpecCfg[]>([]);
  const [gate, setGate] = useState<Gate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Accounts load once, then pick the first account that takes this grade.
  useEffect(() => {
    fetch("/api/swing/context").then((r) => r.json()).then((j) => {
      const accs: SwingAccountCfg[] = j.accounts ?? [];
      setAccounts(accs);
      setSpecs(j.specs ?? []);
      const pick = accs.find((a) => a.gradesAllowed.includes(card.grade)) ?? accs[0];
      if (pick) setF((x) => ({ ...x, account: pick.key }));
    }).catch(() => setErr("couldn't load accounts"));
  }, [card.grade]);
  const acc = accounts?.find((a) => a.key === f.account);
  const risk = f.riskUsd ? Number(f.riskUsd) : riskForGrade(card.grade, acc?.riskPerTrade ?? 100);
  const spec = specFor(card.instrument, specs);   // your contract-size overrides from Month → Settings
  const size = f.size ? Number(f.size) : sizeFor(risk, Number(f.entryPrice), Number(f.stopPrice), spec);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setGate(null); };

  const body = (override = false) => ({
    account: f.account, instrument: card.instrument, executeSymbol: card.executeSymbol, side: card.side, grade: card.grade,
    entryDate: f.entryDate, entryPrice: f.entryPrice, stopPrice: f.stopPrice, capPrice: f.capPrice, riskUsd: risk, size,
    cardEntry: card.entry, cardStop: card.stop, cardCap: card.cap, cardEntryKind: card.entryKind,
    samePrices: card.samePrices, readLocked: card.readLocked, readAgrees: card.readAgrees, setupRef: card.ref, notes: f.notes, override,
  });

  const check = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/swing/gate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setGate(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const save = async (override: boolean) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/swing/trades", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(override)) });
      const j = await r.json();
      if (r.status === 409) { setGate(j.gate); return; }
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      invalidateRiskContext();
      const logged = (j.gate?.checks ?? []).filter((c: Check) => c.level === "block" || (c.level === "warn" && ["Levels", "House money", "Read"].includes(c.rule))).length;
      onDone(`Saved to Trades (${f.account}).${logged ? ` ${logged} rule break${logged > 1 ? "s" : ""} logged on Discipline.` : ""}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        <label style={lbl}>account
          <select style={inp} value={f.account} onChange={set("account")}>
            {(accounts ?? []).map((a) => <option key={a.key} value={a.key}>{a.key}{a.gradesAllowed.includes(card.grade) ? "" : ` (${a.gradesAllowed.join("/")} only)`}</option>)}
          </select>
        </label>
        <label style={lbl}>entry date<input style={inp} value={f.entryDate} onChange={set("entryDate")} /></label>
        <label style={lbl}>your entry{card.entryKind === "open" ? " (fill)" : ""}<input style={inp} value={f.entryPrice} onChange={set("entryPrice")} /></label>
        <label style={lbl}>your stop<input style={inp} value={f.stopPrice} onChange={set("stopPrice")} /></label>
        <label style={lbl}>your cap<input style={inp} value={f.capPrice} onChange={set("capPrice")} /></label>
        <label style={lbl}>risk $<input style={inp} placeholder={String(risk)} value={f.riskUsd} onChange={set("riskUsd")} /></label>
      </div>
      <div style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>
        size for {fmtUsd(risk)}: <b style={{ color: "var(--text-1)" }}>{size} {spec.unit}{size === 1 ? "" : "s"}</b>
        {spec.unit === "lot" ? " — check your broker's contract size" : ""}
        {!card.samePrices ? " · card prices are the future's; enter your broker's prices" : ""}
      </div>
      <label style={lbl}>notes<input style={inp} value={f.notes} onChange={set("notes")} /></label>

      {gate ? (
        <div style={{ display: "grid", gap: 3, padding: "6px 8px", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
          {gate.checks.map((c, i) => (
            <div key={i} style={{ ...mono, fontSize: 10, display: "flex", gap: 6, alignItems: "flex-start",
              color: c.level === "block" ? "var(--red)" : c.level === "warn" ? "var(--amber)" : "var(--text-2)" }}>
              {c.level === "ok" ? <CheckCircle2 size={10} color="var(--green)" /> : c.level === "warn" ? <AlertTriangle size={10} /> : <XCircle size={10} />}
              <span><b>{c.rule}</b> · {c.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={btn} disabled={busy || !f.account} onClick={check}>check the rules</button>
        {gate && !gate.blocked ? <button style={{ ...btn, borderColor: "var(--green)" }} disabled={busy} onClick={() => save(false)}>save trade</button> : null}
        {gate && gate.blocked ? (
          <button style={{ ...btn, borderColor: "var(--red)", color: "var(--red)" }} disabled={busy} onClick={() => save(true)}>
            already in it — save and log the break{gate.checks.filter((c) => c.level === "block").length > 1 ? "s" : ""}
          </button>
        ) : null}
      </div>
      {err ? <div style={{ ...mono, fontSize: 10.5, color: "var(--red)" }}>{err}</div> : null}
    </div>
  );
}

function SkipForm({ card, onDone }: { card: TakeCard; onDone: (text: string) => void }) {
  const [reason, setReason] = useState(SKIP_REASONS[0]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const r = await fetch("/api/swing/discipline", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "skip", date: todayUtc(), instrument: card.instrument, rule: reason, detail: note, setupRef: card.ref }) });
    const j = await r.json();
    if (!r.ok) setErr(j.error ?? r.statusText); else onDone(`Skipped (${reason}) — logged on Discipline.`);
  };
  return (
    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1.4fr auto", gap: 6, alignItems: "end" }}>
      <label style={lbl}>reason
        <select style={inp} value={reason} onChange={(e) => setReason(e.target.value)}>{SKIP_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
      </label>
      <label style={lbl}>note<input style={inp} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button style={btn} onClick={save}>log skip</button>
      {err ? <div style={{ ...mono, fontSize: 10.5, color: "var(--red)", gridColumn: "1 / -1" }}>{err}</div> : null}
    </div>
  );
}
