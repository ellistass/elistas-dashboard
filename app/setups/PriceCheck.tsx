"use client";
// app/setups/PriceCheck.tsx — type the premarket / current price, get the rule's answer.
import { useState } from "react";

const mono = { fontFamily: "'DM Mono', monospace" } as const;

export interface PriceCheckCard {
  entryKind: "open" | "limit"; // aggressive = next open, conservative = limit at the edge
  long: boolean;               // execute direction
  entry: number;
  stop: number;
  plus1R: number;
  cap: number;
  rangeLo: number;
  rangeHi: number;
}

type Verdict = { tone: "go" | "wait" | "stop"; text: string };

export function priceVerdict(c: PriceCheckCard, px: number): Verdict {
  const d = c.long ? 1 : -1;
  const past = (a: number, b: number) => d * (a - b) > 0; // a strictly beyond b in the trade direction
  const f = (x: number) => x.toFixed(2);
  if (c.entryKind === "open") {
    const edge = c.long ? c.rangeLo : c.rangeHi; // the level the spring/upthrust has to reclaim
    if (!past(px, c.stop))
      return { tone: "stop", text: `SKIP — ${f(px)} is at or beyond the stop ${f(c.stop)}. The ${c.long ? "spring" : "upthrust"} failed; cancel the market-on-open. Don't take it at a "better" price, don't move the stop.` };
    if (!past(c.plus1R, px))
      return { tone: "stop", text: `SKIP — already at or past +1R (${f(c.plus1R)}). The move happened without you.` };
    if (!past(px, edge))
      return { tone: "wait", text: `Rule allows it (still inside the stop), but price is ${c.long ? "below the range low" : "above the range high"} ${f(edge)}. Take it only if it OPENS back ${c.long ? "above" : "below"} ${f(edge)}; otherwise pass. (This edge check is a judgment overlay, not backtested.)` };
    return { tone: "go", text: `VALID — take it at the open. Re-measure 1R from your fill (stop stays ${f(c.stop)}).` };
  }
  if (!past(px, c.stop))
    return { tone: "stop", text: `CANCEL the limit — price is at or through the stop ${f(c.stop)} before filling. The break failed.` };
  if (!past(c.cap, px))
    return { tone: "stop", text: `CANCEL — price already reached the cap ${f(c.cap)}. The card is dead.` };
  if (!past(px, c.entry))
    return { tone: "go", text: `AT THE LIMIT — ${f(c.entry)} is being touched; the order fills here. Stop ${f(c.stop)}.` };
  return { tone: "wait", text: `WAIT — the limit ${f(c.entry)} is still ${f(Math.abs(px - c.entry))} away. Keep the order working.` };
}

export default function PriceCheck({ card }: { card: PriceCheckCard }) {
  const [v, setV] = useState("");
  const px = parseFloat(v);
  const out = Number.isFinite(px) ? priceVerdict(card, px) : null;
  const col = out?.tone === "go" ? "var(--green)" : out?.tone === "stop" ? "var(--red)" : "var(--amber)";
  return (
    <div style={{ ...mono, fontSize: 10, marginTop: 10, display: "grid", gap: 4 }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--text-3)" }}>
        price now / premarket
        <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder="e.g. 527.26"
          style={{ ...mono, fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-1)", width: 110 }} />
      </label>
      {out && <div style={{ color: col, lineHeight: 1.5 }}>{out.text}</div>}
    </div>
  );
}
