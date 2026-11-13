import type { Analysis } from '../audio/analyze';
import { makeRng } from './rng';
import type { Chart, Difficulty, Note, NoteKind } from './types';

const DEG = Math.PI / 180;

export const BOUNDS = { yaw: 30 * DEG, pitchMin: 0, pitchMax: 14 * DEG };
/** Songs start with this much quiet time so the player can settle in. */
export const LEAD_IN = 2;
export const MAX_SHOTS_WITHOUT_REST = 6;
/** Longest run of rapid-fire burst targets before a half-beat breather. */
export const MAX_BURST = 4;

interface Tuning {
  minStrength: number;
  /** Minimum spacing between shots: the larger of a fraction of a beat and a floor in seconds. */
  minGapBeats: number;
  minGapSec: number;
  approach: number;
  /** How far (radians) the next target may sit per second of gap. */
  angularSpeed: number;
  maxFlick: number;
  civilianChance: number;
  /** Most shots allowed in any stretch of four beats. */
  maxPerBar: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { minStrength: 0.5, minGapBeats: 1, minGapSec: 0.4, approach: 1.3, angularSpeed: 25 * DEG, maxFlick: 18 * DEG, civilianChance: 0, maxPerBar: 99 },
  normal: { minStrength: 0.28, minGapBeats: 0.5, minGapSec: 0.2, approach: 1.1, angularSpeed: 34 * DEG, maxFlick: 22 * DEG, civilianChance: 0.35, maxPerBar: 5 },
  hard: { minStrength: 0.22, minGapBeats: 0.5, minGapSec: 0.19, approach: 1.0, angularSpeed: 40 * DEG, maxFlick: 26 * DEG, civilianChance: 0.45, maxPerBar: 8 },
  extreme: { minStrength: 0.14, minGapBeats: 0.25, minGapSec: 0.1, approach: 0.85, angularSpeed: 52 * DEG, maxFlick: 32 * DEG, civilianChance: 0.55, maxPerBar: 10 },
};

interface Draft { kind: NoteKind; time: number; duration: number }

function meanEnergy(a: Analysis, from: number, to: number): number {
  const i0 = Math.max(0, Math.floor(from * a.energyRate));
  const i1 = Math.min(a.energy.length, Math.ceil(to * a.energyRate));
  let s = 0;
  for (let i = i0; i < i1; i++) s += a.energy[i];
  return i1 > i0 ? s / (i1 - i0) : 0;
}

