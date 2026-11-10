// lib/swing/rulesSim.ts — which filled setups the account rules would have taken.
//
// Pure: candidates in (every setup that filled, already played out by simulate()),
// one decision per candidate out. Same checks, same order, as the "Took it" gate
// (lib/swing/gate.ts), applied to each fill as it happened:
//
//   1. the card's own skip (not on FTMO, forex COT skip, 4h heavy first drop)
//   2. grade allowed in the account (50k: A only)
//   3. one trade per market
//   4. 4 losers this month → done until the 1st
//   5. monthly stop: realised hit, or the worst case after this trade breaks it
//   6. slots — range 3 (account maxSlots), trend 1, crypto 1. Only trades still at risk
//      hold a slot (stop at breakeven or better frees it). A correlated range trade shares
//      the slot of the trade it's correlated with, unless that trade is losing (block).
//
// Fills are taken in date order; same day: A before B, then the earliest seen.
// A trade that exits on a fill day still holds its slot that day (we don't know the
// intraday order). Half-risk trades (trend, crypto) count half in the month maths.

import { correlated, correlationGroups, exposures, specFor, type InstrumentSpecCfg, type Side, type SwingAccountCfg } from "./core";

export const MAX_LOSERS_PER_MONTH = 4;   // same value as gate.ts (kept here so this stays pure)

export type RuleSlot = "range" | "trend" | "crypto";
export interface RuleCall { taken: boolean; slot: RuleSlot; reason: string | null }

export interface RuleCand {
  id: string;
  slot: RuleSlot;
  instrument: string;
  side: Side;                                    // EXECUTE direction (for correlation)
  grade: string;
  firstBarDate: string;
  fillDate: string;
  fillPrice: number;
  origStop: number;
  seriesLong: boolean;                           // direction in the series' prices (for stops/closes)
  exitDate: string | null;
  resultR: number | null;
  stops: { date: string; stop: number }[];       // stop in force each bar (simulate)
  closes: { date: string; c: number }[];         // closes from the fill on (for "is it losing")
  weight: number;                                // 1 = full risk, 0.5 = trend / crypto
  cardSkip: string | null;                       // the card itself says skip / cancel
}

export function applyRules(cands: RuleCand[], acc: SwingAccountCfg, specs: InstrumentSpecCfg[] = []): Map<string, RuleCall> {
  const out = new Map<string, RuleCall>();
  const taken: RuleCand[] = [];
  const stopR = acc.riskPerTrade > 0 ? acc.monthlyStop / acc.riskPerTrade : 5;
  const cap: Record<RuleSlot, number> = { range: acc.maxSlots, trend: 1, crypto: 1 };
  const order = [...cands].sort((a, b) =>
    a.fillDate.localeCompare(b.fillDate)
    || (a.grade === "A" ? 0 : 1) - (b.grade === "A" ? 0 : 1)
    || a.firstBarDate.localeCompare(b.firstBarDate)
    || a.instrument.localeCompare(b.instrument));

  const dir = (c: RuleCand) => (c.seriesLong ? 1 : -1);
  const R = (c: RuleCand) => Math.abs(c.fillPrice - c.origStop) || 1e-9;
  const stopOn = (c: RuleCand, day: string) => {
    let s = c.origStop;
    for (const p of c.stops) { if (p.date > day) break; s = p.stop; }
    return s;
  };
  const rAtStop = (c: RuleCand, day: string) => (dir(c) * (stopOn(c, day) - c.fillPrice)) / R(c);
  const markR = (c: RuleCand, day: string) => {
    let px: number | null = null;
    for (const b of c.closes) { if (b.date >= day) break; px = b.c; }
    return px == null ? 0 : (dir(c) * (px - c.fillPrice)) / R(c);
  };
  const sector = (t: RuleCand) => specFor(t.instrument, specs).sector;
  const ex = (t: RuleCand) => exposures(t.instrument, t.side, sector(t));

  for (const c of order) {
    const day = c.fillDate, month = day.slice(0, 7);
    const skip = (reason: string) => out.set(c.id, { taken: false, slot: c.slot, reason });

    if (c.cardSkip) { skip(c.cardSkip); continue; }
    if (c.slot === "range" && !acc.gradesAllowed.includes(c.grade)) { skip(`grade ${c.grade} — ${acc.key} takes ${acc.gradesAllowed.join("/")} only`); continue; }

    const open = taken.filter((t) => t.fillDate <= day && (t.exitDate == null || t.exitDate >= day));
    if (open.some((t) => t.instrument === c.instrument)) { skip(`already in ${c.instrument}`); continue; }

    const closedThisMonth = taken.filter((t) => t.exitDate != null && t.exitDate.startsWith(month) && t.exitDate < day);
    const losers = closedThisMonth.filter((t) => (t.resultR ?? 0) < -0.05).length;
    if (losers >= MAX_LOSERS_PER_MONTH) { skip(`${losers} losers this month — done until the 1st`); continue; }

    const realised = closedThisMonth.reduce((s, t) => s + (t.resultR ?? 0) * t.weight, 0);
    if (realised <= -stopR) { skip(`monthly stop hit (${realised.toFixed(1)}R realised)`); continue; }
    const openRisk = open.reduce((s, t) => s + Math.max(0, -rAtStop(t, day)) * t.weight, 0);
    const locked = open.reduce((s, t) => s + Math.max(0, rAtStop(t, day)) * t.weight, 0);
    const worstAfter = realised - openRisk + locked - c.weight;
    if (worstAfter < -stopR) { skip(`worst case after it ${worstAfter.toFixed(1)}R breaks the −${stopR}R monthly stop`); continue; }

    // One trade per currency direction (Nov 2026 test: max DD −8.8R → −7.7R for −2R over 8 years):
    // never twice in the same currency bet (GBPJPY long + CHFJPY long = short JPY twice).
    const sameCcy = (() => {
      // A trade that closes on this fill day doesn't block it (daily bars can't order the two; the stop usually came first).
      for (const t of open.filter((o) => o.exitDate == null || o.exitDate > day)) for (const x of ex(c)) for (const y of ex(t))
        if (x.factor.startsWith("ccy:") && x.factor === y.factor && x.sign === y.sign) return { t, ccy: x.factor.slice(4), sign: x.sign };
      return null;
    })();
    if (sameCcy) { skip(`already ${sameCcy.sign > 0 ? "long" : "short"} ${sameCcy.ccy} (${sameCcy.t.instrument}) — one trade per currency direction`); continue; }

    const atRisk = open.filter((t) => t.slot === c.slot && rAtStop(t, day) < -0.01);
    const join = c.slot === "range" ? atRisk.filter((t) => correlated(ex(c), ex(t))) : [];
    if (join.length) {
      const loser = join.find((t) => markR(t, day) < 0);
      if (loser) { skip(`correlated with an open loser: ${loser.instrument} ${loser.side}`); continue; }
    } else {
      const used = c.slot === "range" ? correlationGroups(atRisk.map((t) => ({ ...t, sector: sector(t) }))).length : atRisk.length;
      if (used >= cap[c.slot]) { skip(`all ${cap[c.slot]} ${c.slot} slot${cap[c.slot] > 1 ? "s" : ""} in use`); continue; }
    }
    taken.push(c);
    out.set(c.id, { taken: true, slot: c.slot, reason: join.length ? `shares a slot with ${join[0].instrument} (correlated)` : null });
  }
  return out;
}
