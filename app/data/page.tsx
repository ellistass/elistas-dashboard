"use client";
// app/data/page.tsx — Market data viewer
// Shows exactly what Barchart, ForexFactory, and central bank rates are in DB

import { useState, useEffect } from "react";

interface BarchartRow {
  symbol: string; name: string; latest: number;
  change: number; percentChange: number;
  standardDeviation?: number; time: string;
}
interface CalendarEvent {
  title: string; country: string; date: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  forecast: string | null; previous: string | null; actual: string | null;
}
interface CentralBankRate {
  currency: string; country: string; bankName: string;
  currentRate: number; previousRate: number | null; source: string; lastUpdated: string;
}
interface MarketData {
  barchart: {
    fetchedAt: string | null; ageMinutes: number | null; errors: string[];
    data: {
      forex: {
        performance: { today: { bullish: BarchartRow[]; bearish: BarchartRow[] } };
        surprises: { bullish: BarchartRow[]; bearish: BarchartRow[] };
      };
      futures: {
        performance: { today: { bullish: BarchartRow[]; bearish: BarchartRow[] } };
        surprises: { bullish: BarchartRow[]; bearish: BarchartRow[] };
      };
    } | null;
  };
  economic: { fetchedAt: string | null; ageMinutes: number | null; events: CalendarEvent[] };
  rates:    { fetchedAt: string | null; ageMinutes: number | null; rates: CentralBankRate[] };
}

function AgeBadge({ age }: { age: number | null }) {
  if (age === null) return <span style={{ fontSize: 10, color: "var(--red)", padding: "2px 8px", borderRadius: 20, background: "var(--red-dim)", border: "1px solid var(--red-border)" }}>missing</span>;
  const color = age < 60 ? "var(--green)" : age < 120 ? "var(--amber)" : "var(--red)";
  const bg    = age < 60 ? "var(--green-dim)" : age < 120 ? "var(--amber-dim)" : "var(--red-dim)";
  const bdr   = age < 60 ? "var(--green-border)" : age < 120 ? "var(--amber-border)" : "var(--red-border)";
  return <span style={{ fontSize: 10, color, padding: "2px 8px", borderRadius: 20, background: bg, border: `1px solid ${bdr}` }}>{age}m ago</span>;
}

function ImpactDot({ impact }: { impact: string }) {
  const color = impact === "High" ? "var(--red)" : impact === "Medium" ? "var(--amber)" : "var(--text-3)";
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />;
}

