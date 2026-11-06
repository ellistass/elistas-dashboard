"use client";
// app/setups/TrendSection.tsx — the trend slot on the Setups page (paper, half risk).
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { EmptyState, ErrorCard } from "../wyckoff/_components/ui";
import { TREND_MARKETS, CRYPTO_MARKETS, type TrendSetup } from "@/lib/setups/trendMarkets";
import PriceCheck from "./PriceCheck";
import SetupChart from "./SetupChart";
import SetupChartFull from "./SetupChartFull";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toFixed(5));

export default function TrendSection() {
  const [data, setData] = useState<{ at: string; setups: TrendSetup[]; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<TrendSetup | null>(null);
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
              <button onClick={() => setOpen(s)} title="Click to expand"
                style={{ marginTop: 10, display: "block", width: "100%", padding: 0, background: "none", border: "none", cursor: "zoom-in" }}>
                <SetupChart bars={s.bars ?? []} rangeLo={s.channelLo} rangeHi={s.channelHi} rangeStart={s.channelStart}
                  signalDate={s.signalDate} entry={s.entryRef} stop={s.stop} breakevenAt={s.breakevenAt} long={long} fmt={fmt} />
              </button>
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
      {open ? <TrendChartModal s={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** The expanded chart for a trend/crypto card: box = the 55-day channel, no cap (3×ATR trail). */
export function TrendChartModal({ s, onClose, played }: {
  s: TrendSetup; onClose: () => void;
  played?: React.ComponentProps<typeof SetupChartFull>["played"];
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const long = s.side === "long";
  return (
    <div role="dialog" aria-modal="true" aria-label={`${s.instrument} chart`} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1180px, 100%)", maxHeight: "100%", overflow: "auto", background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ ...mono, fontSize: 13 }}>
            <b style={{ fontSize: 16 }}>{s.instrument}</b>
            <span style={{ marginLeft: 10, color: long ? "var(--green)" : "var(--red)" }}>
              {long ? "BUY" : "SELL"} {s.executeSymbol} · {s.slot} slot · 55-day breakout · ½ risk
            </span>
          </div>
          <button onClick={onClose} style={{ ...mono, fontSize: 11, color: "var(--text-3)" }}>close (esc)</button>
        </div>
        <div style={{ ...mono, fontSize: 11, color: "var(--text-2)", margin: "8px 0 12px", display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>entry next open (ref {fmt(s.entryRef)})</span>
          <span style={{ color: "var(--red)" }}>stop {fmt(s.stop)} (2 × ATR)</span>
          <span style={{ color: "var(--green)" }}>+1R → BE {fmt(s.breakevenAt)}</span>
          <span style={{ color: "var(--text-3)" }}>then trail {fmt(s.trailDistance)} (3 × ATR) · no cap</span>
          <span style={{ color: "var(--text-3)" }}>signal {s.signalDate}</span>
        </div>
        <SetupChartFull instrument={s.instrument} entry="aggressive" long={long}
          rangeLo={s.channelLo} rangeHi={s.channelHi} rangeStart={s.channelStart} signalDate={s.signalDate}
          entryPrice={s.entryRef} stop={s.stop} breakevenAt={s.breakevenAt} fmt={fmt}
          note="trend slot · box = the 55-day channel the close broke · no target, 3 × ATR trail"
          played={played} />
      </div>
    </div>
  );
}
