"use client";
// app/analysis/_components/DetailDrawer.tsx
// Right-side slide-in drawer replaying one scoring run — 3 tabs:
// Strength read / Ranked ideas / Raw response.

import { useEffect, useState } from "react";
import {
  X,
  Database,
  List,
  TrendingUp,
  TrendingDown,
  RotateCcw,
} from "lucide-react";
import {
  HistoryItem,
  AlertDetail,
  TradeIdea,
  fmtDate,
  fmtTime,
  modelShort,
  toRanked,
  gradeMeta,
} from "./types";
import { GradePill, DirArrow, SentIcon, Spinner } from "./Bits";

type Tab = "strength" | "ideas" | "response";

interface Props {
  item: HistoryItem;
  detail: AlertDetail | null;
  loading: boolean;
  rerunning: boolean;
  onRerun: () => void;
  onClose: () => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "strength", label: "Strength read" },
  { id: "ideas", label: "Ranked ideas" },
  { id: "response", label: "Raw response" },
];

export default function DetailDrawer({
  item,
  detail,
  loading,
  rerunning,
  onRerun,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("strength");

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const model = modelShort(detail?.scoringModel ?? item.scoringModel);

  // Same idea-source fallback the old page used (ideas → pairs9, minus Skips)
  const ideas: TradeIdea[] = detail
    ? ((detail.ideas?.length ? detail.ideas : (detail.pairs9 ?? [])) as TradeIdea[]).filter(
        (p: any) => p.grade !== "Skip",
      )
    : [];

  const strong = toRanked(detail?.top3);
  const weak = toRanked(detail?.bottom3);
  const maxScore = Math.max(1, ...strong.map((c) => Math.abs(c.score)), ...weak.map((c) => Math.abs(c.score)));
  const macros = detail?.macros ?? [];

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer-panel wide" role="dialog" aria-label="Scoring run detail">
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "20px 22px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div>
            <p
              className="kicker"
              style={{ margin: 0, color: "var(--accent)", letterSpacing: "0.14em" }}
            >
              Scoring run · {model}
            </p>
            <h2 style={{ margin: "5px 0 0", fontSize: 19, fontWeight: 600 }}>
              {fmtDate(item.date)} · {fmtTime(item.createdAt)} WAT
            </h2>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 7,
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: "var(--text-3)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Database size={12} strokeWidth={2} />
                data {item.dataAge != null ? `${item.dataAge}m` : "—"}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: item.sentAt ? "var(--green)" : "var(--text-3)",
                }}
              >
                <SentIcon sent={!!item.sentAt} size={12} />
                {item.sentAt ? "Sent to Telegram" : "Not sent"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <List size={12} strokeWidth={2} />
                {detail ? ideas.length : item.ideasCount} ideas
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: 8,
              background: "var(--bg-card-2)",
              border: "1px solid var(--border)",
              color: "var(--text-label)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={17} strokeWidth={2} />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "12px 22px 0",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "9px 14px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontFamily: "'Sora', sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  color: on ? "var(--accent)" : "var(--text-label)",
                  borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                  marginBottom: -1,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* ── Body ── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {loading ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <Spinner />
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12 }}>
                Loading run…
              </p>
            </div>
          ) : !detail ? (
            <p style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", padding: 30 }}>
              Could not load this run.
            </p>
          ) : (
            <>
              {/* STRENGTH READ */}
              {tab === "strength" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <StrengthCol
                      label="STRONGEST"
                      tone="green"
                      icon={<TrendingUp size={15} strokeWidth={2} />}
                      rows={strong}
                      max={maxScore}
                    />
                    <StrengthCol
                      label="WEAKEST"
                      tone="red"
                      icon={<TrendingDown size={15} strokeWidth={2} />}
                      rows={weak}
                      max={maxScore}
                    />
                  </div>

                  <div style={{ paddingTop: 16, borderTop: "1px solid var(--border-faint)" }}>
                    <p className="kicker" style={{ margin: "0 0 10px", letterSpacing: "0.14em" }}>
                      Macro snapshot at score time
                    </p>
                    {macros.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
                        No macro snapshot for this run.
                      </p>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                        {macros.map((m) => {
                          const up = m.percentChange > 0;
                          return (
                            <div
                              key={m.symbol}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                background: "var(--bg-inset)",
                                border: "1px solid var(--bg-elevated)",
                                borderRadius: 9,
                                padding: "10px 13px",
                              }}
                            >
                              <span style={{ fontSize: 12, color: "var(--text-label)" }}>
                                {m.name}
                              </span>
                              <span
                                style={{
                                  fontFamily: "'DM Mono', monospace",
                                  fontSize: 13,
                                  color: up ? "var(--green)" : "var(--red)",
                                }}
                                title={`Latest ${m.latest?.toFixed?.(2) ?? m.latest}`}
                              >
                                {up ? "+" : ""}
                                {m.percentChange.toFixed(2)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* RANKED IDEAS */}
              {tab === "ideas" &&
                (ideas.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", padding: 24 }}>
                    No trade ideas in this run
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                    {ideas.map((idea, i) => {
                      const first = i === 0;
                      return (
                        <div
                          key={`${idea.pair}-${i}`}
                          style={{
                            border: `1px solid ${first ? "rgba(58,212,236,0.3)" : "var(--border)"}`,
                            borderRadius: 12,
                            background: first ? "rgba(58,212,236,0.05)" : "var(--bg-card-raised)",
                            padding: "15px 16px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: 9,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                              <span
                                style={{
                                  fontFamily: "'DM Mono', monospace",
                                  fontSize: 10,
                                  color: "var(--text-3)",
                                }}
                              >
                                #{i + 1}
                              </span>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 7,
                                  fontFamily: "'DM Mono', monospace",
                                  fontSize: 17,
                                  fontWeight: 500,
                                  color: "var(--text-1)",
                                }}
                              >
                                <DirArrow direction={idea.direction} size={14} />
                                {idea.pair}
                              </span>
                              <GradePill grade={idea.grade} size={11} />
                            </div>
                            <span
                              style={{
                                fontFamily: "'DM Mono', monospace",
                                fontSize: 15,
                                fontWeight: 500,
                                color: "var(--accent)",
                              }}
                            >
                              {idea.divergence?.toFixed?.(1) ?? idea.divergence}σ
                            </span>
                          </div>
                          <p
                            style={{
                              margin: "0 0 10px",
                              fontSize: 12,
                              lineHeight: 1.55,
                              color: "var(--text-2)",
                              fontWeight: 300,
                            }}
                          >
                            {idea.reason}
                          </p>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 14,
                              fontFamily: "'DM Mono', monospace",
                              fontSize: 11,
                              color: "var(--text-3)",
                            }}
                          >
                            <span>
                              <span style={{ color: "var(--green)" }}>{idea.strong}</span>{" "}
                              {fmtScore(idea.strongScore)}
                            </span>
                            <span style={{ color: "var(--border-strong)" }}>vs</span>
                            <span>
                              <span style={{ color: "var(--red)" }}>{idea.weak}</span>{" "}
                              {fmtScore(idea.weakScore)}
                            </span>
                            <span style={{ marginLeft: "auto" }}>
                              {Array.isArray(idea.session) ? idea.session.join(" · ") : idea.session}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}

              {/* RAW RESPONSE */}
              {tab === "response" && (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span className="kicker" style={{ letterSpacing: "0.14em" }}>
                      Raw model response · {model}
                    </span>
                    <span
                      style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 10,
                        color: "var(--text-3)",
                      }}
                    >
                      {detail.fullAnalysis?.promptLength
                        ? `${detail.fullAnalysis.promptLength.toLocaleString()} chars in`
                        : ""}
                    </span>
                  </div>
                  {detail.fullAnalysis?.rawResponse ? (
                    <pre
                      style={{
                        margin: 0,
                        background: "#0a0c12",
                        border: "1px solid var(--bg-elevated)",
                        borderRadius: 10,
                        padding: 15,
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 11.5,
                        lineHeight: 1.6,
                        color: "var(--text-2)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflowX: "auto",
                      }}
                    >
                      {detail.fullAnalysis.rawResponse}
                    </pre>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", padding: 24 }}>
                      Raw response not saved for this run.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "16px 22px",
            borderTop: "1px solid var(--border-subtle)",
            background: "#0b0d13",
          }}
        >
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: 11,
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: "'Sora', sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-label)",
              background: "transparent",
              border: "1px solid var(--border)",
            }}
          >
            Close
          </button>
          <button
            onClick={onRerun}
            disabled={rerunning}
            style={{
              flex: 2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 11,
              borderRadius: 9,
              border: "none",
              cursor: rerunning ? "default" : "pointer",
              fontFamily: "'Sora', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent-on)",
              background: "var(--accent)",
              boxShadow: "0 0 20px rgba(58,212,236,0.26)",
              opacity: rerunning ? 0.6 : 1,
            }}
          >
            {rerunning ? <Spinner small /> : <RotateCcw size={15} strokeWidth={2} />}
            {rerunning ? "Re-running…" : "Re-run with today's data"}
          </button>
        </div>
      </aside>
    </>
  );
}

function fmtScore(n: number | undefined) {
  if (typeof n !== "number") return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}

function StrengthCol({
  label,
  tone,
  icon,
  rows,
  max,
}: {
  label: string;
  tone: "green" | "red";
  icon: React.ReactNode;
  rows: { cur: string; score: number }[];
  max: number;
}) {
  const c = tone === "green" ? "#23e0a0" : "#ff5470";
  const border = tone === "green" ? "rgba(35,224,160,0.22)" : "rgba(255,84,112,0.22)";
  const bg = tone === "green" ? "rgba(35,224,160,0.04)" : "rgba(255,84,112,0.04)";
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: bg, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
        <span style={{ color: c, display: "inline-flex" }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: c }}>{label}</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>No data</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div key={r.cur} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 15,
                  color: "var(--text-1)",
                  width: 38,
                }}
              >
                {r.cur}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: "var(--border-subtle)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.round((Math.abs(r.score) / max) * 100)}%`,
                    height: "100%",
                    background: c,
                    borderRadius: 3,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 13,
                  color: c,
                  width: 42,
                  textAlign: "right",
                }}
              >
                {fmtScore(r.score)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
