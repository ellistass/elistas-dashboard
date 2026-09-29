// app/api/swing/gate/route.ts — run the pre-trade gate without saving anything.
// POST GateInput → GateResult (see lib/swing/gate.ts).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runGate, type GateInput } from "@/lib/swing/gate";

export async function POST(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const b = await req.json();
    const g: GateInput = {
      account: String(b.account), instrument: String(b.instrument).toUpperCase(), side: b.side === "short" ? "short" : "long",
      grade: b.grade === "B" ? "B" : "A", riskUsd: Number(b.riskUsd), entryPrice: Number(b.entryPrice), stopPrice: Number(b.stopPrice),
      size: b.size ? Number(b.size) : null, cardEntry: b.cardEntry ?? null, cardStop: b.cardStop ?? null,
      cardEntryKind: b.cardEntryKind ?? null, samePrices: !!b.samePrices, readLocked: b.readLocked ?? null, readAgrees: b.readAgrees ?? null,
    };
    if (![g.riskUsd, g.entryPrice, g.stopPrice].every((x) => Number.isFinite(x) && x > 0)) {
      return NextResponse.json({ error: "risk, entry and stop are required" }, { status: 400 });
    }
    return NextResponse.json(await runGate(g));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
