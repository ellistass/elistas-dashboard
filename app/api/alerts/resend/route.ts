// app/api/alerts/resend/route.ts
// Resends the last saved alert to Telegram — no Claude call, no market data fetch
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formatTelegramAlertAI } from "@/lib/ai-scoring";
import { sendTelegramMessage } from "@/lib/telegram";
import { normalizeRanking } from "@/lib/normalize-ranking";

function currentSessionName(): string {
  const watHour = new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Lagos", hour: "2-digit", hour12: false,
  });
  const h = parseInt(watHour);
  if (h >= 8  && h < 13) return "London";
  if (h >= 15 && h < 22) return "New York";
  if (h >= 1  && h < 7)  return "Tokyo";
  return "Off-hours";
}

export async function POST() {
  try {
    // Find the most recently sent alert
    const alert = await db.dailyAlert.findFirst({
      where:   { sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
    });

    if (!alert) {
      return NextResponse.json(
        { error: "No sent alert found — run analysis and send first" },
        { status: 404 },
      );
    }

    // Reconstruct the normalised result shape formatTelegramAlertAI expects.
    // top3/bottom3 may be strings (legacy routine save) or objects (post-fix);
    // normalize defensively so Telegram message renders currency codes either way.
    const fa: any = (alert as any).fullAnalysis ?? {};
    const sourceScores = fa.scores ?? fa.allScores ?? [];
    const result = {
      top3:               normalizeRanking(alert.top3, sourceScores),
      bottom3:            normalizeRanking(alert.bottom3, sourceScores),
      pairs9:             alert.pairs9  as any[],
      ideas:              (alert as any).ideas ?? (alert.pairs9 as any[]) ?? [],
      priority1:          alert.priority1 as any,
      allScores:          sourceScores as any[],
      divergenceWarnings: fa.divergenceWarnings ?? [] as string[],
      generatedAt:        alert.createdAt,
      scoringModel:       (alert as any).scoringModel ?? "claude-ai",
      debugData:          { systemPrompt: "", userMessage: "", rawResponse: "", promptLength: 0 },
    };

    const session = currentSessionName();
    const message = formatTelegramAlertAI(result, session);
    await sendTelegramMessage(message);

    // Update sentAt to now
    await db.dailyAlert.update({
      where: { id: alert.id },
      data:  { sentAt: new Date() },
    });

    return NextResponse.json({
      ok:      true,
      session,
      pair:    (alert.priority1 as any)?.pair ?? "—",
      sentAt:  new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Resend error:", err);
    return NextResponse.json({ error: err.message || "Resend failed" }, { status: 500 });
  }
}
