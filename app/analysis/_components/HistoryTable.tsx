"use client";
// app/analysis/_components/HistoryTable.tsx
// History table (desktop) + stacked-card reflow (narrow viewports).

import { ChevronRight } from "lucide-react";
import {
  HistoryItem,
  fmtDate,
  fmtTime,
  modelShort,
  inferDirection,
} from "./types";
import { GradePill, DirArrow, SentIcon, CurrencyChips } from "./Bits";

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  fontFamily: "'DM Mono', monospace",
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  fontWeight: 500,
};
const TD: React.CSSProperties = { padding: "13px 16px" };

interface Props {
  items: HistoryItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function HistoryTable({ items, selectedId, onSelect }: Props) {
  return (
    <>
      <style>{`
        .ah-row:hover { background: #12141d !important; }
        .ah-card:hover { background: #12141d !important; }
        .ah-cards { display: none; }
        @media (max-width: 860px) {
          .ah-table-wrap { display: none; }
          .ah-cards { display: flex; }
        }
      `}</style>

      {/* ── Desktop table ── */}
      <div
        className="ah-table-wrap"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 14,
          background: "var(--bg-card)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ background: "#0c0e15" }}>
                <th style={TH}>Run</th>
                <th style={TH}>Strongest</th>
                <th style={TH}>Weakest</th>
                <th style={TH}>Priority</th>
                <th style={{ ...TH, textAlign: "center" }}>Grade</th>
                <th style={{ ...TH, textAlign: "right" }}>Divergence</th>
                <th style={{ ...TH, textAlign: "center" }}>Ideas</th>
                <th style={{ ...TH, textAlign: "center", color: "var(--text-label)" }}>Sent</th>
                <th style={{ ...TH, width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const selected = selectedId === item.id;
                return (
                  <tr
                    key={item.id}
                    className="ah-row"
                    onClick={() => onSelect(item.id)}
                    style={{
                      borderTop: "1px solid var(--border-faint)",
                      background: selected ? "rgba(58,212,236,0.05)" : "transparent",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                  >
                    <td style={{ ...TD, whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                        {fmtDate(item.date)}
                      </div>
                      <div
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          color: "var(--text-3)",
                          marginTop: 2,
                        }}
                      >
                        {fmtTime(item.createdAt)} WAT · {modelShort(item.scoringModel)}
                      </div>
                    </td>
                    <td style={TD}>
                      <CurrencyChips currencies={item.top3} tone="green" />
                    </td>
                    <td style={TD}>
                      <CurrencyChips currencies={item.bottom3} tone="red" />
                    </td>
                    <td style={TD}>
                      {item.priorityPair ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 7,
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 14,
                            color: "var(--text-1)",
                          }}
                        >
                          <DirArrow direction={inferDirection(item)} />
                          {item.priorityPair}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-3)" }}>—</span>
                      )}
                    </td>
                    <td style={{ ...TD, textAlign: "center" }}>
                      <GradePill grade={item.priorityGrade} />
                    </td>
                    <td
                      style={{
                        ...TD,
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 15,
                        fontWeight: 500,
                        color: "var(--accent)",
                      }}
                    >
                      {item.divergence != null ? `${item.divergence.toFixed(1)}σ` : "—"}
                    </td>
                    <td
                      style={{
                        ...TD,
                        textAlign: "center",
                        fontFamily: "'DM Mono', monospace",
                        color: "var(--text-label)",
                      }}
                    >
                      {item.ideasCount}
                    </td>
                    <td style={{ ...TD, textAlign: "center" }}>
                      <SentIcon sent={!!item.sentAt} />
                    </td>
                    <td style={{ ...TD, textAlign: "right" }}>
                      <span style={{ color: "var(--text-3)", display: "inline-flex" }}>
                        <ChevronRight size={16} strokeWidth={2} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Narrow-viewport stacked cards ── */}
      <div className="ah-cards" style={{ flexDirection: "column", gap: 10 }}>
        {items.map((item) => {
          const selected = selectedId === item.id;
          return (
            <div
              key={item.id}
              className="ah-card"
              onClick={() => onSelect(item.id)}
              style={{
                border: `1px solid ${selected ? "rgba(58,212,236,0.3)" : "var(--border)"}`,
                borderRadius: 12,
                background: selected ? "rgba(58,212,236,0.05)" : "var(--bg-card)",
                padding: "13px 15px",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 9,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                    {fmtDate(item.date)}
                  </div>
                  <div
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 10,
                      color: "var(--text-3)",
                      marginTop: 2,
                    }}
                  >
                    {fmtTime(item.createdAt)} WAT · {modelShort(item.scoringModel)}
                  </div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <SentIcon sent={!!item.sentAt} size={14} />
                  <GradePill grade={item.priorityGrade} size={11} />
                  <span style={{ color: "var(--text-3)", display: "inline-flex" }}>
                    <ChevronRight size={15} strokeWidth={2} />
                  </span>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 9,
                }}
              >
                <CurrencyChips currencies={item.top3} tone="green" />
                <CurrencyChips currencies={item.bottom3} tone="red" />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                }}
              >
                {item.priorityPair && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      color: "var(--text-1)",
                      fontSize: 13,
                    }}
                  >
                    <DirArrow direction={inferDirection(item)} size={12} />
                    {item.priorityPair}
                  </span>
                )}
                {item.divergence != null && (
                  <span style={{ color: "var(--accent)", fontWeight: 500 }}>
                    {item.divergence.toFixed(1)}σ
                  </span>
                )}
                <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
                  {item.ideasCount} ideas
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
