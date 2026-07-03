"use client";
// app/_components/EditTradeDrawer.tsx
//
// Side-mounted modal for fixing a trade after the fact — most importantly
// `initialSlPrice`, without which R math is meaningless once SL gets moved
// to BE or trailed. Also handles outcome / R correction, classification,
// reasoning notes, and entry/close screenshots.
//
// Shared between /accounts/[id] and /journal. Both pages render trade rows
// from the same Trade table; the only difference is layout, so the drawer
// is identical.

import { useEffect, useState } from "react";

// Superset of what any trade-shaped object needs to expose. Both pages
// pre-fetch every field that gets edited here; if a field is missing
// from the source row, the drawer just defaults to empty.
export interface EditableTrade {
  id: string;
  ticket?: number | null;
  pair: string;
  direction: string;
  entryPrice: number;
  slPrice: number;
  initialSlPrice?: number | null;
  riskPercent?: number | null;
  riskAmount?: number | null;
  tpPrice: number;
  closePrice?: number | null;
  outcome?: string | null;
  resultR?: number | null;
  profitCcy?: number | null;
  date: string;
  closeTimeUtc?: string | null;
  model?: string | null;
  grade?: string | null;
  reason?: string | null;
  notes?: string | null;
  preTradeNotes?: string | null;
  postTradeNotes?: string | null;
  screenshotUrl?: string | null;
  closeScreenshotUrl?: string | null;
}

interface Props {
  trade: EditableTrade;
  currency?: string;                       // account ccy; defaults USD for journal-context trades
  // For the "Recompute R from $" fallback. R = profitCcy / (riskPercent% * startingBalance).
  // Pass it from the per-account page; on /journal where we don't know the account, leave
  // undefined and the button stays disabled.
  startingBalance?: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }); }
  catch { return "—"; }
}
function fmtCcy(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(n);
}

