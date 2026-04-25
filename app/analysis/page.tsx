"use client";
// app/analysis/page.tsx — Full analysis view + prompt inspector

import { useState } from "react";

interface DebugLog {
  model: string;
  timestamp: string;
  promptLength: number;
  systemPrompt: string;
  userMessage: string;
  rawResponse: string;
}

interface TradeIdea {
  pair: string; direction: string; strong: string; weak: string;
  divergence: number; grade: string; session: string[];
  reason: string; timeframe?: string; pricedInRisk?: boolean;
  confidence?: string; strongScore: number; weakScore: number;
}

function GradePill({ grade }: { grade: string }) {
  const cls = grade === "A+" ? "badge-aplus" : grade === "B" ? "badge-b" : grade === "Skip" ? "badge-skip" : "badge-c";
  return <span className={cls} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 600, letterSpacing: "0.05em" }}>{grade}</span>;
}

function Spinner() {
  return <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.75s linear infinite" }} />;
}

export default function AnalysisPage() {
  const [debug, setDebug] = useState<DebugLog | null>(null);
  const [ideas, setIdeas] = useState<TradeIdea[]>([]);
  const [scores, setScores] = useState<any>(null);
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDebug, setLoadingDebug] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"ideas" | "prompt" | "response" | "system">("ideas");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Load today's saved scores on mount so model info shows before a fresh run
  useState(() => {
    fetch("/api/dashboard").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.scores?.scoringModel) setSavedModel(d.scores.scoringModel);
      if (d?.scoredAt) setSavedAt(d.scoredAt);
      if (d?.scores?.ideas?.length) setIdeas(d.scores.ideas);
      else if (d?.scores?.pairs9?.length) setIdeas(d.scores.pairs9);
    }).catch(() => {});
  });

  async function runAnalysis(sendAlert = false) {
    setScoring(true); setStatus(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto", sendAlert }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus({ ok: false, msg: json.error || "Scoring failed" });
      } else {
        setScores(json);
        setIdeas(json.ideas || json.pairs9 || []);
        if (json.scoringModel) setSavedModel(json.scoringModel);
        setSavedAt(new Date().toISOString());
        setStatus({ ok: true, msg: `Scored with ${json.scoredBy || "claude-ai"} · ${json.fetchErrors?.length ? json.fetchErrors.length + " warnings" : "clean"}` });
        if (sendAlert) setSent(true);
        // Auto-load debug log
        await loadDebug();
      }
    } catch (e: any) {
      setStatus({ ok: false, msg: e.message });
    }
    setScoring(false);
  }

  async function loadDebug() {
    setLoadingDebug(true);
    try {
      const res = await fetch("/api/debug");
      if (res.ok) setDebug(await res.json());
    } catch (e) { console.error(e); }
    setLoadingDebug(false);
  }

  async function resend() {
    setSending(true);
    try {
      const res = await fetch("/api/alerts/resend", { method: "POST" });
      if (res.ok) setSent(true);
    } catch (e) { console.error(e); }
    setSending(false);
  }

  const tabStyle = (tab: string) => ({
    padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
    cursor: "pointer", border: "none",
    background: activeTab === tab ? "var(--bg-elevated)" : "transparent",
    color: activeTab === tab ? "var(--text-1)" : "var(--text-3)",
    transition: "all 0.15s",
  } as React.CSSProperties);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Analysis</h1>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            Run RFDM scoring, inspect the prompt sent to Claude, and review all trade ideas
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => runAnalysis(false)} disabled={scoring}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: scoring ? 0.6 : 1 }}>
            {scoring ? <Spinner /> : "⚡"} {scoring ? "Analysing…" : "Run Analysis"}
          </button>
          <button onClick={() => runAnalysis(true)} disabled={scoring || sent}
            style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: sent ? "var(--green)" : "var(--text-1)", fontSize: 13, cursor: "pointer", opacity: scoring || sent ? 0.6 : 1 }}>
            {sent ? "✓ Sent" : "Run + Send"}
          </button>
          {debug && !sent && (
            <button onClick={resend} disabled={sending}
              style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-2)", fontSize: 13, cursor: "pointer" }}>
              {sending ? "Sending…" : "📱 Resend last"}
            </button>
          )}
        </div>
      </div>

      {/* Status */}
      {status && (
        <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between", background: status.ok ? "var(--green-dim)" : "var(--red-dim)", border: `1px solid ${status.ok ? "var(--green-border)" : "var(--red-border)"}`, color: status.ok ? "var(--green)" : "var(--red)" }}>
          <span className="font-mono" style={{ fontSize: 11 }}>{status.ok ? "✓ " : "✗ "}{status.msg}</span>
          <button onClick={() => setStatus(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.5, fontSize: 16 }}>×</button>
        </div>
      )}

      {/* Model info */}
      {(debug || savedModel) && (
        <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, background: "var(--blue-dim)", border: "1px solid var(--blue-border)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--blue)" }}>
            Model: <span className="font-mono" style={{ fontWeight: 600 }}>{debug?.model ?? savedModel}</span>
          </span>
          {(debug?.timestamp || savedAt) && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                Last scored: {new Date((debug?.timestamp ?? savedAt)!).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" })} WAT
              </span>
            </>
          )}
          {debug && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                Prompt: {debug.promptLength.toLocaleString()} chars
              </span>
            </>
          )}
          {!debug && savedModel && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>Saved result · run analysis to inspect prompt</span>
            </>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* LEFT — Trade ideas */}
        <div>
          <p className="section-label" style={{ marginTop: 0 }}>All Trade Ideas (ranked by divergence)</p>

          {ideas.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
              <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>Run analysis to see ranked trade ideas</p>
              <button onClick={() => runAnalysis(false)} disabled={scoring}
                style={{ padding: "8px 20px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                ⚡ Run Analysis
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ideas.map((idea, i) => (
                <div key={`${idea.pair}-${i}`} className="card" style={{
                  padding: "14px 16px",
                  background: i === 0 ? "var(--bg-card)" : "var(--bg-card-2)",
                  borderColor: i === 0 && idea.grade === "A+" ? "var(--green-border)" : "var(--border)",
                  backgroundImage: i === 0 ? "radial-gradient(ellipse at top right, rgba(0,212,138,0.04) 0%, transparent 60%)" : "none",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="font-mono" style={{ fontSize: 10, color: "var(--text-3)", minWidth: 20 }}>#{i + 1}</span>
                      <span className="font-mono" style={{ fontSize: 16, fontWeight: 600 }}>{idea.pair}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: idea.direction === "Short" ? "var(--red)" : "var(--green)" }}>{idea.direction}</span>
                      <GradePill grade={idea.grade} />
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className="font-mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--green)" }}>{idea.divergence.toFixed(1)}</span>
                      <p style={{ fontSize: 9, color: "var(--text-3)", margin: 0 }}>DIV</p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span className="font-mono" style={{ fontSize: 11, color: "var(--green)" }}>{idea.strong} {idea.strongScore > 0 ? "+" : ""}{idea.strongScore?.toFixed(1)}</span>
                    <span style={{ fontSize: 10, color: "var(--text-3)" }}>vs</span>
                    <span className="font-mono" style={{ fontSize: 11, color: "var(--red)" }}>{idea.weak} {idea.weakScore?.toFixed(1)}</span>
                    {idea.timeframe && (
                      <span style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "var(--bg-elevated)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                        {idea.timeframe}
                      </span>
                    )}
                    {idea.confidence && (
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: idea.confidence === "High" ? "var(--green-dim)" : idea.confidence === "Low" ? "var(--red-dim)" : "var(--amber-dim)", color: idea.confidence === "High" ? "var(--green)" : idea.confidence === "Low" ? "var(--red)" : "var(--amber)", border: "none" }}>
                        {idea.confidence}
                      </span>
                    )}
                  </div>

                  <p style={{ fontSize: 11, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>{idea.reason}</p>

                  {idea.pricedInRisk && (
                    <p style={{ fontSize: 10, marginTop: 6, padding: "4px 8px", borderRadius: 6, background: "var(--amber-dim)", color: "var(--amber)", border: "1px solid var(--amber-border)" }}>
                      ⚠ Fundamentals may already be priced in
                    </p>
                  )}

                  <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {idea.session?.map(s => (
                      <span key={s} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 20, background: "var(--bg-elevated)", color: "var(--text-3)", border: "1px solid var(--border)" }}>{s}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Currency scores */}
          {scores?.allScores?.length > 0 && (
            <>
              <p className="section-label">Currency Scores</p>
              <div className="card" style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {scores.allScores.map((c: any) => {
                    const pct = Math.abs(c.score) / 10;
                    return (
                      <div key={c.cur} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 36, color: c.score > 0 ? "var(--green)" : c.score < 0 ? "var(--red)" : "var(--text-3)" }}>{c.cur}</span>
                        <div style={{ flex: 1, height: 4, background: "var(--bg-elevated)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(pct * 100, 100)}%`, background: c.score > 0 ? "var(--green)" : "var(--red)", borderRadius: 2 }} />
                        </div>
                        <span className="font-mono" style={{ fontSize: 11, color: c.score > 0 ? "var(--green)" : c.score < 0 ? "var(--red)" : "var(--text-3)", minWidth: 40, textAlign: "right" }}>
                          {c.score > 0 ? "+" : ""}{c.score.toFixed(2)}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-3)", minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.tag}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT — Prompt inspector */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>Prompt Inspector</p>
            <button onClick={loadDebug} disabled={loadingDebug}
              style={{ fontSize: 11, color: "var(--blue)", background: "none", border: "none", cursor: "pointer" }}>
              {loadingDebug ? "Loading…" : "↻ Refresh"}
            </button>
          </div>

          {!debug ? (
            <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
              <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 12 }}>
                Run analysis to see the exact prompt sent to Claude
              </p>
              <button onClick={loadDebug}
                style={{ fontSize: 11, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                Load last run →
              </button>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, padding: "12px 12px 0", borderBottom: "1px solid var(--border)", background: "var(--bg-card-2)" }}>
                {(["ideas", "prompt", "response", "system"] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={tabStyle(tab)}>
                    {tab === "ideas" ? "Output" : tab === "prompt" ? "Data sent" : tab === "response" ? "Raw response" : "System prompt"}
                  </button>
                ))}
              </div>

              <div style={{ padding: 16, maxHeight: 600, overflowY: "auto" }}>
                {activeTab === "ideas" && (
                  <div>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>
                      This is what Claude returned. Compare this with what you get when you send the same data in Claude chat.
                    </p>
                    <pre className="font-mono" style={{ fontSize: 10, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, margin: 0 }}>
                      {JSON.stringify(JSON.parse(debug.rawResponse.startsWith("{") ? debug.rawResponse : "{}"), null, 2)}
                    </pre>
                  </div>
                )}
                {activeTab === "prompt" && (
                  <div>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>
                      This is the exact data message sent to Claude. Copy this into Claude chat with the system prompt to verify the output matches.
                    </p>
                    <pre className="font-mono" style={{ fontSize: 10, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, margin: 0 }}>
                      {debug.userMessage}
                    </pre>
                  </div>
                )}
                {activeTab === "response" && (
                  <div>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>Raw text response from Claude before JSON parsing.</p>
                    <pre className="font-mono" style={{ fontSize: 10, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, margin: 0 }}>
                      {debug.rawResponse}
                    </pre>
                  </div>
                )}
                {activeTab === "system" && (
                  <div>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>
                      The RFDM system prompt — this defines all scoring rules Claude follows.
                    </p>
                    <pre className="font-mono" style={{ fontSize: 10, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, margin: 0 }}>
                      {debug.systemPrompt}
                    </pre>
                  </div>
                )}
              </div>

              {/* Copy button */}
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-card-2)", display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    const text = activeTab === "prompt" ? debug.userMessage : activeTab === "response" ? debug.rawResponse : activeTab === "system" ? debug.systemPrompt : debug.rawResponse;
                    navigator.clipboard.writeText(text);
                  }}
                  style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-2)", cursor: "pointer" }}>
                  Copy to clipboard
                </button>
                <span style={{ fontSize: 11, color: "var(--text-3)", lineHeight: "26px" }}>
                  Paste into Claude chat to verify output matches
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
