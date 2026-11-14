export type NoteKind = 'bandit' | 'burst' | 'drone' | 'civilian';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';

export interface Note {
  id: number;
  kind: NoteKind;
  /** Song time (seconds) the note should be shot. For drones/civilians: when they appear. */
  time: number;
  /** Seconds a drone must be tracked / a civilian stays in view. 0 for shots. */
  duration: number;
  /** Where the target sits at `time`, as view angles (radians) from the rail's forward direction. */
  yaw: number;
  pitch: number;
  /** Drones glide towards this second position. */
  yaw2: number;
  pitch2: number;
}

/** Rounds in the cylinder: how many clicks a reload interlude has. */
export const ROUNDS = 6;

/** A reload interlude: one round clicks in every `step` from `start`, the cylinder shuts at `close`. */
export interface Interlude {
  start: number;
  step: number;
  close: number;
}

/** Song times at which each round goes into the cylinder. */
export const interludeClicks = (i: Interlude): number[] => Array.from({ length: ROUNDS }, (_, k) => i.start + k * i.step);

export interface Chart {
  notes: Note[];
  /** Stretches of the song with nothing to shoot, where the revolver reloads by itself. */
  interludes: Interlude[];
  bpm: number;
  phase: number;
  duration: number;
  difficulty: Difficulty;
  /** Seconds a target is visible before its beat. */
  approach: number;
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Fácil',
  normal: 'Normal',
  hard: 'Difícil',
  extreme: 'Extremo',
};

export const isShot = (n: Note) => n.kind === 'bandit' || n.kind === 'burst';
