"use client";
// app/analysis/page.tsx — Paginated analysis history + run new analysis

import React, { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryItem {
  id: string;
  date: string;
  createdAt: string;
  sentAt: string | null;
  scoringModel: string | null;
  dataAge: number | null;
  priorityPair: string | null;
  priorityGrade: string | null;
  divergence: number | null;
  top3: string[];
  bottom3: string[];
  ideasCount: number;
}
interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface TradeIdea {
  pair: string;
  direction: string;
  strong: string;
  weak: string;
  divergence: number;
  grade: string;
  session: string[];
  reason: string;
  timeframe?: string;
  pricedInRisk?: boolean;
  confidence?: string;
  strongScore: number;
  weakScore: number;
}
interface AlertDetail {
  id: string;
  date: string;
  createdAt: string;
  scoringModel: string | null;
  dataAge: number | null;
  top3: any[];
  bottom3: any[];
  priority1: any;
  ideas: TradeIdea[] | null;
  pairs9: any[];
  fullAnalysis: {
    systemPrompt: string;
    userMessage: string;
    rawResponse: string;
    promptLength: number;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function GradePill({ grade }: { grade: string }) {
  const s: Record<string, { bg: string; color: string }> = {
    "A+": { bg: "var(--green-dim)", color: "var(--green)" },
    B: { bg: "var(--amber-dim)", color: "var(--amber)" },
    C: { bg: "var(--bg-elevated)", color: "var(--text-3)" },
  };
  const st = s[grade] ?? s.C;
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 20,
        fontWeight: 600,
        background: st.bg,
        color: st.color,
      }}
    >
      {grade}
    </span>
  );
}