export function EditTradeDrawer({ trade, currency = "USD", startingBalance, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    initialSlPrice: trade.initialSlPrice != null ? String(trade.initialSlPrice) : "",
    slPrice: String(trade.slPrice ?? ""),
    tpPrice: String(trade.tpPrice ?? ""),
    closePrice: trade.closePrice != null ? String(trade.closePrice) : "",
    resultR: trade.resultR != null ? String(trade.resultR) : "",
    riskAmount: trade.riskAmount != null ? String(trade.riskAmount) : "",
    ticket: trade.ticket != null ? String(trade.ticket) : "",
    outcome: trade.outcome ?? "Open",
    model: trade.model ?? "",
    grade: trade.grade ?? "",
    reason: trade.reason ?? "",
    notes: trade.notes ?? "",
    preTradeNotes: trade.preTradeNotes ?? "",
    postTradeNotes: trade.postTradeNotes ?? "",
  });
  const [entryShotUrl, setEntryShotUrl] = useState<string | null>(trade.screenshotUrl ?? null);
  const [closeShotUrl, setCloseShotUrl] = useState<string | null>(trade.closeScreenshotUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  // Client-side R computation — mirrors lib/mt4.ts resultR(). Pip size by pair
  // so JPY / metals don't blow up the calc.
  function pipSize(pair: string): number {
    const s = pair.toUpperCase();
    if (s.includes("JPY")) return 0.01;
    if (s.startsWith("XAU")) return 0.1;
    if (s.startsWith("XAG")) return 0.01;
    return 0.0001;
  }
  function computeR(): number | null {
    const entry = trade.entryPrice;
    const sl = parseFloat(form.initialSlPrice);
    const close = parseFloat(form.closePrice);
    if (!entry || !sl || !close) return null;
    const pip = pipSize(trade.pair);
    const riskPips = Math.abs(entry - sl) / pip;
    if (riskPips === 0) return null;
    const profitPips = trade.direction === "Long"
      ? (close - entry) / pip
      : (entry - close) / pip;
    return Number((profitPips / riskPips).toFixed(2));
  }

  function recompute() {
    const r = computeR();
    if (r === null) { setErr("Need entry, initial SL, and close price to compute R."); return; }
    setErr(null);
    const outcome = r >= 0.1 ? "Win" : r <= -0.1 ? "Loss" : "BE";
    setForm((f) => ({ ...f, resultR: String(r), outcome }));
  }

  // Fallback: when the original SL is gone but we know the dollar P&L and the
  // intended risk %, infer R from those. Less precise than the price-based
  // calc (it assumes the trade actually hit the planned risk size) but useful
  // for legacy rows.
  const canRecomputeFromDollars =
    typeof startingBalance === "number" && startingBalance > 0 &&
    typeof trade.riskPercent === "number" && trade.riskPercent > 0 &&
    typeof trade.profitCcy === "number" && Number.isFinite(trade.profitCcy);

  function recomputeFromDollars() {
    if (!canRecomputeFromDollars) {
      setErr("Need risk %, account starting balance, and P&L $ to back-compute R.");
      return;
    }
    const dollarRisk = (trade.riskPercent! / 100) * (startingBalance as number);
    if (dollarRisk === 0) { setErr("Dollar risk is zero — can't divide."); return; }
    const r = Number((trade.profitCcy! / dollarRisk).toFixed(2));
    setErr(null);
    const outcome = r >= 0.1 ? "Win" : r <= -0.1 ? "Loss" : "BE";
    setForm((f) => ({ ...f, resultR: String(r), outcome }));
  }

  async function uploadShot(file: File, phase: "entry" | "close") {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tradeId", trade.id);
    fd.append("phase", phase);
    setBusy(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (j.error) { setErr(j.error); return; }
      const field = phase === "close" ? "closeScreenshotUrl" : "screenshotUrl";
      // Persist URL immediately so it survives a Cancel.
      await fetch("/api/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: trade.id, [field]: j.url }),
      });
      if (phase === "close") setCloseShotUrl(j.url); else setEntryShotUrl(j.url);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const patch: any = { id: trade.id };
      const numKeys = ["initialSlPrice", "slPrice", "tpPrice", "closePrice", "resultR", "riskAmount"] as const;
      for (const k of numKeys) {
        const v = (form as any)[k];
        if (v === "" || v == null) continue;
        const n = parseFloat(v);
        if (Number.isFinite(n)) patch[k] = n;
      }
      // ticket is an MT4 order number — always an integer. Setting it manually
      // on a limbo trade is the rescue path that links the row to its broker fill.
      if (form.ticket !== "") {
        const t = parseInt(form.ticket, 10);
        if (Number.isFinite(t) && t > 0) patch.ticket = t;
      }
      const strKeys = ["outcome", "model", "grade", "reason", "notes", "preTradeNotes", "postTradeNotes"] as const;
      for (const k of strKeys) {
        const v = (form as any)[k];
        if (v !== undefined) patch[k] = v;
      }
      const res = await fetch("/api/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (j.error) { setErr(j.error); return; }
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 100, display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)", height: "100%", overflowY: "auto",
          background: "var(--bg-card)", borderLeft: "1px solid var(--border)",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", margin: 0 }}>EDIT TRADE</p>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "2px 0 0" }}>
              <span className="font-mono">{trade.pair}</span> ·{" "}
              <span style={{ color: trade.direction === "Long" ? "var(--green)" : "var(--red)" }}>{trade.direction}</span>
              {trade.ticket != null && <span style={{ color: "var(--text-3)", fontWeight: 400 }}> · #{trade.ticket}</span>}
            </h2>
          </div>
          <button onClick={onClose} style={drawerBtn("ghost")}>Close</button>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12, lineHeight: 1.5 }}>
          Entry: <span className="font-mono" style={{ color: "var(--text-2)" }}>{fmtNum(trade.entryPrice, 5)}</span> ·{" "}
          Closed: <span className="font-mono" style={{ color: "var(--text-2)" }}>{fmtDate(trade.closeTimeUtc ?? trade.date)}</span>
        </div>

        {err && (
          <p style={{ fontSize: 11, color: "var(--red)", background: "var(--red-dim)", padding: "8px 10px", borderRadius: 6, marginBottom: 10 }}>
            {err}
          </p>
        )}

        <Section title="Risk & result">
          <Grid2>
            <DrawerField label="Initial SL (for R math)" hint="The SL at the moment of fill. Type the original price here — even if BE-moved later.">
              <DrawerInput
                mono
                value={form.initialSlPrice}
                onChange={(v) => setForm({ ...form, initialSlPrice: v })}
                placeholder={form.slPrice}
              />
            </DrawerField>
            <DrawerField label="Current SL" hint="What the SL is now (post-modifications). Informational only.">
              <DrawerInput
                mono
                value={form.slPrice}
                onChange={(v) => setForm({ ...form, slPrice: v })}
              />
            </DrawerField>
            <DrawerField label="Take Profit">
              <DrawerInput mono value={form.tpPrice} onChange={(v) => setForm({ ...form, tpPrice: v })} />
            </DrawerField>
            <DrawerField label="Close Price">
              <DrawerInput mono value={form.closePrice} onChange={(v) => setForm({ ...form, closePrice: v })} />
            </DrawerField>
            <DrawerField label="Risk $" hint="Dollars actually risked in the account's currency. Preferred over risk % for R math.">
              <DrawerInput
                mono
                value={form.riskAmount}
                onChange={(v) => setForm({ ...form, riskAmount: v })}
                placeholder="e.g. 250"
              />
            </DrawerField>
            <DrawerField label="Order # (ticket)" hint="Set this to the MT4 order number to link this trade to its broker fill.">
              <DrawerInput
                mono
                value={form.ticket}
                onChange={(v) => setForm({ ...form, ticket: v.replace(/[^0-9]/g, "") })}
                placeholder="MT4 order #"
              />
            </DrawerField>
            <DrawerField label="Result R">
              <DrawerInput mono value={form.resultR} onChange={(v) => setForm({ ...form, resultR: v })} />
            </DrawerField>
            <DrawerField label="Outcome">
              <DrawerSelect
                value={form.outcome}
                onChange={(v) => setForm({ ...form, outcome: v })}
                options={["Win", "Loss", "BE", "Open"]}
              />
            </DrawerField>
          </Grid2>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={recompute} style={drawerBtn("primary")}>
              Recompute R from initial SL
            </button>
            <button
              onClick={recomputeFromDollars}
              disabled={!canRecomputeFromDollars}
              style={{
                ...drawerBtn("ghost"),
                opacity: canRecomputeFromDollars ? 1 : 0.5,
                cursor: canRecomputeFromDollars ? "pointer" : "not-allowed",
              }}
              title={canRecomputeFromDollars
                ? "Back-compute R from profitCcy / (riskPercent × startingBalance). Use when initial SL is lost."
                : "Needs trade.riskPercent, trade.profitCcy, and account startingBalance"}
            >
              Recompute R from $
            </button>
          </div>
        </Section>

        <Section title="Classification">
          <Grid2>
            <DrawerField label="Model">
              <DrawerInput value={form.model} onChange={(v) => setForm({ ...form, model: v })} placeholder="A / B" />
            </DrawerField>
            <DrawerField label="Grade">
              <DrawerSelect
                value={form.grade}
                onChange={(v) => setForm({ ...form, grade: v })}
                options={["A+", "B", "C", "Skip", ""]}
              />
            </DrawerField>
          </Grid2>
        </Section>

        <Section title="Reasoning">
          <DrawerField label="Entry reason (one line)">
            <DrawerInput value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
          </DrawerField>
          <DrawerField label="Pre-trade notes">
            <DrawerTextarea value={form.preTradeNotes} onChange={(v) => setForm({ ...form, preTradeNotes: v })} />
          </DrawerField>
          <DrawerField label="Post-trade notes">
            <DrawerTextarea value={form.postTradeNotes} onChange={(v) => setForm({ ...form, postTradeNotes: v })} />
          </DrawerField>
          <DrawerField label="General notes">
            <DrawerTextarea value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
          </DrawerField>
        </Section>

        <Section title="Screenshots">
          <ScreenshotSlot
            label="Entry"
            url={entryShotUrl}
            onPick={(f) => uploadShot(f, "entry")}
            disabled={busy}
          />
          <ScreenshotSlot
            label="Close"
            url={closeShotUrl}
            onPick={(f) => uploadShot(f, "close")}
            disabled={busy}
          />
        </Section>

        <Section title="Maintenance">
          <button
            onClick={() => setMergeOpen(true)}
            style={drawerBtn("ghost")}
            title="Fold this trade's journal context into another trade row, then delete this one."
          >
            Merge into another trade…
          </button>
        </Section>

        <div style={{ display: "flex", gap: 8, marginTop: 16, position: "sticky", bottom: 0, paddingTop: 12, background: "var(--bg-card)" }}>
          <button onClick={save} disabled={busy} style={drawerBtn("primary")}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button onClick={onClose} disabled={busy} style={drawerBtn("ghost")}>
            Cancel
          </button>
          {trade.profitCcy != null && (
            <span style={{ fontSize: 10, color: "var(--text-3)", marginLeft: "auto", alignSelf: "center" }}>
              P&L: {fmtCcy(trade.profitCcy ?? 0, currency)}
            </span>
          )}
        </div>
      </div>

      {mergeOpen && (
        <MergePicker
          source={trade}
          onCancel={() => setMergeOpen(false)}
          onMerged={async () => { setMergeOpen(false); await onSaved(); }}
        />
      )}
    </div>
  );
}

