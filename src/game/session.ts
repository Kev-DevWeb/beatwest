import * as THREE from 'three';
import type { AudioPlayer } from '../audio/player';
import type { Sfx } from '../audio/sfx';
import { beatDistance } from '../audio/tempo';
import { isShot, type Chart, type Difficulty, type Note } from '../chart/types';
import type { Settings } from '../storage';
import type { Hud } from '../ui/hud';
import { applyTargetPalette, Target } from '../world/entities';
import { Fx } from '../world/fx';
import { TARGETS } from '../world/palette';
import { Covers } from '../world/props';
import { railPosition, type Stage } from '../world/stage';
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
/** Smallest a head may be on screen (px radius); smaller ones are scaled up. */
const MIN_HEAD_PX = 11;
/** Seconds of song ahead of time that a target's stand is put up. */
const COVER_LEAD = 6;
const MILESTONES = [25, 50, 100, 200, 300, 500];
const FALL_TIME = 1.0;

export interface Result {
  score: Score;
  failed: boolean;
  autoplay: boolean;
  civiliansShot: number;
}

/** One playthrough of a chart: spawns targets, judges shots, tracks score/health and drives HUD and effects. */
export class Session {
  readonly score: Score;
  readonly revolver = new Revolver();
  readonly deadEye = new DeadEye();
  private targets: Target[] = [];
  private covers: Covers;
  private fx: Fx;
  private lead: THREE.Line;
  private next = 0;
  private coverNext = 0;
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
  private milestone = 0;
  private firstSpawn: number;
  private failedAt = -1;
  private lastSong = -Infinity;
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
    /** Loudness of the song at a given time, 0..1. */
    private energyAt: (t: number) => number,
  ) {
    this.rate = playbackRate(mods);
    this.beat = 60 / chart.bpm;
    this.hidden = mods.includes('hidden');
    this.score = new Score(modMultiplier(mods));
    this.covers = new Covers(stage.dynamic, stage.mats);
    this.fx = new Fx(stage.dynamic);
    applyTargetPalette(TARGETS[settings.palette], stage.textures);

    // Keep heads hittable at wide FOVs and small windows.
    let scale = TARGET_SCALE[chart.difficulty];
    const px = stage.pixelRadius(0.26 * scale);
    if (px < MIN_HEAD_PX) scale *= Math.min(1.6, MIN_HEAD_PX / px);
    this.scale = scale;

    const first = chart.notes.find(isShot) ?? chart.notes[0];
    this.firstSpawn = (first ? first.time : 0) - chart.approach * this.rate;

    // Faint line from the current target to the next one, like osu's follow points.
    this.lead = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthTest: false }),
    );
    this.lead.frustumCulled = false;
    this.lead.visible = false;
    stage.dynamic.add(this.lead);

    this.warmUp();
  }

  /** Shows one of everything for a single frame so the first real ones appear without a hitch. */
  private warmUp(): void {
    const now = performance.now() / 1000;
    const kinds = ['bandit', 'burst', 'drone', 'civilian'] as const;
    const notes: Note[] = kinds.map((kind, i) => ({ id: -1 - i, kind, time: 0, duration: 1, yaw: (i - 1.5) * 0.12, pitch: 0.1, yaw2: 0, pitch2: 0.1 }));
    const dummies = notes.map((n) => new Target(n, 1, now));
    dummies[0].setMarked();
    notes.forEach((n) => this.covers.ensure(n, 1, now - 1));
    this.covers.update(now, 0);
    this.fx.shatter(dummies[0].aim, dummies[0].color, 3, new THREE.Vector3());
    this.fx.burst(dummies[0].aim, dummies[0].color, 3);
    this.fx.tracer(dummies[0].aim, dummies[1].aim, dummies[0].color);
    this.fx.update(0.01);
    this.stage.update({ songTime: 0, yaw: 0, pitch: 0.1, dt: 0, deadEye: false, energy: 0, fall: 0 });
    dummies.forEach((d) => d.update(now, 0, 1, 0.05, this.stage.camera, false));
    this.stage.warmUp(dummies.map((d) => d.group));
    dummies.forEach((d) => d.dispose());
    this.covers.clear();
    this.fx.clear();
  }

  // ----- input -------------------------------------------------------------

  look(dx: number, dy: number): void {
    if (this.autoplay || this.finished) return;
    const k = this.settings.degPerCount * DEG;
    this.yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, this.yaw - dx * k));
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch - dy * k));
  }

  /** @param when song time of the shot; defaults to now (the bot passes the exact beat). */
  fire(when?: number): void {
    if (this.finished) return;
    const t = when ?? this.player.songTime();
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
    const reach = best ? best.distance : 70;
    const end = new THREE.Vector3(origin.x + dir.x * reach, origin.y + dir.y * reach, origin.z + dir.z * reach);
    // Start the streak a little ahead of the barrel so it never fills the screen.
    const start = this.stage.gun.muzzle().add(new THREE.Vector3(dir.x, dir.y, dir.z).multiplyScalar(1.2));
    this.fx.tracer(start, end, new THREE.Color(0xffe2a8).multiplyScalar(1.5), 0.014);
    if (!best) { this.score.breakCombo(); return; }

    const { target, zone } = best;
    const at = this.stage.project(target.aim);
    if (target.note.kind === 'civilian') {
      this.civiliansShot++;
      this.score.breakCombo();
      this.damage(HEALTH.civilian);
      this.sfx.civilian();
      this.hud.judgement('¡ERA UN CIVIL!', 'miss');
      this.hud.flash('hurt');
      this.destroy(target, 10, dir);
      return;
    }
    const delta = (t - target.note.time) / this.rate;
    const j = judge(delta);
    if (j === null || j === 'miss') {
      // Fired before the bandit had even drawn: the bullet is wasted but nothing else happens.
      this.hud.judgement('MUY PRONTO', 'early');
      return;
    }
    const headshot = target.note.kind === 'bandit' && zone === 'head';
    this.registerHit(target, j, target.note.kind === 'burst' ? 'crit' : zone, delta * 1000, at, dir);
    this.sfx.hit(headshot || target.note.kind === 'burst', j === 'perfect');
  }

  reload(): void {
    if (this.finished) return;
    const t = this.player.songTime();
    const error = beatDistance(t, this.chart.bpm, this.chart.phase) / this.rate;
    const result = this.revolver.reload(t, error, this.beat);
    if (result === 'perfect') {
      this.sfx.reload(true);
      this.stage.gun.startReload(0);
      this.hud.judgement('RECARGA PERFECTA', 'perfect');
    } else if (result === 'slow') {
      this.sfx.reload(false);
      this.stage.gun.startReload(this.beat / this.rate);
      this.hud.judgement('RECARGA LENTA', 'ok');
    }
  }

  triggerDeadEye(): void {
    if (this.finished) return;
    if (this.deadEye.activate(this.player.songTime(), this.beat)) {
      this.sfx.deadEye();
      this.hud.flash('deadeye');
      this.hud.banner('DEAD EYE');
    }
  }

  // ----- scoring helpers ---------------------------------------------------

  private registerHit(target: Target, j: Judgement, zone: 'head' | 'body' | 'crit', errorMs: number, at: { x: number; y: number } | null, dir: { x: number; y: number; z: number }): void {
    const t = this.player.songTime();
    const reaction = (performance.now() / 1000 - target.spawnedAt) * 1000;
    const points = this.score.hit(j, zone, errorMs, reaction);
    this.health = Math.min(100, this.health + HEALTH[j as 'perfect' | 'good' | 'ok']);
    if (zone === 'head') {
      this.deadEye.charge(j === 'perfect' ? CHARGE.perfectHead : CHARGE.goodHead, t);
      this.stage.zoomPunch();
    }
    const label = j === 'ok' ? (errorMs < 0 ? 'PRONTO' : 'TARDE') : JUDGEMENT_LABEL[j];
    const gold = zone === 'head' && j === 'perfect';
    this.hud.judgement(zone === 'head' ? `☠ ${label}` : label, gold ? 'gold' : j);
    this.hud.popup(`+${points}`, gold ? 'gold' : j, at);
    this.destroy(target, zone === 'head' ? 18 : zone === 'crit' ? 9 : 11, dir);
    if (zone === 'head') this.fx.burst(target.aim, new THREE.Color(TARGETS[this.settings.palette].perfect).multiplyScalar(2.5), 26);

    const reached = MILESTONES.find((m) => m === this.score.combo && m > this.milestone);
    if (reached) {
      this.milestone = reached;
      this.hud.banner(`${reached} SEGUIDOS`);
      this.sfx.milestone();
    }
  }

  private registerMiss(target: Target, amount: number): void {
    this.score.miss();
    this.damage(amount);
    this.sfx.miss();
    this.hud.judgement('FALLO', 'miss');
    this.hud.flash('hurt');
    this.stage.shake(1);
    if (target.note.kind === 'bandit') {
      // The bandit got his shot off.
      // The streak stops short of the camera so it reads as a near miss, not a wall of red.
      const from = target.muzzle;
      const cam = this.stage.camera.position;
      const to = new THREE.Vector3(cam.x + 0.5, cam.y - 0.35, cam.z).sub(from).multiplyScalar(0.82).add(from);
      this.fx.tracer(from, to, new THREE.Color(0xff2a2a).multiplyScalar(2.5), 0.03, 0.16);
    }
    target.kill(performance.now() / 1000, true);
    this.covers.collapse(target.note.id, performance.now() / 1000 + 0.25);
  }

  private damage(amount: number): void {
    this.health = Math.max(0, this.health + amount);
  }

  private destroy(target: Target, pieces: number, dir: { x: number; y: number; z: number }): void {
    const now = performance.now() / 1000;
    const hot = target.color.clone().multiplyScalar(1.6);
    this.fx.shatter(target.aim, hot, pieces, new THREE.Vector3(dir.x, dir.y, dir.z));
    this.fx.burst(target.aim, hot, 12);
    target.kill(now);
    this.covers.collapse(target.note.id, now + 0.15);
  }

  // ----- per-frame ---------------------------------------------------------

  update(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - this.lastFrame);
    this.lastFrame = now;
    const t = this.player.songTime();
    const approach = this.chart.approach * this.rate;
    const notes = this.chart.notes;

    if (!this.finished) {
      while (this.coverNext < notes.length && notes[this.coverNext].time - t < COVER_LEAD * this.rate) {
        this.covers.ensure(notes[this.coverNext++], this.scale, now);
      }
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
            this.sfx.mark();
          }
          if (this.deadEye.isMarked(n.id) && t >= n.time) {
            this.deadEye.consume(n.id);
            this.stage.kick();
            this.sfx.shot();
            this.sfx.hit(true, true);
            this.fx.tracer(this.stage.gun.muzzle(), target.aim, new THREE.Color(0xffe2a8).multiplyScalar(1.5), 0.014);
            const to = target.aim.clone().sub(this.stage.camera.position).normalize();
            this.registerHit(target, 'perfect', n.kind === 'burst' ? 'crit' : 'head', 0, this.stage.project(target.aim), to);
          } else if ((t - n.time) / this.rate > WINDOWS.late) {
            this.registerMiss(target, HEALTH.miss);
          }
        } else if (n.kind === 'drone') {
          target.isTracked = t >= n.time && raySphere(origin, dir, target.aim, target.radius) !== null;
          // Credit the stretch of flight since the last frame (in song time, so slow frames lose nothing).
          if (target.isTracked) target.tracked += Math.max(0, Math.min(t, n.time + n.duration) - Math.max(this.lastSong, n.time));
          if (t > n.time + n.duration) {
            const j = judgeTracking(Math.min(1, target.tracked / n.duration));
            if (j === 'miss') this.registerMiss(target, HEALTH.droneMiss);
            else {
              const points = this.score.hit(j, 'track');
              this.health = Math.min(100, this.health + HEALTH[j as 'perfect' | 'good' | 'ok']);
              this.hud.judgement(`DRON ${JUDGEMENT_LABEL[j]}`, j);
              this.hud.popup(`+${points}`, j, this.stage.project(target.aim));
              this.sfx.hit(false, j === 'perfect');
              this.destroy(target, 12, dir);
            }
          }
        } else if (t > n.time + n.duration) {
          target.kill(now, true);
          this.covers.collapse(n.id, now + 0.25);
        }
      }

      const beatIndex = Math.floor((t - this.chart.phase) / this.beat);
      if (beatIndex !== this.lastBeat) {
        this.lastBeat = beatIndex;
        if (t >= 0) {
          this.stage.beat();
          if (this.energyAt(t) > 0.8 && Math.random() < 0.22) this.stage.lightning();
        }
      }

      if (deadEyeOn !== this.wasDeadEye) {
        this.wasDeadEye = deadEyeOn;
        this.player.setMuffled(deadEyeOn);
        this.hud.setDeadEyeFx(deadEyeOn);
      }

      const failed = !this.mods.includes('nf') &&
        (this.health <= 0 || (this.mods.includes('sd') && this.score.counts.miss > 0));
      const done = this.next >= notes.length && this.targets.every((x) => !x.alive) &&
        (t >= this.chart.duration - 0.3 || this.player.ended);
      if (failed || done) this.finish(failed, now);

      this.updateGuides(t);
      this.hud.setScore(this.score.score, this.score.accuracy);
      this.hud.setCombo(this.score.combo, this.score.gold);
      this.hud.setHealth(this.health / 100);
      this.hud.setAmmo(this.revolver.ammo, t < this.revolver.lockedUntil);
      this.hud.setDeadEye(this.deadEye.meter, deadEyeOn, this.deadEye.remaining(t, this.beat));
      this.hud.setProgress(t / this.chart.duration);
      this.hud.countdown(this.countdownText(t));
      this.hud.message(this.revolver.ammo === 0 ? 'RECARGA [R] AL RITMO' : '');
    }

    const perfect = WINDOWS.perfect * this.rate;
    this.targets = this.targets.filter((target) => {
      if (target.update(now, t, approach, perfect, this.stage.camera, this.hidden)) return true;
      this.stage.dynamic.remove(target.group);
      target.dispose();
      return false;
    });
    this.lastSong = t;
    this.covers.update(now, railPosition(t).z);
    this.fx.update(dt);
    const fall = this.failedAt < 0 ? 0 : Math.pow(Math.min(1, (now - this.failedAt) / FALL_TIME), 2) * 1.25;
    this.stage.update({ songTime: t, yaw: this.yaw, pitch: this.pitch, dt, deadEye: this.wasDeadEye, energy: this.energyAt(t), fall });
  }

  private countdownText(t: number): string {
    const beats = (this.firstSpawn - t) / this.beat;
    if (beats > 3) return t < 0 ? 'PREPÁRATE' : '';
    if (beats > 0) return String(Math.ceil(beats));
    return beats > -1.2 ? '¡DESENFUNDA!' : '';
  }

  /** Follow line between the next two targets and an arrow when the next one is off screen. */
  private updateGuides(t: number): void {
    const upcoming = this.targets.filter((x) => x.alive && x.note.kind !== 'civilian');
    const current = upcoming[0], following = upcoming[1];
    if (current && following && isShot(current.note) && isShot(following.note)) {
      const pos = this.lead.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, current.aim.x, current.aim.y, current.aim.z);
      pos.setXYZ(1, following.aim.x, following.aim.y, following.aim.z);
      pos.needsUpdate = true;
      this.lead.visible = true;
    } else {
      this.lead.visible = false;
    }

    let arrow: number | null = null;
    if (current) {
      const a = anglesTo(railPosition(t), current.aim);
      const dyaw = a.yaw - this.yaw, dpitch = a.pitch - this.pitch;
      const half = (this.stage.camera.fov * DEG) / 2;
      const offX = Math.abs(dyaw) > half * this.stage.camera.aspect * 0.8, offY = Math.abs(dpitch) > half * 0.8;
      // Screen angle: 0 = right, counter-clockwise. Positive yaw is to the left.
      if (offX || offY) arrow = Math.atan2(dpitch, -dyaw);
    }
    this.hud.arrow(arrow);
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
      this.stage.gun.startReload(0);
    }
    // Fire every shot that came due since the last frame, exactly on its beat, so the bot's
    // result does not depend on the frame rate.
    for (const due of this.targets) {
      if (!due.alive || !isShot(due.note) || t < due.note.time) continue;
      if (this.revolver.ammo === 0) this.revolver.reload(due.note.time, 0, this.beat);
      const a = anglesTo(railPosition(due.note.time), due.aim);
      this.yaw = a.yaw;
      this.pitch = a.pitch;
      this.fire(due.note.time);
    }
  }

  private finish(failed: boolean, now: number): void {
    this.finished = { score: this.score, failed, autoplay: this.autoplay, civiliansShot: this.civiliansShot };
    this.player.setMuffled(false);
    this.hud.setDeadEyeFx(false);
    this.hud.arrow(null);
    this.hud.countdown('');
    this.hud.message('');
    this.lead.visible = false;
    if (failed) {
      this.failedAt = now;
      this.player.windDown(FALL_TIME);
      this.hud.banner('ABATIDO');
      this.hud.flash('hurt');
    } else {
      this.hud.banner(this.score.counts.miss === 0 ? '¡SIN FALLOS!' : 'RECOMPENSA COBRADA');
    }
  }

  dispose(): void {
    for (const target of this.targets) {
      this.stage.dynamic.remove(target.group);
      target.dispose();
    }
    this.targets = [];
    this.covers.clear();
    this.fx.clear();
    this.stage.dynamic.remove(this.lead);
    this.lead.geometry.dispose();
    (this.lead.material as THREE.Material).dispose();
    this.hud.setDeadEyeFx(false);
  }
}
