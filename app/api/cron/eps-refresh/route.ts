// app/api/cron/eps-refresh/route.ts — afternoon job (13:50 UTC = 14:50 Lagos, Mon–Fri):
// refresh every stock's EPS so the evening rescan only fetches bars and rescores.
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { BASKET } from "@/lib/wyckoff/basket";
import { specClass } from "@/lib/swing/core";
import { epsFor, ETF } from "@/lib/data/eps";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let ok = 0, failed = 0;
  for (const inst of BASKET) {
    if (specClass(inst.symbol) !== "stock" || ETF.has(inst.symbol)) continue;
    try { await epsFor(inst.symbol, true); ok++; } catch { failed++; }
  }
  return NextResponse.json({ ok, failed });
}
