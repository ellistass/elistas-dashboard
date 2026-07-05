"use client";
// app/scanner/page.tsx — Trend-strength screener (v2 design).
// Reads the latest ScanRun from GET /api/scan; "Run scan" POSTs a manual sweep.
// Sections: fresh trends, established trends, big ranges (reversal watch),
// then the full ranked table with condition + RFDM cross-check.

import { useState, useEffect, useCallback } from "react";
import { Radar, RefreshCw, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

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

function edgeText(r: ScanResultRow): { text: string; hot: boolean } {
  const pos = r.pricePosition ?? 0.5;
  if (pos >= 0.8) return { text: "AT TOP — upthrust watch", hot: true };
  if (pos <= 0.2) return { text: "AT BOTTOM — spring watch", hot: true };
  return { text: `mid-range ${Math.round(pos * 100)}%`, hot: false };
}

const fmtPx = (v: number | null, close: number) => (v == null ? "—" : v.toFixed(close < 10 ? 4 : 2));

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

  const trends = results.filter((r) => r.condition === "trend" && r.grade !== "skip");
  const fresh = trends.filter((r) => r.phase === "fresh");
  const established = trends.filter((r) => r.phase === "established");
  const forming = results.filter(
    (r) => r.condition === "transition" && r.score >= 55 && r.adxRising && r.direction !== "none",
  );
  const climax = results.filter((r) => r.phase === "climax");
  const bigRanges = results
    .filter((r) => r.condition === "big-range")
    .sort((a, b) => Math.abs((b.pricePosition ?? 0.5) - 0.5) - Math.abs((a.pricePosition ?? 0.5) - 0.5));

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
      <style>{`.spin { animation: scanspin 1s linear infinite; } @keyframes scanspin { to { transform: rotate(360deg); } }`}</style>

      <p style={{ ...LABEL, marginBottom: 24 }}>
        {run
          ? `last run ${new Date(run.createdAt).toLocaleString()} · ${run.runType} · ${run.scanned}/${run.universe} markets`
          : loading
            ? "loading…"
            : "no runs yet — hit Run scan"}
        {status ? ` · ${status}` : ""}
      </p>

      {/* ── Fresh trends ── */}
      <Section title="Fresh trends — ADX 20–30 rising (the prize)">
        {fresh.length ? (
          <TrendTable rows={fresh} />
        ) : (
          <Empty text="none right now — don't force it" />
        )}
      </Section>

      {/* ── Established ── */}
      <Section title="Established trends — later in the move">
        {established.length ? <TrendTable rows={established} /> : <Empty text="none" />}
      </Section>

      {/* ── Forming ── */}
      <Section title="Forming — ADX rising but price still crawling (watch for promotion)">
        {forming.length ? <TrendTable rows={forming} /> : <Empty text="none" />}
      </Section>

      {/* ── Climax ── */}
      <Section title="Climax — ADX 50+ (never a trend entry; reversal hunt on the hook down)">
        {climax.length ? <TrendTable rows={climax} /> : <Empty text="none" />}
      </Section>

      {/* ── Big ranges ── */}
      <Section title="Big ranges — reversal watch (springs / upthrusts at the edges)">
        {bigRanges.length ? (
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
                {bigRanges.map((r) => {
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
                      <td style={{ ...TD }}>
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
        ) : (
          <Empty text="none" />
        )}
      </Section>

      {/* ── Full ranking ── */}
      <Section title={`Full ranking — ${results.length} markets`}>
        {results.length ? <TrendTable rows={results} showCondition /> : <Empty text={loading ? "loading…" : "no data"} />}
      </Section>

      {/* ── Auto-tracked signal performance ── */}
      <Section title="Signal performance — auto-graded by later scans (R = ATR units in called direction; climax wants negative)">
        {stats.length ? (
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
                    <td style={{ ...TD, ...MONO, fontSize: 12, color: s.hitRate >= 50 ? "var(--green)" : "var(--red)" }}>
                      {s.hitRate}%
                    </td>
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
        ) : (
          <Empty text="no graded signals yet — fills in automatically ~6 days after the first scans deploy" />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={{ ...LABEL, marginBottom: 10 }}>{title}</p>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        borderRadius: 10,
        padding: "18px 16px",
        color: "var(--text-3)",
        fontSize: 13,
      }}
    >
      {text}
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