function Spinner({ small }: { small?: boolean }) {
  const sz = small ? 12 : 16;
  return (
    <span
      style={{
        display: "inline-block",
        width: sz,
        height: sz,
        border: `2px solid rgba(255,255,255,0.15)`,
        borderTopColor: "var(--green)",
        borderRadius: "50%",
        animation: "spin 0.75s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        color: copied ? "var(--green)" : "var(--text-3)",
        fontSize: 10,
        cursor: "pointer",
      }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  // Run analysis state
  const [scoring, setScoring] = useState(false);
  const [runStatus, setRunStatus] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [sent, setSent] = useState(false);

  // History list state
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    pages: 1,
  });
  const [listLoading, setListLoading] = useState(true);

  // Detail panel state
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [promptTab, setPromptTab] = useState<
    "ideas" | "context" | "data" | "response" | "system"
  >("ideas");

  // ── Load list ──────────────────────────────────────────────────────────────
  const loadList = useCallback(async (page = 1) => {
    setListLoading(true);
    try {
      const res = await fetch(`/api/alerts/history?page=${page}&limit=20`);
      if (res.ok) {
        const j = await res.json();
        setItems(j.items);
        setPagination(j.pagination);
      }
    } catch (e) {
      console.error(e);
    }
    setListLoading(false);
  }, []);

  useEffect(() => {
    loadList(1);
  }, [loadList]);

  // ── Load detail ────────────────────────────────────────────────────────────
  async function selectItem(id: string) {
    if (selected === id) {
      setSelected(null);
      setDetail(null);
      return;
    }
    setSelected(id);
    setDetail(null);
    setDetailLoading(true);
    setPromptTab("ideas");
    try {
      const res = await fetch(`/api/alerts/${id}`);
      if (res.ok) setDetail(await res.json());
    } catch (e) {
      console.error(e);
    }
    setDetailLoading(false);
  }

  // ── Run analysis ───────────────────────────────────────────────────────────
  async function runAnalysis(sendAlert = false) {
    setScoring(true);
    setRunStatus(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto", sendAlert }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRunStatus({ ok: false, msg: json.error || "Scoring failed" });
      } else {
        setRunStatus({
          ok: true,
          msg: `Scored · ${json.scoringModel ?? "claude-ai"} · ${(json.fetchErrors?.length ?? 0) > 0 ? json.fetchErrors.length + " warnings" : "clean"}`,
        });
        if (sendAlert) setSent(true);
        // Reload list and auto-select the new record
        await loadList(1);
        // The new record will be first — select it after a tick
        setTimeout(async () => {
          const r2 = await fetch("/api/alerts/history?page=1&limit=1");
          if (r2.ok) {
            const j2 = await r2.json();
            if (j2.items[0]) selectItem(j2.items[0].id);
          }
        }, 300);
      }
    } catch (e: any) {
      setRunStatus({ ok: false, msg: e.message });
    }
    setScoring(false);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString("en-GB", {
      timeZone: "Africa/Lagos",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  function fmtTime(d: string) {
    return new Date(d).toLocaleTimeString("en-GB", {
      timeZone: "Africa/Lagos",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const ideas: TradeIdea[] = detail
    ? (detail.ideas?.length ? detail.ideas : (detail.pairs9 ?? [])).filter(
        (p: any) => p.grade !== "Skip",
      )
    : [];

  const tabBtn = (tab: string, label: string) => (
    <button
      key={tab}
      onClick={() => setPromptTab(tab as any)}
      style={{
        padding: "6px 14px",
        borderRadius: 7,
        fontSize: 11,
        fontWeight: 500,
        cursor: "pointer",
        border: "none",
        background: promptTab === tab ? "var(--bg-elevated)" : "transparent",
        color: promptTab === tab ? "var(--text-1)" : "var(--text-3)",
      }}
    >
      {label}
    </button>
  );

  const codeBlock = (text: string) => (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", top: 8, right: 8 }}>
        <CopyBtn text={text} />
      </div>
      <pre
        style={{
          margin: 0,
          padding: "14px 16px",
          paddingTop: 36,
          fontSize: 10.5,
          fontFamily: "DM Mono, monospace",
          color: "var(--text-2)",
          overflowX: "auto",
          overflowY: "auto",
          maxHeight: 420,
          background: "var(--bg-elevated)",
          borderRadius: 8,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text || "—"}
      </pre>
    </div>
  );

  return (
    <div>
      {/* ── Header + Run buttons ── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>
            Analysis
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            {pagination.total} scoring run{pagination.total !== 1 ? "s" : ""} ·
            click any row to inspect prompt &amp; ideas
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => runAnalysis(false)}
            disabled={scoring}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 18px",
              borderRadius: 10,
              border: "none",
              background: "var(--green)",
              color: "#000",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              opacity: scoring ? 0.6 : 1,
            }}
          >
            {scoring ? <Spinner small /> : "⚡"}{" "}
            {scoring ? "Analysing…" : "Run Analysis"}
          </button>
          <button
            onClick={() => runAnalysis(true)}
            disabled={scoring || sent}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg-card-2)",
              color: sent ? "var(--green)" : "var(--text-1)",
              fontSize: 13,
              cursor: "pointer",
              opacity: scoring || sent ? 0.6 : 1,
            }}
          >
            {sent ? "✓ Sent" : "📱 Run + Send"}
          </button>
        </div>
      </div>

      {/* ── Run status ── */}
      {runStatus && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 16px",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: runStatus.ok ? "var(--green-dim)" : "var(--red-dim)",
            border: `1px solid ${runStatus.ok ? "var(--green-border)" : "var(--red-border)"}`,
            color: runStatus.ok ? "var(--green)" : "var(--red)",
          }}
        >
          <span className="font-mono" style={{ fontSize: 11 }}>
            {runStatus.ok ? "✓ " : "✗ "}
            {runStatus.msg}
          </span>
          <button
            onClick={() => setRunStatus(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              opacity: 0.5,
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── History list ── */}
      <div
        className="card"
        style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}
      >
        {listLoading ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <Spinner />
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12 }}>
              Loading history…
            </p>
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 28, marginBottom: 8 }}>📊</p>
            <p
              style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}
            >
              No analysis runs yet
            </p>
            <button
              onClick={() => runAnalysis(false)}
              disabled={scoring}
              style={{
                padding: "8px 20px",
                borderRadius: 10,
                border: "none",
                background: "var(--green)",
                color: "#000",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ⚡ Run First Analysis
            </button>
          </div>
        ) : (
          <>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {[
                    "Date",
                    "Time",
                    "Model",
                    "Priority Setup",
                    "Top 3",
                    "Bottom 3",
                    "Ideas",
                    "Data Age",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 10,
                        color: "var(--text-3)",
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isSelected = selected === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        onClick={() => selectItem(item.id)}
                        style={{
                          borderBottom: isSelected
                            ? "none"
                            : "1px solid var(--border-subtle)",
                          cursor: "pointer",
                          background: isSelected
                            ? "var(--bg-elevated)"
                            : "transparent",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background =
                              "rgba(255,255,255,0.02)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <td style={{ padding: "12px 14px", fontWeight: 500 }}>
                          {fmtDate(item.date)}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span
                            className="font-mono"
                            style={{ color: "var(--text-3)", fontSize: 11 }}
                          >
                            {fmtTime(item.createdAt)}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--text-3)",
                              marginLeft: 6,
                            }}
                          >
                            {timeAgo(item.createdAt)}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          {item.scoringModel ? (
                            <span
                              className="font-mono"
                              style={{ fontSize: 10, color: "var(--blue)" }}
                            >
                              {item.scoringModel}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-3)" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          {item.priorityPair ? (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span
                                className="font-mono"
                                style={{ fontWeight: 600 }}
                              >
                                {item.priorityPair}
                              </span>
                              {item.priorityGrade && (
                                <GradePill grade={item.priorityGrade} />
                              )}
                              {item.divergence != null && (
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: 10,
                                    color: "var(--text-3)",
                                  }}
                                >
                                  div {item.divergence.toFixed(1)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "var(--text-3)" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--green)",
                              fontFamily: "DM Mono, monospace",
                              fontWeight: 600,
                            }}
                          >
                            {item.top3.join(" · ") || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--red)",
                              fontFamily: "DM Mono, monospace",
                              fontWeight: 600,
                            }}
                          >
                            {item.bottom3.join(" · ") || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span
                            className="font-mono"
                            style={{ color: "var(--text-2)" }}
                          >
                            {item.ideasCount}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          {item.dataAge != null ? (
                            <span
                              style={{ fontSize: 10, color: "var(--text-3)" }}
                            >
                              {item.dataAge}m
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-3)" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span
                            style={{
                              color: "var(--text-3)",
                              fontSize: 14,
                              transition: "transform 0.15s",
                              display: "inline-block",
                              transform: isSelected ? "rotate(90deg)" : "none",
                            }}
                          >
                            ›
                          </span>
                        </td>
                      </tr>

                      {/* ── Inline detail panel ── */}
                      {isSelected && (
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          <td colSpan={9} style={{ padding: 0 }}>
                            {detailLoading ? (
                              <div style={{ padding: 32, textAlign: "center" }}>
                                <Spinner />
                                <p
                                  style={{
                                    fontSize: 12,
                                    color: "var(--text-3)",
                                    marginTop: 10,
                                  }}
                                >
                                  Loading…
                                </p>
                              </div>
                            ) : detail ? (
                              <div
                                style={{
                                  background: "var(--bg-card-2)",
                                  borderTop: "1px solid var(--border)",
                                }}
                              >
                                {/* Tabs */}
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 4,
                                    padding: "12px 16px 0",
                                    borderBottom: "1px solid var(--border)",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  {tabBtn("ideas", `Ideas (${ideas.length})`)}
                                  {tabBtn("context", "Context")}
                                  {tabBtn("data", "Data sent")}
                                  {tabBtn("response", "Raw response")}
                                  {tabBtn("system", "System prompt")}
                                </div>

                                <div style={{ padding: 16 }}>
                                  {/* Ideas tab */}
                                  {promptTab === "ideas" &&
                                    (ideas.length === 0 ? (
                                      <p
                                        style={{
                                          fontSize: 12,
                                          color: "var(--text-3)",
                                          textAlign: "center",
                                          padding: 24,
                                        }}
                                      >
                                        No trade ideas in this run
                                      </p>
                                    ) : (
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 10,
                                        }}
                                      >
                                        {ideas.map((idea, i) => (
                                          <div
                                            key={i}
                                            style={{
                                              background: "var(--bg-card)",
                                              border: "1px solid var(--border)",
                                              borderRadius: 10,
                                              padding: "12px 16px",
                                            }}
                                          >
                                            <div
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 10,
                                                marginBottom: 6,
                                                flexWrap: "wrap",
                                              }}
                                            >
                                              <span
                                                style={{
                                                  fontSize: 10,
                                                  color: "var(--text-3)",
                                                  fontFamily:
                                                    "DM Mono, monospace",
                                                }}
                                              >
                                                #{i + 1}
                                              </span>
                                              <span
                                                className="font-mono"
                                                style={{
                                                  fontSize: 14,
                                                  fontWeight: 700,
                                                }}
                                              >
                                                {idea.pair}
                                              </span>
                                              <span
                                                style={{
                                                  fontSize: 11,
                                                  padding: "2px 8px",
                                                  borderRadius: 20,
                                                  fontWeight: 600,
                                                  background:
                                                    idea.direction === "Long"
                                                      ? "var(--green-dim)"
                                                      : "var(--red-dim)",
                                                  color:
                                                    idea.direction === "Long"
                                                      ? "var(--green)"
                                                      : "var(--red)",
                                                }}
                                              >
                                                {idea.direction}
                                              </span>
                                              <GradePill grade={idea.grade} />
                                              <span
                                                className="font-mono"
                                                style={{
                                                  fontSize: 11,
                                                  color: "var(--blue)",
                                                }}
                                              >
                                                div {idea.divergence.toFixed(1)}
                                              </span>
                                              {idea.confidence && (
                                                <span
                                                  style={{
                                                    fontSize: 10,
                                                    padding: "2px 7px",
                                                    borderRadius: 20,
                                                    background:
                                                      "var(--bg-elevated)",
                                                    color: "var(--text-3)",
                                                    border:
                                                      "1px solid var(--border)",
                                                  }}
                                                >
                                                  {idea.confidence}
                                                </span>
                                              )}
                                              {idea.timeframe && (
                                                <span
                                                  style={{
                                                    fontSize: 10,
                                                    color: "var(--text-3)",
                                                  }}
                                                >
                                                  {idea.timeframe}
                                                </span>
                                              )}
                                            </div>
                                            <p
                                              style={{
                                                fontSize: 12,
                                                color: "var(--text-2)",
                                                margin: "0 0 4px",
                                                lineHeight: 1.5,
                                              }}
                                            >
                                              {idea.reason}
                                            </p>
                                            <div
                                              style={{
                                                display: "flex",
                                                gap: 16,
                                                fontSize: 11,
                                                color: "var(--text-3)",
                                              }}
                                            >
                                              <span>
                                                Strong:{" "}
                                                <span
                                                  style={{
                                                    color: "var(--green)",
                                                    fontWeight: 600,
                                                  }}
                                                >
                                                  {idea.strong}
                                                </span>{" "}
                                                ({idea.strongScore.toFixed(1)})
                                              </span>
                                              <span>
                                                Weak:{" "}
                                                <span
                                                  style={{
                                                    color: "var(--red)",
                                                    fontWeight: 600,
                                                  }}
                                                >
                                                  {idea.weak}
                                                </span>{" "}
                                                ({idea.weakScore.toFixed(1)})
                                              </span>
                                              {idea.session?.length > 0 && (
                                                <span>
                                                  Sessions:{" "}
                                                  {idea.session.join(", ")}
                                                </span>
                                              )}
                                              {idea.pricedInRisk && (
                                                <span
                                                  style={{
                                                    color: "var(--amber)",
                                                  }}
                                                >
                                                  ⚠ Already priced in
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ))}

                                  {/* Context tab */}
                                  {promptTab === "context" && (() => {
                                    const fa = detail.fullAnalysis as any;
                                    const hasContext = fa?.marketCondition || fa?.sessionRecommendation || fa?.reasoning || fa?.excludedCurrencies?.length || fa?.neutralCurrencies?.length;
                                    if (!hasContext) return (
                                      <div style={{ padding: 24, textAlign: "center" }}>
                                        <p style={{ fontSize: 12, color: "var(--text-3)" }}>Context not saved for this run — only available for runs after the prompt update.</p>
                                      </div>
                                    );
                                    return (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                                        {/* Market condition */}
                                        {fa?.marketCondition && (
                                          <div style={{
                                            padding: "10px 14px", borderRadius: 8,
                                            background: fa.marketCondition === "Normal" ? "var(--bg-elevated)" : "rgba(239,68,68,0.08)",
                                            border: `1px solid ${fa.marketCondition === "Normal" ? "var(--border)" : "rgba(239,68,68,0.25)"}`,
                                          }}>
                                            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 4px" }}>MARKET CONDITION</p>
                                            <p style={{ fontSize: 12, fontWeight: 600, margin: 0, color: fa.marketCondition === "Normal" ? "var(--green)" : "var(--red)" }}>
                                              {fa.marketCondition}
                                            </p>
                                          </div>
                                        )}

                                        {/* Session recommendation */}
                                        {fa?.sessionRecommendation && (
                                          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                                            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 6px" }}>SESSION RECOMMENDATION</p>
                                            <p style={{ fontSize: 12, color: "var(--text-1)", margin: 0, lineHeight: 1.6 }}>{fa.sessionRecommendation}</p>
                                          </div>
                                        )}

                                        {/* Excluded currencies */}
                                        {fa?.excludedCurrencies?.length > 0 && (
                                          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--amber-dim)", border: "1px solid var(--amber-border)" }}>
                                            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--amber)", margin: "0 0 8px" }}>EXCLUDED — HOLIDAY / THIN DATA</p>
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                              {fa.excludedCurrencies.map((cur: string, i: number) => (
                                                <div key={cur} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                                  <span className="font-mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--amber)", flexShrink: 0, minWidth: 32 }}>{cur}</span>
                                                  <span style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5 }}>
                                                    {fa.excludedReasons?.[i]?.replace(`${cur}: `, "") || "Excluded"}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Neutral currencies */}
                                        {fa?.neutralCurrencies?.length > 0 && (
                                          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                                            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 8px" }}>NEUTRAL — BELOW ±1.5 THRESHOLD</p>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                              {fa.neutralCurrencies.map((cur: string) => (
                                                <span key={cur} className="font-mono" style={{
                                                  fontSize: 11, padding: "3px 10px", borderRadius: 20,
                                                  background: "var(--bg-card)", color: "var(--text-3)",
                                                  border: "1px solid var(--border)",
                                                }}>{cur}</span>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Reasoning */}
                                        {fa?.reasoning && (
                                          <div>
                                            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 6px" }}>CLAUDE'S REASONING</p>
                                            <div style={{ position: "relative" }}>
                                              <div style={{ position: "absolute", top: 8, right: 8 }}>
                                                <CopyBtn text={fa.reasoning} />
                                              </div>
                                              <div style={{
                                                padding: "12px 14px", paddingTop: 36,
                                                background: "var(--bg-elevated)", borderRadius: 8,
                                                border: "1px solid var(--border)",
                                                fontSize: 11, color: "var(--text-2)",
                                                lineHeight: 1.7, whiteSpace: "pre-wrap",
                                                wordBreak: "break-word", maxHeight: 420, overflowY: "auto",
                                              }}>
                                                {fa.reasoning}
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                      </div>
                                    );
                                  })()}

                                  {/* Data sent tab */}
                                  {promptTab === "data" &&
                                    (detail.fullAnalysis?.userMessage ? (
                                      codeBlock(detail.fullAnalysis.userMessage)
                                    ) : (
                                      <div
                                        style={{
                                          padding: 24,
                                          textAlign: "center",
                                        }}
                                      >
                                        <p
                                          style={{
                                            fontSize: 12,
                                            color: "var(--text-3)",
                                          }}
                                        >
                                          Prompt data not saved for this run —
                                          only available for runs after this fix
                                          was deployed.
                                        </p>
                                      </div>
                                    ))}

                                  {/* Raw response tab */}
                                  {promptTab === "response" &&
                                    (detail.fullAnalysis?.rawResponse ? (
                                      codeBlock(detail.fullAnalysis.rawResponse)
                                    ) : (
                                      <div
                                        style={{
                                          padding: 24,
                                          textAlign: "center",
                                        }}
                                      >
                                        <p
                                          style={{
                                            fontSize: 12,
                                            color: "var(--text-3)",
                                          }}
                                        >
                                          Raw response not saved for this run.
                                        </p>
                                      </div>
                                    ))}

                                  {/* System prompt tab */}
                                  {promptTab === "system" &&
                                    (detail.fullAnalysis?.systemPrompt ? (
                                      codeBlock(
                                        detail.fullAnalysis.systemPrompt,
                                      )
                                    ) : (
                                      <div
                                        style={{
                                          padding: 24,
                                          textAlign: "center",
                                        }}
                                      >
                                        <p
                                          style={{
                                            fontSize: 12,
                                            color: "var(--text-3)",
                                          }}
                                        >
                                          System prompt not saved for this run.
                                        </p>
                                      </div>
                                    ))}

                                  {/* Model info footer */}
                                  {detail.scoringModel && (
                                    <div
                                      style={{
                                        marginTop: 12,
                                        display: "flex",
                                        gap: 16,
                                        fontSize: 11,
                                        color: "var(--text-3)",
                                      }}
                                    >
                                      <span>
                                        Model:{" "}
                                        <span
                                          className="font-mono"
                                          style={{ color: "var(--blue)" }}
                                        >
                                          {detail.scoringModel}
                                        </span>
                                      </span>
                                      {detail.fullAnalysis?.promptLength ? (
                                        <span>
                                          Prompt:{" "}
                                          {detail.fullAnalysis.promptLength.toLocaleString()}{" "}
                                          chars
                                        </span>
                                      ) : null}
                                      {detail.dataAge != null ? (
                                        <span>Data age: {detail.dataAge}m</span>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                  Page {pagination.page} of {pagination.pages} ·{" "}
                  {pagination.total} total
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    disabled={pagination.page <= 1}
                    onClick={() => loadList(pagination.page - 1)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-card-2)",
                      color:
                        pagination.page <= 1
                          ? "var(--text-3)"
                          : "var(--text-1)",
                      cursor: pagination.page <= 1 ? "default" : "pointer",
                      fontSize: 12,
                    }}
                  >
                    ← Prev
                  </button>
                  {Array.from(
                    { length: Math.min(5, pagination.pages) },
                    (_, i) => {
                      const start = Math.max(
                        1,
                        Math.min(pagination.page - 2, pagination.pages - 4),
                      );
                      const p = start + i;
                      return (
                        <button
                          key={p}
                          onClick={() => loadList(p)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            fontSize: 12,
                            background:
                              p === pagination.page
                                ? "var(--green)"
                                : "var(--bg-card-2)",
                            color:
                              p === pagination.page ? "#000" : "var(--text-2)",
                            cursor: "pointer",
                            fontWeight: p === pagination.page ? 600 : 400,
                          }}
                        >
                          {p}
                        </button>
                      );
                    },
                  )}
                  <button
                    disabled={pagination.page >= pagination.pages}
                    onClick={() => loadList(pagination.page + 1)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-card-2)",
                      color:
                        pagination.page >= pagination.pages
                          ? "var(--text-3)"
                          : "var(--text-1)",
                      cursor:
                        pagination.page >= pagination.pages
                          ? "default"
                          : "pointer",
                      fontSize: 12,
                    }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
