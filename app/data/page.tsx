"use client";
// app/data/page.tsx — Paginated list of market data snapshots

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface SnapshotRow {
  id: string;
  fetchedAt: string;
  errors: string[];
  forexPerf: number;
  forexSurp: number;
  futPerf: number;
  futSurp: number;
  topForex: string | null;
}
interface Pagination {
  total: number; page: number; limit: number; pages: number;
}

function AgeBadge({ fetchedAt }: { fetchedAt: string }) {
  const age = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 60_000);
  const color = age < 60 ? "var(--green)" : age < 120 ? "var(--amber)" : "var(--text-3)";
  const bg    = age < 60 ? "var(--green-dim)" : age < 120 ? "var(--amber-dim)" : "var(--bg-elevated)";
  const bdr   = age < 60 ? "var(--green-border)" : age < 120 ? "var(--amber-border)" : "var(--border)";
  if (age < 60) return <span style={{ fontSize: 10, color, background: bg, border: `1px solid ${bdr}`, padding: "2px 7px", borderRadius: 20 }}>{age}m ago</span>;
  const hrs = Math.floor(age / 60);
  const label = hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
  return <span style={{ fontSize: 10, color, background: bg, border: `1px solid ${bdr}`, padding: "2px 7px", borderRadius: 20 }}>{label}</span>;
}

export default function DataListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 20, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(page = 1) {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/market-data/history?page=${page}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setRows(json.rows);
      setPagination(json.pagination);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(1); }, []);

  function fmt(d: string) {
    const dt = new Date(d);
    return {
      date: dt.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }),
      time: dt.toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }),
    };
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Market Data</h1>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            {pagination.total} snapshots · synced hourly by GitHub Actions · click any row to inspect
          </p>
        </div>
        <button onClick={() => load(pagination.page)}
          style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-2)", fontSize: 12, cursor: "pointer" }}>
          ↻ Refresh
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center" }}>
            <div style={{ width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.75s linear infinite", margin: "0 auto 12px" }} />
            <p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading snapshots…</p>
          </div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <p style={{ color: "var(--red)", marginBottom: 12, fontSize: 13 }}>Failed: {error}</p>
            <button onClick={() => load(1)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-1)", cursor: "pointer" }}>Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center" }}>
            <p style={{ fontSize: 28, marginBottom: 8 }}>📭</p>
            <p style={{ fontSize: 13, color: "var(--text-3)" }}>No snapshots yet — GitHub Actions may not have run</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Date", "Time (WAT)", "Age", "Forex rows", "Surprises", "Futures rows", "Top symbol", "Errors", ""].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { date, time } = fmt(row.fetchedAt);
                const hasErrors = row.errors.length > 0;
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/data/${row.id}`)}
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-elevated)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "12px 16px", fontWeight: 500 }}>{date}</td>
                    <td style={{ padding: "12px 16px" }}><span className="font-mono" style={{ color: "var(--text-2)" }}>{time}</span></td>
                    <td style={{ padding: "12px 16px" }}><AgeBadge fetchedAt={row.fetchedAt} /></td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="font-mono" style={{ color: row.forexPerf > 0 ? "var(--text-1)" : "var(--text-3)" }}>
                        {row.forexPerf > 0 ? row.forexPerf : "—"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="font-mono" style={{ color: "var(--text-2)" }}>{row.forexSurp > 0 ? row.forexSurp : "—"}</span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="font-mono" style={{ color: "var(--text-2)" }}>{row.futPerf > 0 ? row.futPerf : "—"}</span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {row.topForex
                        ? <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--green)" }}>{row.topForex.replace(/^\^/, "")}</span>
                        : <span style={{ color: "var(--text-3)" }}>—</span>}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {hasErrors
                        ? <span style={{ fontSize: 10, color: "var(--amber)", background: "var(--amber-dim)", border: "1px solid var(--amber-border)", padding: "2px 7px", borderRadius: 20 }}>⚠ {row.errors.length}</span>
                        : <span style={{ color: "var(--text-3)", fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ color: "var(--text-3)", fontSize: 16 }}>→</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            Page {pagination.page} of {pagination.pages} · {pagination.total} total snapshots
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              disabled={pagination.page <= 1}
              onClick={() => load(pagination.page - 1)}
              style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: pagination.page <= 1 ? "var(--text-3)" : "var(--text-1)", cursor: pagination.page <= 1 ? "default" : "pointer", fontSize: 12 }}>
              ← Prev
            </button>
            {/* Page numbers (show up to 5 around current) */}
            {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
              const start = Math.max(1, Math.min(pagination.page - 2, pagination.pages - 4));
              const p = start + i;
              return (
                <button key={p} onClick={() => load(p)}
                  style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12,
                    background: p === pagination.page ? "var(--green)" : "var(--bg-card-2)",
                    color: p === pagination.page ? "#000" : "var(--text-2)",
                    cursor: "pointer", fontWeight: p === pagination.page ? 600 : 400 }}>
                  {p}
                </button>
              );
            })}
            <button
              disabled={pagination.page >= pagination.pages}
              onClick={() => load(pagination.page + 1)}
              style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: pagination.page >= pagination.pages ? "var(--text-3)" : "var(--text-1)", cursor: pagination.page >= pagination.pages ? "default" : "pointer", fontSize: 12 }}>
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
