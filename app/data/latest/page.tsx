"use client";
// app/data/latest/page.tsx
// Shows the most recent Barchart snapshot — all pairs exactly as Claude receives them.

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface PairRow  { symbol: string; percentChange: number; stddev?: number }
interface FutRow   { symbol: string; percentChange: number }
interface CalEvent { title: string; country: string; date: string; impact: "High"|"Medium"|"Low"|"Holiday"; forecast:string|null; previous:string|null; actual:string|null }
interface RateRow  { currency: string; bankName: string; currentRate: number; previousRate: number|null; source: string }

interface RawData {
  fetchedAt:   string;
  dataAge:     string;
  errors:      string[];
  summary: {
    forexPerfPairCount:     number;
    forexSurprisePairCount: number;
    futuresContractCount:   number;
    calendarEventCount:     number;
    centralBankRateCount:   number;
  };
  forexPerformance: PairRow[];
  forexSurprises:   (PairRow & { stddev: number })[];
  futures:          FutRow[];
  economicCalendar: CalEvent[];
  centralBankRates: RateRow[];
}

type Tab = "perf" | "surprises" | "futures" | "calendar" | "rates";

const IMPACT_COLOR: Record<string, string> = {
  High: "var(--red)", Medium: "var(--amber)", Low: "var(--text-3)", Holiday: "var(--text-3)",
};

function Pill({ val, green }: { val: number; green?: boolean }) {
  const pos = val > 0;
  const zero = val === 0;
  const color = zero ? "var(--text-3)" : pos ? "var(--green)" : "var(--red)";
  const bg    = zero ? "var(--bg-elevated)" : pos ? "var(--green-dim)" : "var(--red-dim)";
  const bdr   = zero ? "var(--border)" : pos ? "var(--green-border)" : "var(--red-border)";
  return (
    <span style={{ fontFamily: "monospace", fontSize: 11, color, background: bg, border: `1px solid ${bdr}`, padding: "2px 7px", borderRadius: 20 }}>
      {zero ? "0" : (pos ? "+" : "")}{val.toFixed(4)}
    </span>
  );
}

function SdPill({ val }: { val: number }) {
  const pos = val > 0;
  const zero = val === 0;
  const color = zero ? "var(--text-3)" : pos ? "var(--green)" : "var(--red)";
  const bg    = zero ? "var(--bg-elevated)" : pos ? "var(--green-dim)" : "var(--red-dim)";
  const bdr   = zero ? "var(--border)" : pos ? "var(--green-border)" : "var(--red-border)";
  return (
    <span style={{ fontFamily: "monospace", fontSize: 11, color, background: bg, border: `1px solid ${bdr}`, padding: "2px 7px", borderRadius: 20 }}>
      {zero ? "0" : (pos ? "+" : "")}{val.toFixed(2)}σ
    </span>
  );
}

