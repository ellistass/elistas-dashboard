"use client";
// app/_components/Rate.tsx — one way to draw a percentage, everywhere.
//
// The point is not decoration. A rate built on 14 cases and one built on 800
// were rendered identically across this app, so the page could not tell you
// which of its own numbers to believe. Here the sample size is part of the
// number rather than a footnote: always shown, and below MIN_RATE_N there is
// no percentage at all — just the count, which is all a sample of four has to
// say.
//
// Provisional rates are dimmed rather than hidden. Hiding them would mean
// deciding for the reader that an early signal is worth nothing; dimming says
// it exists and has not earned confidence yet.

import type { Rate as RateValue } from "@/lib/stats";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export function RateValueText({
  rate,
  size = 15,
  accent,
  showN = true,
}: {
  rate: RateValue;
  size?: number;
  accent?: boolean;
  showN?: boolean;
}) {
  const weak = rate.confidence !== "solid";
  return (
    <span title={rate.title} style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
      <span
        style={{
          ...mono, fontSize: size, fontWeight: 500,
          color: rate.pct == null ? "var(--text-3)" : accent ? "var(--accent)" : "var(--text-1)",
          opacity: weak ? 0.72 : 1,
        }}
      >
        {rate.label}
      </span>
      {showN && rate.n > 0 && (
        <span style={{ ...mono, fontSize: Math.max(9, size * 0.6), color: "var(--text-3)" }}>
          n={rate.n}
          {rate.confidence === "provisional" && "*"}
        </span>
      )}
    </span>
  );
}

/** Labelled tile — the shape used across the Wyckoff header and audit bands. */
export function RateStat({
  label,
  rate,
  accent,
  size = 15,
}: {
  label: string;
  rate: RateValue;
  accent?: boolean;
  size?: number;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <span style={{
        ...mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)",
      }}>
        {label}
      </span>
      <RateValueText rate={rate} accent={accent} size={size} />
    </span>
  );
}

/** The asterisk needs explaining once per surface, not per tile. */
export function ProvisionalKey({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      title="A starred rate rests on fewer than 30 cases. It is shown because an early signal is still information, and dimmed because it has not earned confidence yet."
      style={{ ...mono, fontSize: 9.5, color: "var(--text-3)" }}
    >
      * provisional
    </span>
  );
}

/** Panel-level warning when a breakdown covers a field most rows lack. */
export function CoverageNote({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <p style={{
      ...mono, fontSize: 10, lineHeight: 1.6, margin: "9px 0 0",
      color: "var(--amber)",
    }}>
      {note}
    </p>
  );
}
