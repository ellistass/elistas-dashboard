// app/setups/VolLine.tsx — how volatile the market is right now. Information only;
// on indices it also explains the wider trail.
import type { VolRead } from "@/lib/swing/vol";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export default function VolLine({ v, fmt, trailAtr }: { v: VolRead | null | undefined; fmt: (x: number) => string; trailAtr?: number | null }) {
  if (!v) return null;
  const tone = v.regime === "high" ? "var(--amber)" : v.regime === "low" ? "var(--text-2)" : "var(--text-2)";
  return (
    <div style={{ ...mono, fontSize: 10.5, marginTop: 8, color: "var(--text-3)", lineHeight: 1.6 }}>
      VOLATILITY · ATR {fmt(v.atr)} ({(v.atrPct * 100).toFixed(2)}%/day) · 1R = {v.rInAtr.toFixed(1)} ATR ·{" "}
      <span style={{ color: tone }}>{v.regime} ({v.ratio.toFixed(2)}× its year)</span>
      {trailAtr ? <div>trail after +1R: {trailAtr} × ATR ≈ {fmt(trailAtr * v.atr)} behind the best (indices)</div> : null}
    </div>
  );
}
