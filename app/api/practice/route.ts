// app/api/practice/route.ts — deliberate practice, kept apart from live money.
//
// GET  → runs + stats + breakdowns + demo accounts
// POST → import a Wyckoff trainer CSV export
//
// SEPARATION RULE: nothing here reads or writes the Trade table. Practice fills
// are simulated; letting them touch the table that computes live P&L is how a
// journal quietly stops being trustworthy. The two are compared by putting
// their numbers side by side, never by merging their rows.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseTrainerCsv, computeStats } from "@/lib/practice/trainer-csv";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const runs = await (db as any).practiceRun.findMany({
      orderBy: { importedAt: "desc" },
      include: { cases: true },
      take: 50,
    });

    const allCases = runs.flatMap((r: any) => r.cases);

    // Breakdowns chosen to answer "what do I read well", not "how much did I
    // make" — practice has no money in it, so the only useful output is which
    // structures you handle and which you do not.
    const bySetup = [
      { key: "spring at entry", cases: allCases.filter((c: any) => (c.springsAtEntry ?? 0) > 0) },
      { key: "upthrust at entry", cases: allCases.filter((c: any) => (c.upthrustsAtEntry ?? 0) > 0) },
      { key: "no test", cases: allCases.filter((c: any) => !(c.springsAtEntry ?? 0) && !(c.upthrustsAtEntry ?? 0)) },
      { key: "stopping action", cases: allCases.filter((c: any) => c.stoppingAction === true) },
    ].map((b) => ({ key: b.key, ...computeStats(b.cases) }));

    // Aided vs unaided: the trainer records which chart helpers were on. A win
    // rate that only holds up with the aids on is worth knowing about before
    // it becomes a live habit.
    const unaided = allCases.filter((c: any) => !c.aids);
    const aided = allCases.filter((c: any) => !!c.aids);

    const byEngine = ["accum", "distrib", "neutral"].map((v) => ({
      key: v,
      ...computeStats(allCases.filter((c: any) => c.engineVerdict === v)),
    }));

    // Demo accounts live in the existing Account table — type "Demo" has always
    // been a valid value, nothing ever filtered on it.
    const demoAccounts = await db.account.findMany({
      where: { type: "Demo", isActive: true },
      select: {
        id: true, name: true, broker: true, status: true, currency: true,
        startingBalance: true, currentBalance: true, currentEquity: true,
        profitTarget: true, maxDrawdownPct: true, currentDrawdownPct: true,
      },
    });

    return NextResponse.json({
      overall: computeStats(allCases),
      unaided: computeStats(unaided),
      aided: computeStats(aided),
      bySetup,
      byEngine,
      demoAccounts,
      runs: runs.map((r: any) => ({
        id: r.id,
        label: r.label,
        source: r.source,
        trainerRunId: r.trainerRunId,
        importedAt: r.importedAt,
        ...computeStats(r.cases),
      })),
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    const missing = e?.code === "P2021" || /practice_(runs|cases)/.test(msg);
    return NextResponse.json(
      {
        error: missing
          ? "The practice tables aren't in the database yet — run `npm run db:push` from elistas-dashboard, then reload."
          : msg || String(e),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { csv?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.csv || typeof body.csv !== "string") {
    return NextResponse.json({ error: "csv required" }, { status: 400 });
  }

  const parsed = parseTrainerCsv(body.csv);
  if (!parsed.cases.length) {
    return NextResponse.json(
      { error: parsed.warnings[0] ?? "no rows parsed", warnings: parsed.warnings },
      { status: 400 },
    );
  }

  try {
    // One export can span several trainer runs. Splitting them on import keeps
    // "how did run 3 go" answerable instead of collapsing everything into one
    // undifferentiated pile.
    const groups = new Map<string, typeof parsed.cases>();
    for (const c of parsed.cases) {
      const key = c.trainerRunId ?? "unassigned";
      const list = groups.get(key) ?? [];
      list.push(c);
      groups.set(key, list);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    let runsTouched = 0;
    let casesWritten = 0;

    for (const [trainerRunId, cases] of groups) {
      const isReal = trainerRunId !== "unassigned";
      const label = body.label
        ? groups.size > 1 ? `${body.label} · ${trainerRunId}` : body.label
        : isReal ? `trainer ${trainerRunId}` : `trainer import ${stamp}`;

      // Re-importing the same run must update it, not stack duplicates.
      const existing = isReal
        ? await (db as any).practiceRun.findFirst({ where: { source: "trainer", trainerRunId } })
        : null;

      const run = existing
        ? await (db as any).practiceRun.update({
            where: { id: existing.id },
            data: { importedAt: new Date(), label },
          })
        : await (db as any).practiceRun.create({
            data: { source: "trainer", trainerRunId: isReal ? trainerRunId : null, label },
          });

      runsTouched++;

      for (const c of cases) {
        const { trainerRunId: _drop, closedAt, ...rest } = c;
        const data = {
          ...rest,
          closedAt: closedAt ? new Date(closedAt) : null,
        };
        await (db as any).practiceCase.upsert({
          where: { runId_caseKey: { runId: run.id, caseKey: c.caseKey } },
          create: { ...data, runId: run.id },
          update: data,
        });
        casesWritten++;
      }
    }

    return NextResponse.json({
      ok: true,
      runsTouched,
      casesWritten,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    const missing = e?.code === "P2021" || /practice_(runs|cases)/.test(msg);
    return NextResponse.json(
      {
        error: missing
          ? "The practice tables aren't in the database yet — run `npm run db:push`, then try the import again."
          : msg || String(e),
      },
      { status: 500 },
    );
  }
}
