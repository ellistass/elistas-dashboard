"use client";
// app/wyckoff/_components/TradedStrip.tsx — the trade that came from this read.
//
// This is the follow-up half of committing to a read. The read scores your
// chart-reading; this strip says whether you actually backed it, whether you
// backed it the way you said you would, and what it cost or made.
//
// It appears only when a fill has been linked (see lib/wyckoff/link.ts), so an
// unbacked read stays visually quiet — the absence IS the information.

import { ArrowUpRight, ArrowDownRight, TriangleAlert, ShieldCheck } from "lucide-react";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export interface LinkedTrade {
  id: string;
  ticket: number | null;
  direction: string;
  entryPrice: number | null;
  outcome: string | null;
  resultR: number | null;
  profitCcy: number | null;
  readAdherence: string | null;
  entryDriftR: number | null;
  stopWidenedR: number | null;
  ruleViolations?: string[] | null;
  behaviorFlags?: string[] | null;
}

/** The uncomfortable ones get colour; following your own plan is the baseline
 *  and does not need celebrating. */
const ADHERENCE: Record<string, { label: string; color: string; loud: boolean }> = {
  aligned: { label: "followed your read", color: "var(--text-3)", loud: false },
  contradicted: { label: "TRADED AGAINST YOUR READ", color: "var(--red)", loud: true },
  "traded-a-pass": { label: "TRADED A PASS", color: "var(--amber)", loud: true },
};

export default function TradedStrip({ trades }: { trades?: LinkedTrade[] | null }) {
  if (!trades || trades.length === 0) return null;

  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "9px 16px", display: "flex", flexDirection: "column", gap: 7 }}>
      {trades.map((t) => {
        const a = t.readAdherence ? ADHERENCE[t.readAdherence] : null;
        const open = t.outcome === "Open" || t.outcome == null;
        const r = t.resultR;
        const rColor = r == null ? "var(--text-3)" : r > 0.05 ? "var(--green)" : r < -0.05 ? "var(--red)" : "var(--text-2)";
        // Drift is only worth surfacing when it is big enough to have mattered.
        const drift: string[] = [];
        if (t.entryDriftR != null && t.entryDriftR >= 0.15) drift.push(`entry ${t.entryDriftR}R off plan`);
        if (t.stopWidenedR != null && t.stopWidenedR >= 0.15) drift.push(`stop ${t.stopWidenedR}R wider`);
        const flags = [...(t.ruleViolations ?? []), ...(t.behaviorFlags ?? [])];

        return (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-2)" }}>
              {t.direction === "Long"
                ? <ArrowUpRight size={12} strokeWidth={2} style={{ color: "var(--green)" }} />
                : <ArrowDownRight size={12} strokeWidth={2} style={{ color: "var(--red)" }} />}
              taken
              {t.ticket != null && <span style={{ color: "var(--text-3)" }}>#{t.ticket}</span>}
            </span>

            <span style={{ ...mono, fontSize: 10.5, color: rColor }}>
              {open ? "open" : r != null ? `${r > 0 ? "+" : ""}${r}R` : (t.outcome ?? "closed")}
            </span>

            {a && (
              <span
                style={{
                  ...mono, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5,
                  padding: a.loud ? "2px 8px" : 0, borderRadius: 999,
                  border: a.loud ? `1px solid ${a.color}` : "none",
                  color: a.color, letterSpacing: a.loud ? "0.04em" : undefined,
                }}
              >
                {a.loud ? <TriangleAlert size={10} strokeWidth={2.2} /> : <ShieldCheck size={10} strokeWidth={2} />}
                {a.label}
              </span>
            )}

            {drift.length > 0 && (
              <span style={{ ...mono, fontSize: 9.5, color: "var(--amber)" }}>{drift.join(" · ")}</span>
            )}

            {flags.length > 0 && (
              <span
                title={flags.join(", ")}
                style={{ ...mono, fontSize: 9.5, color: "var(--amber)", marginLeft: "auto" }}
              >
                {flags.length} rule flag{flags.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
