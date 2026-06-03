"use client";
// app/page.tsx — Elistas Dashboard (dark redesign)

import { useState, useEffect, useCallback } from "react";
import {
  FreshnessStrip,
  DailyRBar,
  NextEventCountdown,
  MacroStrip,
  TradePlanBoard,
  AlertsLog,
  NewsCollisionBadge,
} from "./_components/DashboardWidgets";
import { PositionSizeCalc } from "./_components/PositionSizeCalc";
import { AccountTiles } from "./_components/AccountTiles";
import { MultiIdeaHero } from "./_components/MultiIdeaHero";
import { WatchedPanel } from "./_components/WatchedPanel";
import { SourceChip, RiskLine } from "./_components/TradeChips";
import { RoutineSetupCard } from "./_components/RoutineSetupCard";
import { DiagnosticsPanel } from "./_components/DiagnosticsPanel";

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
  newsCollisions?: Array<{ title: string; country: string; currency: string; date: string; impact: string }>;
  source?: string; accountId?: string | null; riskPercent?: number;
  lotSize?: number | null; profitCcy?: number | null;
}
interface SectorRow { sector: string; symbol?: string; percentChange: number }
interface CentralBankRateLite { currency: string; bankName: string; currentRate: number; previousRate: number | null; source?: string }
interface FreshnessTile { source: string; label: string; fetchedAt: string | null; ageMinutes: number | null; status: 'fresh' | 'stale' | 'missing' }
interface DailyRStatus { todayR: number; cutoffR: number; pctOfCutoff: number; state: 'safe' | 'caution' | 'stop'; closedToday: number }
interface CalEvent { title: string; country: string; currency: string; date: string; impact: string; forecast: string | null; previous: string | null; actual: string | null }
interface MacroTile { symbol: string; name: string; latest: number; percentChange: number }
interface RecentAlert { id: string; date: string; sentAt: string | null; pair: string | null; direction: string | null; grade: string | null }
interface DashboardData {
  scores: ScoringResult | null; openTrades: OpenTrade[];
  sectors?: SectorRow[];
  centralBankRates?: CentralBankRateLite[];
  freshness?: FreshnessTile[];
  dailyR?: DailyRStatus;
  nextEvent?: CalEvent | null;
  macros?: MacroTile[];
  todaysIdeas?: any[];
  recentAlerts?: RecentAlert[];
  barchartFetchedAt?: string | null;
  ratesFetchedAt?: string | null;
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

// Cyclical sectors leading vs defensives = the simplest risk-on/off read.
// Cyclicals: XLK, XLY, XLF, XLC, XLI    Defensives: XLP, XLV, XLU
function sectorRegime(sectors: { sector: string; symbol?: string; percentChange: number }[]): string {
  if (!sectors || sectors.length < 3) return "";
  const cyclicalSyms = new Set(["XLK", "XLY", "XLF", "XLC", "XLI"]);
  const defensiveSyms = new Set(["XLP", "XLV", "XLU"]);
  const cyclical = sectors.filter((s) => s.symbol && cyclicalSyms.has(s.symbol));
  const defensive = sectors.filter((s) => s.symbol && defensiveSyms.has(s.symbol));
  if (!cyclical.length || !defensive.length) return "";
  const cycAvg = cyclical.reduce((a, b) => a + b.percentChange, 0) / cyclical.length;
  const defAvg = defensive.reduce((a, b) => a + b.percentChange, 0) / defensive.length;
  const delta = cycAvg - defAvg;
  if (delta > 0.3) return "risk-on";
  if (delta < -0.3) return "risk-off";
  return "mixed";
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

// Safe number formatters — return "—" for undefined/null/NaN so a missing
// numeric field in a scoring payload doesn't crash the whole page render.
// LLM outputs can be patchy; render code stays defensive.
function fmt(n: unknown, digits = 1): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}
function fmtSigned(n: unknown, digits = 1): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return (n > 0 ? "+" : "") + n.toFixed(digits);
}

