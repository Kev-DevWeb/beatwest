import type { AudioPlayer } from '../audio/player';
import type { Sfx } from '../audio/sfx';
import { beatDistance } from '../audio/tempo';
import { isShot, type Chart, type Difficulty } from '../chart/types';
import type { Settings } from '../storage';
import type { Hud } from '../ui/hud';
import { Sparks, Target } from '../world/entities';
import { NEON, railPosition, type Stage } from '../world/stage';
import { CHARGE, DeadEye } from './deadEye';
import { aimDirection, anglesTo, raySphere } from './hit';
import { judge, JUDGEMENT_LABEL, judgeTracking, WINDOWS, type Judgement } from './judge';
import { modMultiplier, playbackRate, type ModId } from './mods';
import { Revolver } from './revolver';
import { Score } from './scoring';

const DEG = Math.PI / 180;
const MAX_YAW = 75 * DEG, MIN_PITCH = -35 * DEG, MAX_PITCH = 50 * DEG;
const TARGET_SCALE: Record<Difficulty, number> = { easy: 1.3, normal: 1.15, hard: 1, extreme: 1 };
const HEALTH = { miss: -12, droneMiss: -6, civilian: -15, perfect: 3, good: 2, ok: 1 };

export interface Result {
  score: Score;
  failed: boolean;
  autoplay: boolean;
  civiliansShot: number;
}

/** One playthrough of a chart: spawns targets, judges shots, tracks score/health and drives the HUD. */
export class Session {
  readonly score: Score;
  readonly revolver = new Revolver();
  readonly deadEye = new DeadEye();
  private targets: Target[] = [];
  private sparks: Sparks;
  private next = 0;
  private yaw = 0;
  private pitch = 6 * DEG;
  private health = 100;
  private civiliansShot = 0;
  private lastBeat = -Infinity;
  private lastFrame = performance.now() / 1000;
  private rate: number;
  private beat: number;
  private hidden: boolean;
  private scale: number;
  private wasDeadEye = false;
  finished: Result | null = null;

  constructor(
    private stage: Stage,
    private player: AudioPlayer,
    private sfx: Sfx,
    private hud: Hud,
    private chart: Chart,
    private settings: Settings,
    private mods: ModId[],
    private autoplay: boolean,
  ) {
    this.rate = playbackRate(mods);
    this.beat = 60 / chart.bpm;
    this.hidden = mods.includes('hidden');
    this.scale = TARGET_SCALE[chart.difficulty];
    this.score = new Score(modMultiplier(mods));
    this.sparks = new Sparks(stage.dynamic);

    // Show one of each target for a single frame so the first real ones appear without a hitch.
    const now = performance.now() / 1000;
    const kinds = ['bandit', 'burst', 'drone', 'civilian'] as const;
    const dummies = kinds.map((kind, i) =>
      new Target({ id: -1, kind, time: 0, duration: 1, yaw: (i - 1.5) * 0.1, pitch: 0.1, yaw2: 0, pitch2: 0.1 }, 1, now));
    dummies[0].setMarked();
    this.sparks.emit(dummies[0].aim, NEON.amber, now, 2);
    stage.update(0, 0, 0.1, 0, false);
    dummies.forEach((d) => d.update(now, 0, 1, stage.camera, false));
    stage.warmUp(dummies.map((d) => d.group));
    dummies.forEach((d) => d.dispose());
    this.sparks.clear();
  }

  // ----- input -------------------------------------------------------------

