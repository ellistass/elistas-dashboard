"use client";
// app/journal/page.tsx — Trade Journal (dark theme, free-form pair, account selector)

import { useState, useEffect, useRef } from "react";
import { ImagePlus } from "lucide-react";
import { EditTradeDrawer } from "@/app/_components/EditTradeDrawer";
import { Pager } from "@/app/_components/Pager";

const PAGE_SIZE = 50;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Trade {
  id: string; date: string; pair: string; direction: string;
  model: string; grade: string; session: string;
  entryPrice: number; slPrice: number; initialSlPrice: number | null; tpPrice: number;
  closePrice: number | null; resultR: number | null;
  outcome: string; reason: string; notes: string | null;
  preTradeNotes: string | null; postTradeNotes: string | null;
  screenshotUrl: string | null; closeScreenshotUrl: string | null;
  strongCcy: string; weakCcy: string;
  divScore: number | null; accountId: string | null;
  ticket: number | null; profitCcy: number | null; closeTimeUtc: string | null;
  riskPercent: number | null; riskAmount: number | null;
}
interface AccountOption { id: string; name: string; broker: string; status: string; currentBalance: number; }

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
  riskAmount: "",
  ticket: "",
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
  const [shotName, setShotName] = useState("");
  // Edit drawer + multi-select state. Selection survives across drawer open/close
  // so you can pick a batch, edit one, save, and the rest stay checked. Selection
  // also persists across pages — flip pages, the selection set keeps growing.
  const [editing, setEditing] = useState<Trade | null>(null);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<null | "edit" | "account">(null);
  const [bulkForm, setBulkForm] = useState({ grade: "", model: "", tag: "" });
  const [bulkAccountId, setBulkAccountId] = useState("");
  const bulkFileRef = useRef<HTMLInputElement>(null);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  // PATCH the same body across every selected trade. We don't have a real
  // batch endpoint yet — Promise.all keeps the round-trips parallel.
  async function patchAll(body: Record<string, any>) {
    const ids = Array.from(selectedIds);
    setBulkBusy(true); setBulkErr(null);
    try {
      await Promise.all(ids.map((id) =>
        fetch("/api/trades", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...body }),
        })
      ));
      await fetchTrades();
    } catch (e: any) {
      setBulkErr(e?.message ?? "bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAttachScreenshot(file: File) {
    setBulkBusy(true); setBulkErr(null);
    try {
      // Upload once to a synthetic key, then PATCH the URL onto every selected
      // trade. /api/upload requires a tradeId for path uniqueness; we use the
      // first selected id so the object lives somewhere predictable.
      const firstId = Array.from(selectedIds)[0] ?? "bulk";
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tradeId", firstId);
      fd.append("phase", "entry");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (j.error || !j.url) { setBulkErr(j.error ?? "upload failed"); setBulkBusy(false); return; }
      await patchAll({ screenshotUrl: j.url });
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} trade${selectedIds.size > 1 ? "s" : ""}? This can't be undone.`)) return;
    setBulkBusy(true); setBulkErr(null);
    try {
      const res = await fetch("/api/trades", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const j = await res.json();
      if (j.error) { setBulkErr(j.error); return; }
      clearSelection();
      await fetchTrades();
    } finally {
      setBulkBusy(false);
    }
  }

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
        currentBalance: typeof a.currentBalance === "number" ? a.currentBalance : 0,
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
      const payload: Record<string, any> = {
        ...form,
        accountId: form.accountId || null,
      };
      // riskAmount ($) and ticket (MT4 order #) only go up when actually filled.
      delete payload.riskAmount;
      delete payload.ticket;
      const riskAmt = parseFloat(form.riskAmount);
      if (Number.isFinite(riskAmt) && riskAmt > 0) payload.riskAmount = riskAmt;
      const ticketNum = parseInt(form.ticket, 10);
      if (Number.isFinite(ticketNum) && ticketNum > 0) payload.ticket = ticketNum;
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
      setShotName("");
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
        <button onClick={() => { setForm({ ...emptyForm }); setShotName(""); setShowForm(true); }}
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

              {/* Row 3b — risk sizing + broker link */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", marginBottom: 14 }}>
                {field("Risk $", (() => {
                  const acct = accounts.find(a => a.id === form.accountId);
                  const amt = parseFloat(form.riskAmount);
                  const pct = acct && acct.currentBalance > 0 && Number.isFinite(amt) && amt > 0
                    ? (amt / acct.currentBalance) * 100 : null;
                  return (
                    <div>
                      <input type="number" step="1" min="0" style={inp({ fontFamily: "DM Mono, monospace" })}
                        placeholder="e.g. 250" value={form.riskAmount}
                        onChange={e => setForm(f => ({ ...f, riskAmount: e.target.value }))} />
                      {pct != null && (
                        <p style={{ fontSize: 10, margin: "4px 0 0", fontFamily: "DM Mono, monospace",
                          color: pct > 2 ? "var(--amber)" : "var(--text-3)" }}>
                          {pct.toFixed(2)}% of {acct!.name} (${Math.round(acct!.currentBalance).toLocaleString()})
                        </p>
                      )}
                    </div>
                  );
                })())}
                {field("Order #", (
                  <input type="number" step="1" min="0" style={inp({ fontFamily: "DM Mono, monospace" })}
                    placeholder="MT4 order # (optional)" value={form.ticket}
                    onChange={e => setForm(f => ({ ...f, ticket: e.target.value }))} />
                ))}
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

              {/* Screenshot — attached at creation via fileRef, uploaded right after the POST */}
              <div style={{ marginBottom: 14 }}>
                <input
                  ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => setShotName(e.target.files?.[0]?.name ?? "")}
                />
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "9px 14px", borderRadius: 10, cursor: "pointer",
                    border: `1px dashed ${shotName ? "var(--accent)" : "var(--border)"}`,
                    background: "var(--bg-card-2)", color: shotName ? "var(--text-1)" : "var(--text-2)",
                    fontSize: 12, fontFamily: "inherit",
                  }}>
                  <ImagePlus size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
                  {uploading ? "Uploading…" : shotName || "Attach chart screenshot"}
                </button>
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
          {trades.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(trade => {
            const isOpen = trade.outcome === "Open";
            const isExpanded = expanded === trade.id;
            const resultColor = trade.resultR != null
              ? trade.resultR > 0 ? "var(--green)" : trade.resultR < 0 ? "var(--red)" : "var(--text-3)"
              : "var(--text-3)";

            const isSelected = selectedIds.has(trade.id);
            return (
              <div key={trade.id} className="card"
                style={{
                  padding: "14px 18px", cursor: "pointer", transition: "border-color 0.1s",
                  borderColor: isSelected ? "var(--blue-border)" : undefined,
                  background: isSelected ? "var(--blue-dim)" : undefined,
                }}
                onClick={() => setExpanded(isExpanded ? null : trade.id)}>
                {/* ── Trade row ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(trade.id)}
                      style={{ cursor: "pointer", width: 14, height: 14 }}
                      title="Select for bulk action"
                    />
                    <span className="font-mono" style={{ fontSize: 14, fontWeight: 700 }}>{trade.pair}</span>
                    {trade.ticket != null && (
                      <span
                        className="font-mono"
                        title="MT4 order number — match this against your terminal's Account History tab"
                        style={{
                          fontSize: 10, color: "var(--text-3)", background: "var(--bg-elevated)",
                          padding: "2px 7px", borderRadius: 4, border: "1px solid var(--border)",
                        }}
                      >
                        #{trade.ticket}
                      </span>
                    )}
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
                    {trade.profitCcy != null && (
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontSize: 9, color: "var(--text-3)", margin: "0 0 1px", letterSpacing: "0.06em" }}>RESULT</p>
                        <p className="font-mono" style={{
                          fontSize: 13, fontWeight: 700, margin: 0,
                          color: (trade.profitCcy ?? 0) > 0 ? "var(--green)"
                                 : (trade.profitCcy ?? 0) < 0 ? "var(--red)"
                                 : "var(--text-3)",
                        }}>
                          {(trade.profitCcy ?? 0) >= 0 ? "+" : ""}${trade.profitCcy.toFixed(2)}
                        </p>
                        {/* Show R only when initialSlPrice is set — otherwise the calc
                            is from the modified SL and shouldn't be trusted. */}
                        {trade.initialSlPrice != null && trade.resultR != null && (
                          <p className="font-mono" style={{ fontSize: 10, color: "var(--text-3)", margin: "1px 0 0" }}>
                            {trade.resultR > 0 ? "+" : ""}{trade.resultR}R
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(trade); }}
                      style={{
                        fontSize: 10, padding: "4px 10px", borderRadius: 6,
                        background: "transparent", color: "var(--text-2)",
                        border: "1px solid var(--border)", cursor: "pointer",
                      }}
                      title="Edit trade / fix R / attach screenshot"
                    >
                      Edit
                    </button>
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
                        {/* Prefer the concrete $ risked; fall back to planned % */}
                        {(trade.riskAmount != null || trade.riskPercent != null) && (
                          <div>
                            <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 3px", letterSpacing: "0.06em" }}>RISK</p>
                            <p className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-2)", margin: 0 }}>
                              {trade.riskAmount != null
                                ? `$${Math.round(trade.riskAmount).toLocaleString()}`
                                : `${trade.riskPercent}%`}
                            </p>
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
          <Pager total={trades.length} pageSize={PAGE_SIZE} page={page} onChange={setPage} />
        </div>
      )}

      {editing && (
        <EditTradeDrawer
          trade={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await fetchTrades(); }}
        />
      )}

      {/* Sticky bulk-action toolbar — only when ≥1 selected */}
      {selectedIds.size > 0 && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 60,
          background: "var(--bg-card)", borderTop: "1px solid var(--border)",
          padding: "10px 18px", display: "flex", alignItems: "center", gap: 10,
          flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>
            {selectedIds.size} selected
          </span>
          <button onClick={clearSelection} style={bulkBtn("ghost")}>Clear</button>

          <span style={{ width: 1, height: 18, background: "var(--border)" }} />

          <label style={{ ...bulkBtn("ghost"), cursor: bulkBusy ? "wait" : "pointer", opacity: bulkBusy ? 0.6 : 1 }}>
            Attach screenshot
            <input
              ref={bulkFileRef}
              type="file" accept="image/*"
              disabled={bulkBusy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) bulkAttachScreenshot(f); }}
              style={{ display: "none" }}
            />
          </label>

          <button onClick={() => setBulkMode("edit")} disabled={bulkBusy} style={bulkBtn("ghost")}>
            Edit fields
          </button>
          <button onClick={() => setBulkMode("account")} disabled={bulkBusy} style={bulkBtn("ghost")}>
            Assign account
          </button>

          <button onClick={bulkDelete} disabled={bulkBusy} style={bulkBtn("danger")}>
            Delete
          </button>

          {bulkErr && <span style={{ fontSize: 11, color: "var(--red)" }}>{bulkErr}</span>}
          {bulkBusy && <span style={{ fontSize: 11, color: "var(--text-3)" }}>working…</span>}
        </div>
      )}

      {/* Bulk edit popover — grade / model / add-tag (only sends fields you fill) */}
      {bulkMode === "edit" && (
        <div onClick={() => setBulkMode(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 80,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 10, padding: 18, width: "min(400px, 90vw)",
          }}>
            <p style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 12px" }}>
              EDIT {selectedIds.size} TRADE{selectedIds.size > 1 ? "S" : ""}
            </p>
            <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 12px" }}>
              Leave blank to skip a field.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>Grade</label>
                <select
                  value={bulkForm.grade}
                  onChange={(e) => setBulkForm({ ...bulkForm, grade: e.target.value })}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)" }}
                >
                  <option value="">— no change —</option>
                  <option>A+</option><option>B</option><option>C</option><option>Skip</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>Model</label>
                <select
                  value={bulkForm.model}
                  onChange={(e) => setBulkForm({ ...bulkForm, model: e.target.value })}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)" }}
                >
                  <option value="">— no change —</option>
                  <option value="A">A — Wyckoff trap</option>
                  <option value="B">B — Liquidity run</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>Append tag</label>
              <input
                value={bulkForm.tag}
                onChange={(e) => setBulkForm({ ...bulkForm, tag: e.target.value })}
                placeholder="e.g. revenge, post-news, journal-cleanup"
                style={{ width: "100%", padding: "6px 10px", fontSize: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)" }}
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={bulkBusy}
                onClick={async () => {
                  const patch: Record<string, any> = {};
                  if (bulkForm.grade) patch.grade = bulkForm.grade;
                  if (bulkForm.model) patch.model = bulkForm.model;
                  // Tag is appended per-row. For brevity here we just include it
                  // in the same patch — the server's PATCH does {...updates}, so
                  // sending `tags: [tag]` would REPLACE the array. We use a
                  // dedicated tag-append loop instead.
                  if (Object.keys(patch).length > 0) await patchAll(patch);
                  if (bulkForm.tag.trim()) {
                    setBulkBusy(true);
                    try {
                      // Per-row append: GET → push → PATCH. Acceptable for the
                      // batch sizes we're dealing with (tens, not hundreds).
                      const ids = Array.from(selectedIds);
                      const current = trades.filter((t) => ids.includes(t.id));
                      await Promise.all(current.map((t) =>
                        fetch("/api/trades", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: t.id, tags: Array.from(new Set([...((t as any).tags ?? []), bulkForm.tag.trim()])) }),
                        })
                      ));
                      await fetchTrades();
                    } finally { setBulkBusy(false); }
                  }
                  setBulkMode(null);
                  setBulkForm({ grade: "", model: "", tag: "" });
                }}
                style={bulkBtn("primary")}
              >
                Apply to {selectedIds.size}
              </button>
              <button onClick={() => setBulkMode(null)} style={bulkBtn("ghost")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk-assign account popover */}
      {bulkMode === "account" && (
        <div onClick={() => setBulkMode(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 80,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 10, padding: 18, width: "min(400px, 90vw)",
          }}>
            <p style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 12px" }}>
              ASSIGN {selectedIds.size} TRADE{selectedIds.size > 1 ? "S" : ""} TO ACCOUNT
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              <button
                onClick={() => setBulkAccountId("")}
                style={{
                  fontSize: 11, padding: "5px 10px", borderRadius: 6,
                  border: `1px solid ${bulkAccountId === "" ? "var(--amber-border)" : "var(--border)"}`,
                  background: bulkAccountId === "" ? "var(--amber-dim)" : "transparent",
                  color: bulkAccountId === "" ? "var(--amber)" : "var(--text-2)",
                  cursor: "pointer",
                }}
              >
                Unlink (no account)
              </button>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setBulkAccountId(a.id)}
                  style={{
                    fontSize: 11, padding: "5px 10px", borderRadius: 6,
                    border: `1px solid ${bulkAccountId === a.id ? "var(--blue-border)" : "var(--border)"}`,
                    background: bulkAccountId === a.id ? "var(--blue-dim)" : "transparent",
                    color: bulkAccountId === a.id ? "var(--blue)" : "var(--text-2)",
                    cursor: "pointer",
                  }}
                >
                  {a.name} <span style={{ opacity: 0.6 }}>· {a.status}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={bulkBusy}
                onClick={async () => {
                  await patchAll({ accountId: bulkAccountId || null });
                  setBulkMode(null);
                  setBulkAccountId("");
                }}
                style={bulkBtn("primary")}
              >
                Apply
              </button>
              <button onClick={() => setBulkMode(null)} style={bulkBtn("ghost")}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function bulkBtn(variant: "primary" | "ghost" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
  };
  if (variant === "primary") return { ...base, background: "var(--green)", color: "#001a14", border: "none", fontWeight: 500 };
  if (variant === "danger")  return { ...base, background: "var(--red-dim)", color: "var(--red)", border: "1px solid var(--red-border)" };
  return { ...base, background: "transparent", color: "var(--text-2)", border: "1px solid var(--border)" };
}
