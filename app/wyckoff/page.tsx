"use client";
// app/wyckoff/page.tsx — Wyckoff Range Scanner (v2 design tokens).
//
// The validation instrument, not a signal feed:
//   • PENDING ranges (unresolved) — the server response for these NEVER
//     contains the engine verdict, so there is nothing to peek at. You log a
//     blind read (accum / distrib / pass + optional entry & stop). Submitting
//     locks it server-side — immutable, timestamped.
//   • RESOLVED ranges — full reveal: your read vs the engine's vs what price
//     actually did, plus running accuracy tallies on the same candidate set.
//
// Data: GET /api/wyckoff, POST /api/wyckoff/read.

import { useCallback, useEffect, useState } from "react";
import { Frame, Lock, Eye, ShieldCheck, RefreshCw } from "lucide-react";

/* ── Types (mirror app/api/wyckoff) ─────────────────────────────────────── */

interface PendingRow {
  id: string;
  instrument: string;
  rangeLo: number;
  rangeHi: number;
  contextPct: number | null;
  terminalTest: string;
  stoppingAction: boolean;
  barsInRange: number;
  status: "open" | "broken";
  rangeStartDate: string;
  breakoutDate: string | null;
  traderVerdict: string | null;
  traderEntry: number | null;
  traderStop: number | null;
  traderReadAt: string | null;
}

interface ResolvedRow extends PendingRow {
  outcome: string;
  outcomeAt: string | null;
  engineVerdict: string;
  loggedBlind: boolean;
}

interface Tally {
  n: number;
  correct: number;
  decisiveN: number;
  decisiveCorrect: number;
}

interface Scoreboard {
  resolvedWithRead: number;
  you: Tally;
  engineSameSet: Tally;
  engineOverallBlind: Tally;
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const px = (v: number, hi: number) => v.toFixed(hi < 10 ? 4 : 2);
const box = (r: { rangeLo: number; rangeHi: number }) =>
  `${px(r.rangeLo, r.rangeHi)}–${px(r.rangeHi, r.rangeHi)}`;
const ctxFmt = (v: number | null) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const pct = (c: number, n: number) => (n ? `${Math.round((c / n) * 100)}%` : "—");

const VERDICT_COLOR: Record<string, string> = {
  accum: "var(--green)",
  distrib: "var(--red)",
  pass: "var(--text-3)",
  neutral: "var(--text-3)",
};
const OUTCOME_COLOR: Record<string, string> = {
  up: "var(--green)",
  down: "var(--red)",
  chop: "var(--text-3)",
};
const verdictLabel = (v: string) =>
  v === "accum" ? "ACCUM" : v === "distrib" ? "DISTRIB" : v === "pass" ? "PASS" : "NEUTRAL";
const verdictHits = (v: string, outcome: string) =>
  v === "accum" ? outcome === "up" : v === "distrib" ? outcome === "down" : outcome === "chop";

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function WyckoffPage() {
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [resolved, setResolved] = useState<ResolvedRow[]>([]);
  const [score, setScore] = useState<Scoreboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wyckoff", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `load failed (${res.status})`);
      setPending(j.pending);
      setResolved(j.resolved);
      setScore(j.score);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runScanNow() {
    if (scanning) return;
    setScanning(true);
    setScanNote(null);
    try {
      const res = await fetch("/api/wyckoff", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.error ?? `scan failed (${res.status})`);
      setScanNote(
        `scanned ${j.scanned} · ${j.rangesFound} ranges · ${j.freshCount} fresh · data through ${j.latestBarDate ?? "?"}`,
      );
      await load();
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : String(e));
    }
    setScanning(false);
  }

