import type { CrosshairSettings } from '../storage';
import { CHAMBERS } from '../game/revolver';

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

const ARC_RADIUS = 58;
const ARC_SPAN = 0.36;                                   // share of the circle the Dead Eye arc covers
const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS * ARC_SPAN;

/**
 * In-game overlay. Everything the player must read mid-fight (ammo, Dead Eye, judgement)
 * sits around the crosshair so the eyes never leave the targets.
 */
export class Hud {
  private root = $('hud');
  private score = $('h-score');
  private acc = $('h-acc');
  private combo = $('h-combo');
  private comboBox = $('h-combo-box');
  private gold = $('h-gold');
  private health = $('h-health');
  private vignette = $('vignette');
  private deadEye = $<SVGCircleElement>('h-deadeye');
  private arc = $('h-arc');
  private ammo = $('h-ammo');
  private progress = $('h-progress');
  private messageEl = $('h-message');
  private judgeEl = $('h-judge');
  private countdownEl = $('h-countdown');
  private bannerEl = $('h-banner');
  private arrowEl = $('h-arrow');
  private popups = $('popups');
  private flashEl = $('flash');
  private mods = $('h-mods');
  private last: Record<string, string | number> = {};
  private bannerTimer = 0;

  constructor() {
    this.ammo.innerHTML = Array.from({ length: CHAMBERS }, () => '<i></i>').join('');
    const track = $<SVGCircleElement>('h-deadeye-track');
    for (const c of [track, this.deadEye]) {
      c.setAttribute('r', String(ARC_RADIUS));
      // Rotate so the arc is centred under the crosshair.
      c.setAttribute('transform', `rotate(${90 - (ARC_SPAN * 360) / 2})`);
    }
    track.setAttribute('stroke-dasharray', `${ARC_LENGTH} 1000`);
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.popups.innerHTML = '';
      this.setDeadEyeFx(false);
      this.bannerEl.className = '';
      this.judgeEl.className = '';
    }
    this.last = {};
  }

  private set(key: string, value: string | number, apply: () => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  private replay(el: Element, className: string): void {
    el.setAttribute('class', '');
    void (el as HTMLElement).offsetWidth;
    el.setAttribute('class', className);
  }

  setScore(score: number, accuracy: number): void {
    this.set('score', score, () => (this.score.textContent = score.toLocaleString('es')));
    const a = (accuracy * 100).toFixed(2) + '%';
    this.set('acc', a, () => (this.acc.textContent = a));
  }

  setCombo(combo: number, gold: number): void {
    this.set('combo', combo, () => {
      this.combo.textContent = String(combo);
      this.comboBox.classList.toggle('idle', combo === 0);
      this.comboBox.classList.toggle('hot', combo >= 50);
      this.comboBox.classList.remove('bump');
      void this.comboBox.offsetWidth;
      if (combo > 0) this.comboBox.classList.add('bump');
    });
    const g = gold >= 3 ? `☠ ×${gold}` : '';
    this.set('gold', g, () => (this.gold.textContent = g));
  }

  setHealth(fraction: number): void {
    const v = Math.round(fraction * 100);
    this.set('health', v, () => {
      this.health.style.width = v + '%';
      this.health.parentElement!.classList.toggle('low', v < 35);
      // The screen edges close in red as health drops.
      this.vignette.style.opacity = String(Math.max(0, Math.min(1, (45 - v) / 45)));
    });
  }

  setAmmo(count: number, reloading: boolean): void {
    this.set('ammo', count + (reloading ? 100 : 0), () => {
      [...this.ammo.children].forEach((el, i) => el.classList.toggle('spent', i >= count));
      this.ammo.classList.toggle('reloading', reloading);
      this.ammo.classList.toggle('empty', count === 0);
    });
  }

  setDeadEye(meter: number, active: boolean, remaining: number): void {
    const v = Math.round((active ? remaining : meter) * 100);
    this.set('de', v + (active ? 1000 : 0), () => {
      this.deadEye.setAttribute('stroke-dasharray', `${(ARC_LENGTH * v) / 100} 1000`);
      this.arc.setAttribute('class', active ? 'active' : meter >= 1 ? 'ready' : '');
    });
  }

  setDeadEyeFx(on: boolean): void {
    document.body.classList.toggle('deadeye', on);
  }

  setProgress(fraction: number): void {
    const v = Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 10;
    this.set('progress', v, () => (this.progress.style.width = v + '%'));
  }

  setMods(text: string): void {
    this.mods.textContent = text;
  }

  /** Small persistent hint (e.g. "reload"). */
  message(text: string): void {
    this.set('message', text, () => (this.messageEl.textContent = text));
  }

  /** Verdict on the last shot, always in the same place just under the crosshair. */
  judgement(text: string, kind: string): void {
    this.judgeEl.textContent = text;
    this.replay(this.judgeEl, `show ${kind}`);
  }

  /** Big centred text: "3", "2", "1", "¡DESENFUNDA!". */
  countdown(text: string): void {
    this.set('countdown', text, () => {
      this.countdownEl.textContent = text;
      this.replay(this.countdownEl, text ? (text.length <= 2 ? 'show digit' : 'show') : '');
    });
  }

  /** Short celebratory line: combo milestones, Dead Eye, end of run. */
  banner(text: string): void {
    this.bannerEl.textContent = text;
    this.replay(this.bannerEl, 'show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (this.bannerEl.className = ''), 1400);
  }

  /** Points to an off-screen target. `angle` in radians, 0 = right, counter-clockwise; null hides it. */
  arrow(angle: number | null): void {
    const key = angle === null ? 'off' : Math.round(angle * 20);
    this.set('arrow', key, () => {
      this.arrowEl.classList.toggle('show', angle !== null);
      if (angle !== null) this.arrowEl.style.transform = `rotate(${-angle}rad) translateX(170px)`;
    });
  }

  popup(text: string, kind: string, at: { x: number; y: number } | null): void {
    if (!at) return;
    const el = document.createElement('div');
    el.className = `popup ${kind}`;
    el.textContent = text;
    el.style.left = at.x + 'px';
    el.style.top = at.y - 34 + 'px';
    this.popups.appendChild(el);
    setTimeout(() => el.remove(), 600);
    while (this.popups.childElementCount > 14) this.popups.firstElementChild!.remove();
  }

  flash(kind: 'hurt' | 'deadeye'): void {
    this.replay(this.flashEl, kind);
  }
}

/** Draws the crosshair from the player's settings into any container (HUD or settings preview). */
export function renderCrosshair(container: HTMLElement, c: CrosshairSettings): void {
  const line = (w: number, h: number, x: number, y: number) =>
    `<i style="width:${w}px;height:${h}px;left:calc(50% + ${x}px);top:calc(50% + ${y}px);background:${c.color}"></i>`;
  const t = c.thickness, half = t / 2;
  container.innerHTML =
    line(c.size, t, c.gap, -half) + line(c.size, t, -c.gap - c.size, -half) +
    line(t, c.size, -half, c.gap) + line(t, c.size, -half, -c.gap - c.size) +
    (c.dot ? line(t, t, -half, -half) : '');
}
