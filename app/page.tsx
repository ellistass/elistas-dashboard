"use client";
// app/page.tsx — Elistas Dashboard (dark redesign)

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CurrencyScore {
  cur: string; score: number; tag: string;
  fundamental: number; pricePerf: number; stdDev: number; notes?: string[];
}
interface PairSetup {
  pair: string; direction: string; strong: string; weak: string;
  divergence: number; grade: string; session: string[];
  reason: string; strongScore: number; weakScore: number;
}
interface ScoringResult {
  top3: CurrencyScore[]; bottom3: CurrencyScore[];
  pairs9: PairSetup[]; priority1: PairSetup;
  allScores: CurrencyScore[]; divergenceWarnings?: string[];
  generatedAt?: string; scoredBy?: string;
  scoringModel?: string | null; dataAge?: number | null;
  // Context fields from Claude's reasoning
  reasoning?: string | null;
  neutralCurrencies?: string[];
  excludedCurrencies?: string[];
  excludedReasons?: string[];
  marketCondition?: string | null;
  sessionRecommendation?: string | null;
}
interface OpenTrade {
  id: string; pair: string; direction: string; model: string;
  grade: string; session: string; entryPrice: number;
  slPrice: number; tpPrice: number; strongCcy: string;
  weakCcy: string; divScore?: number;
  alignmentStatus: "Green" | "Amber" | "Red" | "Unknown";
  alignmentReason: string; date: string;
}
interface DashboardData {
  scores: ScoringResult | null; openTrades: OpenTrade[];
  fetchedAt: string; fetchErrors: string[];
  hasLiveData: boolean; scoredAt?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function watTime(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit",
  });
}

function watHour(): number {
  return parseInt(new Date().toLocaleTimeString("en-GB", {
    timeZone: "Africa/Lagos", hour: "2-digit", hour12: false,
  }));
}

function currentSession(): string | null {
  const h = watHour();
  if (h >= 1 && h < 7) return "Tokyo";
  if (h >= 8 && h < 13) return "London";
  if (h >= 13 && h < 15) return "Pre-NY";
  if (h >= 15 && h < 22) return "New York";
  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AlignBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; dot: string }> = {
    Green:   { bg: "var(--green-dim)",  color: "var(--green)",  dot: "var(--green)"  },
    Amber:   { bg: "var(--amber-dim)",  color: "var(--amber)",  dot: "var(--amber)"  },
    Red:     { bg: "var(--red-dim)",    color: "var(--red)",    dot: "var(--red)"    },
    Unknown: { bg: "var(--bg-elevated)",color: "var(--text-3)", dot: "var(--text-3)" },
  };
  const s = styles[status] || styles.Unknown;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 500, padding: "3px 9px",
      borderRadius: 20, background: s.bg, color: s.color,
      border: `1px solid ${s.color}30`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

