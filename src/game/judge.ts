export type Judgement = 'perfect' | 'good' | 'ok' | 'miss';

/** Timing windows in real seconds (not affected by Double/Half Time). */
export const WINDOWS = { perfect: 0.045, good: 0.09, late: 0.14, early: 0.3 };

/**
 * `delta` = shot time − note time, in real seconds.
 * Returns null when the shot is so early the target cannot be hit yet.
 */
export function judge(delta: number): Judgement | null {
  if (delta < -WINDOWS.early) return null;
  const abs = Math.abs(delta);
  if (abs <= WINDOWS.perfect) return 'perfect';
  if (abs <= WINDOWS.good) return 'good';
  if (delta <= WINDOWS.late) return 'ok';
  return 'miss';
}

/** Share of a drone's flight spent under the crosshair → judgement. */
export function judgeTracking(fraction: number): Judgement {
  if (fraction >= 0.9) return 'perfect';
  if (fraction >= 0.6) return 'good';
  if (fraction >= 0.3) return 'ok';
  return 'miss';
}

export const JUDGEMENT_LABEL: Record<Judgement, string> = {
  perfect: 'PERFECT',
  good: 'GOOD',
  ok: 'OK',
  miss: 'MISS',
};
