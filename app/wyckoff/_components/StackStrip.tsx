"use client";
// app/wyckoff/_components/StackStrip.tsx — the whole pile, in the drawer.
//
// A pair with three overlapping boxes is not three opportunities and it is not
// clutter either. It is one area that price keeps returning to and failing to
// leave — which is a thing worth knowing BEFORE the move, and which the desk
// was actively hiding by scattering the boxes across a grid sorted by grade.
//
// So the drawer shows the stack as a stack: the boxes drawn to scale against
// each other so the overlap is visible at a glance, ordered oldest at the
// bottom the way they actually accumulated, with the one you are reading lit.
// Clicking a box loads it. The header says the thing out loud — how many times
// this area has come to a decision point, and over how long.

import { Layers, Lock, Eye } from "lucide-react";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export interface StackEntry {
  id: string;
  rangeLo: number;
  rangeHi: number;
  status: string;
  grade?: string | null;
  gradeScore?: number | null;
  rangeStartDate?: string | null;
  breakoutDate?: string | null;
  surfacedBarDate?: string | null;
  sightingCount?: number | null;
  traderVerdict?: string | null;
  watch?: string | null;
  current?: boolean;
}

const px = (v: number, ref: number) => v.toFixed(ref < 10 ? 4 : 2);

export default function StackStrip({
  stack,
  instrument,
  onSelect,
}: {
  stack: StackEntry[];
  instrument: string;
  onSelect: (id: string) => void;
}) {
  // One box is just the candidate you opened — nothing to say.
  if (!stack || stack.length < 2) return null;

  // Oldest first: the pile reads bottom-up in the order it actually formed.
  const ordered = [...stack].sort((a, b) =>
    (a.rangeStartDate ?? "").localeCompare(b.rangeStartDate ?? ""),
  );

  const lo = Math.min(...stack.map((s) => s.rangeLo));
  const hi = Math.max(...stack.map((s) => s.rangeHi));
  const span = hi - lo || 1;
  const sightings = stack.reduce((s, r) => s + (r.sightingCount ?? 0), 0);
  const dates = ordered.map((s) => s.rangeStartDate).filter(Boolean) as string[];
  const daysSpanned = dates.length >= 2
    ? Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000)
    : 0;

  return (
    <div
      style={{
        padding: "12px 14px", borderRadius: 11, marginBottom: 13,
        border: "1px solid var(--accent-border, var(--accent))",
        background: "var(--accent-dim, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 11 }}>
        <Layers size={13} strokeWidth={2} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
          {stack.length} boxes stacked on {instrument}
        </span>
        <span style={{ ...mono, fontSize: 10, color: "var(--text-2)" }}>
          {daysSpanned > 0 && `formed across ${daysSpanned} days`}
          {sightings > 1 && `${daysSpanned > 0 ? " · " : ""}${sightings} decision points`}
        </span>
      </div>

      <p style={{ ...mono, fontSize: 10, color: "var(--text-2)", margin: "0 0 12px", lineHeight: 1.6 }}>
        Price keeps returning to this area and failing to leave it. Each bar below is one
        detected range, drawn to scale — the overlap is the point.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ordered.map((s) => {
          const left = ((s.rangeLo - lo) / span) * 100;
          const width = ((s.rangeHi - s.rangeLo) / span) * 100;
          const acted = s.traderVerdict || s.watch;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => !s.current && onSelect(s.id)}
              title={
                `${px(s.rangeLo, s.rangeHi)} – ${px(s.rangeHi, s.rangeHi)}` +
                (s.rangeStartDate ? ` · from ${s.rangeStartDate}` : "") +
                (s.current ? " · you are reading this one" : " · click to load")
              }
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "5px 7px",
                borderRadius: 7, cursor: s.current ? "default" : "pointer",
                border: `1px solid ${s.current ? "var(--accent)" : "transparent"}`,
                background: s.current ? "var(--bg-card-2, transparent)" : "transparent",
                font: "inherit",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", minWidth: 68 }}>
                  {s.rangeStartDate ?? "—"}
                </span>
                <span style={{ ...mono, fontSize: 9.5, color: s.status === "open" ? "var(--accent)" : "var(--text-3)" }}>
                  {s.status === "open" ? "OPEN" : "BROKE"}
                </span>
                {s.grade && (
                  <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}>{s.grade}</span>
                )}
                {acted && (
                  <span
                    title={s.traderVerdict ? `read locked: ${s.traderVerdict}` : `watching: ${s.watch}`}
                    style={{ display: "inline-flex", color: "var(--text-2)" }}
                  >
                    {s.traderVerdict ? <Lock size={9} strokeWidth={2.4} /> : <Eye size={9} strokeWidth={2.4} />}
                  </span>
                )}
                <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)", marginLeft: "auto" }}>
                  {px(s.rangeLo, s.rangeHi)}–{px(s.rangeHi, s.rangeHi)}
                </span>
              </div>
              {/* The box itself, positioned on the shared price axis. */}
              <div style={{ position: "relative", height: 9, borderRadius: 3, background: "var(--border-subtle)" }}>
                <div
                  style={{
                    position: "absolute", top: 0, bottom: 0,
                    left: `${left}%`, width: `${Math.max(width, 1.5)}%`,
                    borderRadius: 3,
                    background: s.current ? "var(--accent)" : "var(--text-3)",
                    opacity: s.current ? 1 : 0.45,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
