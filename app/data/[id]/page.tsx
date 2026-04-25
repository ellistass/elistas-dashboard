"use client";
// app/data/[id]/page.tsx — Full detail view for one BarchartSnapshot

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

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
interface SnapshotDetail {
  barchart: {
    id: string; fetchedAt: string; ageMinutes: number | null; errors: string[];
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
  if (age === null) return <span style={{ fontSize: 10, color: "var(--text-3)", padding: "2px 8px", borderRadius: 20, background: "var(--bg-elevated)" }}>unknown</span>;
  const old = age > 1440; // >24h
  const color = old ? "var(--text-3)" : age < 60 ? "var(--green)" : age < 120 ? "var(--amber)" : "var(--red)";
  const bg    = old ? "var(--bg-elevated)" : age < 60 ? "var(--green-dim)" : age < 120 ? "var(--amber-dim)" : "var(--red-dim)";
  const bdr   = old ? "var(--border)" : age < 60 ? "var(--green-border)" : age < 120 ? "var(--amber-border)" : "var(--red-border)";
  const label = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.floor(age / 60)}h ago` : `${Math.floor(age / 1440)}d ago`;
  return <span style={{ fontSize: 10, color, padding: "2px 8px", borderRadius: 20, background: bg, border: `1px solid ${bdr}` }}>{label}</span>;
}

function ImpactDot({ impact }: { impact: string }) {
  const color = impact === "High" ? "var(--red)" : impact === "Medium" ? "var(--amber)" : "var(--text-3)";
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />;
}

function BarchartTable({ rows, colorDir }: { rows: BarchartRow[]; colorDir: "bullish" | "bearish" }) {
  const color = colorDir === "bullish" ? "var(--green)" : "var(--red)";
  if (!rows?.length) return <p style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", padding: 24 }}>No data</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Symbol", "Name", "Change %", "Std Dev", "Time"].map(h => (
              <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em" }}>{h}</th>
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

type BcTab = "forex-perf" | "forex-surp" | "fut-perf" | "fut-surp";

export default function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [barchartTab, setBarchartTab] = useState<BcTab>("forex-perf");
  const [calFilter, setCalFilter] = useState<"all" | "today" | "High">("all");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/market-data/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject("Not found"))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [id]);

  const snapDate = data?.barchart.fetchedAt
    ? new Date(data.barchart.fetchedAt).toLocaleString("en-GB", {
        timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }) + " WAT"
    : "—";

  const todayStr = new Date().toISOString().split("T")[0];
  const filteredEvents = (data?.economic.events as CalendarEvent[] ?? []).filter(e => {
    const eDate = new Date(e.date).toISOString().split("T")[0];
    if (calFilter === "today") return eDate === todayStr;
    if (calFilter === "High") return e.impact === "High";
    return true;
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const bc = data?.barchart;
  const tabs: Record<BcTab, { label: string; bullish: BarchartRow[]; bearish: BarchartRow[] }> = {
    "forex-perf": { label: "Forex Perf",    bullish: bc?.data?.forex.performance.today.bullish  ?? [], bearish: bc?.data?.forex.performance.today.bearish  ?? [] },
    "forex-surp": { label: "Forex Surp",    bullish: bc?.data?.forex.surprises.bullish           ?? [], bearish: bc?.data?.forex.surprises.bearish           ?? [] },
    "fut-perf":   { label: "Futures Perf",  bullish: bc?.data?.futures.performance.today.bullish ?? [], bearish: bc?.data?.futures.performance.today.bearish ?? [] },
    "fut-surp":   { label: "Futures Surp",  bullish: bc?.data?.futures.surprises.bullish         ?? [], bearish: bc?.data?.futures.surprises.bearish         ?? [] },
  };
  const activeTab = tabs[barchartTab];

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
        <div style={{ width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.75s linear infinite", margin: "0 auto 12px" }} />
        <p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading snapshot…</p>
      </div>
    </div>
  );

  if (error) return (
    <div>
      <button onClick={() => router.push("/data")} style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}>← Back to list</button>
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <p style={{ color: "var(--red)", fontSize: 13 }}>Snapshot not found or failed to load.</p>
      </div>
    </div>
  );

  return (
    <div>
      {/* Back + Header */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => router.push("/data")}
          style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}>
          ← Back to snapshots
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Snapshot Detail</h1>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>{snapDate}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <AgeBadge age={data?.barchart.ageMinutes ?? null} />
            {(bc?.errors?.length ?? 0) > 0 && (
              <span style={{ fontSize: 11, color: "var(--amber)" }}>⚠ {bc!.errors.length} error{bc!.errors.length > 1 ? "s" : ""}</span>
            )}
            <span className="font-mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{id.slice(0, 8)}…</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Barchart ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 0" }}>
            <p className="section-label" style={{ marginTop: 0, marginBottom: 8 }}>Barchart — Forex & Futures</p>
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
              {(Object.entries(tabs) as [BcTab, any][]).map(([key, val]) =>
                tabBtn(key, val.label, barchartTab, setBarchartTab)
              )}
            </div>
          </div>
          {!bc?.data ? (
            <p style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>No Barchart data in this snapshot</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <div style={{ borderRight: "1px solid var(--border)" }}>
                <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
                  <span style={{ fontSize: 10, color: "var(--green)", fontWeight: 600, letterSpacing: "0.1em" }}>BULLISH ({activeTab.bullish.length})</span>
                </div>
                <BarchartTable rows={activeTab.bullish} colorDir="bullish" />
              </div>
              <div>
                <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--red)", display: "inline-block" }} />
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p className="section-label" style={{ margin: 0 }}>Economic Calendar</p>
              <AgeBadge age={data?.economic.ageMinutes ?? null} />
            </div>
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
              {[["today", "Today"], ["High", "High impact"], ["all", "Full week"]].map(([k, l]) =>
                tabBtn(k, l, calFilter, setCalFilter)
              )}
            </div>
          </div>
          {filteredEvents.length === 0 ? (
            <p style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>No events for this filter</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["", "CCY", "Event", "Impact", "Actual", "Forecast", "Previous", "Date"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((e, i) => {
                    const hasActual = e.actual !== null && e.actual !== "";
                    const beat = hasActual && e.forecast && parseFloat(e.actual!) > parseFloat(e.forecast);
                    const miss = hasActual && e.forecast && parseFloat(e.actual!) < parseFloat(e.forecast);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "8px 8px 8px 16px" }}><ImpactDot impact={e.impact} /></td>
                        <td style={{ padding: "8px 12px" }}><span className="font-mono" style={{ fontWeight: 600 }}>{e.country}</span></td>
                        <td style={{ padding: "8px 12px", color: "var(--text-2)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20,
                            background: e.impact === "High" ? "var(--red-dim)" : e.impact === "Medium" ? "var(--amber-dim)" : "var(--bg-elevated)",
                            color: e.impact === "High" ? "var(--red)" : e.impact === "Medium" ? "var(--amber)" : "var(--text-3)" }}>{e.impact}</span>
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {hasActual
                            ? <span className="font-mono" style={{ fontWeight: 600, color: beat ? "var(--green)" : miss ? "var(--red)" : "var(--text-1)" }}>{e.actual}</span>
                            : <span style={{ color: "var(--text-3)" }}>—</span>}
                        </td>
                        <td style={{ padding: "8px 12px" }}><span className="font-mono" style={{ color: "var(--text-2)" }}>{e.forecast ?? "—"}</span></td>
                        <td style={{ padding: "8px 12px" }}><span className="font-mono" style={{ color: "var(--text-3)" }}>{e.previous ?? "—"}</span></td>
                        <td style={{ padding: "8px 12px", color: "var(--text-3)", whiteSpace: "nowrap", fontSize: 10 }}>
                          {new Date(e.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          {" "}{new Date(e.date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
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
          <div style={{ padding: "16px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p className="section-label" style={{ margin: 0 }}>Central Bank Interest Rates</p>
            <AgeBadge age={data?.rates.ageMinutes ?? null} />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Currency", "Country", "Bank", "Rate", "Previous", "Change", "Source"].map(h => (
                    <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.08em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.rates.rates as CentralBankRate[] ?? [])
                  .sort((a, b) => b.currentRate - a.currentRate)
                  .map((r, i) => {
                    const changed = r.previousRate !== null && r.previousRate !== r.currentRate;
                    const hiked   = changed && r.currentRate > (r.previousRate ?? 0);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "9px 14px" }}><span className="font-mono" style={{ fontWeight: 700, fontSize: 12 }}>{r.currency}</span></td>
                        <td style={{ padding: "9px 14px", color: "var(--text-2)" }}>{r.country}</td>
                        <td style={{ padding: "9px 14px", color: "var(--text-3)", fontSize: 10 }}>{r.bankName}</td>
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
