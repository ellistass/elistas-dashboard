"use client";
// app/wyckoff/_components/CandidateCard.tsx — one readable candidate.
//
// Design intent: a card you can read in two seconds, then act on. Header names
// the instrument and its state; a range rail shows the box; a fact row gives
// bars/context/flags; the triage row and the read form sit at the bottom.
// Deliberately direction-neutral: test/flag chips use neutral tones
// (accent/muted), never green/red — a colored hint would be a verdict in
// disguise. The only green/red on the card is the factual context % sign.
//
// TRIAGE vs READ — two different acts, kept visually and structurally apart:
//   • Triage (Now / Later / note / alert level) is housekeeping. Mutable,
//     reversible, carries no direction, never touches the benchmark.
//   • The read (ACCUM / DISTRIB / PASS) is the commitment. One shot, immutable,
//     scored. It stays the loudest control on the card.

import { useState } from "react";
import {
  Lock, ShieldCheck, AlertTriangle, CandlestickChart, ArrowLeftRight,
  Zap, Clock, X, BellRing, Bell, StickyNote,
} from "lucide-react";
import { SUSPECT_VOLUME, instrumentInfo, executeCall, instrumentName } from "@/lib/wyckoff/basket";

export interface PendingRow {
  id: string;
  instrument: string;
  rangeLo: number;
  rangeHi: number;
  contextPct: number | null;
  terminalTest: string;
  stoppingAction: boolean;
  barsInRange: number;
  status: "open" | "broken";
  rangeStartDate: string;
  breakoutDate: string | null;
  traderVerdict: string | null;
  traderEntry: number | null;
  traderStop: number | null;
  traderReadAt: string | null;
  fresh?: boolean;
  watch?: string | null;
  watchNote?: string | null;
  watchAt?: string | null;
  alertPrice?: number | null;
  alertSetAt?: string | null;
  alertHitAt?: string | null;
  alertHitDate?: string | null;
  readable?: boolean;
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const px = (v: number, hi: number) => v.toFixed(hi < 10 ? 4 : 2);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
const VERDICT_COLOR: Record<string, string> = { accum: "var(--green)", distrib: "var(--red)", pass: "var(--text-3)" };
const verdictLabel = (v: string) => (v === "accum" ? "ACCUM" : v === "distrib" ? "DISTRIB" : "PASS");

export default function CandidateCard({
  row,
  onLocked,
  onChart,
  onWatchChange,
}: {
  row: PendingRow;
  onLocked: () => void;
  onChart: (id: string) => void;
  onWatchChange?: () => void;
}) {
  const [verdict, setVerdict] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState(row.watchNote ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const suspect = SUSPECT_VOLUME.has(row.instrument);
  const inst = instrumentInfo(row.instrument);
  const readable = row.readable !== false;
  const hit = row.alertHitAt != null;

  async function saveWatch(patch: Record<string, unknown>) {
    if (watchBusy) return;
    setWatchBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/wyckoff/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, ...patch }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      onWatchChange?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setWatchBusy(false);
  }

  async function lockRead() {
    if (!verdict || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/wyckoff/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          verdict,
          entry: entry.trim() ? Number(entry) : undefined,
          stop: stop.trim() ? Number(stop) : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      onLocked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="card"
      style={{
        padding: 0, display: "flex", flexDirection: "column", overflow: "hidden",
        // A touched alert is the one thing on this page allowed to shout.
        border: hit ? "1px solid var(--accent)" : undefined,
        boxShadow: hit ? "0 0 0 1px var(--accent-dim, transparent), 0 0 18px rgba(58,212,236,0.15)" : undefined,
      }}
    >
      {/* ── Header: identity + state ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px 0" }}>
        <span style={{ ...mono, fontSize: 17, fontWeight: 500, color: "var(--text-1)", letterSpacing: "0.02em" }}>
          {row.instrument}
        </span>
        {instrumentName(row.instrument) !== row.instrument && (
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 300 }}>
            {instrumentName(row.instrument)}
            {inst && <span style={{ ...mono, fontSize: 9, letterSpacing: "0.08em" }}> · {inst.assetClass.toUpperCase()}</span>}
          </span>
        )}
        {inst && inst.executeSymbol && inst.executeSymbol !== row.instrument && (
          <span
            title={inst.inverted
              ? `INVERTED: ${row.instrument} moves opposite ${inst.executeSymbol} — your locked read is auto-translated to the execute side`
              : `execute on ${inst.executeSymbol}${inst.cfdNote ? ` (${inst.cfdNote})` : ""}`}
            style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: inst.inverted ? "var(--amber)" : "var(--text-3)" }}
          >
            <ArrowLeftRight size={10} strokeWidth={2} />
            {inst.executeSymbol}
            {inst.inverted && " ·inv"}
          </span>
        )}
        {inst && !inst.executeSymbol && (
          <span
            title={`No common CFD for ${row.instrument}${inst.cfdNote ? ` — ${inst.cfdNote}` : ""}. Surfaced for reading and benchmark scoring only.`}
            style={{ ...mono, fontSize: 9.5, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 999, border: "1px dashed var(--border-strong)", color: "var(--text-3)" }}
          >
            read only
          </span>
        )}
        {suspect && (
          <span title="Yahoo volume unreliable for this instrument — read on TradingView's CME feed">
            <AlertTriangle size={12} strokeWidth={2} style={{ color: "var(--amber)", display: "block" }} />
          </span>
        )}
        <button
          onClick={() => onChart(row.id)}
          title="Read the chart here (daily bars + volume) — and click a price to set an alert level"
          style={{
            marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
            padding: "4px 9px", borderRadius: 7, cursor: "pointer",
            fontSize: 11, fontWeight: 600, fontFamily: "'Sora', sans-serif",
            background: "transparent", color: "var(--text-1)",
            border: "1px solid var(--border-strong)",
          }}
        >
          <CandlestickChart size={12} strokeWidth={2} />
          Chart
        </button>
        <span style={{
          ...mono, fontSize: 9.5, letterSpacing: "0.1em",
          padding: "3px 9px", borderRadius: 999,
          border: `1px solid ${row.status === "open" ? "var(--accent-border, var(--accent))" : "var(--border-strong)"}`,
          color: row.status === "open" ? "var(--accent)" : "var(--text-2)",
          background: row.status === "open" ? "var(--accent-dim, transparent)" : "transparent",
        }}>
          {row.status === "open" ? "OPEN" : `BROKE ${day(row.breakoutDate)}`}
        </span>
      </div>

      {/* ── Range rail ── */}
      <div style={{ padding: "14px 16px 0" }}>
        <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--bg-inset, var(--border-subtle))" }}>
          <div style={{ position: "absolute", left: 0, top: -3, bottom: -3, width: 2, borderRadius: 1, background: "var(--text-3)" }} />
          <div style={{ position: "absolute", right: 0, top: -3, bottom: -3, width: 2, borderRadius: 1, background: "var(--text-3)" }} />
          {/* Alert level plotted on the rail — where it sits relative to the box
              is the fastest possible answer to "what am I waiting for?" */}
          {row.alertPrice != null && (() => {
            const span = row.rangeHi - row.rangeLo || 1;
            const pct = Math.max(0, Math.min(1, (row.alertPrice - row.rangeLo) / span));
            return (
              <div
                title={`alert ${px(row.alertPrice, row.rangeHi)}`}
                style={{
                  position: "absolute", left: `${pct * 100}%`, top: -5, bottom: -5, width: 2,
                  marginLeft: -1, borderRadius: 1, background: hit ? "var(--accent)" : "var(--text-2)",
                }}
              />
            );
          })()}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
          <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>{px(row.rangeLo, row.rangeHi)}</span>
          <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", alignSelf: "center" }}>{row.barsInRange} bars</span>
          <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>{px(row.rangeHi, row.rangeHi)}</span>
        </div>
      </div>

      {/* ── Facts ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", padding: "10px 16px 11px" }}>
        <Chip on={row.terminalTest !== "none"}>
          {row.terminalTest === "none" ? "no terminal test" : `test: ${row.terminalTest}`}
        </Chip>
        {row.stoppingAction && <Chip on>stopping action</Chip>}
        <span style={{ ...mono, fontSize: 11, marginLeft: "auto", color: row.contextPct == null ? "var(--text-3)" : row.contextPct >= 0 ? "var(--green)" : "var(--red)" }}>
          <span style={{ color: "var(--text-3)" }}>ctx </span>
          {row.contextPct == null ? "n/a" : `${row.contextPct > 0 ? "+" : ""}${row.contextPct}%`}
        </span>
      </div>

      {/* ── Triage row — housekeeping, not a call ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", padding: "0 16px 11px" }}>
        <TriageButton
          active={row.watch === "now"}
          busy={watchBusy}
          icon={<Zap size={11} strokeWidth={2} />}
          label="Now"
          title="Immediate watch — keep this in front of me"
          onClick={() => saveWatch({ watch: row.watch === "now" ? null : "now" })}
        />
        <TriageButton
          active={row.watch === "later"}
          busy={watchBusy}
          icon={<Clock size={11} strokeWidth={2} />}
          label="Later"
          title="Park it — I'll come back to this one"
          onClick={() => saveWatch({ watch: row.watch === "later" ? null : "later" })}
        />
        <button
          onClick={() => setNoteOpen((v) => !v)}
          title={row.watchNote ? row.watchNote : "Note to self — why does this one matter?"
          }
          style={{
            ...mono, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10,
            padding: "4px 9px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${row.watchNote ? "var(--border-strong)" : "var(--border-subtle)"}`,
            background: "transparent", color: row.watchNote ? "var(--text-1)" : "var(--text-3)",
          }}
        >
          <StickyNote size={11} strokeWidth={2} />
          {row.watchNote ? "note" : "add note"}
        </button>
        {row.alertPrice != null ? (
          <span
            title={hit ? `touched ${day(row.alertHitDate)}` : "armed — fires in the nightly digest when a bar trades through it"}
            style={{
              ...mono, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10,
              padding: "4px 9px", borderRadius: 999, marginLeft: "auto",
              border: `1px solid ${hit ? "var(--accent)" : "var(--border-strong)"}`,
              color: hit ? "var(--accent)" : "var(--text-2)",
            }}
          >
            {hit ? <BellRing size={11} strokeWidth={2} /> : <Bell size={11} strokeWidth={2} />}
            {px(row.alertPrice, row.rangeHi)}
            {hit && ` · hit ${day(row.alertHitDate)}`}
            <button
              onClick={() => saveWatch({ alertPrice: null })}
              aria-label="Clear alert"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", display: "flex" }}
            >
              <X size={10} strokeWidth={2.4} />
            </button>
          </span>
        ) : (
          <button
            onClick={() => onChart(row.id)}
            title="Open the chart and click a price to set an alert level"
            style={{
              ...mono, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10,
              padding: "4px 9px", borderRadius: 999, marginLeft: "auto", cursor: "pointer",
              border: "1px dashed var(--border-strong)", background: "transparent", color: "var(--text-3)",
            }}
          >
            <Bell size={11} strokeWidth={2} />
            set alert
          </button>
        )}
      </div>

      {noteOpen && (
        <div style={{ padding: "0 16px 11px", display: "flex", gap: 7 }}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { saveWatch({ note }); setNoteOpen(false); } }}
            placeholder="why this one? (saved to the card)"
            maxLength={500}
            autoFocus
            style={{ ...inputStyle, width: "auto", flex: 1 }}
          />
          <button
            onClick={() => { saveWatch({ note }); setNoteOpen(false); }}
            style={{
              padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border-strong)",
              background: "transparent", color: "var(--text-1)", fontSize: 11, fontWeight: 600,
              fontFamily: "'Sora', sans-serif", cursor: "pointer",
            }}
          >
            Save
          </button>
        </div>
      )}

      {!noteOpen && row.watchNote && (
        <p style={{ ...mono, fontSize: 10.5, color: "var(--text-3)", margin: "0 16px 11px", lineHeight: 1.5 }}>
          “{row.watchNote}”
        </p>
      )}

      {/* ── Read form / locked state ── */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "11px 16px 13px", marginTop: "auto", background: "var(--bg-card-2, transparent)" }}>
        {row.traderVerdict ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{
              ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11,
              padding: "5px 11px", borderRadius: 999, border: "1px solid var(--border-strong)",
              color: VERDICT_COLOR[row.traderVerdict] ?? "var(--text-2)",
            }}>
              <ShieldCheck size={12} strokeWidth={2} />
              {verdictLabel(row.traderVerdict)} · locked {day(row.traderReadAt)}
            </span>
            {(() => {
              // The execute translation of YOUR OWN locked read — inversion
              // applied for you (6C/6J/6S), never flipped in your head.
              const call = executeCall(row.instrument, row.traderVerdict);
              if (!call) return null;
              return (
                <span style={{
                  ...mono, fontSize: 11, fontWeight: 500,
                  color: call.action === "BUY" ? "var(--green)" : "var(--red)",
                }}>
                  → {call.action} {call.symbol}
                </span>
              );
            })()}
            {row.traderEntry != null && (
              <span style={{ ...mono, fontSize: 10.5, color: "var(--text-3)" }}>
                entry {px(row.traderEntry, row.rangeHi)} · stop {row.traderStop != null ? px(row.traderStop, row.rangeHi) : "—"}
              </span>
            )}
          </div>
        ) : !readable ? (
          // Kept because you asked for it, but the blind window has closed —
          // showing a form here would only produce a 409 on submit.
          <p style={{ ...mono, fontSize: 10.5, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            decision point passed — watching only. A read logged now wouldn&apos;t be blind, so it
            isn&apos;t scored. The range stays tracked until it breaks out and resolves.
          </p>
        ) : (
          <>
            <div className="seg" style={{ display: "flex", marginBottom: 8 }}>
              {(["accum", "distrib", "pass"] as const).map((v) => (
                <button key={v} className={verdict === v ? "on" : ""} style={{ flex: 1 }} onClick={() => setVerdict(v)}>
                  {verdictLabel(v)}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="entry" inputMode="decimal" style={inputStyle} />
              <input value={stop} onChange={(e) => setStop(e.target.value)} placeholder="stop" inputMode="decimal" style={inputStyle} />
              <button
                onClick={lockRead}
                disabled={!verdict || busy}
                style={{
                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 8, border: "none",
                  background: verdict ? "var(--accent)" : "var(--border-subtle)",
                  color: verdict ? "var(--accent-on)" : "var(--text-3)",
                  fontSize: 12, fontWeight: 600, cursor: verdict ? "pointer" : "default",
                  opacity: busy ? 0.6 : 1, fontFamily: "'Sora', sans-serif", whiteSpace: "nowrap",
                }}
              >
                <Lock size={12} strokeWidth={2} />
                {busy ? "Locking…" : "Lock read"}
              </button>
            </div>
          </>
        )}
        {err && <p style={{ ...mono, fontSize: 10.5, color: "var(--red)", margin: "7px 0 0" }}>{err}</p>}
      </div>
    </div>
  );
}

/* Triage pill — neutral by design. A tag says "keep this in front of me",
   never which way it breaks, so it gets no directional color. */
function TriageButton({ active, busy, icon, label, title, onClick }: {
  active: boolean; busy: boolean; icon: React.ReactNode; label: string; title: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      style={{
        fontFamily: "'DM Mono', monospace",
        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10,
        padding: "4px 10px", borderRadius: 999, cursor: busy ? "default" : "pointer",
        border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}`,
        background: active ? "var(--accent-dim, transparent)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-3)",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/* Neutral fact chip — accent presence, never green/red (no verdict hints). */
function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span style={{
      ...mono, fontSize: 10, padding: "3px 9px", borderRadius: 999,
      border: `1px solid ${on ? "var(--accent-border, var(--accent))" : "var(--border-subtle)"}`,
      color: on ? "var(--text-1)" : "var(--text-3)",
      background: on ? "var(--accent-dim, transparent)" : "transparent",
    }}>
      {children}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  width: 82,
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-1)",
  outline: "none",
};
