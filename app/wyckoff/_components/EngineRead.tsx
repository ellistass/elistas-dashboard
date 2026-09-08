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
// two models agreeing. The engine's hit rate lives on the Score page; that is
// where you find out how much this is worth.

import { Cpu } from "lucide-react";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

const LABEL: Record<string, string> = {
  accum: "ACCUM", distrib: "DISTRIB", neutral: "NEUTRAL", pass: "PASS",
};

export default function EngineRead({
  engineVerdict,
  traderVerdict,
  suspectVolume,
}: {
  engineVerdict?: string | null;
  traderVerdict: string | null;
  suspectVolume?: boolean;
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
          title="This instrument's volume feed is unverified, and the engine verdict is built entirely from volume. It is excluded from the scoreboard for the same reason — treat it as noise, not a second opinion."
          style={{ ...mono, fontSize: 9, marginLeft: "auto", color: "var(--amber)" }}
        >
          volume unverified — not scored
        </span>
      )}
    </div>
  );
}
