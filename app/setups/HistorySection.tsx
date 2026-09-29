"use client";
// app/setups/HistorySection.tsx — every setup the page has ever shown.
// Frozen as first seen; "on page" means the latest scan still has it.

import { useEffect, useState } from "react";
import { EmptyState, LoadingCard, ErrorCard } from "../wyckoff/_components/ui";

interface LogRow {
  id: string; market: string; instrument: string; side: string; entry: string; grade: string;
  firstState: string; lastState: string; rangeLo: number; rangeHi: number; signalDate: string | null;
  entryPrice: number; stop: number; breakevenAt: number; target: number | null;
  firstBarDate: string; firstSeenAt: string; lastSeenAt: string; goneAt: string | null;
}

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toFixed(5));
const day = (iso: string) => iso.slice(0, 10);

export default function HistorySection() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<"all" | "futures" | "forex">("all");
  const [days, setDays] = useState(90);

  useEffect(() => {
    setRows(null); setError(null);
    fetch(`/api/setups/log?market=${market}&days=${days}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setRows(j.rows); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [market, days]);

  const onPage = rows?.filter((r) => !r.goneAt).length ?? 0;

  return (
    <>
      <div style={{ display: "flex", gap: 8, margin: "0 0 16px", flexWrap: "wrap", alignItems: "center" }}>
        {(["all", "futures", "forex"] as const).map((m) => (
          <Pill key={m} on={market === m} onClick={() => setMarket(m)}>{m}</Pill>
        ))}
        {[30, 90, 365].map((d) => (
          <Pill key={d} on={days === d} onClick={() => setDays(d)}>{d}d</Pill>
        ))}
        {rows ? <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", marginLeft: 8 }}>{rows.length} logged · {onPage} still on the page</span> : null}
      </div>

      {error ? <ErrorCard message={error} /> : null}
      {!rows && !error ? <LoadingCard what="setup history" /> : null}
      {rows && !rows.length ? <EmptyState text="Nothing logged yet — the log starts with the first scan after this ships." small /> : null}

      {rows && rows.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ ...mono, fontSize: 11, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-3)", textAlign: "left" }}>
                {["first seen", "market", "setup", "grade", "state", "entry", "stop", "+1R", "cap", "status"].map((h) => (
                  <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-2)" }}>
                  <td style={td}>{r.firstBarDate}</td>
                  <td style={td}>{r.market}</td>
                  <td style={{ ...td, color: "var(--text-1)" }}>
                    {r.instrument} <span style={{ color: r.side === "long" ? "var(--green)" : "var(--red)" }}>{r.side}</span>
                    <span style={{ color: "var(--text-3)" }}> · {r.entry}</span>
                  </td>
                  <td style={td}>{r.grade}</td>
                  <td style={td}>{r.firstState === r.lastState ? r.lastState : `${r.firstState} → ${r.lastState}`}</td>
                  <td style={td}>{fmt(r.entryPrice)}</td>
                  <td style={td}>{fmt(r.stop)}</td>
                  <td style={td}>{fmt(r.breakevenAt)}</td>
                  <td style={td}>{r.target == null ? "trail" : fmt(r.target)}</td>
                  <td style={{ ...td, color: r.goneAt ? "var(--text-3)" : "var(--green)" }}>
                    {r.goneAt ? `gone ${day(r.goneAt)}` : "on page"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

const td = { padding: "6px 8px", whiteSpace: "nowrap" } as const;

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ ...mono, fontSize: 10.5, padding: "4px 10px", borderRadius: 999,
      border: `1px solid ${on ? "var(--text-2)" : "var(--border-subtle)"}`, color: on ? "var(--text-1)" : "var(--text-3)" }}>
      {children}
    </button>
  );
}
