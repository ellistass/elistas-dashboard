// app/api/debug/route.ts
// Shows the exact prompt sent to Claude + raw response from the last scoring run
// Use this to verify the model being used and what data Claude receives
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { debugLog } from "@/lib/ai-scoring";

export async function GET() {
  if (!debugLog.timestamp) {
    return NextResponse.json({
      message: "No scoring run yet — hit Run Analysis on the dashboard first",
    });
  }

  return NextResponse.json({
    model:           debugLog.model,
    timestamp:       debugLog.timestamp,
    promptLength:    debugLog.userMessage.length,
    systemPrompt:    debugLog.systemPrompt,
    userMessage:     debugLog.userMessage,
    rawResponse:     debugLog.rawResponse,
  });
}
