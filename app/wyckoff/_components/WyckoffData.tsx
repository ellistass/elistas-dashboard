"use client";
// app/wyckoff/_components/WyckoffData.tsx — one fetch, shared by every surface.
//
// The desk, the watchlist, the archive and the score page all read the same
// /api/wyckoff payload. Splitting them into separate routes must NOT mean four
// copies of the same request firing on every navigation, so the fetch lives in
// the layout and the pages consume it through this context.
//
// The blind rules stay server-side, exactly as before — this file moves data
// around, it never decides what the trader is allowed to see.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { PendingRow } from "./CandidateCard";
import type { Scoreboard } from "./ScoreStrip";
import type { LearnableStats } from "@/lib/wyckoff/learnable";

export interface ResolvedRow extends PendingRow {
  outcome: string;
  outcomeAt: string | null;
  engineVerdict: string;
  loggedBlind: boolean;
  leadToBreakout?: number | null;
  leadToTest?: number | null;
}

interface WyckoffState {
  pending: PendingRow[];
  watching: PendingRow[];
  resolved: ResolvedRow[];
  score: Scoreboard | null;
  passRate: { total: number; pass: number } | null;
  learnable: LearnableStats | null;
  trackedOpen: number;
  awaitingBackfill: number;
  loading: boolean;
  error: string | null;
  scanning: boolean;
  scanNote: string | null;
  /** When the scanner last wrote anything. The freshness readout: if this is
   *  days old the desk is showing yesterday's market. */
  lastScanAt: string | null;
  reload: () => Promise<void>;
  runScan: () => Promise<void>;
}

const Ctx = createContext<WyckoffState | null>(null);

export function useWyckoff(): WyckoffState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWyckoff must be used inside <WyckoffProvider>");
  return v;
}

export function WyckoffProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [watching, setWatching] = useState<PendingRow[]>([]);
  const [resolved, setResolved] = useState<ResolvedRow[]>([]);
  const [score, setScore] = useState<Scoreboard | null>(null);
  const [passRate, setPassRate] = useState<{ total: number; pass: number } | null>(null);
  const [learnable, setLearnable] = useState<LearnableStats | null>(null);
  const [trackedOpen, setTrackedOpen] = useState(0);
  const [awaitingBackfill, setAwaitingBackfill] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/wyckoff", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `load failed (${res.status})`);
      setPending(j.pending ?? []);
      setWatching(j.watching ?? []);
      setResolved(j.resolved ?? []);
      setScore(j.score ?? null);
      setPassRate(j.passRate ?? null);
      setLearnable(j.learnable ?? null);
      setTrackedOpen(j.trackedOpen ?? 0);
      setAwaitingBackfill(j.awaitingBackfill ?? 0);
      setLastScanAt(j.lastScanAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanNote(null);
    try {
      const res = await fetch("/api/wyckoff", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.error ?? `scan failed (${res.status})`);
      setScanNote(
        `${j.scanned} scanned · ${j.rangesFound} ranges · ${j.freshCount} fresh · ` +
          `${j.backfill?.updated ?? 0} resolved · data through ${j.latestBarDate ?? "?"}`,
      );
      await reload();
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : String(e));
    }
    setScanning(false);
  }, [reload]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Ctx.Provider
      value={{
        pending, watching, resolved, score, passRate,
        learnable,
        trackedOpen, awaitingBackfill, loading, error,
        scanning, scanNote, lastScanAt, reload, runScan,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
