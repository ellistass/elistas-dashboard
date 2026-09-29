// lib/swing/gate.ts — the pre-trade gate ("Took it" runs this first).
//
// Every check is one of the spec's rules. A BLOCK means the rule says no; a
// WARN means look again. You can still save over a block (you may already be
// in the trade at the broker) — but every failed rule is then written to the
// rule-break log automatically, so the Discipline score sees it.

import { db } from "@/lib/db";
import {
  addDays, correlated, correlationGroups, exposures, fmtPx, fmtUsd, ledger, levelMismatch, marginFor,
  monthOf, riskForGrade, riskParts, specFor, todayUtc, type Side,
} from "./core";
import { loadAccounts, loadSpecs } from "./trades";
import { eventsFor } from "./events";

export interface GateInput {
  account: string;
  instrument: string;
  side: Side;                 // execute direction
  grade: string;
  riskUsd: number;
  entryPrice: number;
  stopPrice: number;
  size?: number | null;
  cardEntry?: number | null;
  cardStop?: number | null;
  cardEntryKind?: string | null;
  samePrices?: boolean;
  /** Futures cards: true = your blind read is locked, false = not read, null = n/a. */
  readLocked?: boolean | null;
  readAgrees?: boolean | null;
}

/** The spec rule a check belongs to — also the rule-break log's "Rule" column. */
export type Rule = "Entry" | "Levels" | "Size" | "Accounts" | "Exposure" | "Monthly stop" | "House money" | "Management" | "Exits" | "Size after wins" | "Margin" | "Events" | "Read";

export interface GateCheck { rule: Rule; level: "ok" | "warn" | "block"; text: string }

export interface GateResult {
  checks: GateCheck[];
  blocked: boolean;
  /** Day before the first event inside the likely hold — becomes the trade's planned exit. */
  plannedExitDate: string | null;
  size: number;
  marginUse: number;
}

/** Rules whose failure is written to the rule-break log when you take the trade anyway. */
export const LOGGED_RULES: Rule[] = ["Levels", "Size", "Accounts", "Exposure", "Monthly stop", "House money", "Read"];

/** How far ahead an event counts as "inside the likely hold" (the time exit is 60 bars). */
export const HOLD_DAYS = 30;
const MARGIN_WARN = 0.4;

