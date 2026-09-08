"use client";
// app/wyckoff/_components/SightingLog.tsx — every time this same box came back.
//
// The card already carried two dates: when the range was first logged, and when
// it first reached a decision point. Both are written once and never again,
// which means neither can answer the question that actually stings — "how many
// times has this exact setup, on this exact pair, been put in front of me while
// I did nothing?"
//
// A range can press its ceiling on Monday, drift for a week, print a spring,
// press again, and break out a month later. That was one setup offered five
// times, and until now the desk showed you the fifth one as though it were the
// first. Counting them is what turns "I keep missing this pair" from a feeling
// into a row of dates you can look at.
//
// Collapsed to a single chip by default. The count is the signal; the dates are
// for when you want to know how long you have been watching it happen.

import { useState } from "react";
import { History } from "lucide-react";
import { REASON_LABEL } from "./desk";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export interface Sighting {
  barDate: string;
  reason: string;
  at?: string;
}

/** Trading-ish gap between two ISO dates, for the "…and then nothing for 9
 *  days" reading. Calendar days are honest enough at this resolution. */
const gapDays = (a: string, b: string) =>
  Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

export default function SightingLog({
  sightings,
  count,
  align,
}: {
  sightings?: Sighting[] | null;
  count?: number | null;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const log = Array.isArray(sightings) ? sightings.filter((s) => s?.barDate) : [];
  const n = count ?? log.length;
  // One sighting is just "the scanner found it" — not worth a chip. The chip
  // earns its place at two, which is the first moment it is telling you
  // something the surfaced date does not.
  if (n < 2) return null;

  const newest = [...log].sort((a, b) => (a.barDate < b.barDate ? 1 : -1));
  const span = log.length >= 2 ? gapDays(log[0].barDate, log[log.length - 1].barDate) : 0;

  return (
    <div style={{ position: "relative", marginLeft: align === "right" ? "auto" : undefined }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`This range has been at a decision point on ${n} separate days${span ? ` across ${span} days` : ""} — click for the dates`}
        style={{
          ...mono, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10,
          padding: "3px 9px", borderRadius: 999, cursor: "pointer",
          border: `1px solid ${open ? "var(--accent)" : "var(--border-subtle)"}`,
          background: "transparent", color: open ? "var(--accent)" : "var(--text-3)",
        }}
      >
        <History size={10} strokeWidth={2} />
        seen {n}×
        {span > 0 && <span style={{ opacity: 0.75 }}>· {span}d</span>}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", zIndex: 30, top: "calc(100% + 5px)",
            [align === "right" ? "right" : "left"]: 0,
            minWidth: 208, maxHeight: 220, overflowY: "auto",
            padding: "8px 10px", borderRadius: 9,
            border: "1px solid var(--border-strong)", background: "var(--bg-base)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          <p style={{ ...mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", margin: "0 0 7px" }}>
            at a decision point on
          </p>
          {newest.map((s, i) => {
            const prev = newest[i + 1];
            const gap = prev ? gapDays(prev.barDate, s.barDate) : null;
            return (
              <div key={`${s.barDate}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "2.5px 0" }}>
                <span style={{ ...mono, fontSize: 10.5, color: "var(--text-1)", minWidth: 74 }}>
                  {s.barDate.slice(0, 10)}
                </span>
                <span style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}>
                  {REASON_LABEL[s.reason] ?? s.reason}
                </span>
                {gap != null && gap > 1 && (
                  <span style={{ ...mono, fontSize: 9, color: "var(--text-3)", marginLeft: "auto", opacity: 0.7 }}>
                    +{gap}d
                  </span>
                )}
              </div>
            );
          })}
          {n > log.length && (
            <p style={{ ...mono, fontSize: 9, color: "var(--text-3)", margin: "7px 0 0", lineHeight: 1.5 }}>
              {n - log.length} earlier sighting{n - log.length === 1 ? "" : "s"} trimmed — the log keeps the most recent 40.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
