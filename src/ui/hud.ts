import type { CrosshairSettings } from '../storage';
import { CHAMBERS } from '../game/revolver';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** In-game overlay: score, combo, health, ammo, Dead Eye, judgement pop-ups and the crosshair. */
export class Hud {
  private root = $('hud');
  private score = $('h-score');
  private acc = $('h-acc');
  private combo = $('h-combo');
  private gold = $('h-gold');
  private health = $('h-health');
  private deadEye = $('h-deadeye');
  private deadEyeLabel = $('h-deadeye-label');
  private ammo = $('h-ammo');
  private progress = $('h-progress');
  private messageEl = $('h-message');
  private popups = $('popups');
  private flashEl = $('flash');
  private mods = $('h-mods');
  private last: Record<string, string | number> = {};

  constructor() {
    this.ammo.innerHTML = Array.from({ length: CHAMBERS }, () => '<i></i>').join('');
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) { this.popups.innerHTML = ''; this.setDeadEyeFx(false); }
  }

  private set(key: string, value: string | number, apply: () => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  setScore(score: number, accuracy: number): void {
    this.set('score', score, () => (this.score.textContent = score.toLocaleString('es')));
    const a = (accuracy * 100).toFixed(2) + '%';
    this.set('acc', a, () => (this.acc.textContent = a));
  }

  setCombo(combo: number, gold: number): void {
    this.set('combo', combo, () => {
      this.combo.textContent = String(combo);
      this.combo.parentElement!.classList.remove('bump');
      void this.combo.offsetWidth;
      if (combo > 0) this.combo.parentElement!.classList.add('bump');
    });
    const g = gold >= 3 ? `★ ${gold} headshots` : '';
    this.set('gold', g, () => (this.gold.textContent = g));
  }

  setHealth(fraction: number): void {
    const v = Math.round(fraction * 100);
    this.set('health', v, () => {
      this.health.style.width = v + '%';
      this.health.parentElement!.classList.toggle('low', v < 30);
    });
  }

  setAmmo(count: number, reloading: boolean): void {
    this.set('ammo', count + (reloading ? 100 : 0), () => {
      [...this.ammo.children].forEach((el, i) => el.classList.toggle('spent', i >= count));
      this.ammo.classList.toggle('reloading', reloading);
    });
  }

  setDeadEye(meter: number, active: boolean, remaining: number): void {
    const v = Math.round((active ? remaining : meter) * 100);
    this.set('de', v + (active ? 1000 : 0), () => {
      this.deadEye.style.width = v + '%';
      this.deadEye.parentElement!.classList.toggle('ready', !active && meter >= 1);
      this.deadEye.parentElement!.classList.toggle('active', active);
      this.deadEyeLabel.textContent = active ? 'DEAD EYE' : meter >= 1 ? 'DEAD EYE · CLIC DERECHO' : 'DEAD EYE';
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

  message(text: string): void {
    this.set('message', text, () => (this.messageEl.textContent = text));
  }

  popup(text: string, kind: string, at: { x: number; y: number } | null): void {
    const el = document.createElement('div');
    el.className = `popup ${kind}`;
    el.textContent = text;
    el.style.left = (at ? at.x : window.innerWidth / 2) + 'px';
    el.style.top = (at ? at.y - 30 : window.innerHeight / 2 - 60) + 'px';
    this.popups.appendChild(el);
    setTimeout(() => el.remove(), 600);
    while (this.popups.childElementCount > 14) this.popups.firstElementChild!.remove();
  }

  flash(kind: 'hurt' | 'deadeye'): void {
    this.flashEl.className = '';
    void this.flashEl.offsetWidth;
    this.flashEl.className = kind;
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
