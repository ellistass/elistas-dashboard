// lib/integrity.ts — the checks that would have caught today's bugs on day one.
//
// Three separate times this app was confidently reporting numbers that were
// wrong by orders of magnitude, and in every case nothing complained. Each was
// found by a human going and looking:
//
//   • 9,304 duplicate scanner rows — ~785 new clones per scan for three weeks,
//     each resolving into a fresh success or failure on the monthly audit.
//   • 14 trades sitting "Open" with a close price, a close time and a P&L on
//     the row, because every consumer filters on outcome and none look at
//     closeTimeUtc.
//   • 230 R values divided by a break-even stop. Reported total R was +8,958
//     while the money said -$1,736 — opposite signs.
//
// Every one of those had a cheap invariant that would have failed the day it
// started. That is what this file is: statements that must be true about the
// data, checked on a schedule, loud when they break.
//
// Design rules, learned from the bugs above:
//   • An invariant compares two things that must agree. "Total R and total
//     money must share a sign" catches a whole class of arithmetic rot that no
//     amount of staring at one number ever would.
//   • A check reports; it never repairs. Silent self-healing is how you end up
//     with 9,304 rows nobody noticed. The repair scripts are separate, run
//     deliberately, and print what they will do first.
//   • Thresholds are set where a real system sits, not at zero. A check that
//     fires every day is a check that gets ignored.

import { db } from "./db";
import { isRTrustworthy } from "./r-trust";

export type Severity = "ok" | "warn" | "fail";

export interface Check {
  id: string;
  /** What must be true. Phrased as the assertion, not the symptom. */
  claim: string;
  severity: Severity;
  /** What is actually the case. */
  detail: string;
  /** How many rows are implicated, when that is meaningful. */
  count?: number;
  /** What to do about it — the thing that is never written down anywhere. */
  fix?: string;
}

export interface IntegrityReport {
  checkedAt: string;
  worst: Severity;
  checks: Check[];
}

const worstOf = (checks: Check[]): Severity =>
  checks.some((c) => c.severity === "fail") ? "fail"
  : checks.some((c) => c.severity === "warn") ? "warn"
  : "ok";

/** Scanner rows that are byte-identical re-detections of the same range. This
 *  is the clone bug's exact signature; it should be flatly zero. */
async function checkScannerClones(): Promise<Check> {
  const rows = await (db as any).scannerCandidate.findMany({
    select: { instrument: true, rangeStartDate: true, rangeLo: true, rangeHi: true },
  });
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.instrument}|${r.rangeStartDate.toISOString().slice(0, 10)}|${r.rangeLo}|${r.rangeHi}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const extra = [...seen.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
  return {
    id: "scanner-clones",
    claim: "No two scanner rows describe the same range on the same instrument",
    severity: extra === 0 ? "ok" : extra > 50 ? "fail" : "warn",
    detail: extra === 0
      ? `${rows.length} rows, no duplicates`
      : `${extra} duplicate row${extra === 1 ? "" : "s"} across ${rows.length} total`,
    count: extra,
    fix: extra === 0 ? undefined
      : "npx tsx --env-file=.env scripts/dedupe-candidates.mjs (dry run first). If the count grows every scan, the identity matcher is forking rows again — see lib/wyckoff/identity.ts.",
  };
}

/** A trade holding a close record is closed, whatever `outcome` says. Nothing
 *  downstream reads closeTimeUtc, so this contradiction is invisible in the UI. */
async function checkClosedButOpen(): Promise<Check> {
  const n = await db.trade.count({ where: { outcome: "Open", closeTimeUtc: { not: null } } });
  return {
    id: "closed-but-open",
    claim: 'No trade is marked "Open" while carrying a close time',
    severity: n === 0 ? "ok" : "fail",
    detail: n === 0 ? "none" : `${n} trade${n === 1 ? "" : "s"} closed but still counted as open`,
    count: n,
    fix: n === 0 ? undefined
      : "npx tsx --env-file=.env scripts/repair-stuck-open-trades.ts (dry run first).",
  };
}

/** R and money are two views of the same trades. They may differ in magnitude;
 *  they must not disagree about whether the account made money. */
