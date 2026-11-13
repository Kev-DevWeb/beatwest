import './ui/styles.css';
import type { Analysis } from './audio/analyze';
import { renderDemoTrack } from './audio/demoTrack';
import { AudioPlayer } from './audio/player';
import { Sfx } from './audio/sfx';
import { generateChart } from './chart/generator';
import { DIFFICULTY_LABEL, isShot, type Chart, type Difficulty } from './chart/types';
import { MODS, modsKey, playbackRate, toggleMod, type ModId } from './game/mods';
import { Session } from './game/session';
import { bestScore, loadSettings, saveScore, saveSettings, scoreKey } from './storage';
import { Hud, renderCrosshair } from './ui/hud';
import { Calibration, initSettings, showResults } from './ui/screens';
import { Stage } from './world/stage';

type Screen = 'menu' | 'settings' | 'calibration' | 'pause' | 'results' | 'none';
interface Song { name: string; buffer: AudioBuffer; analysis: Analysis }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const settings = loadSettings();
const stage = new Stage(canvas);
const hud = new Hud();

let player: AudioPlayer | null = null;
let sfx: Sfx | null = null;
let calibration: Calibration | null = null;
let song: Song | null = null;
let chart: Chart | null = null;
let session: Session | null = null;
let difficulty: Difficulty = 'normal';
let mods: ModId[] = [];
let autoplay = new URLSearchParams(location.search).has('autoplay');
let screen: Screen = 'menu';
let paused = false;
let finishedAt = 0;

// ------------------------------------------------------------------ helpers

function show(next: Screen): void {
  screen = next;
  for (const id of ['menu', 'settings', 'calibration', 'pause', 'results']) {
    $(id).classList.toggle('hidden', id !== next);
  }
}

/** The AudioContext may only be created after a user gesture. */
function audio(): { player: AudioPlayer; sfx: Sfx } {
  if (!player) {
    player = new AudioPlayer();
    sfx = new Sfx(player);
    calibration = new Calibration(player, sfx);
  }
  applySettings();
  return { player, sfx: sfx! };
}

function applySettings(): void {
  stage.setFov(settings.fov);
  renderCrosshair($('crosshair'), settings.crosshair);
  if (player) {
    player.setVolumes(settings.musicVolume, settings.sfxVolume);
    player.offset = settings.offsetMs / 1000;
  }
}

function analyse(samples: Float32Array, sampleRate: number): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audio/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        $('load-bar').style.width = Math.round(e.data.value * 100) + '%';
      } else {
        worker.terminate();
        resolve(e.data.result as Analysis);
      }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
}

async function loadSong(name: string, getBuffer: (p: AudioPlayer) => Promise<AudioBuffer> | AudioBuffer): Promise<void> {
  const { player } = audio();
  $('loading').classList.remove('hidden');
  $('load-error').classList.add('hidden');
  $('setup').classList.add('hidden');
  $('load-bar').style.width = '0%';
  $('load-text').textContent = 'Decodificando audio…';
  try {
    const buffer = await getBuffer(player);
    if (buffer.duration < 10) throw new Error('La canción es demasiado corta (mínimo 10 segundos).');
    $('load-text').textContent = 'Buscando el ritmo…';
    const analysis = await analyse(AudioPlayer.toMono(buffer), buffer.sampleRate);
    song = { name, buffer, analysis };
    renderSetup();
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'formato no compatible';
    $('load-error').textContent = `No se pudo cargar el audio: ${message}`;
    $('load-error').classList.remove('hidden');
  } finally {
    $('loading').classList.add('hidden');
  }
}

