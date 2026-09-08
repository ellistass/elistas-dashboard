// app/api/integrity/route.ts — the same invariants, on demand, for the UI.
//
// The cron (api/cron/desk-health) is what catches things while you are not
// looking. This is what answers "is it clean right now" when you are.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runIntegrityChecks } from "@/lib/integrity";
import { reviewOrders } from "@/lib/order-review";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const report = await runIntegrityChecks();
  const orders = await reviewOrders().catch(() => null);
  return NextResponse.json({ ...report, orders });
}
