"use client";
// app/scanner/page.tsx — Trend-strength screener (v2 design), briefing-first.
//
// Layout philosophy: the pipeline already did the interpretation, so the page
// leads with the verdict, not the evidence. Top: one-line market read + focus
// cards (each a single decision unit). Everything else — established trends,
// ranges, full ranking, performance stats — collapses behind <details> and is
// only there when you want the numbers.

import { useState, useEffect, useCallback } from "react";
import { Radar, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Flame } from "lucide-react";

interface ScanResultRow {
  id: string;
  symbol: string;
  displayName: string;
  assetClass: string;
  tradeable: boolean;
  lastClose: number;
  adx: number;
  adxPrev: number;
  plusDi: number;
  minusDi: number;
  er: number;
  atrPct: number;
  direction: string;
  phase: string;
  condition: string;
  rangeHigh: number | null;
  rangeLow: number | null;
  rangeWidthAtr: number | null;
  pricePosition: number | null;
  adxRising: boolean;
  emaAligned: boolean;
  structureOk: boolean;
  score: number;
  grade: string;
  rfdmAgrees: boolean | null;
  rfdmNote: string | null;
}

interface StatBucket {
  key: string;
  signals: number;
  hitRate: number;
  avgR5: number | null;
  avgR15: number | null;
  avgR30: number | null;
  avgMfe: number | null;
  avgMae: number | null;
}

interface RunMeta {
  id: string;
  createdAt: string;
  runType: string;
  universe: number;
  scanned: number;
  errors: string | null;
}

const MONO: React.CSSProperties = { fontFamily: "'DM Mono', monospace" };
const LABEL: React.CSSProperties = {
  ...MONO,
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  fontWeight: 500,
};
const TH: React.CSSProperties = { ...LABEL, textAlign: "left", padding: "12px 14px" };
const TD: React.CSSProperties = { padding: "12px 14px", fontSize: 13, color: "var(--text-body)" };

const gradeColor = (g: string) =>
  g === "A" ? "var(--green)" : g === "B" ? "var(--accent)" : g === "C" ? "var(--amber)" : "var(--text-3)";

const condStyle = (c: string): React.CSSProperties => {
  const map: Record<string, [string, string, string]> = {
    trend: ["var(--green)", "var(--green-dim)", "var(--green-border)"],
    "big-range": ["var(--purple)", "var(--purple-dim)", "var(--purple-border)"],
    "tight-range": ["var(--text-3)", "var(--bg-inset)", "var(--border-subtle)"],
    transition: ["var(--amber)", "var(--amber-dim)", "var(--amber-border)"],
  };
  const [color, bg, border] = map[c] ?? map.transition;
  return {
    ...MONO,
    fontSize: 10,
    letterSpacing: "0.06em",
    color,
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 4,
    padding: "2px 7px",
    whiteSpace: "nowrap",
  };
};

