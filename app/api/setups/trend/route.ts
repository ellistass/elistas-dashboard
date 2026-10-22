// app/api/setups/trend/route.ts — the trend slot (55-day breakout on the trend markets).
// GET → scan (15-min cache) · GET ?fresh=1 → rescan
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { scanTrend } from "@/lib/setups/trend";

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await scanTrend(new URL(req.url).searchParams.get("fresh") === "1"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
