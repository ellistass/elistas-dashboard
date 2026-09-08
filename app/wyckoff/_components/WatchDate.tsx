"use client";
// app/wyckoff/_components/WatchDate.tsx — the date you are actually waiting for.
//
// "Later" was doing two different jobs badly. Sometimes it meant "this is not
// ready and I do not know when it will be", and sometimes it meant "this is
// ready but I am not touching it until CPI on Thursday". The card looked
// identical either way, so every morning you re-read every parked setup to work
// out which was which — and the second kind is precisely the one that should
// need no thought at all until its day arrives.
//
// A date turns that into something the list can answer for you: overdue, due
// today, or not yet. Day resolution deliberately — "waiting for Thursday" is a
// day, and storing the minute you happened to type it in would make "due today"
// depend on the hour.

import { useState } from "react";
import { CalendarClock, X } from "lucide-react";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());

/** Whole calendar days from today. Negative = the date has passed. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const now = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((t - now) / 86_400_000);
}

/** How the date reads on the card, and whether it should draw the eye. */
export function watchDateStatus(date: string | null | undefined): {
  label: string; due: boolean; overdue: boolean;
} | null {
  const n = daysUntil(date);
  if (n == null) return null;
  if (n < 0) return { label: `${-n}d overdue`, due: true, overdue: true };
  if (n === 0) return { label: "due today", due: true, overdue: false };
  if (n === 1) return { label: "tomorrow", due: false, overdue: false };
  return { label: `in ${n}d`, due: false, overdue: false };
}

export default function WatchDate({
  value,
  busy,
  onSave,
}: {
  value?: string | null;
  busy?: boolean;
  onSave: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ? value.slice(0, 10) : "");
  const status = watchDateStatus(value);

  if (open) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <input
          type="date"
          value={draft}
          min={today()}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onSave(draft || null); setOpen(false); }
            if (e.key === "Escape") setOpen(false);
          }}
          style={{
            ...mono, fontSize: 10.5, padding: "4px 7px", borderRadius: 8,
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-1)", outline: "none", colorScheme: "dark",
          }}
        />
        <button
          type="button"
          onClick={() => { onSave(draft || null); setOpen(false); }}
          style={{
            ...mono, fontSize: 10, padding: "4px 9px", borderRadius: 999, cursor: "pointer",
            border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-1)",
          }}
        >
          set
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-3)", display: "flex" }}
        >
          <X size={11} strokeWidth={2.4} />
        </button>
      </span>
    );
  }

  const color = status?.overdue ? "var(--amber)" : status?.due ? "var(--accent)" : "var(--text-3)";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button
        type="button"
        disabled={busy}
        onClick={() => { setDraft(value ? value.slice(0, 10) : ""); setOpen(true); }}
        title={
          value
            ? `Waiting until ${value.slice(0, 10)} — click to change`
            : "Set the date you plan to act on this (a CPI print, earnings, a rate decision)"
        }
        style={{
          ...mono, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10,
          padding: "4px 9px", borderRadius: 999, cursor: busy ? "default" : "pointer",
          border: `1px solid ${status?.due ? color : value ? "var(--border-strong)" : "var(--border-subtle)"}`,
          background: "transparent", color: value ? color : "var(--text-3)",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <CalendarClock size={11} strokeWidth={2} />
        {value ? `${value.slice(5, 10)} · ${status?.label}` : "set date"}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onSave(null)}
          aria-label="Clear date"
          title="Clear the date"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-3)", display: "flex" }}
        >
          <X size={10} strokeWidth={2.4} />
        </button>
      )}
    </span>
  );
}
