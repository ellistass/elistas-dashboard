"use client";
// app/wyckoff/_components/WyckoffStrip.tsx — the persistent header.
//
// Two jobs, and only two:
//   1. The numbers that must never leave your sight — your accuracy vs the
//      engine's, pass rate, and how stale the data is. These used to live in a
//      big card at the top of the desk, which meant they vanished the moment
//      you scrolled to the archive.
//   2. Navigation between the five surfaces, with live counts.
//
// Data freshness earns its place here because a trader reading a chart built
// from a four-day-old bar is reading fiction. It was previously visible ONLY
// inside the transient scan note, at 10px, and disappeared on reload.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useWyckoff } from "./WyckoffData";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const pct = (c: number, n: number) => (n ? `${Math.round((c / n) * 100)}%` : "—");

const TABS = [
  { href: "/wyckoff", label: "Desk", key: "desk" },
  { href: "/wyckoff/watching", label: "Watching", key: "watching" },
  { href: "/wyckoff/archive", label: "Archive", key: "archive" },
  { href: "/wyckoff/score", label: "Score", key: "score" },
  { href: "/wyckoff/practice", label: "Practice", key: "practice" },
] as const;

/** Trading-day staleness. Weekends are not staleness — a Saturday reading of
 *  Friday's close is current, and flagging it amber every weekend would train
 *  you to ignore the warning. */
function tradingDaysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const now = new Date();
  if (Number.isNaN(then.getTime())) return null;
  let days = 0;
  const cur = new Date(then);
  while (cur < now) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) days++;
  }
  return Math.max(0, days - 1);
}

export default function WyckoffStrip() {
  const pathname = usePathname();
  const { pending, watching, resolved, score, passRate, lastScanAt, scanning, runScan, scanNote } = useWyckoff();

  const counts: Record<string, number | null> = {
    desk: pending.length,
    watching: watching.length,
    archive: resolved.length,
    score: null,
    practice: null,
  };

  const stale = tradingDaysSince(lastScanAt);
  const staleWarn = stale != null && stale >= 2;
  const prPct = passRate && passRate.total > 0 ? Math.round((passRate.pass / passRate.total) * 100) : null;

  return (
    <div
      style={{
        position: "sticky", top: 0, zIndex: 20, marginBottom: 20,
        background: "var(--bg-base)", borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {/* ── Row 1: the numbers ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", padding: "12px 0 10px" }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>Wyckoff</h1>

        <Stat label="you" value={score ? pct(score.you.correct, score.you.n) : "—"} accent />
        <Stat label="engine" value={score ? pct(score.engineSameSet.correct, score.engineSameSet.n) : "—"} />
        <Stat label="pass" value={prPct == null ? "—" : `${prPct}%`} />

        <span
          title={lastScanAt ? `scanner last wrote ${lastScanAt}` : "the scan has never run"}
          style={{
            ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5,
            padding: "4px 10px", borderRadius: 999,
            border: `1px solid ${staleWarn ? "var(--amber-border)" : "var(--border-strong)"}`,
            color: staleWarn ? "var(--amber)" : "var(--text-3)",
          }}
        >
          {staleWarn && <AlertTriangle size={11} strokeWidth={2} />}
          scanned {lastScanAt ? lastScanAt.slice(0, 10) : "never"}
          {stale != null && stale > 0 && ` · ${stale}d old`}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {scanNote && (
            <span style={{ ...mono, fontSize: 10, color: "var(--text-3)", maxWidth: 380, textAlign: "right" }}>
              {scanNote}
            </span>
          )}
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px",
              borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-on)",
              fontSize: 12.5, fontWeight: 600, cursor: scanning ? "default" : "pointer",
              opacity: scanning ? 0.6 : 1, fontFamily: "'Sora', sans-serif",
            }}
          >
            <RefreshCw size={14} strokeWidth={2} style={scanning ? { animation: "spin 1s linear infinite" } : undefined} />
            {scanning ? "Scanning…" : "Run scan"}
          </button>
        </div>
      </div>

      {/* ── Row 2: the surfaces ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, paddingBottom: 2 }}>
        {TABS.map((t) => {
          const active = t.href === "/wyckoff" ? pathname === "/wyckoff" : pathname?.startsWith(t.href);
          const n = counts[t.key];
          return (
            <Link
              key={t.href}
              href={t.href}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 14px", fontSize: 13, textDecoration: "none",
                fontWeight: active ? 600 : 400,
                color: active ? "var(--text-1)" : "var(--text-3)",
                borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
              }}
            >
              {t.label}
              {n != null && n > 0 && (
                <span style={{ ...mono, fontSize: 10, color: active ? "var(--accent)" : "var(--text-3)" }}>{n}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ ...mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>
        {label}
      </span>
      <span style={{ ...mono, fontSize: 15, fontWeight: 500, color: accent ? "var(--accent)" : "var(--text-1)" }}>
        {value}
      </span>
    </span>
  );
}