async function checkRAgreesWithMoney(): Promise<Check> {
  const rows = await db.trade.findMany({
    where: { resultR: { not: null }, profitCcy: { not: null } },
    select: { resultR: true, profitCcy: true, commission: true, swap: true },
  });
  if (rows.length < 30) {
    return {
      id: "r-vs-money",
      claim: "Total R and total money agree on whether the account is up",
      severity: "ok",
      detail: `only ${rows.length} trades with both — too few to compare`,
    };
  }
  const totalR = rows.reduce((s, t) => s + (t.resultR ?? 0), 0);
  const totalMoney = rows.reduce(
    (s, t) => s + (t.profitCcy ?? 0) + (t.commission ?? 0) + (t.swap ?? 0), 0);
  const disagree = Math.sign(totalR) !== Math.sign(totalMoney) && Math.abs(totalR) > 1;
  return {
    id: "r-vs-money",
    claim: "Total R and total money agree on whether the account is up",
    severity: disagree ? "fail" : "ok",
    detail: `R ${totalR.toFixed(1)} vs money ${totalMoney.toFixed(2)} over ${rows.length} trades`
      + (disagree ? " — OPPOSITE SIGNS" : ""),
    fix: disagree
      ? "Almost certainly R values divided by a moved stop. npx tsx --env-file=.env scripts/repair-untrustworthy-r.ts"
      : undefined,
  };
}

/** Every R still on a row should be measuring a real planned risk. */
async function checkRTrust(): Promise<Check> {
  const rows = await db.trade.findMany({
    where: { resultR: { not: null } },
    select: { entryPrice: true, initialSlPrice: true, slPrice: true },
  });
  const bad = rows.filter((t) => !isRTrustworthy(t)).length;
  return {
    id: "r-trust",
    claim: "Every stored R was computed against a plausible fill stop",
    severity: bad === 0 ? "ok" : bad > 20 ? "fail" : "warn",
    detail: bad === 0
      ? `${rows.length} R values, all with a real stop`
      : `${bad} of ${rows.length} computed against a stop too tight to be the risk taken`,
    count: bad,
    fix: bad === 0 ? undefined
      : "npx tsx --env-file=.env scripts/repair-untrustworthy-r.ts (dry run first). If this keeps growing, the import guard in import-statement/route.ts is not firing.",
  };
}

/** An account whose EA has gone quiet cannot be trusted to be reporting closes. */
async function checkEaSilence(): Promise<Check> {
  const accounts = await db.account.findMany({
    where: { isActive: true },
    select: { name: true, lastSyncedAt: true },
  });
  const quiet = accounts.filter((a) => {
    if (!a.lastSyncedAt) return false;
    return Date.now() - new Date(a.lastSyncedAt).getTime() > 24 * 3_600_000;
  });
  return {
    id: "ea-silence",
    claim: "Every active account's EA has reported in the last 24h",
    severity: quiet.length === 0 ? "ok" : "warn",
    detail: quiet.length === 0
      ? `${accounts.length} active account${accounts.length === 1 ? "" : "s"}, all reporting`
      : quiet.map((a) => `${a.name} silent ${Math.floor((Date.now() - new Date(a.lastSyncedAt!).getTime()) / 86_400_000)}d`).join(" · "),
    count: quiet.length,
    fix: quiet.length === 0 ? undefined
      : "Reattach the EA on a chart for that account — reconciliation runs on attach and re-sends missed closes.",
  };
}

/** The scanner should have written something recently, or the desk is fiction. */
async function checkScanFreshness(): Promise<Check> {
  const agg = await (db as any).scannerCandidate.aggregate({ _max: { updatedAt: true } });
  const last = agg?._max?.updatedAt as Date | null;
  if (!last) {
    return { id: "scan-freshness", claim: "The scanner has run recently", severity: "warn", detail: "the scan has never run" };
  }
  // Trading days, not calendar: a Monday reading of Friday's scan is current.
  let days = 0;
  const cur = new Date(last);
  const now = new Date();
  while (cur < now) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) days++;
  }
  days = Math.max(0, days - 1);
  return {
    id: "scan-freshness",
    claim: "The scanner has written within the last 2 trading days",
    severity: days <= 1 ? "ok" : days <= 3 ? "warn" : "fail",
    detail: `last write ${last.toISOString().slice(0, 10)} (${days} trading day${days === 1 ? "" : "s"} ago)`,
    count: days,
    fix: days <= 1 ? undefined : "Run the scan from /wyckoff, or check the wyckoff-scan cron.",
  };
}

/** Run everything. One check failing must not hide the others, so each is
 *  caught individually — a report that dies on its first error is a report
 *  that tells you least exactly when something is most wrong. */
export async function runIntegrityChecks(): Promise<IntegrityReport> {
  const runners: Array<[string, () => Promise<Check>]> = [
    ["scanner-clones", checkScannerClones],
    ["closed-but-open", checkClosedButOpen],
    ["r-vs-money", checkRAgreesWithMoney],
    ["r-trust", checkRTrust],
    ["ea-silence", checkEaSilence],
    ["scan-freshness", checkScanFreshness],
  ];
  const checks: Check[] = [];
  for (const [id, run] of runners) {
    try {
      checks.push(await run());
    } catch (e) {
      checks.push({
        id,
        claim: id,
        severity: "warn",
        detail: `check failed to run: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return { checkedAt: new Date().toISOString(), worst: worstOf(checks), checks };
}