function Dir({ d }: { d: string }) {
  if (d === "long")
    return (
      <span style={{ color: "var(--green)", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <TrendingUp size={13} /> LONG
      </span>
    );
  if (d === "short")
    return (
      <span style={{ color: "var(--red)", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <TrendingDown size={13} /> SHORT
      </span>
    );
  return <span style={{ color: "var(--text-3)" }}>—</span>;
}

const fmtPx = (v: number | null, close: number) => (v == null ? "—" : v.toFixed(close < 10 ? 4 : 2));

// ── Focus items: the day's decision units ─────────────────────────────────────

type FocusKind = "trend" | "edge" | "climax";
interface FocusItem {
  kind: FocusKind;
  row: ScanResultRow;
  headline: string;
  why: string;
  action: string;
}

function buildFocus(results: ScanResultRow[]): FocusItem[] {
  const items: FocusItem[] = [];

  for (const r of results) {
    if (r.condition === "trend" && r.phase === "fresh" && (r.grade === "A" || r.grade === "B")) {
      items.push({
        kind: "trend",
        row: r,
        headline: `${r.direction === "long" ? "Long" : "Short"} ${r.displayName}`,
        why: [
          `fresh trend, ADX ${r.adx} rising`,
          r.structureOk ? "structure confirmed" : null,
          r.emaAligned ? "EMAs stacked" : null,
          r.rfdmAgrees === true ? "RFDM agrees" : r.rfdmAgrees === false ? "RFDM CONFLICTS" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        action: "Volume/effort read on MT4, then Model A/B at H4 pool",
      });
    } else if (
      r.condition === "big-range" &&
      r.pricePosition != null &&
      (r.pricePosition >= 0.8 || r.pricePosition <= 0.2)
    ) {
      const top = r.pricePosition >= 0.8;
      items.push({
        kind: "edge",
        row: r,
        headline: `${r.displayName} at range ${top ? "top" : "bottom"}`,
        why: `box ${fmtPx(r.rangeLow, r.lastClose)}–${fmtPx(r.rangeHigh, r.lastClose)} · ${r.rangeWidthAtr} ATRs wide · price at the ${top ? "highs" : "lows"}`,
        action: top ? "Upthrust watch — H1 sweep + volume climax = Model A short" : "Spring watch — H1 sweep + volume climax = Model A long",
      });
    } else if (r.phase === "climax" && !r.adxRising) {
      items.push({
        kind: "climax",
        row: r,
        headline: `${r.displayName} exhaustion`,
        why: `ADX ${r.adx} hooked down from 50+ — trend on its last leg`,
        action: "Reversal hunt — do NOT join the trend; wait for the turn structure",
      });
    }
  }

  // Trends first (A before B), then edges, then climax. Cap at 6 — a focus
  // list longer than that isn't a focus list.
  const rank = (i: FocusItem) => (i.kind === "trend" ? (i.row.grade === "A" ? 0 : 1) : i.kind === "edge" ? 2 : 3);
  return items.sort((a, b) => rank(a) - rank(b) || b.row.score - a.row.score).slice(0, 6);
}

// ── One-line market read, composed from the data ─────────────────────────────

function buildVerdict(results: ScanResultRow[], focus: FocusItem[]): string {
  if (!results.length) return "";

  // Currency clusters from forex trend signals: long base = base strong + quote weak.
  const tally = new Map<string, number>();
  const bump = (c: string, v: number) => tally.set(c, (tally.get(c) ?? 0) + v);
  for (const r of results) {
    const m = r.symbol.match(/^([A-Z]{3})([A-Z]{3})=X$/);
    if (!m || r.condition !== "trend" || r.direction === "none") continue;
    const s = r.direction === "long" ? 1 : -1;
    bump(m[1], s);
    bump(m[2], -s);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const strong = ranked.filter(([, v]) => v >= 3).map(([c]) => c);
  const weak = ranked.filter(([, v]) => v <= -3).map(([c]) => c);

  const parts: string[] = [];
  if (strong.length || weak.length) {
    const bits = [];
    if (strong.length) bits.push(`${strong.join("/")} strong`);
    if (weak.length) bits.push(`${weak.join("/")} weak across the board`);
    parts.push(bits.join(", "));
  }
  const edges = focus.filter((f) => f.kind === "edge").length;
  if (edges) parts.push(`${edges} market${edges > 1 ? "s" : ""} at range edges`);
  const hooks = focus.filter((f) => f.kind === "climax").length;
  if (hooks) parts.push(`${hooks} exhaustion hook${hooks > 1 ? "s" : ""}`);

  const setups = focus.length;
  parts.push(setups ? `${setups} setup${setups > 1 ? "s" : ""} worth your time` : "nothing qualifies — doing nothing is the trade");
  return parts.join(" — ");
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ScannerPage() {
  const [run, setRun] = useState<RunMeta | null>(null);
  const [results, setResults] = useState<ScanResultRow[]>([]);
  const [stats, setStats] = useState<StatBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, statsRes] = await Promise.all([fetch("/api/scan"), fetch("/api/scan?stats=1")]);
      if (res.ok) {
        const j = await res.json();
        setRun(j.run);
        setResults(j.results ?? []);
      }
      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats(s.stats ?? []);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runNow = async () => {
    setScanning(true);
    setStatus("Sweeping 48 markets on H4 — takes a minute or two…");
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const j = await res.json();
      setStatus(res.ok ? `Scanned ${j.scanned} markets${j.errors?.length ? `, ${j.errors.length} errors` : ""}` : "Scan failed");
      await load();
    } catch {
      setStatus("Scan failed — check connection");
    }
    setScanning(false);
  };

  const focus = buildFocus(results);
  const verdict = buildVerdict(results, focus);

  const trends = results.filter((r) => r.condition === "trend" && r.grade !== "skip");
  const established = trends.filter((r) => r.phase === "established");
  const forming = results.filter(
    (r) => r.condition === "transition" && r.score >= 55 && r.adxRising && r.direction !== "none",
  );
  const bigRanges = results
    .filter((r) => r.condition === "big-range")
    .sort((a, b) => Math.abs((b.pricePosition ?? 0.5) - 0.5) - Math.abs((a.pricePosition ?? 0.5) - 0.5));
  const climax = results.filter((r) => r.phase === "climax");

  const headlineStats = stats.find((s) => s.key === "trend/A");

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1280 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Radar size={20} style={{ color: "var(--accent)" }} />
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>Trend Screener</h1>
        </div>
        <button
          onClick={runNow}
          disabled={scanning}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--accent-border)",
            background: "var(--accent-dim)",
            color: "var(--accent)",
            fontSize: 13,
            cursor: scanning ? "wait" : "pointer",
            opacity: scanning ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} className={scanning ? "spin" : undefined} />
          {scanning ? "Scanning…" : "Run scan"}
        </button>
      </div>
      <style>{`
        .spin { animation: scanspin 1s linear infinite; } @keyframes scanspin { to { transform: rotate(360deg); } }
        details.scn > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; padding: 12px 2px; }
        details.scn > summary::-webkit-details-marker { display: none; }
        details.scn > summary::before { content: '▸'; color: var(--text-3); font-size: 11px; transition: transform .15s; }
        details.scn[open] > summary::before { transform: rotate(90deg); }
      `}</style>

      <p style={{ ...LABEL, marginBottom: 18 }}>
        {run
          ? `last run ${new Date(run.createdAt).toLocaleString()} · ${run.runType} · ${run.scanned}/${run.universe} markets`
          : loading
            ? "loading…"
            : "no runs yet — hit Run scan"}
        {status ? ` · ${status}` : ""}
      </p>

      {/* ── The verdict ── */}
      {verdict && (
        <div
          style={{
            border: "1px solid var(--accent-border)",
            background: "var(--accent-dim)",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 20,
            fontSize: 14,
            color: "var(--text-1)",
            lineHeight: 1.5,
          }}
        >
          {verdict}
        </div>
      )}

      {/* ── Focus cards ── */}
      {focus.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 12,
            marginBottom: 26,
          }}
        >
          {focus.map((f) => (
            <FocusCard key={f.row.id} item={f} />
          ))}
        </div>
      )}
      {!focus.length && !loading && results.length > 0 && (
        <div
          style={{
            border: "1px dashed var(--border)",
            borderRadius: 10,
            padding: "22px 18px",
            marginBottom: 26,
            color: "var(--text-2)",
            fontSize: 13,
          }}
        >
          No qualifying setups today. The scanner's most valuable output is permission to do nothing.
        </div>
      )}

      {/* ── Performance headline chips ── */}
      {headlineStats && (
        <div style={{ display: "flex", gap: 10, marginBottom: 26, flexWrap: "wrap" }}>
          <Chip label="A-grade hit rate" value={`${headlineStats.hitRate}%`} good={headlineStats.hitRate >= 50} />
          <Chip
            label="A-grade avg R (30 bars)"
            value={headlineStats.avgR30 == null ? "—" : `${headlineStats.avgR30 > 0 ? "+" : ""}${headlineStats.avgR30}R`}
            good={(headlineStats.avgR30 ?? 0) > 0}
          />
          <Chip label="signals graded" value={String(headlineStats.signals)} good />
        </div>
      )}

      {/* ── Collapsed detail ── */}
      <Collapse title={`Established trends (${established.length})`}>
        {established.length ? <TrendTable rows={established} /> : <Empty text="none" />}
      </Collapse>
      <Collapse title={`Forming — watch for promotion (${forming.length})`}>
        {forming.length ? <TrendTable rows={forming} /> : <Empty text="none" />}
      </Collapse>
      <Collapse title={`Big ranges (${bigRanges.length})`}>
        {bigRanges.length ? <RangeTable rows={bigRanges} /> : <Empty text="none" />}
      </Collapse>
      <Collapse title={`Climax — ADX 50+ (${climax.length})`}>
        {climax.length ? <TrendTable rows={climax} /> : <Empty text="none" />}
      </Collapse>
      <Collapse title={`Full ranking (${results.length} markets)`}>
        {results.length ? <TrendTable rows={results} showCondition /> : <Empty text={loading ? "loading…" : "no data"} />}
      </Collapse>
      <Collapse title={`Signal performance — all buckets (${stats.length})`}>
        {stats.length ? <StatsTable stats={stats} /> : <Empty text="no graded signals yet — fills in automatically ~6 days after deploy" />}
      </Collapse>
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function FocusCard({ item }: { item: FocusItem }) {
  const r = item.row;
  const accent =
    item.kind === "trend"
      ? r.direction === "long"
        ? "var(--green)"
        : "var(--red)"
      : item.kind === "edge"
        ? "var(--purple)"
        : "var(--amber)";
  const Icon = item.kind === "trend" ? (r.direction === "long" ? TrendingUp : TrendingDown) : item.kind === "edge" ? AlertTriangle : Flame;
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        background: "var(--bg-card)",
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
          <Icon size={15} style={{ color: accent }} />
          {item.headline}
        </span>
        <span style={{ ...MONO, fontSize: 12, color: gradeColor(r.grade) }}>
          {item.kind === "trend" ? `${r.grade} · ${r.score}` : item.kind === "edge" ? "MODEL A" : "REVERSAL"}
        </span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-2)", margin: "0 0 8px", lineHeight: 1.5 }}>{item.why}</p>
      <p style={{ fontSize: 12, color: "var(--text-body)", margin: 0, lineHeight: 1.5 }}>
        <span style={{ color: accent }}>→</span> {item.action}
        {!r.tradeable && <span style={{ ...LABEL, marginLeft: 6 }}>not on MT4</span>}
      </p>
    </div>
  );
}

