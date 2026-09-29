"use client";
// app/setups/RiskBlock.tsx — the card's "Risk (calculated)" block, plus the
// "Info only" rates line for currency setups.
//
//   size for $100 (A) or $50 (B) · which account it belongs in · margin needed
//   and margin use after the trade (warn above 40%) · correlation against your
//   open trades · events inside the likely hold.
//
// Rates are INFO ONLY: rate differentials flipped sign between 2021–23 and
// 2023–26, so they never grade a setup. The one rates item that IS a risk flag:
// with-trend breaks straight after a central-bank decision lost −0.50R over 52
// trades.
//
// All cards share one /api/swing/context fetch.

import { useEffect, useState } from "react";
import { ShieldAlert, Landmark } from "lucide-react";
import {
  accountsForGrade, addDays, correlated, exposures, fmtUsd, fxPairFor, marginFor, riskForGrade, sizeFor, specFor,
  type InstrumentSpecCfg, type Side, type SwingAccountCfg,
} from "@/lib/swing/core";

const mono = { fontFamily: "'DM Mono', monospace" } as const;
const HOLD_DAYS = 30;       // same window the gate uses
const MARGIN_WARN = 0.4;

interface Ctx {
  today: string;
  accounts: SwingAccountCfg[];
  specs: InstrumentSpecCfg[];
  open: { account: string; instrument: string; side: string; size: number; entryPrice: number; rNow: number | null }[];
  events: { date: string; symbol: string; type: string; note: string | null }[];
  rates: { currency: string; bank: string; rate: number; previous: number | null }[];
  ratesAt: string | null;
}

let ctxPromise: Promise<Ctx | null> | null = null;
function loadCtx(): Promise<Ctx | null> {
  ctxPromise ??= fetch("/api/swing/context").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return ctxPromise;
}
/** Call after a trade is saved so the next card render sees it. */
export function invalidateRiskContext() { ctxPromise = null; }

function useCtx() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  useEffect(() => { let live = true; loadCtx().then((c) => { if (live) setCtx(c); }); return () => { live = false; }; }, []);
  return ctx;
}

export interface RiskProps {
  instrument: string;
  executeSymbol: string | null;
  side: Side;            // execute direction
  grade: "A" | "B";
  entry: number;         // execute terms
  stop: number;
  /** Futures cards: the daily context. With-trend breaks carry the rate-decision flag. */
  withTrend?: boolean;
}