function renderSetup(): void {
  if (!song) return;
  chart = generateChart(song.analysis, difficulty);
  const shots = chart.notes.filter(isShot).length;
  const mins = Math.floor(song.analysis.duration / 60), secs = Math.floor(song.analysis.duration % 60);
  $('song-name').textContent = song.name;
  $('song-info').textContent =
    `${Math.round(song.analysis.bpm * playbackRate(mods))} BPM · ${mins}:${String(secs).padStart(2, '0')} · ${shots} disparos · ${chart.notes.length - shots} extras`;

  $('diffs').innerHTML = (Object.keys(DIFFICULTY_LABEL) as Difficulty[])
    .map((d) => `<button class="chip ${d === difficulty ? 'on' : ''}" data-diff="${d}" aria-pressed="${d === difficulty}">${DIFFICULTY_LABEL[d]}</button>`)
    .join('');
  $('mods').innerHTML =
    MODS.map((m) => `<button class="chip ${mods.includes(m.id) ? 'on' : ''}" data-mod="${m.id}" title="${m.description}" aria-pressed="${mods.includes(m.id)}">${m.short} · ${m.name}</button>`).join('') +
    `<button class="chip auto ${autoplay ? 'on' : ''}" data-auto title="El juego se juega solo" aria-pressed="${autoplay}">AUTO</button>`;
  const active = MODS.filter((m) => mods.includes(m.id));
  $('mod-info').textContent = active.length
    ? active.map((m) => `${m.name}: ${m.description} (×${m.multiplier})`).join(' · ')
    : 'Sin mods. Pasa el cursor sobre cada uno para ver qué hace.';
  const best = bestScore(scoreKey(song.analysis.hash, difficulty, modsKey(mods)));
  $('best').textContent = best
    ? `Tu récord: ${best.score.toLocaleString('es')} · ${(best.accuracy * 100).toFixed(2)}% · rango ${best.rank}`
    : 'Aún no tienes récord con esta combinación.';
  $('setup').classList.remove('hidden');
}

// --------------------------------------------------------------- game flow

async function startGame(): Promise<void> {
  if (!song) return;
  const { player, sfx } = audio();
  session?.dispose();
  chart = generateChart(song.analysis, difficulty);
  session = new Session(stage, player, sfx, hud, chart, settings, mods, autoplay);
  paused = false;
  finishedAt = 0;
  show('none');
  hud.setMods((autoplay ? 'AUTO ' : '') + (mods.length ? modsKey(mods) : ''));
  hud.show(true);
  await player.start(song.buffer, playbackRate(mods));
  if (!autoplay) lockPointer();
}

function lockPointer(): void {
  try {
    const request = canvas.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined;
    // Raw input is not available everywhere; fall back to the normal pointer lock.
    request?.catch?.(() => canvas.requestPointerLock());
  } catch {
    canvas.requestPointerLock();
  }
}

function pause(): void {
  if (!session || session.finished || paused || screen !== 'none') return;
  paused = true;
  void player?.pause();
  show('pause');
}

async function resume(): Promise<void> {
  if (!paused) return;
  show('none');
  if (!autoplay) lockPointer();
  await player?.resume();
  paused = false;
}

function endGame(): void {
  if (!session?.finished || !song || !chart) return;
  const result = session.finished;
  player?.stop();
  if (document.pointerLockElement) document.exitPointerLock();
  hud.show(false);
  let newBest = false;
  if (!result.failed && !result.autoplay) {
    newBest = saveScore(scoreKey(song.analysis.hash, difficulty, modsKey(mods)), {
      score: result.score.score,
      accuracy: result.score.accuracy,
      rank: result.score.rank,
      maxCombo: result.score.maxCombo,
      date: Date.now(),
    });
  }
  showResults(result, song.name, `${DIFFICULTY_LABEL[difficulty]} · ${modsKey(mods)}`, newBest);
  show('results');
}

function toMenu(): void {
  player?.stop();
  void player?.resume();
  session?.dispose();
  session = null;
  paused = false;
  if (document.pointerLockElement) document.exitPointerLock();
  hud.show(false);
  renderSetup();
  show('menu');
}

