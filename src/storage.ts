import type { GameId } from './input/sensitivity';
import type { Rank } from './game/scoring';
import type { PaletteId } from './world/palette';
import type { Quality } from './world/stage';

export interface CrosshairSettings {
  size: number;
  thickness: number;
  gap: number;
  color: string;
  dot: boolean;
}

export interface Settings {
  game: GameId;
  /** Degrees of rotation per mouse count. */
  degPerCount: number;
  dpi: number;
  /** Horizontal FOV at 16:9, degrees. */
  fov: number;
  crosshair: CrosshairSettings;
  /** Extra audio/input latency compensation from calibration, ms. */
  offsetMs: number;
  musicVolume: number;
  sfxVolume: number;
  /** Target colours: default or a red/green-safe alternative. */
  palette: PaletteId;
  quality: Quality;
  /** 0..1 strength of camera shake, sway and zoom punches. */
  motion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  game: 'cs2',
  degPerCount: 0.044,
  dpi: 800,
  fov: 103,
  crosshair: { size: 7, thickness: 2, gap: 3, color: '#ffffff', dot: true },
  offsetMs: 0,
  musicVolume: 0.8,
  sfxVolume: 0.6,
  palette: 'default',
  quality: 'high',
  motion: 1,
};

const SETTINGS_KEY = 'beatwest.settings';
const SCORES_KEY = 'beatwest.scores';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: play without saving */ }
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...saved, crosshair: { ...DEFAULT_SETTINGS.crosshair, ...saved.crosshair } };
}

export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);

export interface ScoreRecord {
  score: number;
  accuracy: number;
  rank: Rank;
  maxCombo: number;
  date: number;
}

/** `v3`: charts were rebalanced and gained reload interludes, so earlier records are not comparable. */
export const scoreKey = (hash: number, difficulty: string, mods: string) => `v3:${hash}:${difficulty}:${mods}`;

export function bestScore(key: string): ScoreRecord | null {
  const list = read<Record<string, ScoreRecord[]>>(SCORES_KEY, {})[key];
  return list?.length ? list.reduce((a, b) => (b.score > a.score ? b : a)) : null;
}

/** Stores a result and reports whether it beat the previous best. */
export function saveScore(key: string, record: ScoreRecord): boolean {
  const all = read<Record<string, ScoreRecord[]>>(SCORES_KEY, {});
  const previous = bestScore(key);
  all[key] = [...(all[key] ?? []), record].sort((a, b) => b.score - a.score).slice(0, 20);
  write(SCORES_KEY, all);
  return !previous || record.score > previous.score;
}
