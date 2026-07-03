"use client";
// app/accounts/_components/AccountDrawer.tsx — right-side add/edit drawer.
// Replaces the old centered modal; same payload shape and validation, new shell
// (.drawer-scrim / .drawer-panel from globals.css). Layout per Accounts.dc.html:
// Identity → Capital → Risk limits → Notes, segmented pickers instead of <select>.

import { useEffect } from "react";
import { X, Check } from "lucide-react";
import { AccountForm, statusMeta } from "./types";

const mono = "'DM Mono', monospace";

const TYPE_OPTS = ["Prop", "Live", "Personal", "Demo"];
const STATUS_OPTS = ["Phase1", "Phase2", "Funded", "Live", "Passed", "Failed", "Breached", "Archived"];
const CURRENCY_OPTS = ["USD", "EUR", "GBP", "NGN"];
const PAYOUT_OPTS = ["None", "Requested", "Paid"];

const CYAN = { color: "var(--accent)", bg: "rgba(58,212,236,0.12)", border: "rgba(58,212,236,0.4)" };
const PAYOUT_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  None:      CYAN,
  Requested: { color: "var(--amber)", bg: "rgba(246,183,60,0.12)", border: "rgba(246,183,60,0.4)" },
  Paid:      { color: "var(--green)", bg: "rgba(35,224,160,0.12)", border: "rgba(35,224,160,0.4)" },
};

function SegButton({
  label, on, onPick, colors, grow, monoFont,
}: {
  label: string; on: boolean; onPick: () => void;
  colors: { color: string; bg: string; border: string };
  grow?: boolean; monoFont?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      style={{
        flex: grow ? 1 : undefined,
        padding: grow ? "9px 0" : "7px 12px",
        borderRadius: 8, cursor: "pointer",
        fontFamily: monoFont ? mono : "'Sora', sans-serif",
        fontSize: 12, fontWeight: 500,
        color: on ? colors.color : "var(--text-label)",
        background: on ? colors.bg : "var(--bg-card-2)",
        border: `1px solid ${on ? colors.border : "var(--border)"}`,
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-label)", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="kicker" style={{ margin: "0 0 12px" }}>{children}</p>;
}

export function AccountDrawer({
  form, setField, editing, saving, error, onClose, onSave,
}: {
  form: AccountForm;
  setField: (key: keyof AccountForm, value: string) => void;
  editing: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const input = (key: keyof AccountForm, placeholder: string) => (
    <input
      className="acc-input"
      value={form[key]}
      onChange={(e) => setField(key, e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", boxSizing: "border-box", background: "var(--bg-card-2)",
        border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px",
        fontSize: 13, color: "var(--text-1)", outline: "none", fontFamily: mono,
      }}
    />
  );

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label={editing ? "Edit account" : "New account"}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 22px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div>
            <p className="kicker" style={{ margin: 0, color: "var(--accent)" }}>
              {editing ? "Edit account" : "New account"}
            </p>
            <h2 style={{ margin: "5px 0 0", fontSize: 19, fontWeight: 600 }}>
              {editing ? (form.name || "Account") : "Add Account"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 8, background: "var(--bg-card-2)",
              border: "1px solid var(--border)", color: "var(--text-label)", cursor: "pointer",
            }}
          >
            <X size={17} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 20 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,84,112,0.1)", border: "1px solid rgba(255,84,112,0.28)", color: "var(--red)", fontSize: 12 }}>
              {error}
            </div>
          )}

          {/* Identity */}
          <div>
            <SectionLabel>Identity</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Account name">{input("name", "FTMO Challenge #1")}</Field>
              <Field label="Broker">{input("broker", "FTMO")}</Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-label)", marginBottom: 6 }}>Type</label>
              <div style={{ display: "flex", gap: 6 }}>
                {TYPE_OPTS.map((t) => (
                  <SegButton key={t} label={t} grow on={form.type === t} onPick={() => setField("type", t)} colors={CYAN} />
                ))}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-label)", marginBottom: 6 }}>Status</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {STATUS_OPTS.map((s) => {
                  const sm = statusMeta(s);
                  return (
                    <SegButton
                      key={s} label={s} on={form.status === s}
                      onPick={() => setField("status", s)}
                      colors={{ color: sm.color, bg: sm.bg, border: sm.border }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Capital */}
          <div style={{ paddingTop: 18, borderTop: "1px solid var(--border-faint)" }}>
            <SectionLabel>Capital</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Starting balance">{input("startingBalance", "100000")}</Field>
              <Field label="Current balance">{input("currentBalance", "Same as starting")}</Field>
              <Field label="Profit target">{input("profitTarget", "10000 (optional)")}</Field>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-label)", marginBottom: 6 }}>Currency</label>
                <div style={{ display: "flex", gap: 5 }}>
                  {CURRENCY_OPTS.map((c) => (
                    <SegButton key={c} label={c} grow monoFont on={form.currency === c} onPick={() => setField("currency", c)} colors={CYAN} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Risk limits */}
          <div style={{ paddingTop: 18, borderTop: "1px solid var(--border-faint)" }}>
            <SectionLabel>Risk limits</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Max DD %">{input("maxDrawdownPct", "10")}</Field>
              <Field label="Daily DD %">{input("dailyDrawdownLimitPct", "5")}</Field>
              <Field label="Current DD %">{input("currentDrawdownPct", "0")}</Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-label)", marginBottom: 6 }}>Payout status</label>
              <div style={{ display: "flex", gap: 6 }}>
                {PAYOUT_OPTS.map((p) => (
                  <SegButton key={p} label={p} grow on={form.payoutStatus === p} onPick={() => setField("payoutStatus", p)} colors={PAYOUT_COLORS[p]} />
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div style={{ paddingTop: 18, borderTop: "1px solid var(--border-faint)" }}>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-label)", marginBottom: 6 }}>Notes</label>
            <textarea
              className="acc-input"
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="Reset date, rules quirks, broker notes…"
              style={{
                width: "100%", boxSizing: "border-box", minHeight: 64,
                background: "var(--bg-card-2)", border: "1px solid var(--border)", borderRadius: 8,
                padding: "10px 12px", fontSize: 12, color: "var(--text-1)", outline: "none",
                resize: "vertical", lineHeight: 1.5, fontFamily: mono,
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, padding: "16px 22px", borderTop: "1px solid var(--border-subtle)", background: "#0b0d13" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: 11, borderRadius: 9, cursor: "pointer",
              fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 500,
              color: "var(--text-label)", background: "transparent", border: "1px solid var(--border)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: 11, borderRadius: 9, border: "none", cursor: "pointer",
              fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 600,
              color: "var(--accent-on)", background: "var(--accent)",
              boxShadow: "0 0 20px rgba(58,212,236,0.26)", opacity: saving ? 0.6 : 1,
            }}
          >
            <Check size={15} strokeWidth={2} />
            {saving ? "Saving…" : editing ? "Save changes" : "Add account"}
          </button>
        </div>
      </aside>
    </>
  );
}