  look(dx: number, dy: number): void {
    if (this.autoplay) return;
    const k = this.settings.degPerCount * DEG;
    this.yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, this.yaw - dx * k));
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch - dy * k));
  }

  fire(): void {
    if (this.finished) return;
    const t = this.player.songTime();
    if (!this.revolver.fire(t)) { this.sfx.empty(); return; }
    this.score.shotsFired++;
    this.stage.kick();
    this.sfx.shot();

    const origin = railPosition(t);
    const dir = aimDirection(this.yaw, this.pitch);
    let best: { target: Target; zone: 'head' | 'body'; distance: number } | null = null;
    for (const target of this.targets) {
      if (!target.isShootable) continue;
      const hit = target.hitTest(origin, dir);
      if (hit && (!best || hit.distance < best.distance)) best = { target, ...hit };
    }
    if (!best) { this.score.breakCombo(); return; }

    const { target, zone } = best;
    const at = this.stage.project(target.aim);
    if (target.note.kind === 'civilian') {
      this.civiliansShot++;
      this.score.breakCombo();
      this.damage(HEALTH.civilian);
      this.sfx.civilian();
      this.hud.popup('¡CIVIL!', 'miss', at);
      this.remove(target, NEON.green);
      return;
    }
    const delta = (t - target.note.time) / this.rate;
    const j = judge(delta);
    if (j === null || j === 'miss') {
      // Fired before the bandit had even drawn: the bullet is wasted but nothing else happens.
      this.hud.popup('MUY PRONTO', 'early', at);
      return;
    }
    const headshot = target.note.kind === 'bandit' && zone === 'head';
    this.registerHit(target, j, target.note.kind === 'burst' ? 'crit' : zone, delta * 1000, at);
    this.sfx.hit(headshot || target.note.kind === 'burst', j === 'perfect');
  }

  reload(): void {
    if (this.finished) return;
    const t = this.player.songTime();
    const error = beatDistance(t, this.chart.bpm, this.chart.phase) / this.rate;
    const result = this.revolver.reload(t, error, this.beat);
    if (result === 'perfect') { this.sfx.reload(true); this.hud.popup('RECARGA PERFECTA', 'perfect', null); }
    else if (result === 'slow') { this.sfx.reload(false); this.hud.popup('RECARGA LENTA', 'ok', null); }
  }

  triggerDeadEye(): void {
    if (this.finished) return;
    if (this.deadEye.activate(this.player.songTime(), this.beat)) {
      this.sfx.deadEye();
      this.hud.flash('deadeye');
    }
  }

  // ----- scoring helpers ---------------------------------------------------

  private registerHit(target: Target, j: Judgement, zone: 'head' | 'body' | 'crit', errorMs: number, at: { x: number; y: number } | null): void {
    const t = this.player.songTime();
    const reaction = (performance.now() / 1000 - target.spawnedAt) * 1000;
    const points = this.score.hit(j, zone, errorMs, reaction);
    this.health = Math.min(100, this.health + HEALTH[j as 'perfect' | 'good' | 'ok']);
    if (zone === 'head') this.deadEye.charge(j === 'perfect' ? CHARGE.perfectHead : CHARGE.goodHead, t);
    const label = j === 'ok' ? (errorMs < 0 ? 'EARLY' : 'LATE') : JUDGEMENT_LABEL[j];
    this.hud.popup(`${zone === 'head' ? '☠ ' : ''}${label} +${points}`, zone === 'head' && j === 'perfect' ? 'gold' : j, at);
    this.remove(target, zone === 'body' ? NEON.cyan : NEON.amber);
  }

  private registerMiss(target: Target, amount: number): void {
    this.score.miss();
    this.damage(amount);
    this.sfx.miss();
    this.hud.popup('MISS', 'miss', this.stage.project(target.aim));
    this.hud.flash('hurt');
    target.kill(performance.now() / 1000);
  }

  private damage(amount: number): void {
    this.health = Math.max(0, this.health + amount);
  }

  private remove(target: Target, color: number): void {
    const now = performance.now() / 1000;
    this.sparks.emit(target.aim, color, now);
    target.kill(now);
  }

  // ----- per-frame ---------------------------------------------------------

  update(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - this.lastFrame);
    this.lastFrame = now;
    const t = this.player.songTime();
    const approach = this.chart.approach * this.rate;

    if (!this.finished) {
      const notes = this.chart.notes;
      while (this.next < notes.length && notes[this.next].time - approach <= t) {
        const target = new Target(notes[this.next++], this.scale, now);
        this.targets.push(target);
        this.stage.dynamic.add(target.group);
      }
      if (this.autoplay) this.runBot(t);

      const origin = railPosition(t);
      const dir = aimDirection(this.yaw, this.pitch);
      const deadEyeOn = this.deadEye.isActive(t);
      for (const target of this.targets) {
        if (!target.alive) continue;
        const n = target.note;
        if (isShot(n)) {
          if (deadEyeOn && !this.deadEye.isMarked(n.id) && raySphere(origin, dir, target.aim, target.radius * 2.2) !== null) {
            this.deadEye.mark(n.id);
            target.setMarked();
          }
          if (this.deadEye.isMarked(n.id) && t >= n.time) {
            this.deadEye.consume(n.id);
            this.stage.kick();
            this.sfx.shot();
            this.sfx.hit(true, true);
            this.registerHit(target, 'perfect', n.kind === 'burst' ? 'crit' : 'head', 0, this.stage.project(target.aim));
          } else if ((t - n.time) / this.rate > WINDOWS.late) {
            this.registerMiss(target, HEALTH.miss);
          }
        } else if (n.kind === 'drone') {
          const inFlight = t >= n.time && t <= n.time + n.duration;
          target.isTracked = inFlight && raySphere(origin, dir, target.aim, target.radius) !== null;
          if (target.isTracked) target.tracked += dt * this.rate;
          if (t > n.time + n.duration) {
            const j = judgeTracking(Math.min(1, target.tracked / n.duration));
            if (j === 'miss') this.registerMiss(target, HEALTH.droneMiss);
            else {
              const points = this.score.hit(j, 'track');
              this.health = Math.min(100, this.health + HEALTH[j as 'perfect' | 'good' | 'ok']);
              this.hud.popup(`DRON ${JUDGEMENT_LABEL[j]} +${points}`, j, this.stage.project(target.aim));
              this.remove(target, NEON.cyan);
            }
          }
        } else if (t > n.time + n.duration) {
          target.kill(now);
        }
      }

      const beatIndex = Math.floor((t - this.chart.phase) / this.beat);
      if (beatIndex !== this.lastBeat) { this.lastBeat = beatIndex; if (t >= 0) this.stage.beat(); }

      if (deadEyeOn !== this.wasDeadEye) {
        this.wasDeadEye = deadEyeOn;
        this.player.setMuffled(deadEyeOn);
        this.hud.setDeadEyeFx(deadEyeOn);
      }

      const failed = !this.mods.includes('nf') &&
        (this.health <= 0 || (this.mods.includes('sd') && this.score.counts.miss > 0));
      const done = this.next >= notes.length && this.targets.every((x) => !x.alive) &&
        (t >= this.chart.duration - 0.3 || this.player.ended);
      if (failed || done) this.finish(failed);

      this.hud.setScore(this.score.score, this.score.accuracy);
      this.hud.setCombo(this.score.combo, this.score.gold);
      this.hud.setHealth(this.health / 100);
      this.hud.setAmmo(this.revolver.ammo, t < this.revolver.lockedUntil);
      this.hud.setDeadEye(this.deadEye.meter, deadEyeOn, this.deadEye.remaining(t, this.beat));
      this.hud.setProgress(t / this.chart.duration);
      this.hud.message(t < 0 ? 'PREPÁRATE…' : this.revolver.ammo === 0 ? 'RECARGA [R] AL RITMO' : '');
    }

    this.targets = this.targets.filter((target) => {
      if (target.update(now, t, approach, this.stage.camera, this.hidden)) return true;
      this.stage.dynamic.remove(target.group);
      target.dispose();
      return false;
    });
    this.sparks.update(now, dt);
    this.stage.update(t, this.yaw, this.pitch, dt, this.wasDeadEye);
  }

  /** Plays the chart perfectly: used for the demo mode and for automated verification. */
  private runBot(t: number): void {
    const origin = railPosition(t);
    const drone = this.targets.find((x) => x.alive && x.note.kind === 'drone' && t >= x.note.time - 0.1);
    const shot = this.targets.find((x) => x.alive && isShot(x.note));
    const focus = drone ?? shot;
    if (focus) {
      const a = anglesTo(origin, focus.aim);
      const due = focus === drone || t >= focus.note.time - 0.03;
      const k = due ? 1 : 0.25;
      this.yaw += (a.yaw - this.yaw) * k;
      this.pitch += (a.pitch - this.pitch) * k;
    }
    const beatIndex = Math.floor((t - this.chart.phase) / this.beat);
    if ((beatIndex !== this.lastBeat && this.revolver.ammo < 6) || this.revolver.ammo === 0) {
      this.revolver.reload(t, 0, this.beat);
      this.sfx.reload(true);
    }
    if (shot && !drone && t >= shot.note.time) {
      const a = anglesTo(origin, shot.aim);
      this.yaw = a.yaw;
      this.pitch = a.pitch;
      this.fire();
    }
  }

  private finish(failed: boolean): void {
    this.finished = { score: this.score, failed, autoplay: this.autoplay, civiliansShot: this.civiliansShot };
    this.player.setMuffled(false);
    this.hud.setDeadEyeFx(false);
  }

  dispose(): void {
    for (const target of this.targets) {
      this.stage.dynamic.remove(target.group);
      target.dispose();
    }
    this.targets = [];
    this.sparks.clear();
    this.hud.setDeadEyeFx(false);
  }
}
