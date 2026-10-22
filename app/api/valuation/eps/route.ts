// app/api/valuation/eps/route.ts — read / fill a stock's quarterly EPS history.
//
// GET  ?symbol=AMD → the stored quarters
// POST { symbol, quarters: [{ asOf: "2024-03-30", eps: 0.07 }, …] } → upsert them
//
// Use GAAP DILUTED EPS (the same series Yahoo's daily refresh stores), split-adjusted
// to today's share count, keyed by the fiscal quarter-end date. Mixing in adjusted
// (non-GAAP) EPS would make the P/E history jump and fake a cheap/expensive reading.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

const OK_DATE = /^\d{4}-\d{2}-\d{2}$/;
const sym = (s: unknown) => String(s ?? "").trim().toUpperCase();

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const symbol = sym(new URL(req.url).searchParams.get("symbol"));
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const rows = await db.epsQuarter.findMany({ where: { symbol }, orderBy: { asOf: "asc" } });
  return NextResponse.json({ symbol, quarters: rows.map((r) => ({ asOf: r.asOf, eps: r.eps })) });
}

export async function POST(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const symbol = sym(body.symbol);
  const quarters: { asOf: string; eps: number }[] = (Array.isArray(body.quarters) ? body.quarters : [])
    .map((q: any) => ({ asOf: String(q?.asOf ?? ""), eps: Number(q?.eps) }))
    .filter((q: { asOf: string; eps: number }) => OK_DATE.test(q.asOf) && Number.isFinite(q.eps));
  if (!symbol || !quarters.length)
    return NextResponse.json({ error: "symbol and at least one quarter { asOf: YYYY-MM-DD, eps: number } required" }, { status: 400 });
  for (const q of quarters)
    await db.epsQuarter.upsert({
      where: { symbol_asOf: { symbol, asOf: q.asOf } },
      create: { symbol, asOf: q.asOf, eps: q.eps },
      update: { eps: q.eps },
    });
  const n = await db.epsQuarter.count({ where: { symbol } });
  return NextResponse.json({ symbol, saved: quarters.length, quarters: n, enough: n >= 12 });
}
