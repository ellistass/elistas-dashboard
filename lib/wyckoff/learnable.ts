// lib/wyckoff/learnable.ts — shared definition of a case worth studying.
//
// A learnable case is directional on both sides: the engine made a real call
// and the market resolved directionally on trusted volume. Neutral/chop and
// suspect-volume symbols are useful context, but they are not clean training
// samples for judging the Wyckoff read.

import { SUSPECT_VOLUME } from "./basket";

export interface LearnableRow {
  instrument: string;
  engineVerdict: string | null;
  outcome: string | null;
}

export interface LearnableStats {
  total: number;
  successes: number;
  failures: number;
  accum: number;
  distrib: number;
}

export function isLearnableCase(r: LearnableRow): boolean {
  return (
    (r.engineVerdict === "accum" || r.engineVerdict === "distrib") &&
    (r.outcome === "up" || r.outcome === "down") &&
    !SUSPECT_VOLUME.has(r.instrument)
  );
}

export function engineHit(r: LearnableRow): boolean {
  return (
    (r.engineVerdict === "accum" && r.outcome === "up") ||
    (r.engineVerdict === "distrib" && r.outcome === "down")
  );
}

export function summarizeLearnable(rows: LearnableRow[]): LearnableStats {
  const clean = rows.filter(isLearnableCase);
  return {
    total: clean.length,
    successes: clean.filter(engineHit).length,
    failures: clean.filter((r) => !engineHit(r)).length,
    accum: clean.filter((r) => r.engineVerdict === "accum").length,
    distrib: clean.filter((r) => r.engineVerdict === "distrib").length,
  };
}