export function generateChart(analysis: Analysis, difficulty: Difficulty): Chart {
  const tune = TUNING[difficulty];
  const beat = 60 / analysis.bpm;
  const rng = makeRng(analysis.hash ^ (difficulty.length * 7919 + difficulty.charCodeAt(0)));
  const minGap = Math.max(tune.minGapSec, tune.minGapBeats * beat * 0.9);
  const end = analysis.duration - 0.5;

  // 1. Choose which hits in the music become shots.
  const picked: { time: number; strength: number }[] = [];
  for (const o of analysis.onsets) {
    if (o.time < LEAD_IN || o.time > end || o.strength < tune.minStrength) continue;
    const last = picked[picked.length - 1];
    if (last && o.time - last.time < minGap) {
      const before = picked[picked.length - 2];
      if (o.strength > last.strength && (!before || o.time - before.time >= minGap)) picked[picked.length - 1] = o;
      continue;
    }
    picked.push(o);
  }

  // 1b. Cap sustained density: in any stretch of four beats keep only the strongest hits.
  const span = 4 * beat;
  for (let i = 0; i < picked.length; ) {
    let j = i;
    while (j + 1 < picked.length && picked[j + 1].time - picked[i].time < span) j++;
    if (j - i + 1 > tune.maxPerBar) {
      let weakest = i;
      for (let k = i + 1; k <= j; k++) if (picked[k].strength < picked[weakest].strength) weakest = k;
      picked.splice(weakest, 1);
    } else i++;
  }

  // 2. Guarantee a pause of at least one beat every six shots (the revolver holds six),
  //    and a half-beat breather after every full burst.
  const burstGap = Math.max(beat * 0.3, 0.2);
  const shots: number[] = [];
  let sinceRest = 0, run = 1;
  for (const p of picked) {
    const gap = shots.length ? p.time - shots[shots.length - 1] : Infinity;
    if (gap >= beat) sinceRest = 0;
    else if (sinceRest >= MAX_SHOTS_WITHOUT_REST) continue;
    if (run >= MAX_BURST && gap < 0.45 * beat) continue;
    run = gap <= burstGap ? run + 1 : 1;
    shots.push(p.time);
    sinceRest++;
  }

  // 2b. Reload cues: at a rest, if the six rounds would not last through the next run of
  //     shots, mark a half-beat in that rest as the moment to reload.
  const reloads: number[] = [];
  let fired = 0;
  for (let i = 0; i + 1 < shots.length; i++) {
    fired++;
    const gap = shots[i + 1] - shots[i];
    if (gap < beat) continue;
    let ahead = 1;
    while (i + ahead + 1 < shots.length && shots[i + ahead + 1] - shots[i + ahead] < beat) ahead++;
    if (fired + ahead > MAX_SHOTS_WITHOUT_REST) {
      const mid = shots[i] + Math.min(gap / 2, beat);
      reloads.push(analysis.phase + Math.round((mid - analysis.phase) / (beat / 2)) * (beat / 2));
      fired = 0;
    }
  }

  // 3. Runs of three or more shots faster than ~5 per second become bursts.
  const drafts: Draft[] = shots.map((time) => ({ kind: 'bandit', time, duration: 0 }));
  for (let i = 0; i < drafts.length; ) {
    let j = i;
    while (j + 1 < drafts.length && drafts[j + 1].time - drafts[j].time <= burstGap) j++;
    if (j - i + 1 >= 3) for (let k = i; k <= j; k++) drafts[k].kind = 'burst';
    i = j + 1;
  }

  // 4. Fill long gaps: drones to track where the music keeps going, civilians as decoys.
  const overall = meanEnergy(analysis, 0, analysis.duration);
  const extras: Draft[] = [];
  const edges = [LEAD_IN - beat, ...shots, end];
  for (let i = 0; i + 1 < edges.length; i++) {
    const from = edges[i], to = edges[i + 1];
    const gapBeats = (to - from) / beat;
    if (gapBeats >= 3.5 && meanEnergy(analysis, from, to) >= overall * 0.25) {
      let t = from + beat;
      while (to - t >= 2.5 * beat) {
        const duration = Math.min(4, Math.floor((to - t) / beat - 1)) * beat;
        if (duration < beat) break;
        extras.push({ kind: 'drone', time: t, duration });
        t += duration + beat;
      }
    } else if (gapBeats >= 1.4 && i > 0 && rng() < tune.civilianChance) {
      extras.push({ kind: 'civilian', time: from + (to - from) / 2 - 0.5 * beat, duration: beat });
    }
  }

  // 5. Place everything in view. Distance between consecutive targets grows with the time available.
  const all = [...drafts, ...extras].sort((a, b) => a.time - b.time);
  const clampYaw = (v: number) => Math.max(-BOUNDS.yaw, Math.min(BOUNDS.yaw, v));
  const clampPitch = (v: number) => Math.max(BOUNDS.pitchMin, Math.min(BOUNDS.pitchMax, v));
  const inside = (y: number, p: number) =>
    Math.abs(y) <= BOUNDS.yaw && p >= BOUNDS.pitchMin && p <= BOUNDS.pitchMax;
  const step = (y: number, p: number, dist: number): [number, number] => {
    for (let tries = 0; tries < 12; tries++) {
      const a = rng() * Math.PI * 2;
      const ny = y + Math.cos(a) * dist, np = p + Math.sin(a) * dist * 0.5;
      if (inside(ny, np)) return [ny, np];
    }
    const dir = y > 0 ? -1 : 1;
    return [clampYaw(y + dir * dist), p];
  };

  let yaw = 0, pitch = 6 * DEG, lastTime = LEAD_IN - beat;
  let burstDir = 1;
  const notes: Note[] = [];
  let prevKind: NoteKind | null = null;
  for (const d of all) {
    const gap = Math.max(0, d.time - lastTime);
    let y2 = 0, p2 = 0;
    if (d.kind === 'burst' && prevKind === 'burst' && gap <= burstGap * 1.01) {
      const s = 4.5 * DEG;
      if (Math.abs(yaw + burstDir * s) > BOUNDS.yaw) burstDir = -burstDir;
      yaw += burstDir * s;
      pitch = clampPitch(pitch + (rng() - 0.5) * 2 * DEG);
    } else {
      const dist = Math.max(4 * DEG, Math.min(tune.maxFlick, gap * tune.angularSpeed));
      [yaw, pitch] = step(yaw, pitch, dist);
      burstDir = rng() < 0.5 ? -1 : 1;
    }
    if (d.kind === 'drone') {
      [y2, p2] = step(yaw, pitch, Math.min(24 * DEG, 6 * DEG * (d.duration / beat)));
    }
    notes.push({ id: notes.length, kind: d.kind, time: d.time, duration: d.duration, yaw, pitch, yaw2: y2, pitch2: p2 });
    if (d.kind === 'drone') { yaw = y2; pitch = p2; }
    lastTime = d.time + d.duration;
    prevKind = d.kind;
  }

  return { notes, reloads, bpm: analysis.bpm, phase: analysis.phase, duration: analysis.duration, difficulty, approach: tune.approach };
}
