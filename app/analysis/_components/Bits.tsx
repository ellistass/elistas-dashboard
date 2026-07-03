"use client";
// app/analysis/_components/Bits.tsx — small shared atoms for the history screen

import { ArrowUpRight, ArrowDownRight, Send, CircleSlash } from "lucide-react";
import { gradeMeta } from "./types";

export function GradePill({ grade, size = 12 }: { grade: string | null; size?: number }) {
  if (!grade) return <span style={{ color: "var(--text-3)" }}>—</span>;
  const g = gradeMeta(grade);
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "3px 9px",
        borderRadius: 7,
        fontFamily: "'DM Mono', monospace",
        fontSize: size,
        color: g.c,
        background: g.bg,
        border: `1px solid ${g.b}`,
      }}
    >
      {grade}
    </span>
  );
}

export function DirArrow({
  direction,
  size = 13,
}: {
  direction: "Long" | "Short" | string | null;
  size?: number;
}) {
  if (direction !== "Long" && direction !== "Short") return null;
  const long = direction === "Long";
  return (
    <span
      style={{ color: long ? "var(--green)" : "var(--red)", display: "inline-flex" }}
      title={direction}
    >
      {long ? (
        <ArrowUpRight size={size} strokeWidth={2} />
      ) : (
        <ArrowDownRight size={size} strokeWidth={2} />
      )}
    </span>
  );
}

export function SentIcon({ sent, size = 15 }: { sent: boolean; size?: number }) {
  return (
    <span
      style={{
        color: sent ? "var(--green)" : "var(--text-3)",
        display: "inline-flex",
        justifyContent: "center",
      }}
      title={sent ? "Sent to Telegram" : "Not sent"}
    >
      {sent ? (
        <Send size={size} strokeWidth={2} />
      ) : (
        <CircleSlash size={size} strokeWidth={2} />
      )}
    </span>
  );
}

export function CurrencyChips({ currencies, tone }: { currencies: string[]; tone: "green" | "red" }) {
  const c = tone === "green" ? "#23e0a0" : "#ff5470";
  const bg = tone === "green" ? "rgba(35,224,160,0.09)" : "rgba(255,84,112,0.09)";
  const border = tone === "green" ? "rgba(35,224,160,0.22)" : "rgba(255,84,112,0.22)";
  if (!currencies.length) return <span style={{ color: "var(--text-3)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
      {currencies.slice(0, 3).map((cur) => (
        <span
          key={cur}
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
            padding: "2px 7px",
            borderRadius: 6,
            color: c,
            background: bg,
            border: `1px solid ${border}`,
          }}
        >
          {cur}
        </span>
      ))}
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  const sz = small ? 12 : 16;
  return (
    <span
      style={{
        display: "inline-block",
        width: sz,
        height: sz,
        border: "2px solid rgba(255,255,255,0.15)",
        borderTopColor: "var(--accent)",
        borderRadius: "50%",
        animation: "spin 0.75s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}
