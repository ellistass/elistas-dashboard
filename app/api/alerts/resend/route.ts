// app/api/alerts/resend/route.ts
// Resends the last saved alert to Telegram — no Claude call, no market data fetch
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formatTelegramAlertAI } from "@/lib/ai-scoring";
import { sendTelegramMessage } from "@/lib/telegram";

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

    // Reconstruct the normalised result shape formatTelegramAlertAI expects
    const result = {
      top3:               alert.top3    as any[],
      bottom3:            alert.bottom3 as any[],
      pairs9:             alert.pairs9  as any[],
      ideas:              (alert as any).ideas ?? (alert.pairs9 as any[]) ?? [],
      priority1:          alert.priority1 as any,
      allScores:          [] as any[],
      divergenceWarnings: [] as string[],
      generatedAt:        alert.createdAt,
      scoringModel:       (alert as any).scoringModel ?? "claude-ai",
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