export async function runGate(g: GateInput): Promise<GateResult> {
  const checks: GateCheck[] = [];
  const add = (rule: Rule, level: GateCheck["level"], text: string) => checks.push({ rule, level, text });

  const accounts = await loadAccounts();
  const acc = accounts.find((a) => a.key === g.account);
  if (!acc) throw new Error(`unknown account "${g.account}"`);
  const specs = await loadSpecs();
  const spec = specFor(g.instrument, specs);
  const today = todayUtc();
  const month = monthOf(today);

  const trades = await (db as any).swingTrade.findMany({
    where: { account: acc.key, OR: [{ status: "open" }, { status: "closed", exitDate: { gte: `${month}-01` } }] },
  });
  const open = trades.filter((t: any) => t.status === "open");
  const withSector = (t: any) => ({ ...t, sector: specFor(t.instrument, specs).sector });
  const L = ledger(acc, trades, month);
  const R = Math.abs(g.entryPrice - g.stopPrice);
  const size = g.size && g.size > 0 ? g.size : (R > 0 ? g.riskUsd / (R * spec.valuePerPoint) : 0);

  // Accounts
  if (!acc.gradesAllowed.includes(g.grade)) add("Accounts", "block", `${acc.key} takes ${acc.gradesAllowed.join("/")}-grades only — this is a ${g.grade}`);
  else add("Accounts", "ok", `${g.grade}-grade allowed in ${acc.key}`);

  // Size
  const allowed = riskForGrade(g.grade, acc.riskPerTrade);
  if (g.riskUsd > allowed + 0.5) add("Size", "block", `risk ${fmtUsd(g.riskUsd)} is over the ${fmtUsd(allowed)} for a ${g.grade}-grade`);
  else add("Size", "ok", `risk ${fmtUsd(g.riskUsd)} (${g.grade}: ${fmtUsd(allowed)})`);

  // Monthly stop
  if (L.stopHit) add("Monthly stop", "block", `monthly stop hit (${fmtUsd(L.realised)} realised) — done until the 1st`);
  else {
    const worstAfter = L.worstCase - g.riskUsd;
    if (worstAfter < -acc.monthlyStop) add("Monthly stop", "block", `worst case after this trade ${fmtUsd(worstAfter)} breaks the ${fmtUsd(-acc.monthlyStop)} monthly stop`);
    else add("Monthly stop", "ok", `worst case after this trade ${fmtUsd(worstAfter)} of ${fmtUsd(-acc.monthlyStop)}`);
  }

  // Exposure: slots and correlation
  const mine = exposures(g.instrument, g.side, spec.sector);
  const groups: any[][] = correlationGroups(open.map(withSector));
  const joins = groups.find((grp) => grp.some((t: any) => correlated(mine, exposures(t.instrument, t.side, specFor(t.instrument, specs).sector))));
  if (joins) {
    const combined = joins.reduce((s: number, t: any) => s + riskParts(t).open, 0) + g.riskUsd;
    const loser = joins.find((t: any) => (t.rNow ?? 0) < 0);
    if (loser) add("Exposure", "block", `correlated with an open loser: ${loser.instrument} ${loser.side} (${(loser.rNow ?? 0).toFixed(2)}R)`);
    else add("Exposure", "warn", `same bet as ${joins.map((t: any) => `${t.instrument} ${t.side}`).join(", ")} — shares their slot, combined risk ${fmtUsd(combined)}`);
  } else if (L.slotsUsed >= acc.maxSlots) {
    add("Exposure", "block", `all ${acc.maxSlots} slots in ${acc.key} are in use`);
  } else add("Exposure", "ok", `slot ${L.slotsUsed + 1} of ${acc.maxSlots}`);

  // House money: only bites once there is a pot.
  if (L.housePot > 0 && g.riskUsd > L.housePot / 2) add("House money", "warn", `risk ${fmtUsd(g.riskUsd)} is more than half the house pot (${fmtUsd(L.housePot)})`);

  // Margin
  const marginOpen = open.reduce((s: number, t: any) => s + marginFor(t.size, t.entryPrice, specFor(t.instrument, specs)), 0);
  const marginUse = acc.balance > 0 ? (marginOpen + marginFor(size, g.entryPrice, spec)) / acc.balance : 0;
  add("Margin", marginUse > MARGIN_WARN ? "warn" : "ok", `margin use after this trade ${(marginUse * 100).toFixed(0)}% of ${fmtUsd(acc.balance)}${marginUse > MARGIN_WARN ? " — over 40%" : ""}`);

  // Events inside the likely hold
  const ev = (await eventsFor(g.instrument, today, addDays(today, HOLD_DAYS)))[0] ?? null;
  const plannedExitDate = ev ? addDays(ev.date, -1) : null;
  if (ev) add("Events", "warn", `${ev.type} ${ev.symbol} on ${ev.date} is inside the hold — plan to exit by ${plannedExitDate}'s close`);

  // Levels
  const mm = levelMismatch({
    entryPrice: g.entryPrice, initialStop: g.stopPrice, cardEntry: g.cardEntry ?? null, cardStop: g.cardStop ?? null,
    cardEntryKind: g.cardEntryKind ?? null, samePrices: !!g.samePrices,
  });
  if (mm) add("Levels", "warn", `${mm} — place it exactly as the card; uneasy? cut size, never widen the stop`);
  else if (g.cardStop != null) add("Levels", "ok", `levels match the card (stop ${fmtPx(g.stopPrice)})`);

  // Blind read before the setup read
  if (g.readLocked === false) add("Read", "warn", "no blind read locked on this range — read it on the desk first");
  else if (g.readAgrees === false) add("Read", "warn", "your locked read DISAGREES with this trade");

  return { checks, blocked: checks.some((c) => c.level === "block"), plannedExitDate, size, marginUse };
}
