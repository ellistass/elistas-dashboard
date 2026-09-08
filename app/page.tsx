"use client";
// app/page.tsx — Elistas Dashboard (v2 redesign)
// Orchestration + state only. All presentation lives in app/_components/dashboard/*
// and the restyled shared components (PositionSizeCalc, WatchedPanel,
// DiagnosticsPanel). Types mirror the /api/dashboard + /api/accounts payloads
// (see _components/dashboard/types.ts — unchanged contracts).
//
// Wyckoff leads the page: the A+ setup renders as the real candidate card,
// then open positions, then market context. The RFDM strength read and idea
// hero were removed from here — see the note where they used to sit.

import { useState, useEffect, useCallback } from "react";
import { DashHeader, type Engine } from "./_components/dashboard/DashHeader";
import { DashBanners } from "./_components/dashboard/Banners";
import { EaHealthBanner } from "./_components/dashboard/EaHealthBanner";
import { StatusRow } from "./_components/dashboard/StatusRow";
import { OpenPositions } from "./_components/dashboard/OpenPositions";
import { AccountsAggregateCard, RecentAlertsCard } from "./_components/dashboard/RightRail";
import { ManualPanel } from "./_components/dashboard/ManualPanel";
import { MarketContext } from "./_components/dashboard/MarketContext";
import { WyckoffSetups } from "./_components/dashboard/WyckoffSetups";
import { PositionSizeCalc } from "./_components/PositionSizeCalc";
import { WatchedPanel } from "./_components/WatchedPanel";
import { RoutineSetupCard } from "./_components/RoutineSetupCard";
import { DiagnosticsPanel } from "./_components/DiagnosticsPanel";
import type { DashboardData, AccountAggregate, SectorRow } from "./_components/dashboard/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
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
function sectorRegime(sectors: SectorRow[]): string {
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

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [scoreStatus, setScoreStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [clock, setClock] = useState(watTime());
  const [calendar, setCalendar] = useState("");
  const [perf, setPerf] = useState("");
  const [stddev, setStddev] = useState("");
  const [futures, setFutures] = useState("");
  const [accounts, setAccounts] = useState<AccountAggregate | null>(null);
  // Wyckoff is the strategy, so the board it produces opens the page. Its own
  // narrow endpoint rather than the desk's full payload — see api/wyckoff/top.
  const [wyckoff, setWyckoff] = useState<{ candidates: any[]; lastScanAt: string | null }>({
    candidates: [], lastScanAt: null,
  });
  const [wyckoffLoading, setWyckoffLoading] = useState(true);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(watTime()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, accRes, wyckRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/accounts"),
        fetch("/api/wyckoff/top"),
      ]);
      if (dashRes.ok) setData(await dashRes.json());
      if (accRes.ok) {
        const j = await accRes.json();
        setAccounts(j.aggregate ?? null);
      }
      // Never blocks the rest of the dashboard: the route answers 200 with an
      // empty board even when the scanner table is unavailable.
      if (wyckRes.ok) {
        const j = await wyckRes.json();
        setWyckoff({ candidates: j.candidates ?? [], lastScanAt: j.lastScanAt ?? null });
      }
    } catch (e) { console.error(e); }
    setWyckoffLoading(false);
    setLoading(false);
  }, []);

  // 3-minute polling
  useEffect(() => {
    fetchDashboard();
    const t = setInterval(fetchDashboard, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchDashboard]);

  // Engine the user has picked (defaults to Sonnet via API)
  const [engine, setEngine] = useState<Engine>('sonnet');
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('elistas:scoring-engine') : null;
    if (stored === 'sonnet' || stored === 'haiku' || stored === 'rules' || stored === 'routine') setEngine(stored as Engine);
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('elistas:scoring-engine', engine);
  }, [engine]);

  async function runAnalysis(sendAlert = false) {
    // If user picked "routine", just nudge them to use Claude Desktop instead
    if (engine === 'routine') {
      setScoreStatus({ ok: true, msg: "Routine mode: open Claude Desktop → trading project → paste your trigger prompt (see Routine card in the right rail)." });
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

  // Full per-account list — powers the aggregate rail card, the calc, the
  // idea-take flow and open-position risk math. Refreshed every 3 min.
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

  const scores = data?.scores;
  const openTrades = data?.openTrades ?? [];
  const sectors = data?.sectors ?? [];
  const centralBankRates = data?.centralBankRates ?? [];
  const freshness = data?.freshness;
  const todaysIdeas = data?.todaysIdeas ?? [];
  const session = currentSession();
  const regime = sectorRegime(sectors);

  const calcAccounts = accountList
    .filter((a) => a.isActive)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency, currentBalance: a.currentBalance }));

  // Header meta: data age = scoring dataAge, else the freshest source's age.
  const freshAges = (freshness ?? []).map((f) => f.ageMinutes).filter((n): n is number => n != null);
  const dataAgeMin = scores?.dataAge ?? (freshAges.length ? Math.min(...freshAges) : null);

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

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <DashHeader
        session={session} clock={clock}
        scoredAgo={data?.scoredAt ? timeAgo(data.scoredAt) : null}
        dataAgeMin={dataAgeMin}
        hasLiveData={!!data?.hasLiveData}
        scoringModel={scores?.scoringModel}
        engine={engine} onEngine={setEngine}
        scoring={scoring} sent={sent} loading={loading}
        onRun={runAnalysis} onRefresh={fetchDashboard}
        manualOn={showManual} onManualToggle={() => setShowManual((v) => !v)}
      />

      <DashBanners
        scoreStatus={scoreStatus}
        onDismissStatus={() => setScoreStatus(null)}
        scores={scores}
        warnings={warnings}
        fetchErrors={data?.fetchErrors ?? []}
        hasLiveData={!!data?.hasLiveData}
        onOpenManual={() => setShowManual(true)}
      />

      {/* Only renders when "Open" has stopped meaning "open" — see ea-health.ts */}
      <EaHealthBanner health={(data as any)?.eaHealth} />

      {/* Status row: Daily R budget · Next high-impact · DXY · VIX */}
      <StatusRow dailyR={data?.dailyR} nextEvent={data?.nextEvent} macros={data?.macros} regime={regime} />

      {/* Main grid: content + right rail */}
      <div className="dash-main">
        {/* LEFT column — Wyckoff first. It is the strategy, so it gets the top
            of the page: the best setup on the board, a door to the rest, then
            what is already running. The currency-strength read and the RFDM
            ideas stay, below, as context for a decision rather than the
            decision itself. */}
        <div className="dash-col">
          {/* The A+ setup, as the actual card — chart, grade, read form and all.
              A summary tile that linked to /wyckoff was making you go and look
              somewhere else to see the thing this section is about. */}
          <WyckoffSetups
            candidates={wyckoff.candidates}
            lastScanAt={wyckoff.lastScanAt}
            loading={wyckoffLoading}
            onChanged={fetchDashboard}
          />

          {/* Open positions — what is already at risk, before anything new */}
          <OpenPositions trades={openTrades as any} accounts={accountList as any} onChanged={fetchDashboard} />

          {/* Market context — rates, sectors, sessions */}
          <MarketContext
            sectors={sectors}
            rates={centralBankRates as any}
            regime={regime}
            session={session}
            barchartFetchedAt={data?.barchartFetchedAt}
          />

          {/* REMOVED from the dashboard: the RFDM currency-strength read
              (StrengthRead / EmptyScoreHero) and the RFDM idea hero
              (MultiIdeaHero). Wyckoff is the strategy, and two strategies
              competing for the top of the page meant neither owned it.
              Neither feature is deleted — the scoring API, the ideas and the
              history all still exist and still run on cron; they live on
              /analysis now. Restore by re-adding those two blocks here. */}
        </div>

        {/* RIGHT rail */}
        <div className="dash-col">
          {calcAccounts.length > 0 && (
            <PositionSizeCalc accounts={calcAccounts} defaultPair={scores?.priority1?.pair} />
          )}

          <AccountsAggregateCard accounts={accountList as any} />

          <WatchedPanel />

          <RecentAlertsCard alerts={data?.recentAlerts} />

          <DiagnosticsPanel
            sectors={sectors}
            rates={centralBankRates}
            freshness={freshness}
            todaysIdeas={todaysIdeas}
            macros={data?.macros as any}
            nextEvent={data?.nextEvent}
            barchartFetchedAt={data?.barchartFetchedAt}
            ratesFetchedAt={data?.ratesFetchedAt}
            scoredAt={data?.scoredAt}
            scoringModel={scores?.scoringModel}
          />

          {/* Claude Desktop routine setup — collapsed unless configuring */}
          <RoutineSetupCard />

          {/* Aggregate drawdown-danger note from /api/accounts (null-guarded) */}
          {accounts && accounts.dangerAccounts > 0 && (
            <div style={{
              padding: "8px 12px", borderRadius: 10, fontSize: 11,
              background: "var(--amber-dim)", border: "1px solid var(--amber-border)", color: "var(--amber)",
            }}>
              ⚠ {accounts.dangerAccounts} account{accounts.dangerAccounts > 1 ? "s" : ""} in drawdown danger
            </div>
          )}
        </div>
      </div>

      {/* Manual data entry — shown while the header "Manual" toggle is on */}
      {showManual && (
        <ManualPanel
          calendar={calendar} setCalendar={setCalendar}
          perf={perf} setPerf={setPerf}
          stddev={stddev} setStddev={setStddev}
          futures={futures} setFutures={setFutures}
          scoring={scoring} sent={sent} onRun={runManual}
        />
      )}
    </div>
  );
}
