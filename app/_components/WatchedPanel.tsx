"use client";
// app/_components/WatchedPanel.tsx
// Dashboard section that lists every idea the user clicked Watch on, with the
// armed entry / SL anchor and (when a price feed has updated the row) the live
// R-multiple. Drives the "algorithm strength" feedback loop: see how the calls
// you didn't take would have played out without risking real capital.

import { useEffect, useState } from "react";

interface WatchedRow {
  id: string;
  alertDate: string;
  pair: string;
  direction: string;
  grade: string;
  source: string;
  actedAt: string | null;
  watchEntryPrice: number | null;
  watchSlPrice: number | null;
  watchStartedAt: string | null;
  watchLastPrice: number | null;
  watchPeakR: number | null;
  watchTroughR: number | null;
  watchLastSeenAt: string | null;
  hasAnchor: boolean;
  currentR: number | null;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}
function fmtR(n: number | null): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}
function ago(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "in future";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function WatchedPanel() {
  const [rows, setRows] = useState<WatchedRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/ideas/watched");
      const j = await r.json();
      setRows(j.watched ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading && rows.length === 0) {
    return null;            // first render — keep dashboard clean while loading
  }
  if (rows.length === 0) {
    return null;            // nothing watched — don't render the section at all
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div className="section-label" style={{ margin: 0 }}>
          Watching · {rows.length}
        </div>
        <button
          onClick={load}
          style={{
            fontSize: 11, color: "var(--text-3)", background: "transparent",
            border: "1px solid var(--border)", padding: "3px 10px",
            borderRadius: 6, cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>Pair</Th>
              <Th>Dir</Th>
              <Th>Grade</Th>
              <Th right>Entry / SL</Th>
              <Th right>Last price</Th>
              <Th right>Current R</Th>
              <Th right>Peak / Trough</Th>
              <Th right>Watched</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <Td><span className="font-mono">{r.pair}</span></Td>
                <Td><span style={{ color: r.direction === "Long" ? "var(--green)" : "var(--red)" }}>{r.direction}</span></Td>
                <Td><span style={{ fontSize: 10, color: "var(--text-3)" }}>{r.grade}</span></Td>
                <Td right>
                  {r.hasAnchor ? (
                    <span className="font-mono" style={{ fontSize: 11 }}>
                      {fmtNum(r.watchEntryPrice, 5)} /{" "}
                      <span style={{ color: "var(--red)" }}>{fmtNum(r.watchSlPrice, 5)}</span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, color: "var(--text-3)" }}>no anchor</span>
                  )}
                </Td>
                <Td right>
                  <span className="font-mono" style={{ fontSize: 11 }}>
                    {fmtNum(r.watchLastPrice, 5)}
                  </span>
                </Td>
                <Td right>
                  <span
                    className="font-mono"
                    style={{
                      fontWeight: 600,
                      color: r.currentR == null ? "var(--text-3)"
                        : r.currentR > 0 ? "var(--green)"
                        : r.currentR < 0 ? "var(--red)"
                        : "var(--text-2)",
                    }}
                  >
                    {fmtR(r.currentR)}
                  </span>
                </Td>
                <Td right>
                  <span className="font-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {fmtR(r.watchPeakR)} / {fmtR(r.watchTroughR)}
                  </span>
                </Td>
                <Td right>
                  <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                    {ago(r.watchStartedAt ?? r.actedAt)}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 10, color: "var(--text-3)", margin: "6px 4px 0", lineHeight: 1.4 }}>
        Live price feed for watched ideas runs on a cron — if "Last price" is blank for a row, the cron
        hasn't picked it up yet. Current R is computed from the anchor you armed.
      </p>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{
      padding: "8px 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
      color: "var(--text-3)", textAlign: right ? "right" : "left",
    }}>{children}</th>
  );
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td style={{
      padding: "9px 14px", fontSize: 12, textAlign: right ? "right" : "left",
      color: "var(--text-2)",
    }}>{children}</td>
  );
}
