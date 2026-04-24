"use client";
// app/journal/page.tsx
import { useState, useEffect, useRef } from "react";

interface Trade {
  id: string;
  date: string;
  pair: string;
  direction: string;
  model: string;
  grade: string;
  session: string;
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  closePrice: number | null;
  resultR: number | null;
  outcome: string;
  reason: string;
  notes: string | null;
  screenshotUrl: string | null;
  strongCcy: string;
  weakCcy: string;
  divScore: number | null;
}

const PAIRS = [
  "NZD/USD",
  "EUR/USD",
  "GBP/USD",
  "AUD/USD",
  "USD/CAD",
  "USD/JPY",
  "EUR/GBP",
  "GBP/JPY",
  "EUR/JPY",
  "AUD/JPY",
  "NZD/JPY",
  "EUR/AUD",
  "GBP/AUD",
  "CAD/JPY",
  "XAU/USD",
  "XAG/USD",
];
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF"];

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [alignment, setAlignment] = useState<string>("");

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    pair: "NZD/USD",
    direction: "Short",
    model: "A",
    grade: "A+",
    session: "New York",
    entryPrice: "",
    slPrice: "",
    tpPrice: "",
    closePrice: "",
    resultR: "",
    outcome: "Open",
    reason: "",
    notes: "",
    strongCcy: "USD",
    weakCcy: "NZD",
    divScore: "",
    screenshotUrl: "",
  });

  // Fetch alignment at entry from latest scores
  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.scores) {
          const top3 = (d.scores.top3 || []).map(
            (c: any) =>
              `${c.cur || c.currency} (${(c.score || c.total || 0).toFixed(1)})`,
          );
          const bot3 = (d.scores.bottom3 || []).map(
            (c: any) =>
              `${c.cur || c.currency} (${(c.score || c.total || 0).toFixed(1)})`,
          );
          const p1 = d.scores.priority1;
          const divText = p1
            ? ` · Priority: ${p1.pair} ${p1.direction} div ${p1.divergence?.toFixed(1)} ${p1.grade}`
            : "";
          setAlignment(
            `Strong: ${top3.join(", ")} | Weak: ${bot3.join(", ")}${divText}`,
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchTrades();
  }, []);

  async function fetchTrades() {
    const res = await fetch("/api/trades");
    const data = await res.json();
    setTrades(data.trades || []);
  }

  async function uploadScreenshot(
    file: File,
    tradeId: string,
  ): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tradeId", tradeId);
    setUploading(true);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);
    return data.url || "";
  }

  async function submitTrade(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const trade = await res.json();

      // Upload screenshot if selected
      if (fileRef.current?.files?.[0]) {
        const url = await uploadScreenshot(fileRef.current.files[0], trade.id);
        if (url) {
          await fetch("/api/trades", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: trade.id, screenshotUrl: url }),
          });
        }
      }

      setShowForm(false);
      setForm((f) => ({
        ...f,
        reason: "",
        notes: "",
        closePrice: "",
        resultR: "",
      }));
      fetchTrades();
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function closeTrade(trade: Trade, closePrice: string, outcome: string) {
    const entry = trade.entryPrice,
      sl = trade.slPrice,
      close = parseFloat(closePrice);
    const riskPips = Math.abs(entry - sl);
    const profitPips =
      trade.direction === "Short" ? entry - close : close - entry;
    const resultR = Math.round((profitPips / riskPips) * 100) / 100;
    await fetch("/api/trades", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: trade.id,
        closePrice: parseFloat(closePrice),
        outcome,
        resultR,
      }),
    });
    fetchTrades();
    setSelectedTrade(null);
  }

  const outcomeColor = (o: string) =>
    o === "Win"
      ? "text-green-700 bg-green-50"
      : o === "Loss"
        ? "text-red-700 bg-red-50"
        : o === "BE"
          ? "text-gray-500 bg-gray-100"
          : "text-blue-700 bg-blue-50";

  const gradeColor = (g: string) =>
    g === "A+"
      ? "bg-green-100 text-green-800"
      : g === "B"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-600";

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Trade Journal</h1>
          <p className="text-sm text-gray-500 mt-1">
            Log every trade with reason, screenshot, and outcome
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          + Log Trade
        </button>
      </div>

      {/* Trade form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
          <h2 className="font-semibold mb-6">New Trade Entry</h2>
          <form onSubmit={submitTrade}>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Date</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={form.date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Pair</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={form.pair}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pair: e.target.value }))
                  }
                >
                  {PAIRS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Direction
                </label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={form.direction}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, direction: e.target.value }))
                  }
                >
                  <option>Long</option>
                  <option>Short</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Model
                </label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={form.model}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, model: e.target.value }))
                  }
                >
                  <option value="A">Model A — Wyckoff trap</option>
                  <option value="B">Model B — Liquidity run</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Grade
                </label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={form.grade}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, grade: e.target.value }))
                  }
                >
                  <option>A+</option>
                  <option>B</option>
                  <option>C</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Session
                </label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={form.session}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, session: e.target.value }))
                  }
                >
                  <option>London</option>
                  <option>New York</option>
                  <option>Tokyo</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Entry Price
                </label>
                <input
                  type="number"
                  step="0.00001"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-gray-400"
                  value={form.entryPrice}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, entryPrice: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Stop Loss
                </label>
                <input
                  type="number"
                  step="0.00001"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-gray-400"
                  value={form.slPrice}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slPrice: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Take Profit
                </label>
                <input
                  type="number"
                  step="0.00001"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-gray-400"
                  value={form.tpPrice}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, tpPrice: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Strong Currency
                </label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={form.strongCcy}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, strongCcy: e.target.value }))
                  }
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Weak Currency
                </label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={form.weakCcy}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, weakCcy: e.target.value }))
                  }
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  Divergence Score
                </label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-gray-400"
                  placeholder="e.g. 15.3"
                  value={form.divScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, divScore: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Alignment at entry */}
            {alignment && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-700 font-medium mb-1">
                  📊 Alignment at entry (auto-filled from latest score)
                </p>
                <p className="text-xs text-blue-600 font-mono">{alignment}</p>
              </div>
            )}

            {/* Reason - most important field */}
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">
                Entry Reason <span className="text-red-500">*</span> — one
                sentence, be specific
              </label>
              <input
                type="text"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                placeholder="e.g. NZD weakest on fund + price, H1 upthrust at 0.5905 with falling volume, Model A confirmation candle closed at 3pm"
                value={form.reason}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reason: e.target.value }))
                }
              />
            </div>

            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">
                Notes (optional)
              </label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 min-h-16"
                placeholder="Post-trade notes, what went right/wrong, what to improve..."
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>

            {/* Screenshot upload */}
            <div className="mb-6">
              <label className="text-xs text-gray-500 mb-1 block">
                Chart Screenshot
              </label>
              <div
                className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-gray-400 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                />
                <p className="text-sm text-gray-400">
                  {uploading ? "Uploading..." : "Click or drag screenshot here"}
                </p>
                <p className="text-xs text-gray-300 mt-1">PNG, JPG supported</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save Trade"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-2.5 border border-gray-200 text-sm rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Trade list */}
      <div className="space-y-3">
        {trades.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg mb-2">No trades logged yet</p>
            <p className="text-sm">
              Click "+ Log Trade" to record your first trade
            </p>
          </div>
        )}
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors cursor-pointer"
            onClick={() =>
              setSelectedTrade(selectedTrade?.id === trade.id ? null : trade)
            }
          >
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-base">
                  {trade.pair}
                </span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${trade.direction === "Short" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}
                >
                  {trade.direction}
                </span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gradeColor(trade.grade)}`}
                >
                  {trade.grade}
                </span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  Model {trade.model}
                </span>
                <span className="text-xs text-gray-400">{trade.session}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-mono text-xs text-gray-400">Entry</p>
                  <p className="font-mono text-sm">{trade.entryPrice}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs text-gray-400">SL</p>
                  <p className="font-mono text-sm text-red-600">
                    {trade.slPrice}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs text-gray-400">TP</p>
                  <p className="font-mono text-sm text-green-600">
                    {trade.tpPrice}
                  </p>
                </div>
                {trade.resultR !== null && (
                  <div className="text-right">
                    <p className="font-mono text-xs text-gray-400">Result</p>
                    <p
                      className={`font-mono text-sm font-semibold ${trade.resultR > 0 ? "text-green-700" : "text-red-700"}`}
                    >
                      {trade.resultR > 0 ? "+" : ""}
                      {trade.resultR}R
                    </p>
                  </div>
                )}
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full ${outcomeColor(trade.outcome)}`}
                >
                  {trade.outcome}
                </span>
              </div>
            </div>

            {selectedTrade?.id === trade.id && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-sm text-gray-700 mb-3">
                  <span className="font-medium">Reason:</span> {trade.reason}
                </p>
                {trade.notes && (
                  <p className="text-sm text-gray-500 mb-3">
                    <span className="font-medium">Notes:</span> {trade.notes}
                  </p>
                )}
                {trade.screenshotUrl && (
                  <img
                    src={trade.screenshotUrl}
                    alt="Trade screenshot"
                    className="rounded-lg border border-gray-200 max-h-64 object-contain mb-3"
                  />
                )}
                {trade.outcome === "Open" && (
                  <div className="flex gap-2 flex-wrap mt-3">
                    {["Win", "Loss", "BE"].map((outcome) => (
                      <div key={outcome} className="flex gap-1">
                        <input
                          type="number"
                          step="0.00001"
                          id={`close-${outcome}-${trade.id}`}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs font-mono w-24 outline-none"
                          placeholder="Close price"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const input = document.getElementById(
                              `close-${outcome}-${trade.id}`,
                            ) as HTMLInputElement;
                            if (input.value)
                              closeTrade(trade, input.value, outcome);
                          }}
                          className={`text-xs px-3 py-1 rounded-lg font-medium ${
                            outcome === "Win"
                              ? "bg-green-600 text-white"
                              : outcome === "Loss"
                                ? "bg-red-600 text-white"
                                : "bg-gray-600 text-white"
                          }`}
                        >
                          Close {outcome}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