function SectionHeader({ title, fetchedAt, age, count, extra }: { title: string; fetchedAt: string | null; age: number | null; count: number; extra?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 2px" }}>{title}</h2>
        <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>
          {fetchedAt ? new Date(fetchedAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WAT" : "No data"}
          {extra ? ` · ${extra}` : ""}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{count} rows</span>
        <AgeBadge age={age} />
      </div>
    </div>
  );
}

function BarchartTable({ rows, colorDir }: { rows: BarchartRow[]; colorDir: "bullish" | "bearish" }) {
  const color = colorDir === "bullish" ? "var(--green)" : "var(--red)";
  if (!rows?.length) return <p style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", padding: 16 }}>No data</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Symbol", "Name", "Change %", "Std Dev", "Time"].map(h => (
              <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "7px 10px" }}><span className="font-mono" style={{ fontWeight: 600 }}>{r.symbol?.replace(/^\^/, "")}</span></td>
              <td style={{ padding: "7px 10px", color: "var(--text-2)" }}>{r.name}</td>
              <td style={{ padding: "7px 10px" }}><span className="font-mono" style={{ color, fontWeight: 500 }}>{r.percentChange > 0 ? "+" : ""}{r.percentChange?.toFixed(3)}%</span></td>
              <td style={{ padding: "7px 10px" }}><span className="font-mono" style={{ color: "var(--text-3)" }}>{r.standardDeviation?.toFixed(3) ?? "—"}</span></td>
              <td style={{ padding: "7px 10px", color: "var(--text-3)" }}>{r.time ? new Date(r.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataPage() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [barchartTab, setBarchartTab] = useState<"forex-perf" | "forex-surp" | "fut-perf" | "fut-surp">("forex-perf");
  const [calFilter, setCalFilter] = useState<"all" | "today" | "High">("today");

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/market-data");
      if (!res.ok) throw new Error("Failed to fetch");
      setData(await res.json());
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const todayStr = new Date().toISOString().split("T")[0];

  const filteredEvents = (data?.economic.events as CalendarEvent[] || []).filter(e => {
    const eDate = new Date(e.date).toISOString().split("T")[0];
    if (calFilter === "today") return eDate === todayStr;
    if (calFilter === "High")  return e.impact === "High";
    return true;
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const tabBtn = (key: string, label: string, active: string, set: (k: any) => void) => (
    <button key={key} onClick={() => set(key)}
      style={{ padding: "6px 14px", borderRadius: 7, fontSize: 11, fontWeight: 500, cursor: "pointer", border: "none",
        background: active === key ? "var(--bg-elevated)" : "transparent",
        color: active === key ? "var(--text-1)" : "var(--text-3)" }}>
      {label}
    </button>
  );

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.75s linear infinite", margin: "0 auto 12px" }} />
        <p style={{ fontSize: 13, color: "var(--text-3)" }}>Loading market data…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="card" style={{ textAlign: "center", padding: 40 }}>
      <p style={{ color: "var(--red)", marginBottom: 12 }}>Failed to load: {error}</p>
      <button onClick={load} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-1)", cursor: "pointer" }}>Retry</button>
    </div>
  );

  const bc = data?.barchart;
  const barchartTabs = {
    "forex-perf": { label: "Forex Performance",  bullish: bc?.data?.forex.performance.today.bullish ?? [],  bearish: bc?.data?.forex.performance.today.bearish ?? []  },
    "forex-surp": { label: "Forex Surprises",    bullish: bc?.data?.forex.surprises.bullish ?? [],           bearish: bc?.data?.forex.surprises.bearish ?? []           },
    "fut-perf":   { label: "Futures Performance",bullish: bc?.data?.futures.performance.today.bullish ?? [], bearish: bc?.data?.futures.performance.today.bearish ?? [] },
    "fut-surp":   { label: "Futures Surprises",  bullish: bc?.data?.futures.surprises.bullish ?? [],         bearish: bc?.data?.futures.surprises.bearish ?? []         },
  };
  const activeTab = barchartTabs[barchartTab];
  const totalBarchartRows = (activeTab.bullish.length + activeTab.bearish.length);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Market Data</h1>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            Raw data in Supabase — this is exactly what gets sent to Claude for scoring
          </p>
        </div>
        <button onClick={load}
          style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-2)", fontSize: 12, cursor: "pointer" }}>
          ↻ Refresh
        </button>
      </div>

      {/* Freshness strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Barchart Snapshot",   age: bc?.ageMinutes ?? null,            fetched: bc?.fetchedAt ?? null,            errors: bc?.errors ?? [] },
          { label: "Economic Calendar",   age: data?.economic.ageMinutes ?? null, fetched: data?.economic.fetchedAt ?? null, errors: [] },
          { label: "Central Bank Rates",  age: data?.rates.ageMinutes ?? null,    fetched: data?.rates.fetchedAt ?? null,    errors: [] },
        ].map(({ label, age, fetched, errors }) => (
          <div key={label} style={{ background: "var(--bg-card)", border: `1px solid ${age !== null && age > 90 ? "var(--red-border)" : "var(--border)"}`, borderRadius: 12, padding: "14px 16px" }}>
            <p style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 6px" }}>{label}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <AgeBadge age={age} />
              {errors.length > 0 && <span style={{ fontSize: 10, color: "var(--amber)" }}>⚠ {errors.length} error{errors.length > 1 ? "s" : ""}</span>}
            </div>
            <p style={{ fontSize: 10, color: "var(--text-3)", margin: 0 }}>
              {fetched ? new Date(fetched).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WAT" : "Not fetched yet"}
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Barchart data ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 0" }}>
            <SectionHeader
              title="Barchart — Forex & Futures"
              fetchedAt={bc?.fetchedAt ?? null}
              age={bc?.ageMinutes ?? null}
              count={totalBarchartRows}
              extra="synced hourly by GitHub Actions"
            />
            {bc?.errors?.length ? (
              <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "var(--amber-dim)", border: "1px solid var(--amber-border)", color: "var(--amber)", fontSize: 11 }}>
                ⚠ Sync errors: {bc.errors.join(" · ")}
              </div>
            ) : null}
            {/* Sub-tabs */}
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
              {(Object.entries(barchartTabs) as [string, any][]).map(([key, val]) =>
                tabBtn(key, val.label, barchartTab, setBarchartTab)
              )}
            </div>
          </div>

          {!bc?.data ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <p style={{ color: "var(--text-3)", fontSize: 12 }}>No Barchart snapshot in DB yet — GitHub Actions may not have run</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <div style={{ borderRight: "1px solid var(--border)" }}>
                <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
                  <span style={{ fontSize: 10, color: "var(--green)", fontWeight: 600, letterSpacing: "0.1em" }}>BULLISH ({activeTab.bullish.length})</span>
                </div>
                <BarchartTable rows={activeTab.bullish} colorDir="bullish" />
              </div>
              <div>
                <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--red)", display: "inline-block" }} />
                  <span style={{ fontSize: 10, color: "var(--red)", fontWeight: 600, letterSpacing: "0.1em" }}>BEARISH ({activeTab.bearish.length})</span>
                </div>
                <BarchartTable rows={activeTab.bearish} colorDir="bearish" />
              </div>
            </div>
          )}
        </div>

        {/* ── Economic calendar ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 0" }}>
            <SectionHeader
              title="Economic Calendar — ForexFactory"
              fetchedAt={data?.economic.fetchedAt ?? null}
              age={data?.economic.ageMinutes ?? null}
              count={filteredEvents.length}
              extra="full week, all major currencies"
            />
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
              {[["today", "Today"], ["High", "High impact"], ["all", "Full week"]].map(([k, l]) =>
                tabBtn(k, l, calFilter, setCalFilter)
              )}
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <p style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              No events for this filter — try "Full week"
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["", "Currency", "Event", "Impact", "Actual", "Forecast", "Previous", "Date"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((e, i) => {
                    const hasActual = e.actual !== null && e.actual !== "";
                    const beat = hasActual && e.forecast && parseFloat(e.actual!) > parseFloat(e.forecast);
                    const miss = hasActual && e.forecast && parseFloat(e.actual!) < parseFloat(e.forecast);
                    const eDate = new Date(e.date);
                    const isToday = eDate.toISOString().split("T")[0] === todayStr;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)", background: isToday ? "rgba(99,102,241,0.03)" : "transparent" }}>
                        <td style={{ padding: "8px 8px 8px 16px" }}><ImpactDot impact={e.impact} /></td>
                        <td style={{ padding: "8px 12px" }}><span className="font-mono" style={{ fontWeight: 600, color: "var(--text-1)" }}>{e.country}</span></td>
                        <td style={{ padding: "8px 12px", color: "var(--text-2)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 500,
                            background: e.impact === "High" ? "var(--red-dim)" : e.impact === "Medium" ? "var(--amber-dim)" : "var(--bg-elevated)",
                            color: e.impact === "High" ? "var(--red)" : e.impact === "Medium" ? "var(--amber)" : "var(--text-3)" }}>
                            {e.impact}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {hasActual
                            ? <span className="font-mono" style={{ fontWeight: 600, color: beat ? "var(--green)" : miss ? "var(--red)" : "var(--text-1)" }}>{e.actual}</span>
                            : <span style={{ color: "var(--text-3)" }}>—</span>}
                        </td>
                        <td style={{ padding: "8px 12px" }}><span className="font-mono" style={{ color: "var(--text-2)" }}>{e.forecast ?? "—"}</span></td>
                        <td style={{ padding: "8px 12px" }}><span className="font-mono" style={{ color: "var(--text-3)" }}>{e.previous ?? "—"}</span></td>
                        <td style={{ padding: "8px 12px", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                          {eDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          {" "}{eDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Central bank rates ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 14px" }}>
            <SectionHeader
              title="Central Bank Interest Rates"
              fetchedAt={data?.rates.fetchedAt ?? null}
              age={data?.rates.ageMinutes ?? null}
              count={(data?.rates.rates as CentralBankRate[] || []).length}
              extra="USD live via Alpha Vantage · others static config"
            />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Currency", "Country", "Bank", "Current Rate", "Previous", "Change", "Source", "Updated"].map(h => (
                    <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.rates.rates as CentralBankRate[] || [])
                  .sort((a, b) => b.currentRate - a.currentRate)
                  .map((r, i) => {
                    const changed = r.previousRate !== null && r.previousRate !== r.currentRate;
                    const hiked   = changed && r.currentRate > (r.previousRate ?? 0);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "9px 14px" }}><span className="font-mono" style={{ fontWeight: 700, fontSize: 12 }}>{r.currency}</span></td>
                        <td style={{ padding: "9px 14px", color: "var(--text-2)" }}>{r.country}</td>
                        <td style={{ padding: "9px 14px", color: "var(--text-3)" }}>{r.bankName}</td>
                        <td style={{ padding: "9px 14px" }}><span className="font-mono" style={{ fontSize: 13, fontWeight: 600 }}>{r.currentRate.toFixed(2)}%</span></td>
                        <td style={{ padding: "9px 14px" }}><span className="font-mono" style={{ color: "var(--text-3)" }}>{r.previousRate?.toFixed(2) ?? "—"}%</span></td>
                        <td style={{ padding: "9px 14px" }}>
                          {changed
                            ? <span style={{ fontSize: 11, fontWeight: 500, color: hiked ? "var(--green)" : "var(--red)" }}>{hiked ? "▲ Hiked" : "▼ Cut"}</span>
                            : <span style={{ color: "var(--text-3)" }}>—</span>}
                        </td>
                        <td style={{ padding: "9px 14px" }}>
                          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20,
                            background: r.source === "live" ? "var(--green-dim)" : "var(--bg-elevated)",
                            color: r.source === "live" ? "var(--green)" : "var(--text-3)",
                            border: `1px solid ${r.source === "live" ? "var(--green-border)" : "var(--border)"}` }}>
                            {r.source}
                          </span>
                        </td>
                        <td style={{ padding: "9px 14px", color: "var(--text-3)", fontSize: 10 }}>{r.lastUpdated}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
