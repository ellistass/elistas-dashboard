// app/api/macro/route.ts — the weekly macro run for the /macro page.
//
// GET              → latest finished live run, plus the run list, positions and record
// GET ?run=<id>    → that run instead
//
// Read-only. Claude writes runs through the MCP tools; your edits go through /api/macro/edit.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRunView } from "@/lib/macro/store";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const run = new URL(req.url).searchParams.get("run") ?? undefined;
    return NextResponse.json(await getRunView(run));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
