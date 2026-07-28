"use client";
// app/wyckoff/_components/CandidateCard.tsx — one readable candidate.
//
// Design intent: a card you can read in two seconds, then act on. Header names
// the instrument and its state; a range rail shows the box; a fact row gives
// bars/context/flags; the read form sits at the bottom. Deliberately
// direction-neutral: test/flag chips use neutral tones (accent/muted), never
// green/red — a colored hint would be a verdict in disguise. The only
// green/red on the card is the factual context % sign.

import { useState } from "react";
import { Lock, ShieldCheck, AlertTriangle, CandlestickChart, ArrowLeftRight } from "lucide-react";
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
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const px = (v: number, hi: number) => v.toFixed(hi < 10 ? 4 : 2);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const VERDICT_COLOR: Record<string, string> = { accum: "var(--green)", distrib: "var(--red)", pass: "var(--text-3)" };
const verdictLabel = (v: string) => (v === "accum" ? "ACCUM" : v === "distrib" ? "DISTRIB" : "PASS");

export default function CandidateCard({
  row,
  onLocked,
  onChart,
}: {
  row: PendingRow;
  onLocked: () => void;
  onChart: (id: string) => void;
}) {
  const [verdict, setVerdict] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const suspect = SUSPECT_VOLUME.has(row.instrument);
  const inst = instrumentInfo(row.instrument);

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
    <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
          title="Read the chart here (daily bars + volume) — confirm on TradingView"
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
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
          <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>{px(row.rangeLo, row.rangeHi)}</span>
          <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", alignSelf: "center" }}>{row.barsInRange} bars</span>
          <span style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>{px(row.rangeHi, row.rangeHi)}</span>
        </div>
      </div>

      {/* ── Facts ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", padding: "10px 16px 13px" }}>
        <Chip on={row.terminalTest !== "none"}>
          {row.terminalTest === "none" ? "no terminal test" : `test: ${row.terminalTest}`}
        </Chip>
        {row.stoppingAction && <Chip on>stopping action</Chip>}
        <span style={{ ...mono, fontSize: 11, marginLeft: "auto", color: row.contextPct == null ? "var(--text-3)" : row.contextPct >= 0 ? "var(--green)" : "var(--red)" }}>
          <span style={{ color: "var(--text-3)" }}>ctx </span>
          {row.contextPct == null ? "n/a" : `${row.contextPct > 0 ? "+" : ""}${row.contextPct}%`}
        </span>
      </div>

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
            {err && <p style={{ ...mono, fontSize: 10.5, color: "var(--red)", margin: "7px 0 0" }}>{err}</p>}
          </>
        )}
      </div>
    </div>
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