function ScoreNum({ score }: { score: number | null | undefined }) {
  const valid = typeof score === "number" && Number.isFinite(score);
  const color = !valid
    ? "var(--text-3)"
    : score! > 0 ? "var(--green)" : score! < 0 ? "var(--red)" : "var(--text-3)";
  return (
    <span className="font-mono" style={{ fontSize: 12, fontWeight: 500, color }}>
      {fmtSigned(score, 1)}
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

  // Engine the user has picked (defaults to Sonnet via API)
  const [engine, setEngine] = useState<'sonnet' | 'haiku' | 'rules' | 'routine'>('sonnet')
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('elistas:scoring-engine') : null
    if (stored === 'sonnet' || stored === 'haiku' || stored === 'rules' || stored === 'routine') setEngine(stored as any)
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('elistas:scoring-engine', engine)
  }, [engine])

  async function runAnalysis(sendAlert = false) {
    // If user picked "routine", just nudge them to use Claude Desktop instead
    if (engine === 'routine') {
      setScoreStatus({ ok: true, msg: "Routine mode: open Claude Desktop → trading project → paste your trigger prompt (see Routine card above)." });
      return;
    }
    setScoring(true); setScoreStatus(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto", sendAlert, engine }),
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
  const sectors = data?.sectors ?? [];
  const centralBankRates = data?.centralBankRates ?? [];
  const freshness = data?.freshness;
  const dailyR = data?.dailyR;
  const nextEvent = data?.nextEvent;
  const macros = data?.macros;
  const todaysIdeas = data?.todaysIdeas ?? [];
  const recentAlerts = data?.recentAlerts;
  const ideaActions = (data as any)?.ideaActions ?? {};

  // Compute which ideas have already been taken so the trade plan board can
  // mark them — match on pair + direction against open trades.
  const takenPairs = new Set<string>(
    openTrades.map((t) => `${t.pair}|${t.direction}`),
  );

  async function handleTakeIdea(idea: any) {
    try {
      await fetch('/api/ideas/take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(idea),
      });
      await fetchDashboard();
    } catch (e) {
      console.error('Failed to take idea:', e);
    }
  }

  // Full per-account list — powers both the AccountTiles row and the calc.
  // Refreshed alongside the dashboard data (every 3 min) so equity/today's R stay live.
  const [accountList, setAccountList] = useState<any[]>([]);
  useEffect(() => {
    const loadAccounts = () => {
      fetch('/api/accounts').then((r) => r.json()).then((d) => {
        setAccountList(d.accounts ?? []);
      }).catch(() => {});
    };
    loadAccounts();
    const t = setInterval(loadAccounts, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const calcAccounts = accountList
    .filter((a) => a.isActive)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency, currentBalance: a.currentBalance }));
  // Defensive normalize — Claude has historically returned strings, {currency,type,warning},
  // and pair-level {note,pair,type,stddev} objects. Coerce all variants to a display string
  // so a schema drift never crashes the dashboard with React #31.
  const warnings: string[] = ((scores as any)?.divergenceWarnings || [])
    .map((w: any): string => {
      if (typeof w === "string") return w;
      if (w && typeof w === "object") {
        const text = w.warning ?? w.note ?? w.message ?? w.text;
        if (typeof text === "string" && text.trim()) {
          const tag = w.pair || w.currency;
          return tag ? `${tag}: ${text}` : text;
        }
        try { return JSON.stringify(w); } catch { return String(w); }
      }
      return String(w);
    })
    .filter((s: string) => s && s.trim().length > 0);
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

        {/* Action buttons + engine picker */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
          {/* Engine picker — choose which scoring engine to use */}
          <select value={engine} onChange={(e) => setEngine(e.target.value as any)}
                  title="Choose the scoring engine"
                  style={{
                    padding: "8px 10px", borderRadius: 10, fontSize: 12,
                    background: "var(--bg-card-2)", border: "1px solid var(--border)",
                    color: "var(--text-2)", cursor: "pointer",
                  }}>
            <option value="sonnet">⚡ Sonnet (API)</option>
            <option value="haiku">💨 Haiku (cheap API)</option>
            <option value="rules">📐 Rules-only (no API)</option>
            <option value="routine">🔁 Routine (Desktop)</option>
          </select>
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
          {warnings.map((w, i) => (
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

      {/* ── Routine setup (collapsible — only expanded on first run / when configuring) ── */}
      <RoutineSetupCard />

      {/* ── Data flow diagnostics — collapsible, helps debug "why isn't X showing" ── */}
      <DiagnosticsPanel
        sectors={sectors}
        rates={centralBankRates}
        freshness={freshness}
        todaysIdeas={todaysIdeas}
        macros={macros as any}
        nextEvent={nextEvent}
        barchartFetchedAt={(data as any)?.barchartFetchedAt}
        ratesFetchedAt={(data as any)?.ratesFetchedAt}
        scoredAt={data?.scoredAt}
        scoringModel={data?.scores?.scoringModel}
      />

      {/* ── Per-account tiles — the morning "where am I right now" snapshot ── */}
      <AccountTiles accounts={accountList as any} />

      {/* ── Today's calls (multi-idea hero) — Claude's ideas + your discretionary logs ── */}
      <MultiIdeaHero
        ideas={todaysIdeas as any}
        ideaActions={ideaActions}
        accounts={calcAccounts.map((a: any) => ({ ...a, status: accountList.find((x: any) => x.id === a.id)?.status ?? '' })) as any}
        onChanged={fetchDashboard}
      />

      {/* Watch list — algorithm-strength tracker for ideas you watched but didn't take */}
      <WatchedPanel />

      {/* ── Status row — only shown when there's data worth showing.
           Without an analysis run, accounts + ready-to-score card carry everything. ── */}
      {scores && (
        <div className="dash-status">
          {(() => {
            const redCount = openTrades.filter(t => t.alignmentStatus === "Red").length;
            const newsCount = openTrades.reduce((n, t) => n + (t.newsCollisions?.length ?? 0), 0);
            const tiles = [
              {
                label: "Open trades",
                value: openTrades.length.toString(),
                sub: redCount > 0 ? `${redCount} red` : newsCount > 0 ? `${newsCount} news` : openTrades.length > 0 ? "all aligned" : "no positions",
                danger: redCount > 0 || newsCount > 0,
              },
              {
                label: "Top currency",
                value: scores?.top3?.[0]?.cur ?? "—",
                sub: scores?.top3?.[0] ? fmtSigned(scores.top3[0].score, 1) : "no score",
                danger: false,
              },
              {
                label: "Weak currency",
                value: scores?.bottom3?.[0]?.cur ?? "—",
                sub: scores?.bottom3?.[0] ? fmt(scores.bottom3[0].score, 1) : "no score",
                danger: false,
              },
              {
                label: "Priority setup",
                value: scores?.priority1?.pair ?? "—",
                sub: scores?.priority1 ? `${scores.priority1.grade} · div ${fmt(scores.priority1.divergence, 1)}` : "no setup",
                danger: false,
              },
              {
                label: "Daily R",
                value: dailyR ? `${fmtSigned(dailyR.todayR, 2)}R` : "0.00R",
                sub: dailyR?.state === "stop" ? "STOP — cutoff hit" : dailyR?.state === "caution" ? "near cutoff" : `${dailyR?.closedToday ?? 0} closed today`,
                danger: dailyR?.state !== "safe" && dailyR?.state !== undefined,
              },
            ];
            return tiles.map(({ label, value, sub, danger }) => (
              <div key={label} className={`dash-stat${danger ? " danger" : ""}`}>
                <p className="lbl">{label}</p>
                <p className="val">{value}</p>
                <p className="sub">{sub}</p>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ── (Legacy accounts strip removed — replaced by AccountTiles above) ── */}
      {false && accounts && accounts.totalAccounts > 0 && (
        <a href="/accounts" style={{ textDecoration: "none" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap",
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

      {/* ── Freshness heartbeat (always on top so stale data is unmissable) ── */}
      <FreshnessStrip tiles={freshness as any} />

      {/* ── Risk row: daily R progression + next event + DXY/VIX ──
           Only renders when at least one of the three has real data. Avoids
           three half-empty cards when no analysis has run and no trades closed. */}
      {(dailyR || nextEvent || (macros && macros.length > 0)) && (
        <div className="dash-risk-row">
          {dailyR && <DailyRBar data={dailyR as any} />}
          {nextEvent && <NextEventCountdown event={nextEvent as any} />}
          {macros && macros.length > 0 && <MacroStrip macros={macros as any} />}
        </div>
      )}

      {/* ── Main grid (sidebar + main pane, collapses to single col on tablet) ── */}
      {/* When no scores yet, swap to auto-fit grid so cards reflow instead of
          leaving the right column empty next to a tall left column. */}
      <div className={`dash-main${!scores ? " dash-main--empty" : ""}`}>

        {/* ── LEFT column ── */}
        <div className="dash-col">

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

          {/* ── S&P Sector map — risk-on/off context, populated by barchart-sync ── */}
          {sectors.length > 0 && (
            <div className="card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p className="section-label" style={{ margin: 0 }}>S&amp;P Sectors</p>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>{sectorRegime(sectors)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[...sectors].sort((a, b) => b.percentChange - a.percentChange).map((s) => {
                  const pos = s.percentChange >= 0;
                  const mag = Math.min(Math.abs(s.percentChange) / 2, 1); // |2%| ≈ full bar
                  const barW = Math.max(mag * 100, 4);
                  return (
                    <div key={s.sector} style={{
                      display: "grid", gridTemplateColumns: "92px 1fr 46px",
                      alignItems: "center", gap: 8, fontSize: 11,
                    }}>
                      <span style={{ color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                            title={`${s.sector}${s.symbol ? ` (${s.symbol})` : ""}`}>
                        {s.sector}
                      </span>
                      <div style={{ height: 6, background: "var(--bg-card-2)", borderRadius: 3, position: "relative" }}>
                        <div style={{
                          position: "absolute", top: 0, bottom: 0,
                          [pos ? "left" : "right"]: "50%",
                          width: `${barW / 2}%`,
                          background: pos ? "var(--green)" : "var(--red)",
                          borderRadius: 3,
                        }} />
                        <div style={{ position: "absolute", top: -2, bottom: -2, left: "50%", width: 1, background: "var(--border)" }} />
                      </div>
                      <span className="font-mono" style={{
                        fontSize: 11, fontWeight: 500, textAlign: "right",
                        color: pos ? "var(--green)" : "var(--red)",
                      }}>
                        {fmtSigned(s.percentChange, 2)}%
                      </span>
                    </div>
                  );
                })}
              </div>
              {data?.barchartFetchedAt && (
                <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 10, marginBottom: 0 }}>
                  Updated {timeAgo(data.barchartFetchedAt)}
                </p>
              )}
            </div>
          )}

          {/* ── Macro snapshot — rate + CPI + GDP per currency (TE matrix) ── */}
          {centralBankRates.length > 0 && (
            <div className="card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p className="section-label" style={{ margin: 0 }}>Macro snapshot</p>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                  {centralBankRates.some((r: any) => r.inflationRate != null) ? "matrix" :
                   centralBankRates.some((r) => r.source === "scraped") ? "rates only" : "config"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[...centralBankRates].sort((a, b) => b.currentRate - a.currentRate).map((r: any) => {
                  const hasMacro = r.inflationRate != null || r.gdpGrowth != null;
                  // Real rate proxy: nominal rate − inflation. Positive → restrictive policy.
                  const realRate = (r.currentRate != null && r.inflationRate != null)
                    ? r.currentRate - r.inflationRate : null;
                  return (
                    <div key={r.currency} style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                        <span className="font-mono" style={{ fontSize: 11, color: "var(--text-2)", flexShrink: 0 }} title={r.bankName}>{r.currency}</span>
                        <span className="font-mono" style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)" }}>{fmt(r.currentRate, 2)}%</span>
                      </div>
                      {hasMacro && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", fontSize: 9, color: "var(--text-3)", marginTop: 1 }}>
                          {r.inflationRate != null && <span title="CPI inflation">CPI {r.inflationRate}%</span>}
                          {r.gdpGrowth != null && <span title="Quarterly GDP growth" style={{ color: r.gdpGrowth >= 0 ? "var(--text-3)" : "var(--red)" }}>
                            GDP {r.gdpGrowth > 0 ? "+" : ""}{r.gdpGrowth}%
                          </span>}
                          {realRate != null && <span title="Real rate = nominal − CPI">
                            real {fmtSigned(realRate, 2)}%
                          </span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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

          {/* Position size calculator */}
          {calcAccounts.length > 0 && (
            <PositionSizeCalc
              accounts={calcAccounts}
              defaultPair={scores?.priority1?.pair}
            />
          )}

          {/* Recent Telegram alerts (audit trail) */}
          <AlertsLog alerts={recentAlerts} />
        </div>

        {/* ── RIGHT column ── */}
        <div className="dash-col">

          {/* (Trade plan board removed — MultiIdeaHero at the top of the page handles this now) */}

          {!scores ? (
            /* Empty state — full-width hero (spans all grid columns in reflow mode) */
            <div className="card dash-hero-empty" style={{
              padding: scoring ? "24px" : "14px 18px",
              display: scoring ? "flex" : "grid",
              gridTemplateColumns: scoring ? undefined : "1fr auto",
              alignItems: "center", gap: 16,
              backgroundImage: "radial-gradient(ellipse at top right, rgba(0,212,138,0.04) 0%, transparent 60%)",
            }}>
              {scoring ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                  <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.75s linear infinite", marginBottom: 10 }} />
                  <p style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500, margin: 0 }}>Claude is analysing the markets…</p>
                </div>
              ) : (
                <>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 14 }}>⚡</span>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)", margin: 0 }}>Ready to score the {session ? `${session.toLowerCase()} session` : "market"}</p>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0, lineHeight: 1.4 }}>
                    Rank all 10 currencies, build the 9-pair matrix and surface today's setups.
                  </p>
                </div>
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
                        {fmt(scores.priority1.divergence, 1)}
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
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{fmt(w.score, 1)}</span>
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
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{fmt(s.score, 1)}</span>
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
                                  {p.direction} · {fmt(p.divergence, 1)}
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
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
                          <p className="font-mono" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{trade.pair}</p>
                          {trade.source && <SourceChip source={trade.source} compact />}
                        </div>
                        <p style={{ fontSize: 11, margin: 0, color: trade.direction === "Short" ? "var(--red)" : "var(--green)", fontWeight: 500 }}>
                          {trade.direction}
                          {trade.model ? ` · Model ${trade.model}` : ""}
                          {trade.session ? ` · ${trade.session}` : ""}
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
                      {trade.strongCcy && (
                        <>
                          <span className="font-mono" style={{ fontSize: 11, color: "var(--green)" }}>{trade.strongCcy}</span>
                          <span style={{ fontSize: 10, color: "var(--text-3)" }}>vs</span>
                          <span className="font-mono" style={{ fontSize: 11, color: "var(--red)" }}>{trade.weakCcy}</span>
                        </>
                      )}
                      {trade.divScore && (
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-3)" }}>div {fmt(trade.divScore, 1)}</span>
                      )}
                    </div>

                    {/* Risk + dollar amount + lot size + live P&L from MT4 */}
                    {(() => {
                      const account = accountList.find((a: any) => a.id === trade.accountId);
                      return (
                        <div style={{ marginTop: 8 }}>
                          <RiskLine
                            riskPercent={trade.riskPercent}
                            accountBalance={account?.currentBalance ?? null}
                            accountCcy={account?.currency ?? 'USD'}
                            lotSize={trade.lotSize ?? null}
                            profitCcy={trade.profitCcy ?? null}
                            outcome="Open"
                          />
                          {account && (
                            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{account.name}</div>
                          )}
                        </div>
                      );
                    })()}

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

                    {/* News-collision badge — upcoming high-impact events on this trade's currencies */}
                    <NewsCollisionBadge events={trade.newsCollisions as any} />
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
