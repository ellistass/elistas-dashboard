// app/api/quote/route.ts — the latest price for one basket market, including
// pre-market / after-hours for US stocks (Yahoo 1-minute bars with pre/post).
// Futures trade ~23h a day, so their "overnight" is simply the live price.
// The US stock overnight session (8pm–4am New York) is not in Yahoo's data.
//
// GET /api/quote?symbol=AMD

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { instrumentInfo } from "@/lib/wyckoff/basket";

export async function GET(req: Request) {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inst = instrumentInfo(new URL(req.url).searchParams.get("symbol") ?? "");
  if (!inst) return NextResponse.json({ error: "unknown symbol" }, { status: 400 });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.yahoo)}?interval=1m&range=1d&includePrePost=true`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }, cache: "no-store" });
    if (!r.ok) throw new Error(`yahoo ${r.status}`);
    const res = (await r.json())?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [];
    const close: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
    let k = ts.length - 1;
    while (k >= 0 && close[k] == null) k--;
    const meta = res?.meta ?? {};
    const price = k >= 0 ? close[k]! : meta.regularMarketPrice;
    const t = k >= 0 ? ts[k] : meta.regularMarketTime;
    if (price == null || t == null) throw new Error("no price");
    const tp = meta.currentTradingPeriod;
    const session = inst.assetClass !== "stock" || !tp ? "live"
      : t < tp.regular.start ? "pre-market" : t < tp.regular.end ? "regular" : t < tp.post.end ? "after-hours" : "closed";
    return NextResponse.json({
      symbol: inst.symbol, price, at: new Date(t * 1000).toISOString(), session,
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
