"use client";
// app/setups/TrendSection.tsx — the trend slot on the Setups page (paper, half risk).
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { EmptyState, ErrorCard } from "../wyckoff/_components/ui";
import { TREND_MARKETS, CRYPTO_MARKETS, type TrendSetup } from "@/lib/setups/trendMarkets";
import PriceCheck from "./PriceCheck";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toFixed(5));

export default function TrendSection() {
  const [data, setData] = useState<{ at: string; setups: TrendSetup[]; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (fresh = false) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/setups/trend${fresh ? "?fresh=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...mono, fontSize: 10.5, color: "var(--text-3)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "8px 12px", lineHeight: 1.7 }}>
        <b style={{ color: "var(--text-2)" }}>Trend slot · paper · half risk · one trade at a time · never uses the 3 range slots.</b><br />
        Markets: {TREND_MARKETS.join(", ")} (trended in both 2018–21 and 2022–26). Signal: the daily close breaks the 55-day high (long) or low (short).
        Entry at the next open · stop 2 × ATR(20) · at +1R stop to breakeven, then trail 3 × ATR behind the best price · no target.
        Tested: about 1 trade a month, ~37% win, a few large winners; adds ~+0.3 R/month to the range system with ~1–2R deeper drawdown.
        <button onClick={() => load(true)} disabled={busy} style={{ ...mono, fontSize: 10.5, marginLeft: 8, display: "inline-flex", gap: 4, alignItems: "center" }}>
          <RefreshCw size={10} className={busy ? "animate-spin" : ""} /> rescan
        </button>
      </div>
      {error ? <ErrorCard message={error} /> : null}
      {(["trend", "crypto"] as const).map((slot) => {
        const list = data?.setups.filter((s) => s.slot === slot) ?? [];
        return (
          <div key={slot} style={{ display: "grid", gap: 8 }}>
            <div style={{ ...mono, fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>
              {slot === "trend"
                ? "Trend slot"
                : `Crypto slot · ${Object.keys(CRYPTO_MARKETS).join(" / ")} · paper · half risk · one crypto trade at a time · separate from the trend slot`}
            </div>
            {data && !list.length ? <EmptyState text={slot === "trend" ? "No 55-day breakout on the trend markets at the last close." : "No 55-day breakout on BTC or ETH at the last daily close (UTC)."} small /> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {list.map((s) => {
          const long = s.side === "long";
          return (
            <div key={s.instrument + s.signalDate} style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 14, background: "var(--surface-1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {long ? <TrendingUp size={14} color="var(--green)" /> : <TrendingDown size={14} color="var(--red)" />}
                <b>{s.instrument}</b><span style={{ ...mono, fontSize: 10, color: "var(--text-3)" }}>→ {s.executeSymbol}</span>
                <span style={{ ...mono, fontSize: 10, marginLeft: "auto", color: "var(--amber)" }}>PAPER · ½ risk</span>
              </div>
              <div style={{ ...mono, fontSize: 11, marginTop: 6, color: long ? "var(--green)" : "var(--red)" }}>
                {long ? "BUY" : "SELL"} {s.executeSymbol} · trend breakout · enter at the next open
              </div>
              <div style={{ ...mono, fontSize: 10.5, marginTop: 10, padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border-subtle)", lineHeight: 1.7 }}>
                <div>1. {long ? "BUY" : "SELL"} MARKET at the next open (ref close {fmt(s.close)})</div>
                <div>2. {long ? "SELL" : "BUY"} STOP at {fmt(s.stop)} (2 × ATR {fmt(s.atr)}) — re-measure from your fill</div>
                <div>3. no take-profit</div>
                <div style={{ color: "var(--text-3)" }}>· at +1R ({fmt(s.breakevenAt)}) move the stop to breakeven</div>
                <div style={{ color: "var(--text-3)" }}>· then trail the stop {fmt(s.trailDistance)} (3 × ATR) behind the best price</div>
              </div>
              <div style={{ ...mono, fontSize: 10, marginTop: 8, color: "var(--text-3)" }}>
                closed {long ? "above the 55-day high" : "below the 55-day low"} {fmt(s.channel)} on {s.signalDate} · data to {s.lastBarDate}
              </div>
              <PriceCheck card={{
                entryKind: "open", long, entry: s.entryRef, stop: s.stop, cap: long ? Number.MAX_VALUE : 0,
                plus1R: s.breakevenAt, rangeLo: s.channel, rangeHi: s.channel, symbol: s.instrument,
              }} />
            </div>
          );
        })}
      </div>
          </div>
        );
      })}
    </div>
  );
}
