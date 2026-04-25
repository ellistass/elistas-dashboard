"use client";
// app/accounts/page.tsx — Account management + add/edit

import { useState, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountStats {
  totalTrades: number; openTrades: number; closedTrades: number;
  wins: number; winRate: number; totalR: number;
  computedPnL: number; pnl: number;
  drawdownRemaining: number; drawdownDanger: boolean;
}
interface Account {
  id: string; createdAt: string; name: string; broker: string;
  type: string; market: string; status: string; currency: string;
  startingBalance: number; currentBalance: number;
  profitTarget: number | null; maxDrawdownPct: number;
  dailyDrawdownLimitPct: number; currentDrawdownPct: number;
  currentDailyDrawdownPct: number; payoutStatus: string;
  notes: string | null; isActive: boolean; stats: AccountStats;
}
interface Aggregate {
  totalAccounts: number; activeAccounts: number;
  byStatus: Record<string, number>;
  totalEquity: number; totalPnL: number; dangerAccounts: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  Phase1:  { bg: "var(--blue-dim)",   color: "var(--blue)",   border: "var(--blue-border)"  },
  Phase2:  { bg: "rgba(99,102,241,0.12)", color: "#a78bfa", border: "rgba(167,139,250,0.3)" },
  Funded:  { bg: "var(--green-dim)",  color: "var(--green)",  border: "var(--green-border)" },
  Live:    { bg: "var(--green-dim)",  color: "var(--green)",  border: "var(--green-border)" },
  Passed:  { bg: "var(--green-dim)",  color: "var(--green)",  border: "var(--green-border)" },
  Failed:  { bg: "var(--red-dim)",    color: "var(--red)",    border: "var(--red-border)"   },
  Breached:{ bg: "var(--red-dim)",    color: "var(--red)",    border: "var(--red-border)"   },
  Archived:{ bg: "var(--bg-elevated)",color: "var(--text-3)", border: "var(--border)"       },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? STATUS_COLORS.Archived;
  return (
    <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 20, fontWeight: 600, letterSpacing: "0.05em",
      background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {status}
    </span>
  );
}

function DrawdownBar({ used, max, danger }: { used: number; max: number; danger: boolean }) {
  const pct = Math.min(100, (used / max) * 100);
  const color = danger ? "var(--red)" : pct > 50 ? "var(--amber)" : "var(--green)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 10, color: "var(--text-3)" }}>
        <span>{used.toFixed(1)}% used</span>
        <span>{max}% max</span>
      </div>
      <div style={{ height: 4, background: "var(--bg-elevated)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

// ── Empty form ────────────────────────────────────────────────────────────────

const emptyForm = {
  name: "", broker: "", type: "Prop", market: "forex", status: "Phase1",
  currency: "USD", startingBalance: "", currentBalance: "",
  profitTarget: "", maxDrawdownPct: "10", dailyDrawdownLimitPct: "5",
  currentDrawdownPct: "0", currentDailyDrawdownPct: "0",
  payoutStatus: "None", notes: "",
};

// ── Main component ────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/accounts");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setAccounts(json.accounts);
      setAggregate(json.aggregate);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditId(null);
    setForm({ ...emptyForm });
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(acc: Account) {
    setEditId(acc.id);
    setForm({
      name: acc.name, broker: acc.broker, type: acc.type, market: acc.market,
      status: acc.status, currency: acc.currency,
      startingBalance: String(acc.startingBalance),
      currentBalance: String(acc.currentBalance),
      profitTarget: acc.profitTarget ? String(acc.profitTarget) : "",
      maxDrawdownPct: String(acc.maxDrawdownPct),
      dailyDrawdownLimitPct: String(acc.dailyDrawdownLimitPct),
      currentDrawdownPct: String(acc.currentDrawdownPct),
      currentDailyDrawdownPct: String(acc.currentDailyDrawdownPct),
      payoutStatus: acc.payoutStatus, notes: acc.notes ?? "",
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save() {
    if (!form.name || !form.broker || !form.startingBalance) {
      setFormError("Name, broker and starting balance are required"); return;
    }
    setSaving(true); setFormError(null);
    try {
      const payload = {
        ...form,
        ...(editId ? { id: editId } : {}),
        currentBalance: form.currentBalance || form.startingBalance,
      };
      const res = await fetch("/api/accounts", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Save failed");
      }
      setShowForm(false);
      await load();
    } catch (e: any) { setFormError(e.message); }
    setSaving(false);
  }

  async function archive(id: string) {
    if (!confirm("Archive this account? It will be hidden from active views.")) return;
    await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
    await load();
  }

  const visibleAccounts = accounts.filter(a => showArchived || a.isActive);

  const inp = (style?: React.CSSProperties): React.CSSProperties => ({
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: "1px solid var(--border)", background: "var(--bg-elevated)",
    color: "var(--text-1)", fontSize: 13, boxSizing: "border-box", ...style,
  });
  const sel = inp;

  const fieldGroup = (label: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginBottom: 5, fontWeight: 500, letterSpacing: "0.05em" }}>{label}</label>
      {children}
    </div>
  );

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Accounts</h1>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            {aggregate?.activeAccounts ?? 0} active · {aggregate?.totalAccounts ?? 0} total
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowArchived(v => !v)}
            style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-3)", fontSize: 12, cursor: "pointer" }}>
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
          <button onClick={openAdd}
            style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + Add Account
          </button>
        </div>
      </div>

      {/* ── Aggregate strip ── */}
      {aggregate && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 24 }}>
          {[
            { label: "Total Equity",  value: fmt(aggregate.totalEquity), color: "var(--text-1)", mono: true },
            { label: "Total P&L",     value: (aggregate.totalPnL >= 0 ? "+" : "") + fmt(aggregate.totalPnL), color: aggregate.totalPnL >= 0 ? "var(--green)" : "var(--red)", mono: true },
            { label: "Phase 1",       value: String(aggregate.byStatus.Phase1 ?? 0),  color: "var(--blue)",  mono: false },
            { label: "Phase 2",       value: String(aggregate.byStatus.Phase2 ?? 0),  color: "#a78bfa",      mono: false },
            { label: "Funded / Live", value: String((aggregate.byStatus.Funded ?? 0) + (aggregate.byStatus.Live ?? 0)), color: "var(--green)", mono: false },
            { label: "Breached",      value: String(aggregate.byStatus.Breached ?? 0), color: aggregate.byStatus.Breached ? "var(--red)" : "var(--text-3)", mono: false },
            ...(aggregate.dangerAccounts > 0 ? [{ label: "⚠ Drawdown Danger", value: String(aggregate.dangerAccounts), color: "var(--amber)", mono: false }] : []),
          ].map(({ label, value, color, mono }) => (
            <div key={label} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
              <p style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" }}>{label}</p>
              <p style={{ fontSize: 20, fontWeight: 600, margin: 0, color, fontFamily: mono ? "DM Mono, monospace" : "inherit" }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Loading / error ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.75s linear infinite", margin: "0 auto 12px" }} />
          <p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading accounts…</p>
        </div>
      )}
      {error && <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--red)", fontSize: 13 }}>{error}</div>}

      {/* ── Accounts table ── */}
      {!loading && !error && (
        visibleAccounts.length === 0 ? (
          <div className="card" style={{ padding: 60, textAlign: "center" }}>
            <p style={{ fontSize: 32, marginBottom: 8 }}>🗂️</p>
            <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>No accounts yet</p>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>Add your first prop firm or live trading account</p>
            <button onClick={openAdd}
              style={{ padding: "9px 20px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              + Add Account
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visibleAccounts.map((acc) => {
              const pnl = acc.stats.pnl;
              const pnlColor = pnl > 0 ? "var(--green)" : pnl < 0 ? "var(--red)" : "var(--text-3)";
              return (
                <div key={acc.id} className="card"
                  style={{ padding: "18px 20px", opacity: acc.isActive ? 1 : 0.55 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" }}>

                    {/* Left */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{acc.name}</span>
                        <StatusPill status={acc.status} />
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{acc.broker}</span>
                        <span style={{ fontSize: 11, color: "var(--text-3)", background: "var(--bg-elevated)", padding: "2px 7px", borderRadius: 20, border: "1px solid var(--border)" }}>{acc.type}</span>
                        {acc.payoutStatus !== "None" && (
                          <span style={{ fontSize: 10, color: acc.payoutStatus === "Paid" ? "var(--green)" : "var(--amber)", background: acc.payoutStatus === "Paid" ? "var(--green-dim)" : "var(--amber-dim)", padding: "2px 7px", borderRadius: 20, border: `1px solid ${acc.payoutStatus === "Paid" ? "var(--green-border)" : "var(--amber-border)"}` }}>
                            Payout: {acc.payoutStatus}
                          </span>
                        )}
                      </div>

                      {/* Balance row */}
                      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
                        <div>
                          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 2px", letterSpacing: "0.06em" }}>BALANCE</p>
                          <p style={{ fontSize: 17, fontWeight: 600, margin: 0, fontFamily: "DM Mono, monospace" }}>{fmt(acc.currentBalance, acc.currency)}</p>
                        </div>
                        <div>
                          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 2px", letterSpacing: "0.06em" }}>START</p>
                          <p style={{ fontSize: 13, margin: 0, color: "var(--text-2)", fontFamily: "DM Mono, monospace" }}>{fmt(acc.startingBalance, acc.currency)}</p>
                        </div>
                        <div>
                          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 2px", letterSpacing: "0.06em" }}>P&L</p>
                          <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: pnlColor, fontFamily: "DM Mono, monospace" }}>
                            {pnl >= 0 ? "+" : ""}{fmt(pnl, acc.currency)}
                          </p>
                        </div>
                        {acc.profitTarget && (
                          <div>
                            <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 2px", letterSpacing: "0.06em" }}>TARGET</p>
                            <p style={{ fontSize: 13, margin: 0, color: "var(--text-2)", fontFamily: "DM Mono, monospace" }}>{fmt(acc.profitTarget, acc.currency)}</p>
                          </div>
                        )}
                        <div>
                          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 2px", letterSpacing: "0.06em" }}>WIN RATE</p>
                          <p style={{ fontSize: 13, margin: 0, color: "var(--text-2)" }}>{acc.stats.winRate}% <span style={{ color: "var(--text-3)" }}>({acc.stats.closedTrades} trades)</span></p>
                        </div>
                        <div>
                          <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 2px", letterSpacing: "0.06em" }}>TOTAL R</p>
                          <p style={{ fontSize: 13, margin: 0, color: acc.stats.totalR >= 0 ? "var(--green)" : "var(--red)", fontFamily: "DM Mono, monospace" }}>
                            {acc.stats.totalR >= 0 ? "+" : ""}{acc.stats.totalR}R
                          </p>
                        </div>
                      </div>

                      {/* Drawdown bar */}
                      <div style={{ maxWidth: 320 }}>
                        <DrawdownBar
                          used={acc.currentDrawdownPct}
                          max={acc.maxDrawdownPct}
                          danger={acc.stats.drawdownDanger}
                        />
                      </div>
                      {acc.stats.drawdownDanger && (
                        <p style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>⚠ Drawdown danger — only {acc.stats.drawdownRemaining.toFixed(1)}% remaining</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => openEdit(acc)}
                        style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-2)", fontSize: 12, cursor: "pointer" }}>
                        Edit
                      </button>
                      {acc.isActive && (
                        <button onClick={() => archive(acc.id)}
                          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--red-border)", background: "var(--red-dim)", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                          Archive
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Add / Edit Modal ── */}
      {showForm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{
            width: "100%", maxWidth: 580, maxHeight: "90vh", overflowY: "auto",
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16,
            padding: 28,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{editId ? "Edit Account" : "Add Account"}</h2>
              <button onClick={() => setShowForm(false)}
                style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {formError && (
              <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: "var(--red-dim)", border: "1px solid var(--red-border)", color: "var(--red)", fontSize: 12 }}>
                {formError}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
              {fieldGroup("Account Name *", <input style={inp()} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="FTMO #1" />)}
              {fieldGroup("Broker *", <input style={inp()} value={form.broker} onChange={e => setForm(f => ({ ...f, broker: e.target.value }))} placeholder="FTMO" />)}
              {fieldGroup("Type", (
                <select style={sel()} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {["Prop", "Live", "Personal", "Demo"].map(t => <option key={t}>{t}</option>)}
                </select>
              ))}
              {fieldGroup("Status", (
                <select style={sel()} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {["Phase1", "Phase2", "Funded", "Live", "Passed", "Failed", "Breached", "Archived"].map(s => <option key={s}>{s}</option>)}
                </select>
              ))}
              {fieldGroup("Starting Balance *", <input style={inp()} type="number" value={form.startingBalance} onChange={e => setForm(f => ({ ...f, startingBalance: e.target.value }))} placeholder="100000" />)}
              {fieldGroup("Current Balance", <input style={inp()} type="number" value={form.currentBalance} onChange={e => setForm(f => ({ ...f, currentBalance: e.target.value }))} placeholder="Same as starting" />)}
              {fieldGroup("Profit Target", <input style={inp()} type="number" value={form.profitTarget} onChange={e => setForm(f => ({ ...f, profitTarget: e.target.value }))} placeholder="10000 (optional)" />)}
              {fieldGroup("Currency", (
                <select style={sel()} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                  {["USD", "EUR", "GBP", "NGN"].map(c => <option key={c}>{c}</option>)}
                </select>
              ))}
              {fieldGroup("Max Drawdown %", <input style={inp()} type="number" value={form.maxDrawdownPct} onChange={e => setForm(f => ({ ...f, maxDrawdownPct: e.target.value }))} placeholder="10" />)}
              {fieldGroup("Daily Drawdown Limit %", <input style={inp()} type="number" value={form.dailyDrawdownLimitPct} onChange={e => setForm(f => ({ ...f, dailyDrawdownLimitPct: e.target.value }))} placeholder="5" />)}
              {fieldGroup("Current Drawdown %", <input style={inp()} type="number" value={form.currentDrawdownPct} onChange={e => setForm(f => ({ ...f, currentDrawdownPct: e.target.value }))} placeholder="0" />)}
              {fieldGroup("Payout Status", (
                <select style={sel()} value={form.payoutStatus} onChange={e => setForm(f => ({ ...f, payoutStatus: e.target.value }))}>
                  {["None", "Requested", "Paid"].map(p => <option key={p}>{p}</option>)}
                </select>
              ))}
            </div>

            {fieldGroup("Notes", (
              <textarea style={{ ...inp(), resize: "vertical", minHeight: 72 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes about this account…" />
            ))}

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={save} disabled={saving}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "var(--green)", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : editId ? "Save Changes" : "Add Account"}
              </button>
              <button onClick={() => setShowForm(false)}
                style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-2)", color: "var(--text-2)", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