function GradePill({ grade }: { grade: string }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
      grade === "A+" ? "badge-aplus" : grade === "B" ? "badge-b" : grade === "Skip" ? "badge-skip" : "badge-c"
    }`} style={{ fontSize: 10, letterSpacing: "0.05em" }}>
      {grade}
    </span>
  );
}

function ScoreNum({ score }: { score: number }) {
  const color = score > 0 ? "var(--green)" : score < 0 ? "var(--red)" : "var(--text-3)";
  return (
    <span className="font-mono" style={{ fontSize: 12, fontWeight: 500, color }}>
      {score > 0 ? "+" : ""}{score.toFixed(1)}
    </span>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 14, height: 14,
      border: "2px solid rgba(255,255,255,0.2)",
      borderTopColor: "white", borderRadius: "50%",
      animation: "spin 0.75s linear infinite",
    }} />
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

interface AccountAggregate {
  totalAccounts: number; activeAccounts: number;
  byStatus: Record<string, number>;
  totalEquity: number; totalPnL: number; dangerAccounts: number;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [scoreStatus, setScoreStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [clock, setClock] = useState(watTime());
  const [calendar, setCalendar] = useState("");
  const [perf, setPerf] = useState("");
  const [stddev, setStddev] = useState("");
  const [futures, setFutures] = useState("");
  const [accounts, setAccounts] = useState<AccountAggregate | null>(null);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(watTime()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, accRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/accounts"),
      ]);
      if (dashRes.ok) setData(await dashRes.json());
      if (accRes.ok) {
        const j = await accRes.json();
        setAccounts(j.aggregate ?? null);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDashboard();
    const t = setInterval(fetchDashboard, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchDashboard]);

  async function runAnalysis(sendAlert = false) {
    setScoring(true); setScoreStatus(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto", sendAlert }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScoreStatus({ ok: false, msg: json.error || "Scoring failed" });
      } else {
        setData(prev => prev
          ? { ...prev, scores: json, hasLiveData: true, fetchErrors: json.fetchErrors || [], scoredAt: new Date().toISOString() }
          : { scores: json, openTrades: [], fetchedAt: new Date().toISOString(), fetchErrors: json.fetchErrors || [], hasLiveData: true, scoredAt: new Date().toISOString() }
        );
        const top = json.top3?.map((c: any) => c.cur).join(" · ") || "—";
        const bot = json.bottom3?.map((c: any) => c.cur).join(" · ") || "—";
        setScoreStatus({ ok: true, msg: `Scored · Strong: ${top} · Weak: ${bot}${sendAlert ? " · Sent to Telegram" : ""}` });
        if (sendAlert) setSent(true);
      }
    } catch (e: any) {
      setScoreStatus({ ok: false, msg: e.message || "Network error" });
    }
    setScoring(false);
  }

  async function runManual(sendAlert = false) {
    if (!perf.trim() && !calendar.trim()) return;
    setScoring(true); setScoreStatus(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "manual", calendar, perf, stddev, futures, sendAlert }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScoreStatus({ ok: false, msg: json.error || "Manual scoring failed" });
      } else {
        setData(prev => prev
          ? { ...prev, scores: json, hasLiveData: false, scoredAt: new Date().toISOString() }
          : { scores: json, openTrades: [], fetchedAt: new Date().toISOString(), fetchErrors: [], hasLiveData: false, scoredAt: new Date().toISOString() }
        );
        setScoreStatus({ ok: true, msg: "Scored from manual data" });
        if (sendAlert) setSent(true);
      }
    } catch (e: any) {
      setScoreStatus({ ok: false, msg: e.message || "Error" });
    }
    setScoring(false);
  }

  const scores = data?.scores;
  const openTrades = data?.openTrades || [];
  const warnings = (scores as any)?.divergenceWarnings || [];
  const session = currentSession();

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Page header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Dashboard</h1>
            {session && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 500, padding: "3px 10px",
                borderRadius: 20, background: "var(--green-dim)",
                color: "var(--green)", border: "1px solid var(--green-border)",
              }}>
                <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", flexShrink: 0 }} />
                {session} open
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            {clock} WAT
            {data?.scoredAt ? ` · Last scored ${timeAgo(data.scoredAt)}` : " · No scores yet"}
            {data?.scores?.scoringModel && (
              <span style={{ color: "var(--text-3)", marginLeft: 4 }}>
                · <span className="font-mono" style={{ color: "var(--blue)", fontSize: 11 }}>{data.scores.scoringModel}</span>
              </span>
            )}
            {data?.scores?.dataAge != null && (
              <span style={{ color: "var(--text-3)", marginLeft: 4, fontSize: 11 }}>· data {data.scores.dataAge}m old</span>
            )}
            {data?.hasLiveData && <span style={{ color: "var(--green)", marginLeft: 4 }}>· live data</span>}
          </p>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => runAnalysis(false)} disabled={scoring}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 18px", borderRadius: 10, border: "none",
              background: "var(--green)", color: "#000",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              opacity: scoring ? 0.6 : 1, transition: "opacity 0.15s",
            }}>
            {scoring ? <Spinner /> : "⚡"}
            {scoring ? "Analysing…" : "Run Analysis"}
          </button>
          <button
            onClick={() => runAnalysis(true)} disabled={scoring || sent}
            style={{
              padding: "8px 16px", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--bg-card-2)",
              color: sent ? "var(--green)" : "var(--text-1)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              opacity: scoring || sent ? 0.6 : 1,
            }}>
            {sent ? "✓ Sent" : "📱 Run + Send"}
          </button>
          <button
            onClick={fetchDashboard} disabled={loading}
            title="Refresh"
            style={{
              width: 36, height: 36, borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--bg-card-2)",
              color: "var(--text-2)", fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            {loading ? <Spinner /> : "↻"}
          </button>
        </div>
      </div>

      {/* ── Status banner ── */}
      {scoreStatus && (
        <div style={{
          marginBottom: 16, padding: "10px 16px", borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: scoreStatus.ok ? "var(--green-dim)" : "var(--red-dim)",
          border: `1px solid ${scoreStatus.ok ? "var(--green-border)" : "var(--red-border)"}`,
          color: scoreStatus.ok ? "var(--green)" : "var(--red)",
        }}>
          <span className="font-mono" style={{ fontSize: 11 }}>
            {scoreStatus.ok ? "✓ " : "✗ "}{scoreStatus.msg}
          </span>
          <button onClick={() => setScoreStatus(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.5, fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ── Market condition banner (thin / holiday-heavy) ── */}
      {scores?.marketCondition && scores.marketCondition !== "Normal" && (
        <div style={{
          marginBottom: 16, padding: "12px 16px", borderRadius: 10,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
          color: "var(--red)",
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 4px" }}>
            ⚠ MARKET CONDITION — {scores.marketCondition.toUpperCase()}
          </p>
          {scores.sessionRecommendation && (
            <p style={{ fontSize: 11, margin: 0, opacity: 0.85, lineHeight: 1.5 }}>
              {scores.sessionRecommendation}
            </p>
          )}
        </div>
      )}

      {/* ── Session recommendation (normal days) ── */}
      {scores?.sessionRecommendation && (!scores.marketCondition || scores.marketCondition === "Normal") && (
        <div style={{
          marginBottom: 16, padding: "10px 16px", borderRadius: 10,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>💡</span>
          <p style={{ fontSize: 11, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
            {scores.sessionRecommendation}
          </p>
        </div>
      )}

      {/* ── Divergence warnings ── */}
      {warnings.length > 0 && (
        <div style={{
          marginBottom: 16, padding: "12px 16px", borderRadius: 10,
          background: "var(--amber-dim)", border: "1px solid var(--amber-border)",
          color: "var(--amber)",
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>⚠ DIVERGENCE WARNINGS</p>
          {warnings.map((w: string, i: number) => (
            <p key={i} style={{ fontSize: 11, margin: "2px 0", opacity: 0.85 }}>→ {w}</p>
          ))}
        </div>
      )}

      {/* ── Fetch errors ── */}
      {(data?.fetchErrors?.length ?? 0) > 0 && !data?.hasLiveData && (
        <div style={{
          marginBottom: 16, padding: "10px 16px", borderRadius: 10,
          background: "var(--amber-dim)", border: "1px solid var(--amber-border)",
          color: "var(--amber)", fontSize: 11,
        }}>
          <strong>Fetch warning:</strong> {(data?.fetchErrors ?? []).join(" · ")}
          <button onClick={() => setShowManual(true)}
            style={{ marginLeft: 8, textDecoration: "underline", background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 11 }}>
            Enter data manually →
          </button>
        </div>
      )}

      {/* ── Quick stats strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Open Trades",   value: openTrades.length.toString(), sub: openTrades.filter(t => t.alignmentStatus === "Red").length > 0 ? `${openTrades.filter(t => t.alignmentStatus === "Red").length} red` : "all aligned", danger: openTrades.filter(t => t.alignmentStatus === "Red").length > 0 },
          { label: "Top Currency",  value: scores?.top3?.[0]?.cur ?? "—", sub: scores?.top3?.[0] ? `+${scores.top3[0].score.toFixed(1)} score` : "run analysis", danger: false },
          { label: "Weak Currency", value: scores?.bottom3?.[0]?.cur ?? "—", sub: scores?.bottom3?.[0] ? `${scores.bottom3[0].score.toFixed(1)} score` : "run analysis", danger: false },
          { label: "Priority Setup",value: scores?.priority1?.pair ?? "—", sub: scores?.priority1 ? `${scores.priority1.grade} · div ${scores.priority1.divergence.toFixed(1)}` : "run analysis", danger: false },
        ].map(({ label, value, sub, danger }) => (
          <div key={label} style={{
            background: "var(--bg-card)", border: `1px solid ${danger ? "var(--red-border)" : "var(--border)"}`,
            borderRadius: 12, padding: "14px 18px",
          }}>
            <p style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 6px" }}>{label}</p>
            <p className="font-mono" style={{ fontSize: 20, fontWeight: 600, margin: "0 0 2px", color: danger ? "var(--red)" : "var(--text-1)" }}>{value}</p>
            <p style={{ fontSize: 11, color: danger ? "var(--red)" : "var(--text-3)", margin: 0 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Accounts summary strip ── */}
      {accounts && accounts.totalAccounts > 0 && (
        <a href="/accounts" style={{ textDecoration: "none" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 0,
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 12, padding: "12px 18px", marginBottom: 16,
            cursor: "pointer", transition: "border-color 0.15s",
          }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}>
            <span style={{ fontSize: 11, color: "var(--text-3)", marginRight: 16, flexShrink: 0 }}>ACCOUNTS</span>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", flex: 1 }}>
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                <span className="font-mono" style={{ fontWeight: 600, color: "var(--text-1)" }}>{accounts.activeAccounts}</span>
                <span style={{ color: "var(--text-3)", marginLeft: 4 }}>active</span>
              </span>
              <span style={{ fontSize: 12 }}>
                <span className="font-mono" style={{ fontWeight: 600 }}>
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(accounts.totalEquity)}
                </span>
                <span style={{ color: "var(--text-3)", marginLeft: 4, fontSize: 11 }}>equity</span>
              </span>
              {(accounts.byStatus.Phase1 ?? 0) > 0 && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: "var(--blue-dim)", color: "var(--blue)", border: "1px solid var(--blue-border)" }}>Phase 1 · {accounts.byStatus.Phase1}</span>}
              {(accounts.byStatus.Phase2 ?? 0) > 0 && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.25)" }}>Phase 2 · {accounts.byStatus.Phase2}</span>}
              {((accounts.byStatus.Funded ?? 0) + (accounts.byStatus.Live ?? 0)) > 0 && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green-border)" }}>Funded · {(accounts.byStatus.Funded ?? 0) + (accounts.byStatus.Live ?? 0)}</span>}
              {(accounts.byStatus.Breached ?? 0) > 0 && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: "var(--red-dim)", color: "var(--red)", border: "1px solid var(--red-border)" }}>Breached · {accounts.byStatus.Breached}</span>}
              {accounts.dangerAccounts > 0 && <span style={{ fontSize: 11, color: "var(--amber)" }}>⚠ {accounts.dangerAccounts} drawdown danger</span>}
            </div>
            <span style={{ fontSize: 13, color: "var(--text-3)", marginLeft: 12, flexShrink: 0 }}>→</span>
          </div>
        </a>
      )}

      {/* ── Main grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>

        {/* ── LEFT column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Currency power ranking */}
          <div className="card" style={{ padding: "16px 18px" }}>
            <p className="section-label" style={{ marginTop: 0 }}>Currency Ranking</p>
            {!scores ? (
              <p style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", padding: "20px 0" }}>
                Run analysis to see rankings
              </p>
            ) : (
              <>
                {/* Strongest */}
                <p style={{ fontSize: 10, color: "var(--green)", fontWeight: 600, letterSpacing: "0.1em", marginBottom: 6 }}>STRONGEST</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
                  {scores.top3.map((c, i) => (
                    <div key={c.cur} className="card-strong" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="font-mono" style={{ fontSize: 10, color: "var(--green)", opacity: 0.5 }}>#{i + 1}</span>
                        <span className="font-mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--green)" }}>{c.cur}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <ScoreNum score={c.score} />
                        <p style={{ fontSize: 9, color: "var(--green)", opacity: 0.7, margin: "2px 0 0", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.tag}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Weakest */}
                <p style={{ fontSize: 10, color: "var(--red)", fontWeight: 600, letterSpacing: "0.1em", marginBottom: 6 }}>WEAKEST</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
                  {scores.bottom3.map((c, i) => (
                    <div key={c.cur} className="card-weak" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="font-mono" style={{ fontSize: 10, color: "var(--red)", opacity: 0.5 }}>#{i + 1}</span>
                        <span className="font-mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--red)" }}>{c.cur}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <ScoreNum score={c.score} />
                        <p style={{ fontSize: 9, color: "var(--red)", opacity: 0.7, margin: "2px 0 0", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.tag}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* All scores compact */}
                {scores.allScores?.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <p style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.1em", marginBottom: 8 }}>ALL CURRENCIES</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                      {scores.allScores.map(c => (
                        <div key={c.cur} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span className="font-mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{c.cur}</span>
                          <ScoreNum score={c.score} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Neutral currencies */}
                {(scores as any).neutralCurrencies?.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
                    <p style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.1em", marginBottom: 6 }}>NEUTRAL — BELOW THRESHOLD</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(scores as any).neutralCurrencies.map((cur: string) => (
                        <span key={cur} className="font-mono" style={{
                          fontSize: 10, padding: "2px 8px", borderRadius: 20,
                          background: "var(--bg-elevated)", color: "var(--text-3)",
                          border: "1px solid var(--border)",
                        }}>{cur}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Excluded currencies (holidays) */}
                {(scores as any).excludedCurrencies?.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
                    <p style={{ fontSize: 10, color: "var(--amber)", letterSpacing: "0.1em", marginBottom: 6 }}>EXCLUDED — HOLIDAY / THIN DATA</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {(scores as any).excludedCurrencies.map((cur: string, i: number) => (
                        <div key={cur} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <span className="font-mono" style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 20, flexShrink: 0,
                            background: "var(--amber-dim)", color: "var(--amber)",
                            border: "1px solid var(--amber-border)",
                          }}>{cur}</span>
                          {(scores as any).excludedReasons?.[i] && (
                            <span style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.4, paddingTop: 2 }}>
                              {(scores as any).excludedReasons[i].replace(`${cur}: `, "")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Session windows */}
          <div className="card" style={{ padding: "16px 18px" }}>
            <p className="section-label" style={{ marginTop: 0 }}>Sessions — WAT</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { name: "Tokyo",    time: "1am – 7am",  prime: false },
                { name: "London",   time: "8am – 1pm",  prime: true  },
                { name: "Pre-NY",   time: "1pm – 3pm",  prime: false },
                { name: "New York", time: "3pm – 10pm", prime: true  },
              ].map(s => {
                const active = s.name === session;
                return (
                  <div key={s.name} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "9px 12px", borderRadius: 9,
                    background: active ? "var(--green-dim)" : "var(--bg-card-2)",
                    border: `1px solid ${active ? "var(--green-border)" : "var(--border-subtle)"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {active && <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", flexShrink: 0 }} />}
                      <span style={{ fontSize: 12, fontWeight: 500, color: active ? "var(--green)" : "var(--text-2)" }}>{s.name}</span>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{s.time}</span>
                    </div>
                    {s.prime && (
                      <span style={{
                        fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
                        padding: "2px 7px", borderRadius: 20,
                        background: active ? "var(--green-dim)" : "var(--bg-elevated)",
                        color: active ? "var(--green)" : "var(--text-3)",
                        border: `1px solid ${active ? "var(--green-border)" : "var(--border)"}`,
                      }}>PRIME</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── RIGHT column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {!scores ? (
            /* Empty state */
            <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, textAlign: "center" }}>
              {scoring ? (
                <>
                  <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.75s linear infinite", marginBottom: 16 }} />
                  <p style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>Claude is analysing the markets…</p>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Fetching data · Scoring currencies · Building matrix</p>
                </>
              ) : (
                <>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 16 }}>⚡</div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-1)" }}>No analysis yet</p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4, marginBottom: 20 }}>Tap Run Analysis to score today's market with Claude AI</p>
                  <button onClick={() => runAnalysis(false)}
                    style={{ padding: "10px 22px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    ⚡ Run Analysis
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Priority setup — featured card */}
              {scores.priority1 && (
                <div style={{
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: 14, padding: "22px 24px",
                  backgroundImage: "radial-gradient(ellipse at top right, rgba(0,212,138,0.04) 0%, transparent 60%)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Priority Setup</p>
                      <p className="font-mono" style={{ fontSize: 28, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.02em" }}>{scores.priority1.pair}</p>
                      <p style={{ fontSize: 12, color: "var(--text-2)", margin: "0 0 10px" }}>
                        {scores.priority1.direction} ·{" "}
                        <span style={{ color: "var(--green)" }}>{scores.priority1.strong}</span> vs{" "}
                        <span style={{ color: "var(--red)" }}>{scores.priority1.weak}</span>
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <GradePill grade={scores.priority1.grade} />
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{scores.priority1.session?.join(" · ")}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p className="font-mono" style={{ fontSize: 36, fontWeight: 600, color: "var(--green)", lineHeight: 1, margin: 0 }}>
                        {scores.priority1.divergence.toFixed(1)}
                      </p>
                      <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4, letterSpacing: "0.1em" }}>DIVERGENCE</p>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-3)", margin: "16px 0 14px", lineHeight: 1.6, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                    {scores.priority1.reason}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {["Wait for H1 close", "Declare A or B", "Min 1:2 R:R", "No entry 30m after open"].map(r => (
                      <span key={r} style={{
                        fontSize: 10, padding: "3px 10px", borderRadius: 20,
                        background: "var(--bg-elevated)", color: "var(--text-3)",
                        border: "1px solid var(--border)",
                      }}>{r}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 9-pair matrix */}
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px 0" }}>
                  <p className="section-label" style={{ marginTop: 0 }}>9-Pair Matrix — Strong × Weak</p>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "10px 18px", textAlign: "left", fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.1em" }}>
                          ↓ STR / WK →
                        </th>
                        {scores.bottom3.map(w => (
                          <th key={w.cur} style={{ padding: "10px 16px", textAlign: "center" }}>
                            <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--red)" }}>{w.cur}</span>
                            <br />
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{w.score.toFixed(1)}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scores.top3.map(s => (
                        <tr key={s.cur} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "12px 18px" }}>
                            <span className="font-mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--green)" }}>{s.cur}</span>
                            <br />
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{s.score.toFixed(1)}</span>
                          </td>
                          {scores.bottom3.map(w => {
                            const p = scores.pairs9.find(x => x.strong === s.cur && x.weak === w.cur);
                            if (!p) return <td key={w.cur} style={{ padding: "12px 16px", textAlign: "center", color: "var(--text-3)" }}>—</td>;
                            const isBest = p.pair === scores.priority1?.pair;
                            return (
                              <td key={w.cur} style={{
                                padding: "10px 16px", textAlign: "center",
                                background: isBest ? "rgba(0,212,138,0.04)" : "transparent",
                              }}>
                                <p className="font-mono" style={{ fontSize: 11, fontWeight: 600, margin: "0 0 4px", color: isBest ? "var(--green)" : "var(--text-1)" }}>
                                  {p.pair}
                                </p>
                                <GradePill grade={p.grade} />
                                <p style={{ fontSize: 10, color: "var(--text-3)", margin: "4px 0 0" }}>
                                  {p.direction} · {p.divergence.toFixed(1)}
                                </p>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Open trades */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <p className="section-label" style={{ margin: 0 }}>Open Trades</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="font-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{openTrades.length} active</span>
                <a href="/journal" style={{ fontSize: 11, color: "var(--blue)", textDecoration: "none" }}>+ Add trade →</a>
              </div>
            </div>

            {openTrades.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 8px" }}>No open trades</p>
                <a href="/journal" style={{ fontSize: 11, color: "var(--blue)", textDecoration: "none" }}>Log a trade →</a>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                {openTrades.map(trade => (
                  <div key={trade.id} className="card" style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                      <div>
                        <p className="font-mono" style={{ fontSize: 15, fontWeight: 600, margin: "0 0 2px" }}>{trade.pair}</p>
                        <p style={{ fontSize: 11, margin: 0, color: trade.direction === "Short" ? "var(--red)" : "var(--green)", fontWeight: 500 }}>
                          {trade.direction} · Model {trade.model} · {trade.session}
                        </p>
                      </div>
                      <AlignBadge status={trade.alignmentStatus} />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                      {[
                        { label: "Entry", value: trade.entryPrice, color: "var(--text-1)" },
                        { label: "SL",    value: trade.slPrice,    color: "var(--red)"    },
                        { label: "TP",    value: trade.tpPrice,    color: "var(--green)"  },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ background: "var(--bg-card-2)", borderRadius: 7, padding: "7px 10px" }}>
                          <p style={{ fontSize: 9, color: "var(--text-3)", margin: "0 0 2px", letterSpacing: "0.08em" }}>{label}</p>
                          <p className="font-mono" style={{ fontSize: 12, fontWeight: 500, margin: 0, color }}>{value}</p>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
                      <span className="font-mono" style={{ fontSize: 11, color: "var(--green)" }}>{trade.strongCcy}</span>
                      <span style={{ fontSize: 10, color: "var(--text-3)" }}>vs</span>
                      <span className="font-mono" style={{ fontSize: 11, color: "var(--red)" }}>{trade.weakCcy}</span>
                      {trade.divScore && (
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-3)" }}>div {trade.divScore.toFixed(1)}</span>
                      )}
                    </div>

                    {(trade.alignmentStatus === "Amber" || trade.alignmentStatus === "Red") && (
                      <p style={{
                        fontSize: 10, marginTop: 8, padding: "6px 8px", borderRadius: 6,
                        background: trade.alignmentStatus === "Red" ? "var(--red-dim)" : "var(--amber-dim)",
                        color: trade.alignmentStatus === "Red" ? "var(--red)" : "var(--amber)",
                        border: `1px solid ${trade.alignmentStatus === "Red" ? "var(--red-border)" : "var(--amber-border)"}`,
                      }}>
                        {trade.alignmentReason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Manual override ── */}
      <div style={{ marginTop: 32, borderTop: "1px solid var(--border)", paddingTop: 20 }}>
        <button onClick={() => setShowManual(!showManual)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-3)", fontSize: 12, cursor: "pointer", transition: "color 0.15s" }}>
          <span style={{ fontSize: 10, transform: showManual ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
          Manual data entry
        </button>

        {showManual && (
          <div className="card" style={{ marginTop: 12 }}>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 14 }}>
              Paste data from Barchart / ForexFactory. Claude will analyse it directly.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              {[
                { label: "Economic Calendar", value: calendar, setter: setCalendar, placeholder: "AUD Flash Manufacturing PMI 51.0 49.8\nNZD Credit Card Spending 1.1% 2.1%" },
                { label: "Forex Performance", value: perf, setter: setPerf, placeholder: "NZD/USD -0.41%\nGBP/USD +0.04%" },
                { label: "Std Dev / Surprises", value: stddev, setter: setStddev, placeholder: "NZD/USD -1.09\nGBP/USD -0.18" },
                { label: "Futures (optional)", value: futures, setter: setFutures, placeholder: "NZD Jun -0.42%\nGBP Jun +0.11%" },
              ].map(({ label, value, setter, placeholder }) => (
                <div key={label}>
                  <label style={{ fontSize: 10, color: "var(--text-3)", display: "block", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>
                  <textarea
                    style={{ width: "100%", minHeight: 80, padding: "10px 12px" }}
                    placeholder={placeholder}
                    value={value}
                    onChange={e => setter(e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => runManual(false)} disabled={scoring || (!perf.trim() && !calendar.trim())}
                style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: scoring ? 0.6 : 1 }}>
                {scoring ? "Analysing…" : "⚡ Run Manual Analysis"}
              </button>
              <button onClick={() => runManual(true)} disabled={scoring || sent}
                style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: sent ? "var(--green)" : "var(--text-1)", fontSize: 12, cursor: "pointer", opacity: scoring || sent ? 0.6 : 1 }}>
                {sent ? "✓ Sent" : "Run + Send to Telegram"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