export default function RiskBlock(p: RiskProps) {
  const ctx = useCtx();
  if (!ctx) return null;

  const spec = specFor(p.instrument, ctx.specs);
  const risk = riskForGrade(p.grade);
  const size = sizeFor(risk, p.entry, p.stop, spec);
  const margin = marginFor(size, p.entry, spec);
  const belongs = accountsForGrade(p.grade, ctx.accounts);

  // Margin use after the trade, per account it belongs in.
  const use = belongs.map((k) => {
    const a = ctx.accounts.find((x) => x.key === k)!;
    const openMargin = ctx.open.filter((t) => t.account === k).reduce((s, t) => s + marginFor(t.size, t.entryPrice, specFor(t.instrument, ctx.specs)), 0);
    return { k, pct: a.balance > 0 ? (openMargin + margin) / a.balance : 0 };
  });

  // Correlation with open trades.
  const mine = exposures(p.instrument, p.side, spec.sector);
  const corr = ctx.open
    .map((t) => ({ t, on: correlated(mine, exposures(t.instrument, t.side as Side, specFor(t.instrument, ctx.specs).sector)) }))
    .filter((x) => x.on);
  const loser = corr.find((x) => (x.t.rNow ?? 0) < 0);

  // Events: the instrument, what you execute, and its currencies.
  const syms = new Set<string>([p.instrument, ...(p.executeSymbol ? [p.executeSymbol] : [])]);
  const pair = fxPairFor(p.instrument);
  if (pair) syms.add(pair);
  for (const e of exposures(p.instrument, "long")) if (e.factor.startsWith("ccy:")) syms.add(e.factor.slice(4));
  const ahead = ctx.events.filter((e) => syms.has(e.symbol) && e.date >= ctx.today && e.date <= addDays(ctx.today, HOLD_DAYS));
  const recentCb = ctx.events.filter((e) => syms.has(e.symbol) && e.type === "central-bank" && e.date < ctx.today && e.date >= addDays(ctx.today, -5));

  const row = (k: string, v: React.ReactNode, tone?: string) => (
    <><span style={{ color: "var(--text-3)" }}>{k}</span><span style={{ color: tone }}>{v}</span></>
  );

  const ccys = [...syms].filter((s) => ctx.rates.some((r) => r.currency === s));

  return (
    <>
      <div style={{ ...mono, fontSize: 10.5, marginTop: 10, padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border-subtle)" }}>
        <div style={{ color: "var(--text-3)", fontSize: 9.5, marginBottom: 4 }}>RISK (CALCULATED)</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 2 }}>
          {row(`size for ${fmtUsd(risk)}`, `${size} ${spec.unit}${size === 1 ? "" : "s"}${p.grade === "B" ? " (B-grade: half size)" : ""}`)}
          {row("belongs in", belongs.length ? belongs.join(" and ") : "no account takes this grade", belongs.length ? undefined : "var(--red)")}
          {row("margin", `${fmtUsd(margin)} · use after: ${use.map((u) => `${u.k} ${(u.pct * 100).toFixed(0)}%`).join(" · ")}`,
            use.some((u) => u.pct > MARGIN_WARN) ? "var(--amber)" : undefined)}
          {row("correlation", corr.length
            ? `${loser ? "open LOSER — gate blocks: " : "same bet as "}${corr.map((x) => `${x.t.instrument} ${x.t.side} (${x.t.account})`).join(", ")}`
            : "none with open trades", loser ? "var(--red)" : corr.length ? "var(--amber)" : undefined)}
          {row("events in hold", ahead.length
            ? ahead.slice(0, 3).map((e) => `${e.type} ${e.symbol} ${e.date}`).join(" · ") + " — plan the exit"
            : "none entered for the next 30 days", ahead.length ? "var(--amber)" : undefined)}
        </div>
        {p.withTrend && recentCb.length ? (
          <div style={{ color: "var(--red)", marginTop: 4, display: "flex", gap: 5, alignItems: "center" }}>
            <ShieldAlert size={10} /> with-trend break right after {recentCb[0].symbol} central-bank decision ({recentCb[0].date}) — this lost −0.50R over 52 trades
          </div>
        ) : null}
        {spec.unit === "lot" && !pair ? <div style={{ color: "var(--text-3)", fontSize: 9.5, marginTop: 4 }}>check your broker's contract size — set it once per instrument in settings</div> : null}
      </div>

      {ccys.length ? <Rates ccys={ccys} ctx={ctx} side={p.side} pair={pair} /> : null}
    </>
  );
}

function Rates({ ccys, ctx, side, pair }: { ccys: string[]; ctx: Ctx; side: Side; pair: string | null }) {
  const info = ccys.map((c) => {
    const r = ctx.rates.find((x) => x.currency === c)!;
    const move = r.previous == null ? "" : r.rate > r.previous ? "last: hike" : r.rate < r.previous ? "last: cut" : "last: hold";
    const next = ctx.events.find((e) => e.symbol === c && e.type === "central-bank" && e.date >= ctx.today);
    return { c, r, move, next };
  });
  let carry: string | null = null;
  if (pair) {
    const b = ctx.rates.find((x) => x.currency === pair.slice(0, 3)), q = ctx.rates.find((x) => x.currency === pair.slice(3));
    if (b && q) {
      const diff = (side === "long" ? 1 : -1) * (b.rate - q.rate);
      carry = `differential for you ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}% a year (${diff >= 0 ? "swap likely earns" : "swap likely costs"} on a 20–60 day hold)`;
    }
  }
  return (
    <div style={{ ...mono, fontSize: 10, marginTop: 8, color: "var(--text-3)", lineHeight: 1.6 }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <Landmark size={10} /> <span>RATES · <i>info only — differentials flipped sign 2021–23 vs 2023–26, never graded</i></span>
      </div>
      {info.map(({ c, r, move, next }) => (
        <div key={c}>· {c} {r.rate.toFixed(2)}% ({r.bank}{move ? `, ${move}` : ""}) · next meeting {next ? next.date : "not entered"}</div>
      ))}
      {carry ? <div>· {carry}</div> : null}
    </div>
  );
}
