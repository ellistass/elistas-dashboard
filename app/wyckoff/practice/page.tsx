"use client";
// app/wyckoff/practice/page.tsx — demo progress and backtest runs.
//
// Placeholder with a real purpose: the tab exists so the structure is complete
// and navigable, and it states plainly what is coming rather than 404ing or
// pretending to be finished. The models behind it (PracticeRun / PracticeCase)
// are deliberately NOT Trade rows — simulated fills must never reach the table
// that computes live P&L.

import { FlaskConical } from "lucide-react";
import { SectionHeader } from "../_components/ui";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

const PLANNED = [
  {
    title: "Go-live criteria",
    body: "Your own bar per account — trades, win rate, max drawdown, rule violations, read adherence — with progress against each. Turns the demo into a graduation rather than a balance you glance at.",
  },
  {
    title: "Demo equity + R curve",
    body: "Drawn from the trades the EA already syncs, filtered to accounts typed Demo, so demo results never mix into live stats. Related fix: /api/analytics currently filters by account id but never by account TYPE, so demo trades are in your live numbers today.",
  },
  {
    title: "Backtest runs",
    body: "Import the Wyckoff trainer's CSV ledger — bars stepped, springs and upthrusts at entry, volume ratio, engine verdict, outcome. Your 317-case ledger stops living in one browser's localStorage, and the same breakdowns work on practice and live side by side.",
  },
];

export default function PracticePage() {
  return (
    <>
      <SectionHeader
        icon={<FlaskConical size={13} strokeWidth={2} />}
        title="Practice"
        note="demo progress · backtest runs · kept separate from live results"
      />
      <div className="card" style={{ padding: "22px 24px", marginBottom: 30 }}>
        <p style={{ fontSize: 13, color: "var(--text-body)", margin: "0 0 18px", lineHeight: 1.6, maxWidth: 640 }}>
          Not built yet — this surface is next after the desk. Three things will live here:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {PLANNED.map((p) => (
            <div key={p.title} style={{ paddingLeft: 13, borderLeft: "2px solid var(--border-strong)" }}>
              <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{p.title}</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", lineHeight: 1.6, maxWidth: 640 }}>{p.body}</p>
            </div>
          ))}
        </div>
        <p style={{ ...mono, fontSize: 10, color: "var(--text-3)", margin: "20px 0 0" }}>
          practice data uses its own tables — simulated fills never touch the Trade table
        </p>
      </div>
    </>
  );
}
