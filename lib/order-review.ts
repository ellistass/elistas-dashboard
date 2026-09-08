// lib/order-review.ts — which orders still need a number from you.
//
// The journal fills itself in from the EA, and where the EA cannot reach, it
// stays blank — silently. A closed trade with no close price is not an error
// anything raises; it just quietly drops out of every average it should have
// been in. 58 trades in the book have no stop recorded at all, which is why
// they can never carry an R no matter how the R code is fixed.
//
// This finds those gaps and says which number is missing on which ticket, so
// the nightly Telegram can be a to-do list rather than a status report.
//
// Deliberately narrow. It flags MISSING facts, never disagreeable ones — an
// open position that has been running three weeks is not listed here (the EA
// health check owns that), and no value is ever guessed or filled in.

import { db } from "./db";

export interface OrderGap {
  id: string;
  ticket: number | null;
  pair: string;
  /** Which numbers are absent, in the order a human would fill them. */
  missing: string[];
  openedOn: string | null;
  closedOn: string | null;
  isOpen: boolean;
}

export interface OrderReview {
  /** Positions still running — you owe these a close price when they close. */
  open: OrderGap[];
  /** Closed trades with a hole in them. */
  incomplete: OrderGap[];
  /** Trades that can never carry an R because no stop was ever recorded. */
  noStop: number;
  total: number;
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function reviewOrders(): Promise<OrderReview> {
  const rows = await db.trade.findMany({
    where: {
      OR: [
        { outcome: "Open" },
        { AND: [{ outcome: { not: "Open" } }, { closePrice: null }] },
        { AND: [{ outcome: { not: "Open" } }, { profitCcy: null }] },
      ],
    },
    select: {
      id: true, ticket: true, pair: true, outcome: true,
      entryPrice: true, closePrice: true, profitCcy: true,
      initialSlPrice: true, slPrice: true,
      openTimeUtc: true, closeTimeUtc: true, date: true,
    },
    orderBy: { date: "desc" },
    take: 60,
  });

  const gap = (t: (typeof rows)[number]): OrderGap => {
    const missing: string[] = [];
    if (!t.entryPrice) missing.push("open price");
    if (t.outcome !== "Open" && t.closePrice == null) missing.push("close price");
    if (t.outcome !== "Open" && t.profitCcy == null) missing.push("P&L");
    if (!(t.initialSlPrice || t.slPrice)) missing.push("stop");
    return {
      id: t.id,
      ticket: t.ticket,
      pair: t.pair,
      missing,
      openedOn: day(t.openTimeUtc ?? t.date),
      closedOn: day(t.closeTimeUtc),
      isOpen: t.outcome === "Open",
    };
  };

  const all = rows.map(gap);
  const noStop = await db.trade.count({
    where: { AND: [{ OR: [{ initialSlPrice: null }, { initialSlPrice: 0 }] }, { OR: [{ slPrice: 0 }, { slPrice: { equals: 0 } }] }] },
  }).catch(() => 0);

  return {
    open: all.filter((g) => g.isOpen),
    // A closed trade with nothing missing does not belong on a to-do list.
    incomplete: all.filter((g) => !g.isOpen && g.missing.length > 0),
    noStop,
    total: all.length,
  };
}

/** The Telegram body. Returns null when there is genuinely nothing to do —
 *  a reminder that arrives every night regardless is one you stop reading. */
export function formatOrderReminder(r: OrderReview): string | null {
  if (r.open.length === 0 && r.incomplete.length === 0) return null;

  const lines: string[] = ["📋 *Orders needing a number*", ""];

  if (r.open.length > 0) {
    lines.push(`*Still open — ${r.open.length}*`);
    for (const g of r.open.slice(0, 12)) {
      lines.push(
        `• ${g.pair}${g.ticket ? ` #${g.ticket}` : ""} — opened ${g.openedOn ?? "?"}` +
        (g.missing.length ? ` · missing ${g.missing.join(", ")}` : ""),
      );
    }
    lines.push("_Update the close price once these are out._", "");
  }

  if (r.incomplete.length > 0) {
    lines.push(`*Closed but incomplete — ${r.incomplete.length}*`);
    for (const g of r.incomplete.slice(0, 12)) {
      lines.push(`• ${g.pair}${g.ticket ? ` #${g.ticket}` : ""} — missing ${g.missing.join(", ")}${g.closedOn ? ` (closed ${g.closedOn})` : ""}`);
    }
    lines.push("");
  }

  lines.push("Edit them in the journal → trade drawer.");
  return lines.join("\n");
}
