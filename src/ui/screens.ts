import type { AudioPlayer } from '../audio/player';
import type { Sfx } from '../audio/sfx';
import type { Result } from '../game/session';
import { mean, unstableRate } from '../game/scoring';
import { WINDOWS } from '../game/judge';
import { cmPer360, degPerCountFromCm, degPerCountFromGame, GAME_YAW, gameSensitivity, type GameId } from '../input/sensitivity';
import type { Settings } from '../storage';
import { renderCrosshair } from './hud';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);

// ---------------------------------------------------------------- settings

/** Wires the settings form to `settings`; returns a function that re-reads the form from it. */
export function initSettings(settings: Settings, onChange: () => void): () => void {
  const game = $<HTMLSelectElement>('s-game');
  game.innerHTML = Object.entries(GAME_YAW).map(([id, g]) => `<option value="${id}">${g.name}</option>`).join('');

  const refresh = () => {
    game.value = settings.game;
    input('s-sens').value = String(+gameSensitivity(settings.game, settings.degPerCount).toFixed(4));
    input('s-dpi').value = String(settings.dpi);
    input('s-cm').value = cmPer360(settings.degPerCount, settings.dpi).toFixed(1);
    input('s-fov').value = String(settings.fov);
    $('s-fov-out').textContent = settings.fov + '°';
    input('s-ch-size').value = String(settings.crosshair.size);
    input('s-ch-thick').value = String(settings.crosshair.thickness);
    input('s-ch-gap').value = String(settings.crosshair.gap);
    input('s-ch-color').value = settings.crosshair.color;
    input('s-ch-dot').checked = settings.crosshair.dot;
    input('s-music').value = String(settings.musicVolume);
    input('s-sfx').value = String(settings.sfxVolume);
    input('s-offset').value = String(Math.round(settings.offsetMs));
    $<HTMLSelectElement>('s-palette').value = settings.palette;
    $<HTMLSelectElement>('s-quality').value = settings.quality;
    input('s-motion').value = String(settings.motion);
    renderCrosshair($('s-preview'), settings.crosshair);
  };
  const bind = (id: string, apply: (value: number, el: HTMLInputElement) => void) => {
    $(id).addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const v = parseFloat(el.value);
      if (el.type !== 'checkbox' && el.type !== 'color' && !(v >= 0 || v < 0)) return;
      apply(v, el);
      // Don't overwrite the field being typed in; refresh the derived ones on blur.
      if (el.type === 'range' || el.type === 'checkbox' || el.type === 'color') refresh();
      else {
        input('s-cm').value = el.id === 's-cm' ? el.value : cmPer360(settings.degPerCount, settings.dpi).toFixed(1);
        if (el.id !== 's-sens') input('s-sens').value = String(+gameSensitivity(settings.game, settings.degPerCount).toFixed(4));
      }
      onChange();
    });
    $(id).addEventListener('change', refresh);
  };

  game.addEventListener('change', () => {
    // Keep the same number the player typed, reinterpret it for the newly chosen game.
    const sens = parseFloat(input('s-sens').value) || 1;
    settings.game = game.value as GameId;
    settings.degPerCount = degPerCountFromGame(settings.game, sens);
    refresh();
    onChange();
  });
  bind('s-sens', (v) => { if (v > 0) settings.degPerCount = degPerCountFromGame(settings.game, v); });
  bind('s-dpi', (v) => { if (v >= 100) settings.dpi = v; });
  bind('s-cm', (v) => { if (v > 0) settings.degPerCount = degPerCountFromCm(v, settings.dpi); });
  bind('s-fov', (v) => { settings.fov = v; });
  bind('s-ch-size', (v) => { settings.crosshair.size = v; });
  bind('s-ch-thick', (v) => { settings.crosshair.thickness = v; });
  bind('s-ch-gap', (v) => { settings.crosshair.gap = v; });
  bind('s-ch-color', (_, el) => { settings.crosshair.color = el.value; });
  bind('s-ch-dot', (_, el) => { settings.crosshair.dot = el.checked; });
  bind('s-music', (v) => { settings.musicVolume = v; });
  bind('s-sfx', (v) => { settings.sfxVolume = v; });
  bind('s-offset', (v) => { settings.offsetMs = v; });
  bind('s-motion', (v) => { settings.motion = v; });
  for (const id of ['s-palette', 's-quality'] as const) {
    $(id).addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      if (id === 's-palette') settings.palette = value as Settings['palette'];
      else settings.quality = value as Settings['quality'];
      onChange();
    });
  }
  refresh();
  return refresh;
}

// ------------------------------------------------------------- calibration

const TICKS = 16;
const INTERVAL = 0.5;

export class Calibration {
  private start = 0;
  private errors: number[] = [];
  private running = false;
  private timer = 0;
  result: number | null = null;

  constructor(private player: AudioPlayer, private sfx: Sfx) {}

  async begin(): Promise<void> {
    this.cancel();
    await this.player.ctx.resume();
    this.errors = [];
    this.result = null;
    this.running = true;
    this.start = this.player.ctx.currentTime + 0.8;
    for (let i = 0; i < TICKS; i++) this.sfx.tick(this.start + i * INTERVAL, i % 4 === 0);
    $('cal-status').textContent = 'Escucha y pulsa en cada clic…';
    $('cal-save').classList.add('hidden');
    this.timer = window.setTimeout(() => this.finish(), (0.8 + TICKS * INTERVAL + 0.3) * 1000);
  }

