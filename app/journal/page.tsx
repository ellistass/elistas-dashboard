"use client";
// app/journal/page.tsx — Trade Journal (dark theme, free-form pair, account selector)

import { useState, useEffect, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Trade {
  id: string; date: string; pair: string; direction: string;
  model: string; grade: string; session: string;
  entryPrice: number; slPrice: number; tpPrice: number;
  closePrice: number | null; resultR: number | null;
  outcome: string; reason: string; notes: string | null;
  screenshotUrl: string | null; strongCcy: string; weakCcy: string;
  divScore: number | null; accountId: string | null;
}
interface AccountOption { id: string; name: string; broker: string; status: string; }

// Suggested pairs — used for datalist (not a hard constraint)
const SUGGESTED_PAIRS = [
  "EUR/USD","GBP/USD","AUD/USD","NZD/USD","USD/CAD","USD/JPY","USD/CHF",
  "EUR/GBP","EUR/JPY","GBP/JPY","AUD/JPY","NZD/JPY","EUR/AUD","GBP/AUD",
  "EUR/CAD","GBP/CHF","CAD/JPY","CHF/JPY","GBP/NZD","EUR/NZD","AUD/NZD",
  "AUD/CAD","NZD/CAD","USD/NOK","EUR/NOK","USD/SEK","EUR/SEK",
  "XAU/USD","XAG/USD","US30","NAS100","SPX500","BTC/USD","ETH/USD",
];
const CURRENCIES = ["USD","EUR","GBP","JPY","CAD","AUD","NZD","CHF","NOK","SEK"];

const emptyForm = {
  date: new Date().toISOString().split("T")[0],
  pair: "",
  direction: "Long",
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
  accountId: "",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function GradePill({ grade }: { grade: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    "A+":   { bg: "var(--green-dim)",  color: "var(--green)"  },
    "B":    { bg: "var(--amber-dim)",  color: "var(--amber)"  },
    "C":    { bg: "var(--bg-elevated)", color: "var(--text-3)" },
    "Skip": { bg: "var(--red-dim)",    color: "var(--red)"    },
  };
  const s = styles[grade] ?? styles.C;
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 600, background: s.bg, color: s.color }}>{grade}</span>
  );
}

