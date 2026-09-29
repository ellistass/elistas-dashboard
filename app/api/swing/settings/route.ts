// app/api/swing/settings/route.ts — the hand-kept numbers the swing pages use.
//
// GET → { accounts, specs }   (accounts merged with the spec defaults)
// POST { kind: "account", key, name?, balance?, riskPerTrade?, monthlyStop?, monthlyTarget?, gradesAllowed?, maxSlots? }
// POST { kind: "spec", instrument, unit, valuePerPoint, marginPerUnit?, sector? }
// DELETE ?instrument=  → drop a spec override (back to the default)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_ACCOUNTS } from "@/lib/swing/core";
import { loadAccounts, loadSpecs } from "@/lib/swing/trades";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const pos = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };

export async function GET() {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try { return NextResponse.json({ accounts: await loadAccounts(), specs: await loadSpecs() }); }
  catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}

export async function POST(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  try {
    const b = await req.json();
    if (b.kind === "account") {
      const current = (await loadAccounts()).find((a) => a.key === b.key);
      if (!current) return bad(`unknown account "${b.key}" — accounts are ${DEFAULT_ACCOUNTS.map((a) => a.key).join(", ")}`);
      const grades = Array.isArray(b.gradesAllowed) ? b.gradesAllowed.filter((g: string) => g === "A" || g === "B") : current.gradesAllowed;
      const next = {
        name: b.name ? String(b.name) : current.name,
        balance: b.balance != null ? pos(b.balance) : current.balance,
        riskPerTrade: b.riskPerTrade != null ? pos(b.riskPerTrade) : current.riskPerTrade,
        monthlyStop: b.monthlyStop != null ? pos(Math.abs(Number(b.monthlyStop))) : current.monthlyStop,
        monthlyTarget: b.monthlyTarget != null ? pos(b.monthlyTarget) : current.monthlyTarget,
        gradesAllowed: grades.length ? grades : current.gradesAllowed,
        maxSlots: b.maxSlots != null ? Math.round(pos(b.maxSlots) ?? 0) || null : current.maxSlots,
      };
      if (Object.values(next).some((v) => v == null)) return bad("numbers must be positive");
      const row = await (db as any).swingAccount.upsert({ where: { key: current.key }, create: { key: current.key, ...next }, update: next });
      return NextResponse.json({ account: row });
    }
    if (b.kind === "spec") {
      const instrument = String(b.instrument ?? "").trim().toUpperCase();
      const valuePerPoint = pos(b.valuePerPoint);
      if (!instrument || !valuePerPoint) return bad("instrument and a positive value per point are required");
      const marginPerUnit = b.marginPerUnit === "" || b.marginPerUnit == null ? null : pos(b.marginPerUnit);
      if (b.marginPerUnit !== "" && b.marginPerUnit != null && marginPerUnit == null) return bad("margin per unit must be positive");
      const data = { unit: String(b.unit || "lot"), valuePerPoint, marginPerUnit, sector: b.sector ? String(b.sector).toLowerCase() : null };
      const row = await (db as any).instrumentSpec.upsert({ where: { instrument }, create: { instrument, ...data }, update: data });
      return NextResponse.json({ spec: row });
    }
    return bad("kind must be account or spec");
  } catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}

export async function DELETE(req: Request) {
  if (!(await getServerSession(authOptions))) return bad("Unauthorized", 401);
  const instrument = new URL(req.url).searchParams.get("instrument");
  if (!instrument) return bad("instrument required");
  try { await (db as any).instrumentSpec.delete({ where: { instrument } }); return NextResponse.json({ ok: true }); }
  catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}