  tap(): void {
    if (!this.running) return;
    const t = this.player.ctx.currentTime - this.player.latency - this.start;
    const k = Math.round(t / INTERVAL);
    if (k < 0 || k >= TICKS) return;
    // The first beats are for finding the pulse; only later taps count.
    if (k >= 3) this.errors.push(t - k * INTERVAL);
    const pulse = $('cal-pulse');
    pulse.classList.remove('tap');
    void pulse.offsetWidth;
    pulse.classList.add('tap');
    $('cal-status').textContent = `${Math.min(k + 1, TICKS)} / ${TICKS}`;
  }

  private finish(): void {
    this.running = false;
    if (this.errors.length < 6) {
      $('cal-status').textContent = 'Hicieron falta más pulsaciones. Inténtalo otra vez.';
      return;
    }
    const sorted = [...this.errors].sort((a, b) => a - b);
    this.result = Math.round(sorted[Math.floor(sorted.length / 2)] * 1000);
    const sign = this.result > 0 ? '+' : '';
    $('cal-status').textContent = `Tu offset: ${sign}${this.result} ms (${this.errors.length} pulsaciones).`;
    $('cal-save').classList.remove('hidden');
  }

  cancel(): void {
    this.running = false;
    clearTimeout(this.timer);
  }
}

// ----------------------------------------------------------------- results

export function showResults(result: Result, title: string, subtitle: string, newBest: boolean): void {
  const s = result.score;
  const rank = $('r-rank');
  rank.textContent = result.failed ? 'ABATIDO' : s.rank;
  $('r-head').textContent = result.failed ? 'Te abatieron' : 'Recompensa cobrada';
  $('r-score').textContent = s.score.toLocaleString('es');
  rank.classList.toggle('fail', result.failed);
  $('r-title').textContent = title;
  $('r-sub').textContent = subtitle + (result.autoplay ? ' · AUTO (no se guarda)' : newBest ? ' · ¡Nuevo récord!' : '');

  const bias = mean(s.errors);
  const hits = s.errors.length;   // every bullet that connected recorded a timing error
  const stat = (label: string, value: string) => `<div><span>${label}</span><b>${value}</b></div>`;
  $('r-stats').innerHTML = [
    stat('Precisión', (s.accuracy * 100).toFixed(2) + '%'),
    stat('Combo máximo', s.maxCombo + 'x'),
    stat('Perfect / Good / Ok', `${s.counts.perfect} / ${s.counts.good} / ${s.counts.ok}`),
    stat('Fallos', String(s.counts.miss)),
    stat('Headshots', (s.headshotRate * 100).toFixed(0) + '%' + ` (racha ${s.maxGold})`),
    stat('Puntería', s.shotsFired ? ((Math.min(hits, s.shotsFired) / s.shotsFired) * 100).toFixed(0) + '% de balas' : '—'),
    stat('Desvío medio', s.errors.length ? `${Math.abs(bias).toFixed(0)} ms ${bias < 0 ? 'pronto' : 'tarde'}` : '—'),
    stat('Unstable rate', s.errors.length > 1 ? unstableRate(s.errors).toFixed(0) : '—'),
    stat('Aparición → disparo', s.reactions.length ? mean(s.reactions).toFixed(0) + ' ms' : '—'),
    stat('Civiles heridos', String(result.civiliansShot)),
  ].join('');
  drawHistogram($<HTMLCanvasElement>('r-hist'), s.errors);
}

function drawHistogram(canvas: HTMLCanvasElement, errors: number[]): void {
  const g = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  const range = WINDOWS.early * 1000, bins = 60;
  const counts = new Array<number>(bins).fill(0);
  for (const e of errors) {
    const i = Math.floor(((e + range) / (2 * range)) * bins);
    if (i >= 0 && i < bins) counts[i]++;
  }
  const max = Math.max(1, ...counts);
  const bw = w / bins;
  const zone = (ms: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(w / 2 - (ms / range) * (w / 2), 0, (ms / range) * w, h - 14);
  };
  zone(WINDOWS.good * 1000, 'rgba(42,26,20,0.08)');
  zone(WINDOWS.perfect * 1000, 'rgba(42,26,20,0.12)');
  counts.forEach((c, i) => {
    if (!c) return;
    const centre = ((i + 0.5) / bins) * 2 * range - range;
    g.fillStyle = Math.abs(centre) <= WINDOWS.perfect * 1000 ? '#a1261d' : Math.abs(centre) <= WINDOWS.good * 1000 ? '#6b5140' : '#9c8468';
    const bh = (c / max) * (h - 20);
    g.fillRect(i * bw + 1, h - 14 - bh, bw - 2, bh);
  });
  g.fillStyle = 'rgba(42,26,20,0.6)';
  g.fillRect(w / 2 - 0.5, 0, 1, h - 14);
  g.font = '11px monospace';
  g.fillStyle = '#6b5140';
  g.textAlign = 'left'; g.fillText(`-${range} ms`, 2, h - 2);
  g.textAlign = 'center'; g.fillText('0', w / 2, h - 2);
  g.textAlign = 'right'; g.fillText(`+${range} ms`, w - 2, h - 2);
}
