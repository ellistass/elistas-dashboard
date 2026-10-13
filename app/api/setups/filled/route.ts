// app/api/setups/filled/route.ts — setups after they leave /setups (lib/swing/filled.ts).
// GET → every setup of the last 120 days, played out. GET ?id= → one setup with its chart.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { filledSetups, filledChart } from "@/lib/swing/filled";

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json(await filledSetups());
    const chart = await filledChart(id);
    return chart ? NextResponse.json(chart) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
