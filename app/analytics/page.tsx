"use client";
// app/analytics/page.tsx
import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface Analytics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
  avgR: number;
  modelA: { trades: number; winRate: number };
  modelB: { trades: number; winRate: number };
  bySession: { session: string; trades: number; winRate: number }[];
  byGrade: { grade: string; trades: number; winRate: number; totalR: number }[];
}

interface Trade {
  id: string;
  date: string;
  pair: string;
  resultR: number | null;
  outcome: string;
  model: string;
  grade: string;
  session: string;
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/trades?limit=200")
      .then((r) => r.json())
      .then((d) => {
        setAnalytics(d.analytics);
        setTrades(d.trades || []);
        setLoading(false);
      });
  }, []);

  // Build equity curve
  const equityCurve = trades
    .filter((t) => t.outcome !== "Open" && t.resultR !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .reduce((acc: { trade: number; r: number; cumR: number }[], t, i) => {
      const prev = acc[i - 1]?.cumR || 0;
      acc.push({
        trade: i + 1,
        r: t.resultR!,
        cumR: Math.round((prev + t.resultR!) * 100) / 100,
      });
      return acc;
    }, []);

  if (loading)
    return (
      <div className="text-center py-20 text-gray-400 text-sm">
        Loading analytics...
      </div>
    );

  if (!analytics || analytics.totalTrades === 0) {
    return (
      <div className="max-w-5xl mx-auto text-center py-20">
        <h1 className="text-2xl font-semibold mb-3">Analytics</h1>
        <p className="text-gray-500 text-sm">
          No closed trades yet. Close some trades in the journal to see your
          statistics.
        </p>
      </div>
    );
  }

  const statCard = (
    label: string,
    value: string | number,
    sub?: string,
    color?: string,
  ) => (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">
        {label}
      </p>
      <p
        className={`text-2xl font-semibold font-mono ${color || "text-gray-900"}`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );

  const gradeColor = (g: string) =>
    g === "A+" ? "#1a6b4a" : g === "B" ? "#d4830a" : "#888";

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Strategy Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">
          RFDM performance breakdown — {analytics.totalTrades} closed trades
        </p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-3 gap-4 mb-8 md:grid-cols-6">
        {statCard(
          "Win Rate",
          `${analytics.winRate}%`,
          `${analytics.wins}W / ${analytics.losses}L`,
          analytics.winRate >= 55
            ? "text-green-700"
            : analytics.winRate >= 45
              ? "text-amber-700"
              : "text-red-700",
        )}
        {statCard(
          "Total R",
          `${analytics.totalR > 0 ? "+" : ""}${analytics.totalR}R`,
          "cumulative profit",
          analytics.totalR > 0 ? "text-green-700" : "text-red-700",
        )}
        {statCard(
          "Avg R/Trade",
          `${analytics.avgR > 0 ? "+" : ""}${analytics.avgR}R`,
          "per closed trade",
        )}
        {statCard(
          "Model A",
          `${analytics.modelA.winRate}%`,
          `${analytics.modelA.trades} trades`,
        )}
        {statCard(
          "Model B",
          `${analytics.modelB.winRate}%`,
          `${analytics.modelB.trades} trades`,
        )}
        {statCard("Trades", analytics.totalTrades, "total closed")}
      </div>

      {/* Equity curve */}
      {equityCurve.length > 1 && (
        <>
          <p className="section-label">Equity curve (R)</p>
          <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={equityCurve}>
                <XAxis
                  dataKey="trade"
                  tick={{ fontSize: 11, fill: "#888" }}
                  label={{
                    value: "Trade #",
                    position: "insideBottom",
                    offset: -2,
                    fontSize: 11,
                    fill: "#888",
                  }}
                />
                <YAxis tick={{ fontSize: 11, fill: "#888" }} />
                <Tooltip
                  formatter={(v: number) => [
                    `${v > 0 ? "+" : ""}${v}R`,
                    "Cumulative R",
                  ]}
                  labelFormatter={(l) => `Trade #${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="cumR"
                  stroke={
                    equityCurve[equityCurve.length - 1]?.cumR >= 0
                      ? "#1a6b4a"
                      : "#c0392b"
                  }
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* By session */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <p className="section-label mt-0">Win rate by session</p>
          <div className="space-y-3 mt-2">
            {analytics.bySession
              .filter((s) => s.trades > 0)
              .map((s) => (
                <div key={s.session}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700">{s.session}</span>
                    <span className="font-mono font-medium">
                      {s.winRate.toFixed(0)}%{" "}
                      <span className="text-gray-400 font-normal">
                        ({s.trades} trades)
                      </span>
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${s.winRate}%`,
                        background:
                          s.winRate >= 55
                            ? "#1a6b4a"
                            : s.winRate >= 45
                              ? "#d4830a"
                              : "#c0392b",
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* By grade */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <p className="section-label mt-0">Performance by setup grade</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={analytics.byGrade.filter((g) => g.trades > 0)}
              barSize={40}
            >
              <XAxis dataKey="grade" tick={{ fontSize: 12, fill: "#444" }} />
              <YAxis tick={{ fontSize: 11, fill: "#888" }} unit="%" />
              <Tooltip
                formatter={(v: number) => [`${v.toFixed(0)}%`, "Win rate"]}
              />
              <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                {analytics.byGrade.map((g) => (
                  <Cell key={g.grade} fill={gradeColor(g.grade)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 space-y-1">
            {analytics.byGrade
              .filter((g) => g.trades > 0)
              .map((g) => (
                <div key={g.grade} className="flex justify-between text-xs">
                  <span className="text-gray-500">
                    {g.grade} — {g.trades} trades
                  </span>
                  <span className="font-mono">
                    {g.totalR > 0 ? "+" : ""}
                    {g.totalR.toFixed(1)}R total
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Model comparison */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-8">
        <p className="section-label mt-0">Model A vs Model B</p>
        <div className="grid grid-cols-2 gap-6">
          {[
            {
              label: "Model A — Wyckoff trap",
              ...analytics.modelA,
              color: "#1a6b4a",
              desc: "Spring / upthrust entry",
            },
            {
              label: "Model B — Liquidity run",
              ...analytics.modelB,
              color: "#d4830a",
              desc: "Retest of broken structure",
            },
          ].map((m) => (
            <div key={m.label} className="text-center">
              <p className="text-sm font-medium text-gray-700 mb-1">
                {m.label}
              </p>
              <p className="text-xs text-gray-400 mb-4">{m.desc}</p>
              <p
                className="text-4xl font-mono font-semibold"
                style={{ color: m.color }}
              >
                {m.winRate}%
              </p>
              <p className="text-xs text-gray-400 mt-1">
                win rate · {m.trades} trades
              </p>
            </div>
          ))}
        </div>
        {analytics.modelA.trades > 0 && analytics.modelB.trades > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-500">
              {analytics.modelA.winRate > analytics.modelB.winRate
                ? `Model A outperforms by ${(analytics.modelA.winRate - analytics.modelB.winRate).toFixed(1)}pp — focus here`
                : analytics.modelB.winRate > analytics.modelA.winRate
                  ? `Model B outperforms by ${(analytics.modelB.winRate - analytics.modelA.winRate).toFixed(1)}pp — review Model A execution`
                  : "Both models performing equally"}
            </p>
          </div>
        )}
      </div>

      {/* Alignment quality vs outcome */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-8">
        <p className="section-label mt-0">Alignment quality vs outcome</p>
        {analytics.totalTrades < 20 ? (
          <div className="text-center py-8">
            <p className="text-gray-400 text-sm">
              Need 20+ closed trades to show alignment insights
            </p>
            <p className="text-xs text-gray-300 mt-1">
              {analytics.totalTrades} / 20 trades logged
            </p>
          </div>
        ) : (
          (() => {
            // Build alignment data from trades that have grade info
            const gradeGroups: Record<string, { wins: number; total: number }> =
              {
                "A+": { wins: 0, total: 0 },
                B: { wins: 0, total: 0 },
                C: { wins: 0, total: 0 },
              };
            trades
              .filter((t) => t.outcome !== "Open")
              .forEach((t) => {
                if (gradeGroups[t.grade]) {
                  gradeGroups[t.grade].total++;
                  if (t.outcome === "Win") gradeGroups[t.grade].wins++;
                }
              });
            const alignData = Object.entries(gradeGroups)
              .filter(([, v]) => v.total > 0)
              .map(([grade, v]) => ({
                grade,
                winRate: Math.round((v.wins / v.total) * 100),
                trades: v.total,
              }));
            return (
              <div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={alignData} barSize={50}>
                    <XAxis
                      dataKey="grade"
                      tick={{ fontSize: 12, fill: "#444" }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "#888" }} unit="%" />
                    <Tooltip formatter={(v: number) => [`${v}%`, "Win rate"]} />
                    <Bar dataKey="winRate" radius={[6, 6, 0, 0]}>
                      {alignData.map((d) => (
                        <Cell
                          key={d.grade}
                          fill={
                            d.grade === "A+"
                              ? "#1a6b4a"
                              : d.grade === "B"
                                ? "#d4830a"
                                : "#888"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 text-center mt-2">
                  Does higher alignment grade = better win rate?
                </p>
                <div className="mt-3 space-y-1">
                  {alignData.map((d) => (
                    <div key={d.grade} className="flex justify-between text-xs">
                      <span className="text-gray-500">
                        {d.grade} — {d.trades} trades
                      </span>
                      <span className="font-mono font-medium">
                        {d.winRate}% win rate
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()
        )}
      </div>

      {/* Key insights */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
        <p className="section-label mt-0">RFDM checklist — key rules</p>
        <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
          {[
            "Minimum R:R 1:2 before entry",
            "Max daily loss: 2R — stop trading",
            "A+ = full risk · B = half risk · C = watch",
            "No entries 30min after session open",
            "Wait for full H1 candle close — always",
            "Declare Model A or B before entry",
            "Setup invalid if price reclaims 50% of displacement",
            "No new entries after 7pm Lagos time",
          ].map((rule) => (
            <div key={rule} className="flex gap-2">
              <span className="text-green-600 flex-shrink-0">→</span>
              <span>{rule}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