function Chip({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-card)",
        padding: "8px 14px",
        display: "flex",
        alignItems: "baseline",
        gap: 8,
      }}
    >
      <span style={{ ...MONO, fontSize: 15, fontWeight: 600, color: good ? "var(--green)" : "var(--red)" }}>{value}</span>
      <span style={LABEL}>{label}</span>
    </div>
  );
}

function Collapse({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="scn" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <summary style={LABEL}>{title}</summary>
      <div style={{ paddingBottom: 18 }}>{children}</div>
    </details>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "18px 16px", color: "var(--text-3)", fontSize: 13 }}>
      {text}
    </div>
  );
}

function edgeText(r: ScanResultRow): { text: string; hot: boolean } {
  const pos = r.pricePosition ?? 0.5;
  if (pos >= 0.8) return { text: "AT TOP — upthrust watch", hot: true };
  if (pos <= 0.2) return { text: "AT BOTTOM — spring watch", hot: true };
  return { text: `mid-range ${Math.round(pos * 100)}%`, hot: false };
}

function RangeTable({ rows }: { rows: ScanResultRow[] }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg-card)" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <th style={TH}>Market</th>
            <th style={TH}>Box</th>
            <th style={TH}>Width</th>
            <th style={TH}>Price position</th>
            <th style={TH}>ADX</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const edge = edgeText(r);
            return (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border-faint)" }}>
                <td style={{ ...TD, color: "var(--text-1)", fontWeight: 500 }}>
                  {r.displayName}
                  {!r.tradeable && <span style={{ ...LABEL, marginLeft: 8 }}>not on MT4</span>}
                </td>
                <td style={{ ...TD, ...MONO, fontSize: 12 }}>
                  {fmtPx(r.rangeLow, r.lastClose)} – {fmtPx(r.rangeHigh, r.lastClose)}
                </td>
                <td style={{ ...TD, ...MONO, fontSize: 12 }}>{r.rangeWidthAtr} ATRs</td>
                <td style={TD}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      color: edge.hot ? "var(--amber)" : "var(--text-2)",
                      fontSize: 12,
                    }}
                  >
                    {edge.hot && <AlertTriangle size={13} />}
                    {edge.text}
                  </span>
                </td>
                <td style={{ ...TD, ...MONO, fontSize: 12 }}>
                  {r.adx}
                  {r.adxRising ? "↑" : "↓"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsTable({ stats }: { stats: StatBucket[] }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg-card)", minWidth: 640 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <th style={TH}>Bucket</th>
            <th style={TH}>Signals</th>
            <th style={TH}>Hit rate</th>
            <th style={TH}>Avg R +5</th>
            <th style={TH}>Avg R +15</th>
            <th style={TH}>Avg R +30</th>
            <th style={TH}>Avg MFE</th>
            <th style={TH}>Avg MAE</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.key} style={{ borderBottom: "1px solid var(--border-faint)" }}>
              <td style={{ ...TD, ...MONO, fontSize: 12, color: "var(--text-1)" }}>{s.key}</td>
              <td style={{ ...TD, ...MONO, fontSize: 12 }}>{s.signals}</td>
              <td style={{ ...TD, ...MONO, fontSize: 12, color: s.hitRate >= 50 ? "var(--green)" : "var(--red)" }}>{s.hitRate}%</td>
              {[s.avgR5, s.avgR15, s.avgR30, s.avgMfe, s.avgMae].map((v, i) => (
                <td
                  key={i}
                  style={{ ...TD, ...MONO, fontSize: 12, color: v == null ? "var(--text-3)" : v >= 0 ? "var(--green)" : "var(--red)" }}
                >
                  {v == null ? "—" : v.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendTable({ rows, showCondition = false }: { rows: ScanResultRow[]; showCondition?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg-card)", minWidth: 760 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <th style={TH}>Grade</th>
            <th style={TH}>Score</th>
            <th style={TH}>Market</th>
            <th style={TH}>Direction</th>
            <th style={TH}>ADX</th>
            <th style={TH}>ER</th>
            <th style={TH}>Phase</th>
            {showCondition && <th style={TH}>Condition</th>}
            <th style={TH}>Checks</th>
            <th style={TH}>RFDM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--border-faint)" }}>
              <td style={{ ...TD, ...MONO, color: gradeColor(r.grade), fontWeight: 600 }}>{r.grade}</td>
              <td style={{ ...TD, ...MONO }}>{r.score}</td>
              <td style={{ ...TD, color: "var(--text-1)", fontWeight: 500 }}>
                {r.displayName}
                {!r.tradeable && <span style={{ ...LABEL, marginLeft: 8 }}>not on MT4</span>}
              </td>
              <td style={{ ...TD, fontSize: 12 }}>
                <Dir d={r.direction} />
              </td>
              <td style={{ ...TD, ...MONO, fontSize: 12, color: r.adxRising ? "var(--green)" : "var(--text-2)" }}>
                {r.adx}
                {r.adxRising ? "↑" : "↓"}
              </td>
              <td style={{ ...TD, ...MONO, fontSize: 12 }}>{r.er.toFixed(2)}</td>
              <td style={{ ...TD, fontSize: 12, color: "var(--text-2)" }}>{r.phase}</td>
              {showCondition && (
                <td style={TD}>
                  <span style={condStyle(r.condition)}>{r.condition}</span>
                </td>
              )}
              <td style={{ ...TD, ...MONO, fontSize: 11, color: "var(--text-2)" }}>
                <span style={{ color: r.emaAligned ? "var(--green)" : "var(--text-3)" }}>ema</span>{" "}
                <span style={{ color: r.structureOk ? "var(--green)" : "var(--text-3)" }}>struct</span>
              </td>
              <td style={{ ...TD, fontSize: 11 }} title={r.rfdmNote ?? undefined}>
                {r.rfdmAgrees === true ? (
                  <span style={{ color: "var(--green)" }}>agrees</span>
                ) : r.rfdmAgrees === false ? (
                  <span style={{ color: "var(--red)" }}>conflicts</span>
                ) : (
                  <span style={{ color: "var(--text-3)" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
