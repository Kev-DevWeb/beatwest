export const DEAD_EYE_BEATS = 4;
export const CHARGE = { perfectHead: 0.08, goodHead: 0.04 };

/** Slow-motion ability: mark targets by sweeping over them, they are shot automatically on their beat. */
export class DeadEye {
  meter = 0;
  activeUntil = -Infinity;
  private marked = new Set<number>();

  charge(amount: number, t: number): void {
    if (!this.isActive(t)) this.meter = Math.min(1, this.meter + amount);
  }

  get ready(): boolean {
    return this.meter >= 1;
  }

  isActive(t: number): boolean {
    return t < this.activeUntil;
  }

  activate(t: number, beatLength: number): boolean {
    if (!this.ready || this.isActive(t)) return false;
    this.meter = 0;
    this.activeUntil = t + DEAD_EYE_BEATS * beatLength;
    return true;
  }

  /** Fraction of the ability's duration still left, 0..1. */
  remaining(t: number, beatLength: number): number {
    return Math.max(0, Math.min(1, (this.activeUntil - t) / (DEAD_EYE_BEATS * beatLength)));
  }

  mark(id: number): boolean {
    if (this.marked.has(id)) return false;
    this.marked.add(id);
    return true;
  }

  isMarked(id: number): boolean {
    return this.marked.has(id);
  }

  /** Removes a mark once its automatic shot has been fired. */
  consume(id: number): boolean {
    return this.marked.delete(id);
  }
}
