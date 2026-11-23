// app/api/macro/edit/route.ts — your edits from the /macro page.
//
// POST { entity, id, field, value, reason }
// Goes through applyEdit with by = "taiwo": only whitelisted fields (your fill, your stop,
// skip, notes, "this number is wrong" flags), and every change is logged old -> new so the
// next Friday run sees it in get_macro_state. Stops and outcomes set by the run can't be
// overwritten from here — use userStop / userNote.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { applyEdit } from "@/lib/macro/store";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const b = await req.json();
    if (!b?.entity || !b?.id || !b?.field) return NextResponse.json({ error: "entity, id and field are required" }, { status: 400 });
    const out = await applyEdit({ entity: b.entity, id: b.id, field: b.field, value: b.value, reason: b.reason || "edited on /macro", by: "taiwo" });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
