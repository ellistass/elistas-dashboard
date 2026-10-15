// GET /api/valuation/check — how much EPS history each stock has (12+ quarters = enough).
import { NextResponse } from "next/server";
import { BASKET } from "@/lib/wyckoff/basket";
import { specClass } from "@/lib/swing/core";
import { epsFor, ETF } from "@/lib/data/eps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const out: { symbol: string; quarters: number; first: string | null; last: string | null }[] = [];
  for (const inst of BASKET) {
    if (specClass(inst.symbol) !== "stock" || ETF.has(inst.symbol)) continue;
    const q = await epsFor(inst.symbol);
    out.push({ symbol: inst.symbol, quarters: q.length, first: q[0]?.date ?? null, last: q.at(-1)?.date ?? null });
  }
  return NextResponse.json({ stocks: out.length, enoughHistory: out.filter((x) => x.quarters >= 12).length, out });
}
