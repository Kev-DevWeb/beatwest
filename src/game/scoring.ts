import type { Judgement } from './judge';

export type Zone = 'head' | 'body' | 'crit' | 'track';
export type Rank = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';

export const BASE: Record<Judgement, number> = { perfect: 300, good: 100, ok: 50, miss: 0 };
export const ZONE_FACTOR: Record<Zone, number> = { head: 1.5, body: 1, crit: 1.25, track: 1.25 };

export const comboMultiplier = (combo: number) => 1 + Math.min(combo, 100) / 25;

export function rankFor(accuracy: number, misses: number): Rank {
  if (accuracy >= 0.9999) return 'SS';
  if (accuracy >= 0.95 && misses === 0) return 'S';
  if (accuracy >= 0.9) return 'A';
  if (accuracy >= 0.8) return 'B';
  if (accuracy >= 0.7) return 'C';
  return 'D';
}

export class Score {
  score = 0;
  combo = 0;
  maxCombo = 0;
  /** Consecutive headshots. */
  gold = 0;
  maxGold = 0;
  counts: Record<Judgement, number> = { perfect: 0, good: 0, ok: 0, miss: 0 };
  headshots = 0;
  bodyshots = 0;
  shotsFired = 0;
  /** Signed timing error of every shot that connected, in ms (negative = early). */
  errors: number[] = [];
  /** Time from a target appearing to it being shot, in ms. */
  reactions: number[] = [];

  constructor(public modMultiplier = 1) {}

  hit(j: Judgement, zone: Zone, errorMs?: number, reactionMs?: number): number {
    if (j === 'miss') { this.miss(); return 0; }
    const points = Math.round(BASE[j] * ZONE_FACTOR[zone] * comboMultiplier(this.combo) * this.modMultiplier);
    this.score += points;
    this.counts[j]++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (zone === 'head') { this.headshots++; this.gold++; this.maxGold = Math.max(this.maxGold, this.gold); }
    if (zone === 'body') { this.bodyshots++; this.gold = 0; }
    if (errorMs !== undefined) this.errors.push(errorMs);
    if (reactionMs !== undefined) this.reactions.push(reactionMs);
    return points;
  }

  /** Flat points outside the judgement counts (e.g. a perfect reload). */
  bonus(points: number): number {
    const p = Math.round(points * this.modMultiplier);
    this.score += p;
    return p;
  }

  miss(): void {
    this.counts.miss++;
    this.breakCombo();
  }

  breakCombo(): void {
    this.combo = 0;
    this.gold = 0;
  }

  get total(): number {
    const c = this.counts;
    return c.perfect + c.good + c.ok + c.miss;
  }

  get accuracy(): number {
    const c = this.counts;
    return this.total ? (300 * c.perfect + 100 * c.good + 50 * c.ok) / (300 * this.total) : 1;
  }

  get headshotRate(): number {
    const n = this.headshots + this.bodyshots;
    return n ? this.headshots / n : 0;
  }

  get rank(): Rank {
    return rankFor(this.accuracy, this.counts.miss);
  }
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** osu-style "unstable rate": 10 × standard deviation of timing errors (ms). */
export function unstableRate(errors: number[]): number {
  if (errors.length < 2) return 0;
  const m = mean(errors);
  return 10 * Math.sqrt(mean(errors.map((e) => (e - m) ** 2)));
}
