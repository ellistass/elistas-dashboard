// app/api/swing/events/route.ts — hand-entered event dates (earnings,
// deliveries, central-bank meetings) that the gate and the trade actions read.
//
// GET    ?from=&to= (default: 30 days back → 120 days ahead)
// POST   { date, symbol, type, note? }
// DELETE ?id=

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays, todayUtc } from "@/lib/swing/core";

const V = () => (db as any).tradingEvent;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const EVENT_TYPES = ["earnings", "deliveries", "central-bank", "data", "other"];

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  const q = new URL(req.url).searchParams;
  const from = isDate(q.get("from")) ? q.get("from")! : addDays(todayUtc(), -30);
  const to = isDate(q.get("to")) ? q.get("to")! : addDays(todayUtc(), 120);
  try { return NextResponse.json({ events: await V().findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: "asc" } }) }); }
  catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}

export async function POST(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try {
    const b = await req.json();
    const symbol = String(b.symbol ?? "").trim().toUpperCase();
    if (!isDate(b.date) || !symbol) return bad("date (YYYY-MM-DD) and symbol are required");
    const type = EVENT_TYPES.includes(b.type) ? b.type : "other";
    return NextResponse.json({ event: await V().create({ data: { date: b.date, symbol, type, note: b.note ? String(b.note) : null } }) });
  } catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}

export async function DELETE(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  try { await V().delete({ where: { id } }); return NextResponse.json({ ok: true }); }
  catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}