// ── Merge picker ─────────────────────────────────────────────────────────────
// Lists candidate target trades — same pair, same direction, within ±7 days —
// and lets the user fold the current trade's journal context into one of them.
// The endpoint /api/trades/merge handles the data move + delete in a tx.
function MergePicker({
  source, onCancel, onMerged,
}: {
  source: EditableTrade;
  onCancel: () => void;
  onMerged: () => void | Promise<void>;
}) {
  const [candidates, setCandidates] = useState<EditableTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // /api/trades returns up to 50 most recent matching the pair filter —
        // enough to surface candidates without hammering the DB.
        const r = await fetch(`/api/trades?pair=${encodeURIComponent(source.pair)}&limit=50`);
        const j = await r.json();
        if (cancelled) return;
        // Filter client-side by direction + exclude self + within ±7 days of source date.
        const srcDate = new Date(source.date).getTime();
        const week = 7 * 24 * 60 * 60 * 1000;
        const list = (j.trades ?? []).filter((t: any) =>
          t.id !== source.id
          && t.direction === source.direction
          && Math.abs(new Date(t.date).getTime() - srcDate) <= week
        );
        setCandidates(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [source.id, source.pair, source.direction, source.date]);

  async function doMerge() {
    if (!targetId) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/trades/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, targetId, overwrite }),
      });
      const j = await res.json();
      if (j.error) { setErr(j.error); return; }
      await onMerged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 120,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 95vw)", maxHeight: "85vh", overflow: "auto",
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: 10, padding: 18,
        }}
      >
        <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 12px" }}>
          MERGE INTO ANOTHER TRADE
        </p>

        <p style={{ fontSize: 11, color: "var(--text-2)", margin: "0 0 6px", lineHeight: 1.5 }}>
          Pick a target. Non-empty journal fields from <strong>{source.pair} {source.direction}{source.ticket ? ` #${source.ticket}` : ""}</strong> will be folded into it, then this row will be deleted.
        </p>
        <p style={{ fontSize: 10, color: "var(--text-3)", margin: "0 0 12px", lineHeight: 1.5 }}>
          Tags are always unioned. Other fields only fill blanks on the target unless overwrite is checked.
        </p>

        {loading && <p style={{ fontSize: 11, color: "var(--text-3)" }}>Loading candidates…</p>}
        {!loading && candidates.length === 0 && (
          <p style={{ fontSize: 11, color: "var(--text-3)" }}>
            No candidate trades found (same pair, same direction, within ±7 days).
          </p>
        )}

        {candidates.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {candidates.map((c) => {
              const on = targetId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setTargetId(c.id)}
                  style={{
                    textAlign: "left", padding: "8px 10px", borderRadius: 6,
                    border: `1px solid ${on ? "var(--blue-border)" : "var(--border)"}`,
                    background: on ? "var(--blue-dim)" : "transparent",
                    color: "var(--text-1)", fontSize: 12, cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span>
                      <span className="font-mono">{c.pair}</span>{" "}
                      <span style={{ color: c.direction === "Long" ? "var(--green)" : "var(--red)" }}>{c.direction}</span>
                      {c.ticket != null && (
                        <span className="font-mono" style={{ fontSize: 10, color: "var(--text-3)", marginLeft: 6 }}>
                          #{c.ticket}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                      {fmtDate(c.closeTimeUtc ?? c.date)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>
                    {c.outcome ?? "—"} · entry {fmtNum(c.entryPrice, 5)} · R {fmtNum(c.resultR, 2)}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          Overwrite existing target values (default: only fill blanks)
        </label>

        {err && <p style={{ fontSize: 11, color: "var(--red)", marginBottom: 10 }}>{err}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={doMerge}
            disabled={busy || !targetId}
            style={drawerBtn("primary")}
          >
            {busy ? "Merging…" : "Merge & delete this row"}
          </button>
          <button onClick={onCancel} disabled={busy} style={drawerBtn("ghost")}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── small bits ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-3)", margin: "0 0 8px" }}>
        {title.toUpperCase()}
      </p>
      {children}
    </div>
  );
}
function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}
function DrawerField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 10, color: "var(--text-3)", margin: "3px 0 0", lineHeight: 1.4 }}>{hint}</p>}
    </div>
  );
}
function DrawerInput({
  value, onChange, mono, placeholder,
}: { value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "6px 10px", fontSize: 12,
        fontFamily: mono ? "var(--font-mono, monospace)" : undefined,
        background: "var(--bg-elevated)", border: "1px solid var(--border)",
        borderRadius: 4, color: "var(--text-1)",
      }}
    />
  );
}
function DrawerSelect({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", padding: "6px 10px", fontSize: 12,
        background: "var(--bg-elevated)", border: "1px solid var(--border)",
        borderRadius: 4, color: "var(--text-1)",
      }}
    >
      {options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
    </select>
  );
}
function DrawerTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      style={{
        width: "100%", padding: "6px 10px", fontSize: 12, resize: "vertical",
        background: "var(--bg-elevated)", border: "1px solid var(--border)",
        borderRadius: 4, color: "var(--text-1)", fontFamily: "inherit",
      }}
    />
  );
}
function ScreenshotSlot({
  label, url, onPick, disabled,
}: { label: string; url: string | null; onPick: (f: File) => void; disabled?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>{label}</span>
        <label style={{ ...drawerBtn("ghost"), cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}>
          {url ? "Replace" : "Upload"}
          <input
            type="file"
            accept="image/*"
            disabled={disabled}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
            style={{ display: "none" }}
          />
        </label>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={`${label} screenshot`} style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 4, background: "var(--bg-elevated)" }} />
        </a>
      ) : (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "12px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 4 }}>
          No {label.toLowerCase()} screenshot yet.
        </div>
      )}
    </div>
  );
}
function drawerBtn(variant: "primary" | "ghost"): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11, padding: "6px 12px", borderRadius: 6, cursor: "pointer", border: "none",
  };
  if (variant === "primary") return { ...base, background: "var(--green)", color: "#001a14", fontWeight: 500 };
  return { ...base, background: "transparent", color: "var(--text-2)", border: "1px solid var(--border)" };
}
