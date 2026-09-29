// app/api/swing/discipline/route.ts — rule-break log, skip log, monthly score.
//
// GET    ?month=YYYY-MM → { events, score }
// POST   { kind: "break" | "skip", date?, instrument, rule, detail, tradeId?, setupRef?, costR? }
// PATCH  { id, costR?, reviewed?: boolean }
// DELETE ?id=

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthScore } from "@/lib/swing/discipline";
import { matchLogRow } from "@/lib/setups/log";
import { todayUtc } from "@/lib/swing/core";

const E = () => (db as any).disciplineEvent;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try {
    const month = new URL(req.url).searchParams.get("month") ?? todayUtc().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return bad("month must be YYYY-MM");
    const events = await E().findMany({ where: { date: { gte: `${month}-01`, lte: `${month}-31` } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    // Unreviewed breaks from earlier months stay visible until reviewed.
    const older = await E().findMany({ where: { kind: "break", reviewedAt: null, date: { lt: `${month}-01` } }, orderBy: { date: "desc" } });
    return NextResponse.json({ events: [...events, ...older], score: await monthScore(month) });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function POST(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try {
    const b = await req.json();
    const kind = b.kind === "skip" ? "skip" : b.kind === "break" ? "break" : null;
    if (!kind) return bad("kind must be break or skip");
    const instrument = String(b.instrument ?? "").trim().toUpperCase();
    const rule = String(b.rule ?? "").trim();
    if (!instrument || !rule) return bad(kind === "skip" ? "instrument and reason are required" : "instrument and rule are required");
    const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : todayUtc();
    const costR = b.costR === "" || b.costR == null ? null : Number(b.costR);
    if (costR != null && !Number.isFinite(costR)) return bad("cost must be a number of R");
    const setupLogId = b.setupRef ? await matchLogRow(b.setupRef) : null;
    const row = await E().create({
      data: { kind, date, instrument, rule, detail: String(b.detail ?? ""), tradeId: b.tradeId || null, setupLogId, costR, auto: false },
    });
    return NextResponse.json({ event: row });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function PATCH(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try {
    const b = await req.json();
    const data: Record<string, unknown> = {};
    if ("costR" in b) {
      const c = b.costR === "" || b.costR == null ? null : Number(b.costR);
      if (c != null && !Number.isFinite(c)) return bad("cost must be a number of R");
      data.costR = c;
    }
    if ("reviewed" in b) data.reviewedAt = b.reviewed ? new Date() : null;
    if ("detail" in b) data.detail = String(b.detail);
    return NextResponse.json({ event: await E().update({ where: { id: String(b.id) }, data }) });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function DELETE(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  try { await E().delete({ where: { id } }); return NextResponse.json({ ok: true }); }
  catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}
