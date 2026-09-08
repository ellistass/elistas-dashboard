"use client";
// app/wyckoff/_components/EngineRead.tsx — the engine's call, after yours.
//
// This number is withheld from every unread card on the desk, and there is a
// reason it stops being withheld the instant you lock: the read is immutable
// from that moment, so the only decision it can still touch is whether you
// actually take the trade — which is the decision it should be touching. You
// commit blind, then you get a second opinion while there is still time to
// size it, skip it, or wait for a better entry.
//
// Agreement is stated plainly rather than colored. Green for "we agree" would
// read as "this one is good", and two models agreeing is not evidence — it is
// two models agreeing.
//
// The verdict now arrives with its own track record on calls like this one,
// because without that it is an opinion dressed as information. On this book
// the engine hits 56% overall while a model that says "up" every time and
// thinks about nothing scores 60% — so "the engine agrees" is, on most cards,
// worth nothing at all, and the card should say so rather than let a confident
// label imply otherwise. Where it HAS an edge (distrib calls, and springs) the
// same line says that instead.

import { Cpu } from "lucide-react";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

const LABEL: Record<string, string> = {
  accum: "ACCUM", distrib: "DISTRIB", neutral: "NEUTRAL", pass: "PASS",
};

export interface EngineRecord {
  verdict: string;
  accuracyPct: number | null;
  n: number;
  basePct: number | null;
  edgePts: number | null;
  real: boolean;
}

export default function EngineRead({
  engineVerdict,
  traderVerdict,
  suspectVolume,
  record,
}: {
  engineVerdict?: string | null;
  traderVerdict: string | null;
  suspectVolume?: boolean;
  record?: EngineRecord | null;
}) {
  if (!engineVerdict || !traderVerdict) return null;

  const neutral = engineVerdict === "neutral";
  const agrees = engineVerdict === traderVerdict;
  const verdict = LABEL[engineVerdict] ?? engineVerdict.toUpperCase();

  const stance = neutral
    ? "no call — effort and result balanced across the range"
    : traderVerdict === "pass"
      ? "you passed; the engine saw a side"
      : agrees
        ? "agrees with your read"
        : "reads it the other way";

  return (
    <div
      style={{
        display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
        padding: "8px 10px", marginTop: 8, borderRadius: 9,
        border: "1px solid var(--border-subtle)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-3)" }}>
        <Cpu size={11} strokeWidth={2} />
        <span style={{ ...mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          engine
        </span>
      </span>
      <span style={{ ...mono, fontSize: 11.5, fontWeight: 500, color: neutral ? "var(--text-3)" : "var(--text-1)" }}>
        {verdict}
      </span>
      <span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>{stance}</span>
      {suspectVolume && (
        <span
          title="This instrument's volume feed is unverified, and the engine verdict is built entirely from volume. It is excluded from the scoreboard for the same reason. (Worth noting: measured on this book, suspect-volume instruments score 56% and verified ones 55% — the exclusion currently buys nothing.)"
          style={{ ...mono, fontSize: 9, marginLeft: "auto", color: "var(--amber)" }}
        >
          volume unverified — not scored
        </span>
      )}

      {/* The track record, on calls like this one. */}
      {record && record.accuracyPct != null && (
        <div style={{ flexBasis: "100%", marginTop: 6 }}>
          <span
            title={
              record.real
                ? `Measured over ${record.n} comparable calls, against what guessing that direction every time would have scored.`
                : `Measured over ${record.n} comparable calls. The difference from the base rate is smaller than the uncertainty, so there is no demonstrated edge either way.`
            }
            style={{
              ...mono, fontSize: 9.5, lineHeight: 1.6,
              color: !record.real ? "var(--text-3)"
                : (record.edgePts ?? 0) > 0 ? "var(--text-2)" : "var(--amber)",
            }}
          >
            {record.verdict} · n={record.n}
          </span>
        </div>
      )}
    </div>
  );
}
