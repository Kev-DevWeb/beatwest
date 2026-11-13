export const CHAMBERS = 6;
/** How close to a beat (real seconds) a reload must be to count as on the beat. */
export const RELOAD_WINDOW = 0.1;

export type ReloadResult = 'perfect' | 'slow' | 'full' | 'busy';

export class Revolver {
  ammo = CHAMBERS;
  /** Song time until which the gun cannot fire (slow reload in progress). */
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
   * @param beatError real seconds to the nearest beat
   * @param beatLength song seconds per beat
   */
  reload(t: number, beatError: number, beatLength: number): ReloadResult {
    if (t < this.lockedUntil) return 'busy';
    if (this.ammo === CHAMBERS) return 'full';
    this.ammo = CHAMBERS;
    if (Math.abs(beatError) <= RELOAD_WINDOW) return 'perfect';
    this.lockedUntil = t + beatLength;
    return 'slow';
  }
}