function OutcomePill({ outcome }: { outcome: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    Win:  { bg: "var(--green-dim)", color: "var(--green)"  },
    Loss: { bg: "var(--red-dim)",   color: "var(--red)"    },
    BE:   { bg: "var(--bg-elevated)", color: "var(--text-3)" },
    Open: { bg: "var(--blue-dim)",  color: "var(--blue)"   },
  };
  const s = styles[outcome] ?? styles.Open;
  return (
    <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, fontWeight: 600, background: s.bg, color: s.color }}>{outcome}</span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function JournalPage() {
  const [trades, setTrades]       = useState<Trade[]>([]);
  const [accounts, setAccounts]   = useState<AccountOption[]>([]);
  const [showForm, setShowForm]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [alignment, setAlignment] = useState<string>("");
  const [form, setForm]           = useState({ ...emptyForm });
  const [closeInputs, setCloseInputs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // Load alignment context from latest scores
  useEffect(() => {
    fetch("/api/dashboard").then(r => r.json()).then(d => {
      if (d.scores) {
        const top3 = (d.scores.top3 || []).map((c: any) => `${c.cur} (${(c.score || 0).toFixed(1)})`);
        const bot3 = (d.scores.bottom3 || []).map((c: any) => `${c.cur} (${(c.score || 0).toFixed(1)})`);
        setAlignment(`Strong: ${top3.join(", ")} | Weak: ${bot3.join(", ")}`);
      }
    }).catch(() => {});
  }, []);

  // Load accounts for the selector
  useEffect(() => {
    fetch("/api/accounts").then(r => r.json()).then(j => {
      setAccounts((j.accounts || []).filter((a: any) => a.isActive).map((a: any) => ({
        id: a.id, name: a.name, broker: a.broker, status: a.status,
      })));
    }).catch(() => {});
  }, []);

  useEffect(() => { fetchTrades(); }, []);

  async function fetchTrades() {
    const res = await fetch("/api/trades");
    const data = await res.json();
    setTrades(data.trades || []);
  }

  async function uploadScreenshot(file: File, tradeId: string): Promise<string> {
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
    if (!form.pair.trim()) return;
    setLoading(true);
    try {
      const payload = {
        ...form,
        accountId: form.accountId || null,
      };
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const trade = await res.json();

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
      setForm({ ...emptyForm });
      fetchTrades();
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function closeTrade(trade: Trade, outcome: string) {
    const cp = parseFloat(closeInputs[trade.id] || "");
    if (!cp) return;
    const riskPips = Math.abs(trade.entryPrice - trade.slPrice);
    const profitPips = trade.direction === "Short" ? trade.entryPrice - cp : cp - trade.entryPrice;
    const resultR = Math.round((profitPips / riskPips) * 100) / 100;
    await fetch("/api/trades", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: trade.id, closePrice: cp, outcome, resultR }),
    });
    fetchTrades();
    setExpanded(null);
  }

  const field = (label: string, children: React.ReactNode, required = false) => (
    <div>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginBottom: 5, fontWeight: 500, letterSpacing: "0.05em" }}>
        {label}{required && <span style={{ color: "var(--red)", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );

  const inp = (extra?: React.CSSProperties): React.CSSProperties => ({
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: "1px solid var(--border)", background: "var(--bg-elevated)",
    color: "var(--text-1)", fontSize: 13, boxSizing: "border-box",
    fontFamily: "inherit", outline: "none", ...extra,
  });

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Trade Journal</h1>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            {trades.filter(t => t.outcome === "Open").length} open · {trades.filter(t => t.outcome !== "Open").length} closed · {trades.length} total
          </p>
        </div>
        <button onClick={() => { setForm({ ...emptyForm }); setShowForm(true); }}
          style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + Log Trade
        </button>
      </div>

      {/* ── Log trade modal ── */}
      {showForm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          padding: "40px 20px", overflowY: "auto",
        }} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{
            width: "100%", maxWidth: 640,
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16,
            padding: 28,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>New Trade Entry</h2>
              <button onClick={() => setShowForm(false)}
                style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {/* Account selector */}
            {accounts.length > 0 && (
              <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 10, background: "var(--blue-dim)", border: "1px solid var(--blue-border)" }}>
                <label style={{ display: "block", fontSize: 11, color: "var(--blue)", fontWeight: 600, marginBottom: 8, letterSpacing: "0.05em" }}>ACCOUNT</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => setForm(f => ({ ...f, accountId: "" }))}
                    style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)",
                      background: !form.accountId ? "var(--blue)" : "var(--bg-card-2)",
                      color: !form.accountId ? "#000" : "var(--text-2)", fontWeight: !form.accountId ? 600 : 400 }}>
                    All / Unlinked
                  </button>
                  {accounts.map(a => (
                    <button key={a.id}
                      onClick={() => setForm(f => ({ ...f, accountId: a.id }))}
                      style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)",
                        background: form.accountId === a.id ? "var(--blue)" : "var(--bg-card-2)",
                        color: form.accountId === a.id ? "#000" : "var(--text-2)", fontWeight: form.accountId === a.id ? 600 : 400 }}>
                      {a.name} <span style={{ opacity: 0.6, fontSize: 10 }}>({a.status})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={submitTrade}>
              {/* Row 1 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "12px 14px", marginBottom: 14 }}>
                {field("Date", <input type="date" style={inp()} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />)}
                {field("Pair", (
                  <>
                    <input
                      list="pairs-list"
                      style={{ ...inp(), fontFamily: "DM Mono, monospace", fontWeight: 600 }}
                      placeholder="e.g. GBP/NZD, XAU/USD, NAS100…"
                      value={form.pair}
                      onChange={e => setForm(f => ({ ...f, pair: e.target.value.toUpperCase() }))}
                      required
                    />
                    <datalist id="pairs-list">
                      {SUGGESTED_PAIRS.map(p => <option key={p} value={p} />)}
                    </datalist>
                  </>
                ), true)}
                {field("Direction", (
                  <select style={inp()} value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
                    <option>Long</option>
                    <option>Short</option>
                  </select>
                ))}
              </div>

              {/* Row 2 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px 14px", marginBottom: 14 }}>
                {field("Model", (
                  <select style={inp()} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}>
                    <option value="A">Model A — Wyckoff trap</option>
                    <option value="B">Model B — Liquidity run</option>
                  </select>
                ))}
                {field("Grade", (
                  <select style={inp()} value={form.grade} onChange={e => setForm(f => ({ ...f, grade: e.target.value }))}>
                    <option>A+</option><option>B</option><option>C</option>
                  </select>
                ))}
                {field("Session", (
                  <select style={inp()} value={form.session} onChange={e => setForm(f => ({ ...f, session: e.target.value }))}>
                    <option>London</option><option>New York</option><option>Tokyo</option><option>Pre-NY</option>
                  </select>
                ))}
                {field("Outcome", (
                  <select style={inp()} value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}>
                    <option>Open</option><option>Win</option><option>Loss</option><option>BE</option>
                  </select>
                ))}
              </div>

              {/* Row 3 — prices */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px 14px", marginBottom: 14 }}>
                {field("Entry", <input type="number" step="0.00001" style={inp({ fontFamily: "DM Mono, monospace" })} value={form.entryPrice} onChange={e => setForm(f => ({ ...f, entryPrice: e.target.value }))} required />)}
                {field("Stop Loss", <input type="number" step="0.00001" style={inp({ fontFamily: "DM Mono, monospace" })} value={form.slPrice} onChange={e => setForm(f => ({ ...f, slPrice: e.target.value }))} required />)}
                {field("Take Profit", <input type="number" step="0.00001" style={inp({ fontFamily: "DM Mono, monospace" })} value={form.tpPrice} onChange={e => setForm(f => ({ ...f, tpPrice: e.target.value }))} required />)}
                {field("Close Price", <input type="number" step="0.00001" style={inp({ fontFamily: "DM Mono, monospace" })} value={form.closePrice} onChange={e => setForm(f => ({ ...f, closePrice: e.target.value }))} placeholder="if closed" />)}
              </div>

              {/* Row 4 — RFDM context */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px", marginBottom: 14 }}>
                {field("Strong Currency", (
                  <select style={inp()} value={form.strongCcy} onChange={e => setForm(f => ({ ...f, strongCcy: e.target.value }))}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                ))}
                {field("Weak Currency", (
                  <select style={inp()} value={form.weakCcy} onChange={e => setForm(f => ({ ...f, weakCcy: e.target.value }))}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                ))}
                {field("Divergence Score", <input type="number" step="0.1" style={inp({ fontFamily: "DM Mono, monospace" })} placeholder="e.g. 8.5" value={form.divScore} onChange={e => setForm(f => ({ ...f, divScore: e.target.value }))} />)}
              </div>

              {/* Alignment hint */}
              {alignment && (
                <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: "var(--blue-dim)", border: "1px solid var(--blue-border)" }}>
                  <p style={{ fontSize: 10, color: "var(--blue)", fontWeight: 600, marginBottom: 3, letterSpacing: "0.05em" }}>📊 ALIGNMENT AT ENTRY (latest score)</p>
                  <p style={{ fontSize: 11, color: "var(--text-2)", margin: 0, fontFamily: "DM Mono, monospace" }}>{alignment}</p>
                </div>
              )}

              {/* Reason */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginBottom: 5, fontWeight: 500 }}>
                  Entry Reason <span style={{ color: "var(--red)" }}>*</span>
                  <span style={{ color: "var(--text-3)", fontWeight: 400, marginLeft: 6 }}>one sentence, be specific</span>
                </label>
                <input type="text" required style={inp()} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. NZD weakest on fund + price, H1 upthrust at 0.5905, Model A confirmation closed at 3pm" />
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginBottom: 5, fontWeight: 500 }}>Notes (optional)</label>
                <textarea style={{ ...inp(), resize: "vertical", minHeight: 60 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Pre/post-trade observations, what went right or wrong…" />
              </div>

              {/* Screenshot */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginBottom: 5, fontWeight: 500 }}>Chart Screenshot</label>
                <div onClick={() => fileRef.current?.click()}
                  style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: "20px 16px", textAlign: "center", cursor: "pointer" }}>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} />
                  <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>{uploading ? "Uploading…" : "Click or drag screenshot here"}</p>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="submit" disabled={loading || !form.pair.trim()}
                  style={{ flex: 1, padding: 10, borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading || !form.pair.trim() ? 0.6 : 1 }}>
                  {loading ? "Saving…" : "Save Trade"}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-2)", fontSize: 13, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Trade list ── */}
      {trades.length === 0 ? (
        <div className="card" style={{ padding: 60, textAlign: "center" }}>
          <p style={{ fontSize: 28, marginBottom: 8 }}>📋</p>
          <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>No trades logged yet</p>
          <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>Record your first trade to start building your journal</p>
          <button onClick={() => setShowForm(true)}
            style={{ padding: "9px 20px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + Log Trade
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {trades.map(trade => {
            const isOpen = trade.outcome === "Open";
            const isExpanded = expanded === trade.id;
            const resultColor = trade.resultR != null
              ? trade.resultR > 0 ? "var(--green)" : trade.resultR < 0 ? "var(--red)" : "var(--text-3)"
              : "var(--text-3)";

            return (
              <div key={trade.id} className="card"
                style={{ padding: "14px 18px", cursor: "pointer", transition: "border-color 0.1s" }}
                onClick={() => setExpanded(isExpanded ? null : trade.id)}>
                {/* ── Trade row ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span className="font-mono" style={{ fontSize: 14, fontWeight: 700 }}>{trade.pair}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600,
                      background: trade.direction === "Long" ? "var(--green-dim)" : "var(--red-dim)",
                      color: trade.direction === "Long" ? "var(--green)" : "var(--red)" }}>
                      {trade.direction}
                    </span>
                    <GradePill grade={trade.grade} />
                    <span style={{ fontSize: 11, color: "var(--text-3)", background: "var(--bg-elevated)", padding: "2px 7px", borderRadius: 20, border: "1px solid var(--border)" }}>M{trade.model}</span>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>{trade.session}</span>
                    <OutcomePill outcome={trade.outcome} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 9, color: "var(--text-3)", margin: "0 0 1px", letterSpacing: "0.06em" }}>ENTRY</p>
                      <p className="font-mono" style={{ fontSize: 12, margin: 0 }}>{trade.entryPrice}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 9, color: "var(--text-3)", margin: "0 0 1px", letterSpacing: "0.06em" }}>SL</p>
                      <p className="font-mono" style={{ fontSize: 12, margin: 0, color: "var(--red)" }}>{trade.slPrice}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 9, color: "var(--text-3)", margin: "0 0 1px", letterSpacing: "0.06em" }}>TP</p>
                      <p className="font-mono" style={{ fontSize: 12, margin: 0, color: "var(--green)" }}>{trade.tpPrice}</p>
                    </div>
                    {trade.resultR != null && (
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontSize: 9, color: "var(--text-3)", margin: "0 0 1px", letterSpacing: "0.06em" }}>RESULT</p>
                        <p className="font-mono" style={{ fontSize: 13, fontWeight: 700, margin: 0, color: resultColor }}>
                          {trade.resultR > 0 ? "+" : ""}{trade.resultR}R
                        </p>
                      </div>
                    )}
                    <span style={{ color: "var(--text-3)", fontSize: 14, transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "none" }}>›</span>
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {isExpanded && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                      <div>
                        <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 4px", fontWeight: 600, letterSpacing: "0.08em" }}>ENTRY REASON</p>
                        <p style={{ fontSize: 13, color: "var(--text-1)", margin: 0, lineHeight: 1.5 }}>{trade.reason}</p>
                      </div>
                      <div style={{ display: "flex", gap: 20 }}>
                        <div>
                          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 3px", letterSpacing: "0.06em" }}>STRONG</p>
                          <p className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--green)", margin: 0 }}>{trade.strongCcy}</p>
                        </div>
                        <div>
                          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 3px", letterSpacing: "0.06em" }}>WEAK</p>
                          <p className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--red)", margin: 0 }}>{trade.weakCcy}</p>
                        </div>
                        {trade.divScore && (
                          <div>
                            <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 3px", letterSpacing: "0.06em" }}>DIV</p>
                            <p className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--blue)", margin: 0 }}>{trade.divScore}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {trade.notes && (
                      <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 12, lineHeight: 1.5 }}>
                        <span style={{ color: "var(--text-3)", fontWeight: 600 }}>Notes: </span>{trade.notes}
                      </p>
                    )}

                    {trade.screenshotUrl && (
                      <img src={trade.screenshotUrl} alt="Trade screenshot"
                        style={{ maxHeight: 240, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 12, display: "block" }} />
                    )}

                    {/* Close trade */}
                    {isOpen && (
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                        <input
                          type="number" step="0.00001"
                          placeholder="Close price"
                          value={closeInputs[trade.id] || ""}
                          onChange={e => setCloseInputs(ci => ({ ...ci, [trade.id]: e.target.value }))}
                          onClick={e => e.stopPropagation()}
                          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-1)", fontSize: 12, fontFamily: "DM Mono, monospace", width: 130 }}
                        />
                        {["Win", "Loss", "BE"].map(outcome => (
                          <button key={outcome} onClick={e => { e.stopPropagation(); closeTrade(trade, outcome); }}
                            style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
                              background: outcome === "Win" ? "var(--green)" : outcome === "Loss" ? "var(--red)" : "var(--bg-elevated)",
                              color: outcome === "Win" || outcome === "Loss" ? "#000" : "var(--text-2)" }}>
                            Close {outcome}
                          </button>
                        ))}
                      </div>
                    )}

                    <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 10 }}>
                      {new Date(trade.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
