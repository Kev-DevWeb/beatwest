export const CHAMBERS = 6;
/** How close to a beat or reload cue (real seconds) a reload must be to count as perfect. */
export const RELOAD_WINDOW = 0.1;

export type ReloadResult = 'perfect' | 'slow' | 'full' | 'busy';

export interface Reload {
  result: ReloadResult;
  /** Song time at which the gun can fire again. */
  readyAt: number;
}

export class Revolver {
  ammo = CHAMBERS;
  /** Song time until which the gun cannot fire (reload in progress). */
  lockedUntil = -Infinity;

  canFire(t: number): boolean {
    return this.ammo > 0 && t >= this.lockedUntil;
  }

  fire(t: number): boolean {
    if (!this.canFire(t)) return false;
    this.ammo--;
    return true;
  }

  /**
   * A reload always ends on the music: instantly when pressed on the beat, otherwise on
   * `nextSlot`, the next subdivision of the song.
   * @param beatError real seconds to the nearest beat or reload cue
   * @param nextSlot song time of the subdivision an off-beat reload finishes on
   */
  reload(t: number, beatError: number, nextSlot: number): Reload {
    if (t < this.lockedUntil) return { result: 'busy', readyAt: this.lockedUntil };
    if (this.ammo === CHAMBERS) return { result: 'full', readyAt: t };
    this.ammo = CHAMBERS;
    if (Math.abs(beatError) <= RELOAD_WINDOW) return { result: 'perfect', readyAt: t };
    this.lockedUntil = Math.max(t, nextSlot);
    return { result: 'slow', readyAt: this.lockedUntil };
  }
}

/**
 * Song times at which each round clicks into the cylinder, always on a subdivision of the beat.
 * Off-beat reload: a roll of sixteenth notes (thirty-seconds if they would not fit) leading
 * into `readyAt`. Perfect reload: a quick flourish of thirty-seconds right after the press.
 */
export function reloadClicks(t: number, readyAt: number, rounds: number, beat: number, phase: number, perfect: boolean): number[] {
  if (rounds <= 0) return [];
  if (perfect) {
    const step = beat / 8;
    const first = phase + Math.ceil((t + 0.01 - phase) / step) * step;
    return Array.from({ length: rounds }, (_, i) => first + i * step);
  }
  const room = Math.max(0, readyAt - t);
  let step = beat / 4;
  if (rounds * step > room) step = beat / 8;
  if (rounds * step > room) step = room / (rounds + 1);
  return Array.from({ length: rounds }, (_, i) => readyAt - (rounds - i) * step);
}
