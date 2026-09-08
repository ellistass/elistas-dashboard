"use client";
// app/wyckoff/_components/EntryPlans.tsx — the two ways in, side by side.
//
// The card used to ask for an entry and a stop as two bare number inputs, which
// quietly made pricing the trade a separate job done somewhere else — in your
// head, or on the chart, or not at all. But a range already implies both
// entries exactly: the test and the retest. So it prices them and you pick one.
//
// Deliberately gated on a direction. Before you have chosen accum or distrib
// there is nothing honest to price, and printing "buy here" on an unread card
// would hand you the answer to the question the desk is asking. The moment you
// pick a side — which you do by pressing ACCUM or DISTRIB, before locking —
// both plans appear, and clicking one fills the entry and stop for you.

import { Check } from "lucide-react";
import type { EntryPlan } from "@/lib/wyckoff/entry";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const px = (v: number, ref: number) => v.toFixed(ref < 10 ? 4 : 2);

export default function EntryPlans({
  plans,
  chosen,
  onChoose,
  priceRef,
  compact,
}: {
  plans: EntryPlan[];
  /** The style currently selected, or matched from a locked read. */
  chosen: string | null;
  /** Omit to render read-only (after the read is locked). */
  onChoose?: (p: EntryPlan) => void;
  priceRef: number;
  compact?: boolean;
}) {
  if (!plans.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 8 }}>
      {plans.map((p) => {
        const on = chosen === p.style;
        const dim = !p.available;
        const Tag = onChoose ? "button" : "div";
        return (
          <Tag
            key={p.style}
            {...(onChoose ? { type: "button" as const, onClick: () => onChoose(p) } : {})}
            title={p.pending ? `${p.note}\n\nNot live yet: ${p.pending}` : p.note}
            style={{
              textAlign: "left", padding: "8px 10px", borderRadius: 9,
              border: `1px solid ${on ? "var(--accent)" : "var(--border-subtle)"}`,
              background: on ? "var(--accent-dim, transparent)" : "transparent",
              color: "var(--text-1)", cursor: onChoose ? "pointer" : "default",
              opacity: dim ? 0.55 : 1, width: "100%", display: "block",
              font: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
              <span style={{
                ...mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
                color: on ? "var(--accent)" : "var(--text-3)",
              }}>
                {p.style === "aggressive" ? "Aggressive" : "Conservative"}
              </span>
              {on && <Check size={10} strokeWidth={3} style={{ color: "var(--accent)" }} />}
              {p.rr != null && (
                <span style={{ ...mono, fontSize: 9.5, marginLeft: "auto", color: "var(--text-3)" }}>
                  {p.rr}R
                </span>
              )}
            </div>
            <div style={{ ...mono, fontSize: 11, color: "var(--text-1)", lineHeight: 1.5 }}>
              {px(p.entry, priceRef)}
              <span style={{ color: "var(--text-3)" }}> / </span>
              <span style={{ color: "var(--text-2)" }}>{px(p.stop, priceRef)}</span>
            </div>
            {!compact && (
              <div style={{ ...mono, fontSize: 9, color: "var(--text-3)", marginTop: 3 }}>
                {p.pending ?? p.label}
              </div>
            )}
          </Tag>
        );
      })}
    </div>
  );
}
