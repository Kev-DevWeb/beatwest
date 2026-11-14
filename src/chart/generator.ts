import type { Analysis } from '../audio/analyze';
import { beatDistance, nextGrid } from '../audio/tempo';
import { makeRng } from './rng';
import { ROUNDS, type Chart, type Difficulty, type Interlude, type Note, type NoteKind } from './types';

const DEG = Math.PI / 180;

export const BOUNDS = { yaw: 30 * DEG, pitchMin: 0, pitchMax: 14 * DEG };
/** Songs start with this much quiet time so the player can settle in. */
export const LEAD_IN = 2;
/** Longest unbroken run of shots (gaps under a beat) before a one-beat rest for the hands. */
export const MAX_RUN = 8;
/** Beats before an interlude starts with no shot due (the cylinder is already swinging open). */
export const INTERLUDE_LEAD_BEATS = 0.5;
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
  normal: { minStrength: 0.25, minGapBeats: 0.5, minGapSec: 0.2, approach: 1.1, angularSpeed: 34 * DEG, maxFlick: 22 * DEG, civilianChance: 0.35, maxPerBar: 5 },
  hard: { minStrength: 0.22, minGapBeats: 0.5, minGapSec: 0.19, approach: 1.0, angularSpeed: 40 * DEG, maxFlick: 26 * DEG, civilianChance: 0.45, maxPerBar: 6 },
  extreme: { minStrength: 0.14, minGapBeats: 0.25, minGapSec: 0.1, approach: 0.85, angularSpeed: 52 * DEG, maxFlick: 32 * DEG, civilianChance: 0.55, maxPerBar: 9 },
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

  // 1. Choose which hits in the music become shots. Hits are taken in order of importance
  //    (on the beat first, then half-beats, then the rest; louder first within each) as long
  //    as they keep the minimum spacing and the density cap. Picking by rank rather than in
  //    song order keeps the result stable when the analysis shifts slightly.
  const span = 4 * beat;
  const candidates = analysis.onsets
    .filter((o) => o.time >= LEAD_IN && o.time <= end && o.strength >= tune.minStrength)
    .map((o) => {
      const off = Math.abs(beatDistance(o.time, analysis.bpm, analysis.phase)) / beat;   // 0 on the beat, 0.5 half-way
      return { time: o.time, rank: o.strength + (off < 0.1 ? 2 : off > 0.4 ? 1 : 0) };
    })
    .sort((x, y) => y.rank - x.rank || x.time - y.time);
  const kept: number[] = [];
  const countFrom = (start: number, from: number) => {
    let n = 0;
    for (let k = from; k < kept.length && kept[k] < start + span; k++) n++;
    return n;
  };
  for (const c of candidates) {
    let idx = 0;
    while (idx < kept.length && kept[idx] < c.time) idx++;
    if (idx > 0 && c.time - kept[idx - 1] < minGap) continue;
    if (idx < kept.length && kept[idx] - c.time < minGap) continue;
    // Would any four-beat stretch containing this hit exceed the cap?
    let fits = countFrom(c.time, idx) + 1 <= tune.maxPerBar;
    for (let k = idx - 1; fits && k >= 0 && kept[k] > c.time - span; k--) {
      if (countFrom(kept[k], k) + 1 > tune.maxPerBar) fits = false;
    }
    if (fits) kept.splice(idx, 0, c.time);
  }
  // 1b. Reload interludes. The revolver reloads by itself in stretches with nothing to shoot:
  //     one every 6-12 bars, placed where the fewest shots are lost (natural breaks win).
  //     Rounds click in on eighths or sixteenths, whichever is nearer 0.2 s; the cylinder
  //     shuts on a beat, and the next target only appears once it has.
  const bar = 4 * beat;
  const stepLen = Math.abs(beat / 2 - 0.2) <= Math.abs(beat / 4 - 0.2) ? beat / 2 : beat / 4;
  const lapse = Math.ceil((ROUNDS * stepLen) / beat - 1e-9) * beat;
  const clearFrom = (start: number) => start - INTERLUDE_LEAD_BEATS * beat;
  const clearTo = (start: number) => start + lapse + tune.approach;
  const interludes: Interlude[] = [];
  let prev = kept.length ? kept[0] : LEAD_IN;
  for (;;) {
    let best = -1, bestCost = Infinity;
    for (let b = nextGrid(prev + 6 * bar, analysis.phase, beat); b <= prev + 12 * bar; b += beat) {
      if (clearTo(b) > analysis.duration - 2 * bar) break;
      const lost = kept.filter((t) => t > clearFrom(b) && t < clearTo(b)).length;
      const cost = lost + meanEnergy(analysis, b, b + lapse);
      if (cost < bestCost - 1e-9) { bestCost = cost; best = b; }
    }
    if (best < 0) break;
    interludes.push({ start: best, step: stepLen, close: best + lapse });
    prev = best + lapse;
  }
  const inInterlude = (t: number) => interludes.some((i) => t > clearFrom(i.start) + 1e-9 && t < clearTo(i.start) - 1e-9);

  // 2. Breathing room: a one-beat rest after every long run, half a beat after a full burst.
  const burstGap = Math.max(beat * 0.3, 0.2);
  const shots: number[] = [];
  let run = 1, sinceRest = 0;
  for (const time of kept) {
    if (inInterlude(time)) continue;
    const gap = shots.length ? time - shots[shots.length - 1] : Infinity;
    if (gap >= beat * 0.99) sinceRest = 0;
    else if (sinceRest >= MAX_RUN) continue;
    if (run >= MAX_BURST && gap < 0.45 * beat) continue;
    run = gap <= burstGap ? run + 1 : 1;
    shots.push(time);
    sinceRest++;
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
  const zones = interludes.map((i) => [clearFrom(i.start), clearTo(i.start)]);
  const edges = [LEAD_IN - beat, ...shots, ...zones.flat(), end].sort((a, b) => a - b);
  for (let i = 0; i + 1 < edges.length; i++) {
    const from = edges[i], to = edges[i + 1];
    if (zones.some(([a, b]) => from >= a - 1e-9 && to <= b + 1e-9)) continue;   // inside an interlude
    const gapBeats = (to - from) / beat;
    if (gapBeats >= 3.5 && meanEnergy(analysis, from, to) >= overall * 0.25) {
      let t = from + beat;
      while (to - t >= 2.5 * beat) {
        const duration = Math.min(4, Math.floor((to - t) / beat - 1)) * beat;
        if (duration < beat) break;
        extras.push({ kind: 'drone', time: t, duration });
        t += duration + beat;
      }
    } else if (gapBeats >= 0.95 && i > 0 && rng() < tune.civilianChance * (gapBeats >= 1.4 ? 1 : 0.2)) {
      // Decoys: likely in a real pause, occasional in a one-beat gap.
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

  return { notes, interludes, bpm: analysis.bpm, phase: analysis.phase, duration: analysis.duration, difficulty, approach: tune.approach };
}
