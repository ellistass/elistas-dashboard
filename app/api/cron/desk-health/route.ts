// app/api/cron/desk-health/route.ts — the nightly "is anything wrong" pass.
//
// Two jobs that belong in one message because they are the same question asked
// of two tables: can I trust what the dashboard is telling me, and what does it
// still need from me?
//
//   • Integrity invariants (lib/integrity.ts) — the checks that would have
//     caught the clone bug, the stuck trades and the broken R values on the day
//     each started rather than weeks later.
//   • Orders needing a number (lib/order-review.ts) — the close prices and
//     stops the EA could not fill in.
//
// Telegram only when there is something to say. A cron that pings every night
// regardless is one you learn to swipe away, and then it is worth nothing on
// the night it matters.
//
// Auth: Bearer CRON_SECRET, same as /api/cron.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { runIntegrityChecks } from "@/lib/integrity";
import { reviewOrders, formatOrderReminder } from "@/lib/order-review";
import { sendTelegramMessage } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await runIntegrityChecks();
  const orders = await reviewOrders().catch(() => null);

  const blocks: string[] = [];

  // Only the checks that are actually complaining. Listing the healthy ones
  // would bury the one that is not.
  const problems = report.checks.filter((c) => c.severity !== "ok");
  if (problems.length > 0) {
    blocks.push(
      `${report.worst === "fail" ? "🔴" : "🟠"} *Data integrity — ${problems.length} issue${problems.length === 1 ? "" : "s"}*`,
      "",
      ...problems.flatMap((c) => [
        `*${c.severity === "fail" ? "FAIL" : "WARN"}* — ${c.claim}`,
        `  ${c.detail}`,
        ...(c.fix ? [`  → ${c.fix}`] : []),
        "",
      ]),
    );
  }

  const orderMsg = orders ? formatOrderReminder(orders) : null;
  if (orderMsg) blocks.push(orderMsg);

  let sent = false;
  if (blocks.length > 0) {
    try {
      await sendTelegramMessage(blocks.join("\n"));
      sent = true;
    } catch (e) {
      console.error("desk-health telegram failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    worst: report.worst,
    problems: problems.length,
    ordersOpen: orders?.open.length ?? 0,
    ordersIncomplete: orders?.incomplete.length ?? 0,
    report,
  });
}