function AgeBadge({ fetchedAt }: { fetchedAt: string }) {
  const age = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 60_000);
  const color = age < 60 ? "var(--green)" : age < 120 ? "var(--amber)" : "var(--red)";
  const bg    = age < 60 ? "var(--green-dim)" : age < 120 ? "var(--amber-dim)" : "var(--red-dim)";
  const bdr   = age < 60 ? "var(--green-border)" : age < 120 ? "var(--amber-border)" : "var(--red-border)";
  const label = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.floor(age/60)}h ago` : `${Math.floor(age/1440)}d ago`;
  return <span style={{ fontSize: 11, color, background: bg, border: `1px solid ${bdr}`, padding: "2px 9px", borderRadius: 20 }}>{label}</span>;
}

const TAB_LABELS: { key: Tab; label: string; field: keyof RawData["summary"] }[] = [
  { key: "perf",      label: "Forex Performance", field: "forexPerfPairCount" },
  { key: "surprises", label: "Price Surprises",   field: "forexSurprisePairCount" },
  { key: "futures",   label: "Futures",            field: "futuresContractCount" },
  { key: "calendar",  label: "Calendar",           field: "calendarEventCount" },
  { key: "rates",     label: "CB Rates",           field: "centralBankRateCount" },
];

export default function LatestDataPage() {
  const router = useRouter();
  const [data, setData]     = useState<RawData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [tab, setTab]       = useState<Tab>("perf");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/market-data/raw");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmtFetchedAt = (s: string) => {
    const d = new Date(s);
    return d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WAT";
  };

  const q = search.trim().toUpperCase();

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => router.push("/data")}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text-3)", cursor: "pointer", fontSize: 13 }}>
            ← All snapshots
          </button>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Latest Market Data</h1>
            {data && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>{fmtFetchedAt(data.fetchedAt)}</span>
                <AgeBadge fetchedAt={data.fetchedAt} />
                {data.errors.length > 0 && (
                  <span style={{ fontSize: 10, color: "var(--amber)", background: "var(--amber-dim)", border: "1px solid var(--amber-border)", padding: "2px 7px", borderRadius: 20 }}>
                    ⚠ {data.errors.length} error{data.errors.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={load}
          style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-2)", fontSize: 12, cursor: "pointer" }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 80, textAlign: "center" }}>
          <div style={{ width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.75s linear infinite", margin: "0 auto 12px" }} />
          <p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading latest snapshot…</p>
        </div>
      ) : error ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>✗ {error}</p>
          <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 16 }}>Run <code style={{ background: "var(--bg-elevated)", padding: "2px 6px", borderRadius: 4 }}>npm run sync:now</code> in the barchart-sync folder to fetch data.</p>
          <button onClick={load} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-1)", cursor: "pointer", fontSize: 12 }}>Retry</button>
        </div>
      ) : data ? (
        <>
          {/* Summary strip */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
            {TAB_LABELS.map(t => (
              <div key={t.key} className="card" style={{ padding: "10px 16px", minWidth: 110, cursor: "pointer", border: tab === t.key ? "1px solid var(--green)" : undefined, background: tab === t.key ? "var(--green-dim)" : undefined }}
                onClick={() => setTab(t.key)}>
                <div style={{ fontSize: 20, fontWeight: 700, color: tab === t.key ? "var(--green)" : "var(--text-1)" }}>{data.summary[t.field]}</div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{t.label}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div style={{ marginBottom: 14 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by symbol, currency…"
              style={{ width: "100%", maxWidth: 320, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-1)", fontSize: 12, outline: "none" }}
            />
          </div>

          {/* Tab: Forex Performance */}
          {tab === "perf" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Forex Performance — all pairs (as sent to Claude)</span>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>{data.forexPerformance.filter(r => !q || r.symbol.includes(q)).length} pairs</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["#", "Pair", "% Change", "Direction hint"].map(h => (
                      <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.forexPerformance
                    .filter(r => !q || r.symbol.toUpperCase().includes(q))
                    .map((r, i) => {
                      const base  = r.symbol.length >= 6 ? r.symbol.slice(0, 3) : "—";
                      const quote = r.symbol.length >= 6 ? r.symbol.slice(3, 6) : "—";
                      const hint  = r.percentChange > 0
                        ? <span style={{ color: "var(--green)", fontSize: 11 }}>{base} strong · {quote} weak</span>
                        : r.percentChange < 0
                        ? <span style={{ color: "var(--red)", fontSize: 11 }}>{base} weak · {quote} strong</span>
                        : <span style={{ color: "var(--text-3)", fontSize: 11 }}>flat</span>;
                      return (
                        <tr key={r.symbol} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "9px 16px", color: "var(--text-3)", fontSize: 11 }}>{i + 1}</td>
                          <td style={{ padding: "9px 16px", fontFamily: "monospace", fontWeight: 600 }}>{r.symbol}</td>
                          <td style={{ padding: "9px 16px" }}><Pill val={r.percentChange} /></td>
                          <td style={{ padding: "9px 16px" }}>{hint}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab: Price Surprises */}
          {tab === "surprises" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Price Surprises / Std Dev — all pairs</span>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>{data.forexSurprises.filter(r => !q || r.symbol.includes(q)).length} pairs</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["#", "Pair", "Std Dev (σ)", "% Change", "Signal"].map(h => (
                      <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.forexSurprises
                    .filter(r => !q || r.symbol.toUpperCase().includes(q))
                    .map((r, i) => {
                      const base  = r.symbol.length >= 6 ? r.symbol.slice(0, 3) : "—";
                      const signal = r.stddev > 0
                        ? <span style={{ color: "var(--green)", fontSize: 11 }}>{base} unusually strong</span>
                        : r.stddev < 0
                        ? <span style={{ color: "var(--red)", fontSize: 11 }}>{base} unusually weak</span>
                        : <span style={{ color: "var(--text-3)", fontSize: 11 }}>within normal range</span>;
                      return (
                        <tr key={r.symbol} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "9px 16px", color: "var(--text-3)", fontSize: 11 }}>{i + 1}</td>
                          <td style={{ padding: "9px 16px", fontFamily: "monospace", fontWeight: 600 }}>{r.symbol}</td>
                          <td style={{ padding: "9px 16px" }}><SdPill val={r.stddev} /></td>
                          <td style={{ padding: "9px 16px" }}><Pill val={r.percentChange} /></td>
                          <td style={{ padding: "9px 16px" }}>{signal}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab: Futures */}
          {tab === "futures" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Futures — all contracts</span>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>{data.futures.filter(r => !q || r.symbol.toUpperCase().includes(q)).length} contracts</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["#", "Contract", "% Change"].map(h => (
                      <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.futures
                    .filter(r => !q || r.symbol.toUpperCase().includes(q))
                    .map((r, i) => (
                      <tr key={`${r.symbol}-${i}`} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "9px 16px", color: "var(--text-3)", fontSize: 11 }}>{i + 1}</td>
                        <td style={{ padding: "9px 16px", fontFamily: "monospace", fontWeight: 600 }}>{r.symbol}</td>
                        <td style={{ padding: "9px 16px" }}><Pill val={r.percentChange} /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab: Calendar */}
          {tab === "calendar" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Economic Calendar — this week</span>
              </div>
              {data.economicCalendar.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center" }}>
                  <p style={{ fontSize: 13, color: "var(--text-3)" }}>No events for today</p>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Date", "Country", "Impact", "Event", "Actual", "Forecast", "Previous"].map(h => (
                        <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.economicCalendar
                      .filter(e => !q || e.country.includes(q) || e.title.toUpperCase().includes(q))
                      .map((e, i) => {
                        const dt = new Date(e.date);
                        const dateStr = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                        const timeStr = dt.toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });
                        const hasActual = e.actual && e.actual !== "";
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: "9px 16px", whiteSpace: "nowrap" }}>
                              <span style={{ color: "var(--text-2)" }}>{dateStr}</span>
                              <span style={{ color: "var(--text-3)", marginLeft: 4, fontSize: 10 }}>{timeStr}</span>
                            </td>
                            <td style={{ padding: "9px 16px" }}>
                              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: "var(--text-1)" }}>{e.country}</span>
                            </td>
                            <td style={{ padding: "9px 16px" }}>
                              <span style={{ fontSize: 10, color: IMPACT_COLOR[e.impact] ?? "var(--text-3)", fontWeight: 600 }}>
                                {e.impact === "High" ? "●" : e.impact === "Medium" ? "●" : "○"} {e.impact}
                              </span>
                            </td>
                            <td style={{ padding: "9px 16px", maxWidth: 240 }}>{e.title}</td>
                            <td style={{ padding: "9px 16px" }}>
                              {hasActual
                                ? <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--green)" }}>{e.actual}</span>
                                : <span style={{ color: "var(--text-3)" }}>—</span>}
                            </td>
                            <td style={{ padding: "9px 16px", fontFamily: "monospace", color: "var(--text-2)" }}>{e.forecast ?? "—"}</td>
                            <td style={{ padding: "9px 16px", fontFamily: "monospace", color: "var(--text-3)" }}>{e.previous ?? "—"}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab: Central Bank Rates */}
          {tab === "rates" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Central Bank Interest Rates</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Currency", "Bank", "Rate", "Previous", "Source"].map(h => (
                      <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.centralBankRates
                    .filter(r => !q || r.currency.includes(q))
                    .sort((a, b) => b.currentRate - a.currentRate)
                    .map(r => {
                      const changed = r.previousRate !== null && r.previousRate !== r.currentRate;
                      const cut     = changed && r.currentRate < (r.previousRate ?? 0);
                      return (
                        <tr key={r.currency} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "9px 16px" }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{r.currency}</span>
                          </td>
                          <td style={{ padding: "9px 16px", color: "var(--text-2)" }}>{r.bankName}</td>
                          <td style={{ padding: "9px 16px" }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--text-1)", fontSize: 13 }}>{r.currentRate}%</span>
                          </td>
                          <td style={{ padding: "9px 16px" }}>
                            {r.previousRate !== null ? (
                              <span style={{ fontFamily: "monospace", fontSize: 12, color: cut ? "var(--red)" : changed ? "var(--green)" : "var(--text-3)" }}>
                                {r.previousRate}%{changed ? (cut ? " ↓" : " ↑") : ""}
                              </span>
                            ) : <span style={{ color: "var(--text-3)" }}>—</span>}
                          </td>
                          <td style={{ padding: "9px 16px" }}>
                            <span style={{ fontSize: 10, color: r.source === "live" ? "var(--green)" : "var(--text-3)", background: r.source === "live" ? "var(--green-dim)" : "var(--bg-elevated)", border: `1px solid ${r.source === "live" ? "var(--green-border)" : "var(--border)"}`, padding: "2px 7px", borderRadius: 20 }}>
                              {r.source === "live" ? "🟢 live" : "📋 config"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Errors */}
          {data.errors.length > 0 && (
            <div className="card" style={{ marginTop: 16, padding: 16, border: "1px solid var(--amber-border)", background: "var(--amber-dim)" }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--amber)", marginBottom: 8 }}>⚠ Sync errors</p>
              {data.errors.map((e, i) => (
                <p key={i} style={{ fontSize: 11, color: "var(--text-2)", margin: "4px 0", fontFamily: "monospace" }}>{e}</p>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