  return (
    <div>
      {/* ── Header ── */}
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Wyckoff ranges
            </h1>
            <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)", paddingTop: 6 }}>
              <Frame size={13} strokeWidth={2} />
              {pending.length} unresolved · {resolved.length} resolved shown
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-label)", fontWeight: 300 }}>
            Read the chart, lock your call before the range resolves. The engine&apos;s verdict stays
            sealed server-side until the outcome exists — then both reads are revealed together.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button
            onClick={runScanNow}
            disabled={scanning}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "10px 15px", borderRadius: 9, border: "none",
              background: "var(--accent)", color: "var(--accent-on)",
              fontSize: 13, fontWeight: 600, cursor: scanning ? "default" : "pointer",
              boxShadow: "0 0 20px rgba(58,212,236,0.26)",
              opacity: scanning ? 0.6 : 1, fontFamily: "'Sora', sans-serif",
            }}
          >
            <RefreshCw size={15} strokeWidth={2} className={scanning ? "spin" : undefined}
              style={scanning ? { animation: "spin 1s linear infinite" } : undefined} />
            {scanning ? "Scanning… (~1 min)" : "Run scan"}
          </button>
          {scanNote && (
            <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", maxWidth: 320, textAlign: "right" }}>
              {scanNote}
            </span>
          )}
        </div>
      </header>

      {/* ── Scoreboard ── */}
      {score && <ScoreRow score={score} />}

      {error && (
        <div className="card" style={{ padding: 16, marginBottom: 14, border: "1px solid var(--red-border)", color: "var(--red)" }}>
          <span style={{ ...mono, fontSize: 12 }}>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading candidates…</p>
        </div>
      ) : (
        <>
          {/* ── Pending (blind) ── */}
          <SectionTitle icon={<Lock size={13} strokeWidth={2} />} title="Unresolved — blind" note="engine verdict sealed · reads lock on submit" />
          {pending.length === 0 ? (
            <div className="card" style={{ padding: 32, textAlign: "center", marginBottom: 22 }}>
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                No unresolved ranges right now — the daily scan repopulates this after each close.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26 }}>
              {pending.map((row) => (
                <PendingCard key={row.id} row={row} onLocked={load} />
              ))}
            </div>
          )}

          {/* ── Resolved (revealed) ── */}
          <SectionTitle icon={<Eye size={13} strokeWidth={2} />} title="Resolved — revealed" note="your read vs engine vs what price did" />
          {resolved.length === 0 ? (
            <div className="card" style={{ padding: 32, textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                Nothing resolved yet — outcomes backfill 12 trading days after each breakout.
              </p>
            </div>
          ) : (
            <ResolvedTable rows={resolved} />
          )}
        </>
      )}
    </div>
  );
}

/* ── Scoreboard row ─────────────────────────────────────────────────────── */

