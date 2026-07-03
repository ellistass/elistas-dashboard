"use client";
// app/analysis/page.tsx — Analysis history (v2 redesign per History.dc.html)
// Paginated archive of RFDM scoring runs; row click opens the detail drawer.
// Data contracts unchanged: GET /api/alerts/history?page&limit,
// GET /api/alerts/[id], POST /api/alerts (re-run).

import { useState, useEffect, useCallback } from "react";
import { History, Download, Zap } from "lucide-react";
import { Pager } from "../_components/Pager";
import HistoryTable from "./_components/HistoryTable";
import DetailDrawer from "./_components/DetailDrawer";
import { Spinner } from "./_components/Bits";
import {
  HistoryItem,
  Pagination,
  AlertDetail,
  fmtDate,
  fmtTime,
  modelShort,
} from "./_components/types";

const MODEL_FILTERS = ["all", "Sonnet", "Haiku", "Rules"] as const;
type ModelFilter = (typeof MODEL_FILTERS)[number];

export default function AnalysisPage() {
  // ── History list state ──
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    pages: 1,
  });
  const [listLoading, setListLoading] = useState(true);
  const [modelFilter, setModelFilter] = useState<ModelFilter>("all");

  // ── Detail drawer state ──
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Re-run state ──
  const [scoring, setScoring] = useState(false);
  const [runStatus, setRunStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Load list (same API call as before) ──
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

  // ── Load detail on row select (same API call as before) ──
  async function selectItem(id: string) {
    if (selected === id) {
      closeDrawer();
      return;
    }
    setSelected(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/alerts/${id}`);
      if (res.ok) setDetail(await res.json());
    } catch (e) {
      console.error(e);
    }
    setDetailLoading(false);
  }

  function closeDrawer() {
    setSelected(null);
    setDetail(null);
  }

  // ── Re-run with today's data (same POST the old page used for Run Analysis) ──
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
        // Reload list and auto-select the new record
        await loadList(1);
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

  // ── Client-side model filter (API has no model param — filter loaded rows) ──
  const filtered =
    modelFilter === "all"
      ? items
      : items.filter((i) => modelShort(i.scoringModel) === modelFilter);

  // ── Export currently loaded (filtered) rows as CSV — client-side only ──
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Date",
      "Time (WAT)",
      "Model",
      "Strongest",
      "Weakest",
      "Priority",
      "Grade",
      "Divergence",
      "Ideas",
      "Sent",
    ];
    const lines = filtered.map((i) =>
      [
        fmtDate(i.date),
        fmtTime(i.createdAt),
        modelShort(i.scoringModel),
        i.top3.join(" "),
        i.bottom3.join(" "),
        i.priorityPair ?? "",
        i.priorityGrade ?? "",
        i.divergence != null ? i.divergence.toFixed(1) : "",
        i.ideasCount,
        i.sentAt ? "sent" : "not sent",
      ]
        .map(esc)
        .join(","),
    );
    const blob = new Blob([[header.map(esc).join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analysis-history-p${pagination.page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedItem = selected ? items.find((i) => i.id === selected) ?? null : null;

  return (
    <div>
      {/* ── Header ── */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Analysis history
            </h1>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                color: "var(--text-3)",
                paddingTop: 6,
              }}
            >
              <History size={13} strokeWidth={2} />
              {pagination.total} scoring runs
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-label)", fontWeight: 300 }}>
            Every RFDM run archived — click a row to replay its full strength read and ranked
            ideas.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <div className="seg">
            {MODEL_FILTERS.map((m) => (
              <button
                key={m}
                className={modelFilter === m ? "on" : ""}
                onClick={() => setModelFilter(m)}
              >
                {m === "all" ? "All models" : m}
              </button>
            ))}
          </div>
          <button
            onClick={exportCsv}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 15px",
              borderRadius: 9,
              cursor: "pointer",
              fontFamily: "'Sora', sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-1)",
              background: "var(--border-subtle)",
              border: "1px solid var(--border-strong)",
            }}
          >
            <Download size={15} strokeWidth={2} />
            Export
          </button>
        </div>
      </header>

      {/* ── Run status banner (shown after a re-run) ── */}
      {runStatus && (
        <div
          style={{
            marginBottom: 14,
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
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{runStatus.msg}</span>
          <button
            onClick={() => setRunStatus(null)}
            aria-label="Dismiss"
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              opacity: 0.5,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Table / states ── */}
      {listLoading ? (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <Spinner />
          <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12 }}>Loading history…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
            {items.length === 0
              ? "No analysis runs yet"
              : `No ${modelFilter} runs on this page`}
          </p>
          {items.length === 0 && (
            <button
              onClick={() => runAnalysis(false)}
              disabled={scoring}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 18px",
                borderRadius: 9,
                border: "none",
                background: "var(--accent)",
                color: "var(--accent-on)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 0 20px rgba(58,212,236,0.26)",
                opacity: scoring ? 0.6 : 1,
              }}
            >
              {scoring ? <Spinner small /> : <Zap size={15} strokeWidth={2} />}
              {scoring ? "Analysing…" : "Run first analysis"}
            </button>
          )}
        </div>
      ) : (
        <>
          <HistoryTable items={filtered} selectedId={selected} onSelect={selectItem} />
          <Pager
            total={pagination.total}
            pageSize={pagination.limit}
            page={pagination.page - 1}
            onChange={(p) => loadList(p + 1)}
            shown={filtered.length}
          />
        </>
      )}

      {/* ── Detail drawer ── */}
      {selectedItem && (
        <DetailDrawer
          key={selectedItem.id}
          item={selectedItem}
          detail={detail}
          loading={detailLoading}
          rerunning={scoring}
          onRerun={() => runAnalysis(false)}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