// ------------------------------------------------------------------- input

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas && session && !paused) session.look(e.movementX, e.movementY);
});
canvas.addEventListener('mousedown', (e) => {
  if (!session || paused || screen !== 'none' || autoplay) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (e.button === 0) session.fire();
  else if (e.button === 2) session.triggerDeadEye();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && !autoplay) pause();
});
document.addEventListener('keydown', (e) => {
  if (screen === 'calibration' && e.code === 'Space') { e.preventDefault(); calibration?.tap(); return; }
  if (screen === 'none' && session && !paused) {
    if (e.code === 'KeyR') session.reload();
    else if (e.code === 'KeyQ' || e.code === 'Space') { e.preventDefault(); session.triggerDeadEye(); }
    else if (e.code === 'Escape') pause();
  } else if (screen === 'pause' && e.code === 'Escape') {
    void resume();
  }
});
window.addEventListener('blur', pause);

// -------------------------------------------------------------------- menu

$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void loadFile(file);
  (e.target as HTMLInputElement).value = '';
});

function loadFile(file: File): Promise<void> {
  const name = file.name.replace(/\.[^.]+$/, '');
  return loadSong(name, async (p) => p.decode(await file.arrayBuffer()));
}

const drop = $('drop');
window.addEventListener('dragover', (e) => { e.preventDefault(); if (screen === 'menu') drop.classList.add('over'); });
window.addEventListener('dragleave', () => drop.classList.remove('over'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files?.[0];
  if (file && screen === 'menu') void loadFile(file);
});

$('demo').addEventListener('click', () => {
  void loadSong('Pista demo · Neon Gulch', (p) => p.bufferFromSamples(renderDemoTrack(p.ctx.sampleRate), p.ctx.sampleRate));
});

$('setup').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-diff],[data-mod],[data-auto]');
  if (!el) return;
  if (el.dataset.diff) difficulty = el.dataset.diff as Difficulty;
  else if (el.dataset.mod) mods = toggleMod(mods, el.dataset.mod as ModId);
  else autoplay = !autoplay;
  renderSetup();
});
$('play').addEventListener('click', () => void startGame());
$('retry').addEventListener('click', () => void startGame());
$('restart').addEventListener('click', () => { void player?.resume(); void startGame(); });
$('resume').addEventListener('click', () => void resume());
$('quit').addEventListener('click', toMenu);
$('to-menu').addEventListener('click', toMenu);

const refreshSettingsForm = initSettings(settings, () => { saveSettings(settings); applySettings(); });
$('open-settings').addEventListener('click', () => { refreshSettingsForm(); show('settings'); });
$('open-calibration').addEventListener('click', () => { audio(); show('calibration'); });
$('cal-start').addEventListener('click', () => void calibration?.begin());
$('calibration').addEventListener('mousedown', (e) => {
  if (!(e.target as HTMLElement).closest('button')) calibration?.tap();
});
$('cal-save').addEventListener('click', () => {
  if (calibration?.result == null) return;
  settings.offsetMs = calibration.result;
  saveSettings(settings);
  applySettings();
  show('menu');
});
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { calibration?.cancel(); show('menu'); }));

// -------------------------------------------------------------------- loop

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (session) {
    if (!paused) session.update();
    if (session.finished && !finishedAt) finishedAt = now;
    if (finishedAt && now - finishedAt > 900 && screen === 'none') endGame();
  } else {
    // Idle fly-through behind the menus.
    stage.update(now / 4000, Math.sin(now / 5000) * 0.25, 0.08, dt, false);
  }
  stage.render();
  requestAnimationFrame(frame);
}

applySettings();
show('menu');
requestAnimationFrame(frame);

// Small hook for automated checks and debugging from the console.
(window as unknown as { beatwest: unknown }).beatwest = {
  get state() {
    return {
      screen, paused, song: song?.name ?? null, bpm: song?.analysis.bpm ?? null,
      notes: chart?.notes.length ?? 0,
      songTime: player && session ? player.songTime() : null,
      score: session ? { ...session.score, accuracy: session.score.accuracy, rank: session.score.rank, errors: undefined, reactions: undefined } : null,
      finished: session?.finished ? { failed: session.finished.failed } : null,
    };
  },
};
