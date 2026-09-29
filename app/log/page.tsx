"use client";
// app/log/page.tsx — Journal: is the system working over time?
//
// Every setup ever seen, frozen as first seen, played out under the mechanical
// rules (fill, stop, breakeven at +1R, trail 1R, cap, 60-bar time exit), next to
// the trades you actually took. The results table is the test: compare each
// group against its backtest expectation, not against zero.

import { useCallback, useEffect, useState } from "react";
import { BookMarked, RefreshCw } from "lucide-react";
import { SectionHeader, EmptyState, LoadingCard, ErrorCard } from "../wyckoff/_components/ui";
import { fmtPx, fmtR } from "@/lib/swing/core";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const btn = { ...mono, fontSize: 10.5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-strong)", color: "var(--text-1)", display: "inline-flex", gap: 6, alignItems: "center" } as const;
const td = { padding: "6px 8px", whiteSpace: "nowrap" } as const;
const h3 = { ...mono, fontSize: 11, color: "var(--text-3)", margin: "24px 0 8px" } as const;
const MIN_N = 30;

interface Stats { n: number; avgR: number | null; winPct: number | null; maxDD: number | null; longestLosing: number | null }
interface Payload { table: { group: string; expectation: string; stats: Stats }[]; counts: Record<string, number>; rows: any[] }

export default function JournalPage() {
  const [market, setMarket] = useState<"all" | "futures" | "forex">("all");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<"all" | "closed" | "open" | "expired">("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/swing/journal?market=${market}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [market]);
  useEffect(() => { setData(null); load(); }, [load]);

  const resolve = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/swing/journal", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const rows = (data?.rows ?? []).filter((r) =>
    show === "all" ? true : show === "closed" ? ["win", "loss", "be"].includes(r.outcome) : r.outcome === show);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <SectionHeader
        icon={<BookMarked size={14} />}
        title="Journal"
        count={data?.rows.length}
        note="every setup ever seen, played out under the rules"
        right={<button style={btn} onClick={resolve} disabled={busy}><RefreshCw size={11} className={busy ? "animate-spin" : ""} /> update results</button>}
      />
      <div style={{ display: "flex", gap: 8, margin: "4px 0 12px" }}>
        {(["all", "futures", "forex"] as const).map((m) => <Pill key={m} on={market === m} onClick={() => setMarket(m)}>{m === "futures" ? "futures / stocks" : m}</Pill>)}
      </div>
      {error ? <ErrorCard message={error} /> : null}
      {!data && !error ? <LoadingCard what="the journal" /> : null}

      {data ? (
        <>
          <h3 style={{ ...h3, marginTop: 8 }}>RESULTS</h3>
          <div className="card" style={{ padding: 4, overflowX: "auto" }}>
            <table style={{ ...mono, fontSize: 11.5, width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ color: "var(--text-3)", textAlign: "left" }}>
                {["group", "backtest expectation", "n", "avg R", "win %", "max drawdown", "longest losing streak"].map((h) => <th key={h} style={{ ...td, fontWeight: 400 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.table.map((g) => {
                  const thin = g.stats.n < MIN_N;
                  return (
                    <tr key={g.group} style={{ borderTop: "1px solid var(--border-subtle)", color: thin ? "var(--text-3)" : "var(--text-1)" }}>
                      <td style={td}>{g.group}</td>
                      <td style={{ ...td, color: "var(--text-3)" }}>{g.expectation}</td>
                      <td style={td}>{g.stats.n}{thin && g.stats.n ? <span style={{ fontSize: 9.5 }}> · not enough data</span> : null}</td>
                      <td style={{ ...td, color: thin || g.stats.avgR == null ? undefined : g.stats.avgR >= 0 ? "var(--green)" : "var(--red)" }}>{fmtR(g.stats.avgR)}</td>
                      <td style={td}>{g.stats.winPct == null ? "—" : `${g.stats.winPct}%`}</td>
                      <td style={td}>{g.stats.maxDD == null ? "—" : `${g.stats.maxDD}R`}</td>
                      <td style={td}>{g.stats.longestLosing ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginTop: 6, lineHeight: 1.6 }}>
            Reading rules: groups under {MIN_N} trades are greyed out as not enough data · compare against the expectation, not against zero ·
            losing streaks of 5–8 on A-grades are normal · the key test is whether the COT trapped vs late gap holds.
            Only setups that filled and closed count; no costs or swaps.
          </p>

          <h3 style={h3}>
            EVERY SETUP · {Object.entries(data.counts).map(([k, v]) => `${v} ${k}`).join(" · ") || "none yet"}
          </h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {(["all", "closed", "open", "expired"] as const).map((s) => <Pill key={s} on={show === s} onClick={() => setShow(s)}>{s}</Pill>)}
          </div>
          {rows.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...mono, fontSize: 11, width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "var(--text-3)", textAlign: "left" }}>
                  {["first seen", "setup", "grade", "tags", "entry / stop", "fill", "exit", "R", "peak", "you"].map((h) => <th key={h} style={{ ...td, fontWeight: 400, borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-2)" }}>
                      <td style={td}>{r.firstBarDate}</td>
                      <td style={{ ...td, color: "var(--text-1)" }}>
                        {r.instrument} <span style={{ color: r.side === "long" ? "var(--green)" : "var(--red)" }}>{r.side}</span>
                        <span style={{ color: "var(--text-3)" }}> · {r.entry}</span>
                      </td>
                      <td style={td}>{r.grade}</td>
                      <td style={{ ...td, color: "var(--text-3)" }}>{[r.context, r.cot && `COT ${r.cot}`, r.quietRetest ? "quiet retest" : null].filter(Boolean).join(" · ")}</td>
                      <td style={td}>{fmtPx(r.entryPrice)} / {fmtPx(r.stop)}</td>
                      <td style={td}>{r.fillDate ? `${r.fillDate} @ ${fmtPx(r.fillPrice)}` : r.outcome === "expired" ? "never filled" : "—"}</td>
                      <td style={td}>{r.exitDate ? `${r.exitDate} ${r.exitReason}` : r.outcome === "open" ? "open" : r.outcome ? "—" : "pending"}</td>
                      <td style={{ ...td, color: r.resultR == null ? undefined : r.resultR >= 0 ? "var(--green)" : "var(--red)" }}>
                        {fmtR(r.resultR)}{r.outcome === "open" && r.resultR != null ? " (now)" : ""}
                      </td>
                      <td style={td}>{fmtR(r.peakR)}</td>
                      <td style={td}>{r.taken ? `took it (${r.taken.account})${r.taken.resultR != null ? ` ${fmtR(r.taken.resultR)}` : ""}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState text="No logged setups here yet. The log fills from the first scan after it shipped; press 'update results' to play them out." small />}
        </>
      ) : null}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ ...mono, fontSize: 10.5, padding: "4px 10px", borderRadius: 999,
      border: `1px solid ${on ? "var(--text-2)" : "var(--border-subtle)"}`, color: on ? "var(--text-1)" : "var(--text-3)" }}>
      {children}
    </button>
  );
}
