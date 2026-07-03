"use client";
// app/accounts/page.tsx — Account management + add/edit (v2 redesign).
// Pixel-faithful to design-handoff Accounts.dc.html: cyan accent, Lucide icons,
// 6-tile aggregate strip, drawdown-watched account cards, right-side add/edit
// drawer. Data contract unchanged: GET/POST/PATCH /api/accounts, DELETE ?id=.

import { useState, useEffect } from "react";
import { Archive, EyeOff, Plus, Wallet } from "lucide-react";
import { Account, Aggregate, AccountForm, emptyForm, fmt } from "./_components/types";
import { AccountCard } from "./_components/AccountCard";
import { AccountDrawer } from "./_components/AccountDrawer";

const mono = "'DM Mono', monospace";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountForm>({ ...emptyForm });
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

  // ── Aggregate tiles (prototype: 6 fixed tiles; last flips DD danger ↔ Breached) ──
  const aggTiles = aggregate ? (() => {
    const sign = (n: number) => (n >= 0 ? "+" : "");
    const dangerN = aggregate.dangerAccounts;
    const breachedN = aggregate.byStatus.Breached ?? 0;
    return [
      { label: "Total equity", value: fmt(aggregate.totalEquity), color: "var(--text-1)", monoFont: true, tinted: false },
      { label: "Total P&L", value: sign(aggregate.totalPnL) + fmt(aggregate.totalPnL), color: aggregate.totalPnL >= 0 ? "var(--green)" : "var(--red)", monoFont: true, tinted: false },
      { label: "Phase 1", value: String(aggregate.byStatus.Phase1 ?? 0), color: "var(--accent)", monoFont: false, tinted: false },
      { label: "Phase 2", value: String(aggregate.byStatus.Phase2 ?? 0), color: "var(--purple)", monoFont: false, tinted: false },
      { label: "Funded / Live", value: String((aggregate.byStatus.Funded ?? 0) + (aggregate.byStatus.Live ?? 0)), color: "var(--green)", monoFont: false, tinted: false },
      dangerN > 0
        ? { label: "DD danger", value: String(dangerN), color: "var(--amber)", monoFont: false, tinted: true }
        : { label: "Breached", value: String(breachedN), color: breachedN ? "var(--red)" : "var(--text-3)", monoFont: false, tinted: false },
    ];
  })() : [];

  return (
    <div>
      <style>{`
        .acc-agg-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 20px; }
        @media (max-width: 900px) {
          .acc-agg-grid { grid-template-columns: repeat(3, 1fr); }
          .acc-card-grid { grid-template-columns: 1fr !important; }
          .acc-metrics { gap: 18px !important; }
        }
        @media (max-width: 560px) {
          .acc-agg-grid { grid-template-columns: repeat(2, 1fr); }
        }
        .acc-input:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px rgba(58,212,236,0.13); }
        .acc-btn-hover { transition: border-color 0.12s; }
        .acc-btn-hover:hover { border-color: var(--accent) !important; }
        .acc-icon-btn-hover { transition: color 0.12s, border-color 0.12s; }
        .acc-icon-btn-hover:hover { color: var(--accent) !important; border-color: var(--accent) !important; }
        .acc-add-btn { transition: transform 0.12s, box-shadow 0.12s; }
        .acc-add-btn:hover { transform: translateY(-1px); box-shadow: 0 0 30px rgba(58,212,236,0.42); }
      `}</style>

      {/* ── Header ── */}
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>Accounts</h1>
            <span style={{ fontFamily: mono, fontSize: 12, color: "var(--text-3)", paddingTop: 6 }}>
              {aggregate?.activeAccounts ?? 0} active · {aggregate?.totalAccounts ?? 0} total
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-label)", fontWeight: 300 }}>
            Prop-firm phases, funded and live capital — one aggregate view, drawdown watched per account.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <button
            onClick={() => setShowArchived(v => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 14px",
              borderRadius: 9, cursor: "pointer", fontFamily: "'Sora', sans-serif",
              fontSize: 12, fontWeight: 500,
              color: showArchived ? "var(--accent)" : "var(--text-label)",
              background: showArchived ? "rgba(58,212,236,0.1)" : "var(--border-subtle)",
              border: `1px solid ${showArchived ? "rgba(58,212,236,0.3)" : "var(--border-strong)"}`,
            }}
          >
            {showArchived ? <EyeOff size={14} strokeWidth={2} /> : <Archive size={14} strokeWidth={2} />}
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
          <button
            onClick={openAdd}
            className="acc-add-btn"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px",
              borderRadius: 9, border: "none", cursor: "pointer",
              fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 600,
              color: "var(--accent-on)", background: "var(--accent)",
              boxShadow: "0 0 22px rgba(58,212,236,0.26)",
            }}
          >
            <Plus size={15} strokeWidth={2} />
            Add Account
          </button>
        </div>
      </header>

      {/* ── Aggregate strip ── */}
      {aggregate && (
        <div className="acc-agg-grid">
          {aggTiles.map((t) => (
            <div
              key={t.label}
              style={{
                border: `1px solid ${t.tinted ? "rgba(246,183,60,0.22)" : "var(--border)"}`,
                borderRadius: 12,
                background: t.tinted ? "rgba(246,183,60,0.05)" : "var(--bg-card-raised)",
                padding: "13px 15px",
              }}
            >
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--text-3)" }}>
                {t.label}
              </div>
              <div style={{
                fontFamily: t.monoFont ? mono : "'Sora', sans-serif",
                fontSize: t.monoFont ? 18 : 20, fontWeight: 600, marginTop: 7, color: t.color,
              }}>
                {t.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Loading / error ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.75s linear infinite", margin: "0 auto 12px" }} />
          <p style={{ fontSize: 12, color: "var(--text-3)" }}>Loading accounts…</p>
        </div>
      )}
      {error && <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--red)", fontSize: 13 }}>{error}</div>}

      {/* ── Account cards ── */}
      {!loading && !error && (
        visibleAccounts.length === 0 ? (
          <div style={{ border: "1px dashed var(--border)", borderRadius: 14, padding: "50px 20px", textAlign: "center" }}>
            <span style={{ display: "inline-flex", color: "var(--text-3)", marginBottom: 12 }}>
              <Wallet size={30} strokeWidth={2} />
            </span>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>No accounts to show</p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-3)" }}>
              Add a prop-firm or live account, or reveal archived ones.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {visibleAccounts.map((acc) => (
              <AccountCard key={acc.id} account={acc} onEdit={openEdit} onArchive={archive} />
            ))}
          </div>
        )
      )}

      {/* ── Add / Edit drawer ── */}
      {showForm && (
        <AccountDrawer
          form={form}
          setField={(key, value) => setForm(f => ({ ...f, [key]: value }))}
          editing={!!editId}
          saving={saving}
          error={formError}
          onClose={() => setShowForm(false)}
          onSave={save}
        />
      )}
    </div>
  );
}