function ScoreRow({ score }: { score: Scoreboard }) {
  const tiles = [
    {
      label: "You",
      main: pct(score.you.correct, score.you.n),
      sub: `${score.you.correct}/${score.you.n} · decisive ${pct(score.you.decisiveCorrect, score.you.decisiveN)}`,
      accent: "var(--accent)",
    },
    {
      label: "Engine (same set)",
      main: pct(score.engineSameSet.correct, score.engineSameSet.n),
      sub: `${score.engineSameSet.correct}/${score.engineSameSet.n} · decisive ${pct(score.engineSameSet.decisiveCorrect, score.engineSameSet.decisiveN)}`,
      accent: "var(--text-2)",
    },
    {
      label: "Shared sample",
      main: String(score.resolvedWithRead),
      sub: "resolved candidates with your read",
      accent: "var(--text-2)",
    },
    {
      label: "Engine overall (blind)",
      main: pct(score.engineOverallBlind.correct, score.engineOverallBlind.n),
      sub: `${score.engineOverallBlind.correct}/${score.engineOverallBlind.n} blind-logged ranges`,
      accent: "var(--text-2)",
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 20 }}>
      {tiles.map((t) => (
        <div key={t.label} className="card" style={{ padding: "14px 16px" }}>
          <p className="kicker" style={{ margin: "0 0 6px" }}>{t.label}</p>
          <p style={{ ...mono, margin: 0, fontSize: 24, fontWeight: 500, color: t.accent }}>{t.main}</p>
          <p style={{ ...mono, margin: "4px 0 0", fontSize: 10, color: "var(--text-3)" }}>{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "0 0 10px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
        {icon} {title}
      </span>
      <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{note}</span>
    </div>
  );
}

/* ── Pending candidate card with the blind-read form ────────────────────── */

function PendingCard({ row, onLocked }: { row: PendingRow; onLocked: () => void }) {
  const [verdict, setVerdict] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lockRead() {
    if (!verdict || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/wyckoff/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          verdict,
          entry: entry.trim() ? Number(entry) : undefined,
          stop: stop.trim() ? Number(stop) : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      onLocked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const facts: Array<[string, string]> = [
    ["box", box(row)],
    ["bars", String(row.barsInRange)],
    ["context", ctxFmt(row.contextPct)],
    ["test", row.terminalTest],
    ["stopping", row.stoppingAction ? "yes" : "no"],
    [row.status === "open" ? "state" : "broke out", row.status === "open" ? "OPEN" : day(row.breakoutDate)],
  ];

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
        <span style={{ ...mono, fontSize: 15, fontWeight: 500, color: "var(--text-1)", minWidth: 52 }}>
          {row.instrument}
        </span>
        {facts.map(([k, v]) => (
          <span key={k} style={{ ...mono, fontSize: 11, color: "var(--text-2)" }}>
            <span style={{ color: "var(--text-3)" }}>{k} </span>
            {v}
          </span>
        ))}
      </div>

      {row.traderVerdict ? (
        // Locked read — shown back to you; still no engine verdict anywhere.
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{
            ...mono, display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 11, padding: "4px 10px", borderRadius: 999,
            border: "1px solid var(--border-strong)", color: VERDICT_COLOR[row.traderVerdict],
          }}>
            <ShieldCheck size={12} strokeWidth={2} />
            your read: {verdictLabel(row.traderVerdict)} · locked {day(row.traderReadAt)}
          </span>
          {row.traderEntry != null && (
            <span style={{ ...mono, fontSize: 11, color: "var(--text-3)" }}>
              entry {px(row.traderEntry, row.rangeHi)} · stop {row.traderStop != null ? px(row.traderStop, row.rangeHi) : "—"}
            </span>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className="seg">
            {(["accum", "distrib", "pass"] as const).map((v) => (
              <button key={v} className={verdict === v ? "on" : ""} onClick={() => setVerdict(v)}>
                {verdictLabel(v)}
              </button>
            ))}
          </div>
          <input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="entry (opt)" inputMode="decimal" style={inputStyle} />
          <input value={stop} onChange={(e) => setStop(e.target.value)} placeholder="stop (opt)" inputMode="decimal" style={inputStyle} />
          <button
            onClick={lockRead}
            disabled={!verdict || busy}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8, border: "none",
              background: verdict ? "var(--accent)" : "var(--border-subtle)",
              color: verdict ? "var(--accent-on)" : "var(--text-3)",
              fontSize: 12, fontWeight: 600, cursor: verdict ? "pointer" : "default",
              opacity: busy ? 0.6 : 1, fontFamily: "'Sora', sans-serif",
            }}
          >
            <Lock size={12} strokeWidth={2} />
            {busy ? "Locking…" : "Lock read"}
          </button>
          <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>immutable once locked</span>
          {err && <span style={{ ...mono, fontSize: 11, color: "var(--red)" }}>{err}</span>}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  width: 92,
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-1)",
  outline: "none",
};

/* ── Resolved table — the reveal ────────────────────────────────────────── */

function ResolvedTable({ rows }: { rows: ResolvedRow[] }) {
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["Instrument", "Box", "Bars", "Context", "Test", "Broke out", "Outcome", "Your read", "Engine", "Blind"].map((h) => (
              <th key={h} style={{
                ...mono, textAlign: "left", fontSize: 9.5, letterSpacing: "0.12em",
                textTransform: "uppercase", color: "var(--text-3)", fontWeight: 500,
                padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ ...mono, padding: "9px 12px", color: "var(--text-1)", fontWeight: 500 }}>{r.instrument}</td>
              <td style={{ ...mono, padding: "9px 12px", color: "var(--text-2)" }}>{box(r)}</td>
              <td style={{ ...mono, padding: "9px 12px", color: "var(--text-2)" }}>{r.barsInRange}</td>
              <td style={{ ...mono, padding: "9px 12px", color: "var(--text-2)" }}>{ctxFmt(r.contextPct)}</td>
              <td style={{ ...mono, padding: "9px 12px", color: "var(--text-2)" }}>{r.terminalTest}</td>
              <td style={{ ...mono, padding: "9px 12px", color: "var(--text-2)" }}>{day(r.breakoutDate)}</td>
              <td style={{ ...mono, padding: "9px 12px", color: OUTCOME_COLOR[r.outcome] ?? "var(--text-2)", fontWeight: 500 }}>
                {r.outcome.toUpperCase()}
              </td>
              <VerdictCell verdict={r.traderVerdict} outcome={r.outcome} />
              <VerdictCell verdict={r.engineVerdict} outcome={r.outcome} />
              <td style={{ ...mono, padding: "9px 12px", color: "var(--text-3)" }}>{r.loggedBlind ? "✓" : "seed"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VerdictCell({ verdict, outcome }: { verdict: string | null; outcome: string }) {
  if (!verdict) return <td style={{ ...mono, padding: "9px 12px", color: "var(--text-3)" }}>—</td>;
  const hit = verdictHits(verdict, outcome);
  return (
    <td style={{ ...mono, padding: "9px 12px", color: VERDICT_COLOR[verdict] ?? "var(--text-2)" }}>
      {verdictLabel(verdict)}{" "}
      <span style={{ color: hit ? "var(--green)" : "var(--red)" }}>{hit ? "✓" : "✗"}</span>
    </td>
  );
}
