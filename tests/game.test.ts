import { describe, expect, it } from 'vitest';
import { analyzeSamples } from '../src/audio/analyze';
import { renderDemoTrack } from '../src/audio/demoTrack';
import { BOUNDS, generateChart, LEAD_IN, MAX_SHOTS_WITHOUT_REST } from '../src/chart/generator';
import { isShot, type Difficulty } from '../src/chart/types';
import { DeadEye } from '../src/game/deadEye';
import { aimDirection, anglesTo, rayCapsule, raySphere } from '../src/game/hit';
import { judge, judgeTracking } from '../src/game/judge';
import { modMultiplier, modsKey, playbackRate, toggleMod } from '../src/game/mods';
import { Revolver } from '../src/game/revolver';
import { comboMultiplier, rankFor, Score, unstableRate } from '../src/game/scoring';
import { cmPer360, degPerCountFromCm, degPerCountFromGame, gameSensitivity, verticalFov } from '../src/input/sensitivity';

const analysis = analyzeSamples(renderDemoTrack(44100), 44100);
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'extreme'];

describe('chart generator', () => {
  it('is deterministic for the same song and difficulty', () => {
    expect(generateChart(analysis, 'hard')).toEqual(generateChart(analysis, 'hard'));
  });

  it('gets denser with difficulty', () => {
    const counts = DIFFS.map((d) => generateChart(analysis, d).notes.filter(isShot).length);
    expect(counts[0]).toBeGreaterThan(15);
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[3]).toBeGreaterThanOrEqual(counts[2]);
  });

  for (const d of DIFFS) {
    it(`${d}: notes are ordered, in view and after the lead-in`, () => {
      const chart = generateChart(analysis, d);
      chart.notes.forEach((n, i) => {
        expect(n.id).toBe(i);
        if (i) expect(n.time).toBeGreaterThanOrEqual(chart.notes[i - 1].time);
        expect(Math.abs(n.yaw)).toBeLessThanOrEqual(BOUNDS.yaw + 1e-9);
        expect(n.pitch).toBeGreaterThanOrEqual(BOUNDS.pitchMin - 1e-9);
        expect(n.pitch).toBeLessThanOrEqual(BOUNDS.pitchMax + 1e-9);
        if (isShot(n)) expect(n.time).toBeGreaterThanOrEqual(LEAD_IN);
      });
    });

    it(`${d}: never more than six shots without a one-beat rest`, () => {
      const chart = generateChart(analysis, d);
      const beat = 60 / chart.bpm;
      const shots = chart.notes.filter(isShot);
      let run = 1;
      for (let i = 1; i < shots.length; i++) {
        run = shots[i].time - shots[i - 1].time >= beat ? 1 : run + 1;
        expect(run).toBeLessThanOrEqual(MAX_SHOTS_WITHOUT_REST);
      }
    });
  }

  it('uses every note type on the demo track', () => {
    const kinds = new Set(DIFFS.flatMap((d) => generateChart(analysis, d).notes.map((n) => n.kind)));
    expect([...kinds].sort()).toEqual(['bandit', 'burst', 'civilian', 'drone']);
  });

  it('limits flick distance by the time available', () => {
    const chart = generateChart(analysis, 'normal');
    for (let i = 1; i < chart.notes.length; i++) {
      const prev = chart.notes[i - 1], cur = chart.notes[i];
      const from = prev.kind === 'drone' ? { yaw: prev.yaw2, pitch: prev.pitch2 } : prev;
      const dist = Math.hypot(cur.yaw - from.yaw, cur.pitch - from.pitch);
      expect(dist).toBeLessThanOrEqual((26 * Math.PI) / 180 + 1e-6);
    }
  });

  it('keeps bandits (headshot targets) as the main note on every difficulty', () => {
    for (const d of DIFFS) {
      const notes = generateChart(analysis, d).notes;
      const bandits = notes.filter((n) => n.kind === 'bandit').length;
      expect(bandits).toBeGreaterThan(notes.filter((n) => n.kind === 'burst').length * 0.5);
    }
  });
});

describe('judge', () => {
  it('maps timing error to judgements', () => {
    expect(judge(0)).toBe('perfect');
    expect(judge(-0.045)).toBe('perfect');
    expect(judge(0.06)).toBe('good');
    expect(judge(-0.2)).toBe('ok');
    expect(judge(0.13)).toBe('ok');
    expect(judge(0.2)).toBe('miss');
    expect(judge(-0.4)).toBeNull();
  });

  it('grades drone tracking', () => {
    expect(judgeTracking(0.95)).toBe('perfect');
    expect(judgeTracking(0.7)).toBe('good');
    expect(judgeTracking(0.4)).toBe('ok');
    expect(judgeTracking(0.1)).toBe('miss');
  });
});

describe('scoring', () => {
  it('rewards headshots and combo', () => {
    const s = new Score();
    expect(s.hit('perfect', 'head')).toBe(450);
    expect(s.hit('perfect', 'body')).toBe(Math.round(300 * comboMultiplier(1)));
    expect(s.combo).toBe(2);
    expect(s.gold).toBe(0);
    expect(s.headshotRate).toBe(0.5);
  });

  it('a miss resets combo and lowers accuracy', () => {
    const s = new Score();
    s.hit('perfect', 'head');
    s.miss();
    expect(s.combo).toBe(0);
    expect(s.maxCombo).toBe(1);
    expect(s.accuracy).toBe(0.5);
  });

  it('applies the mod multiplier', () => {
    expect(new Score(0.5).hit('good', 'body')).toBe(50);
  });

  it('assigns ranks', () => {
    expect(rankFor(1, 0)).toBe('SS');
    expect(rankFor(0.97, 0)).toBe('S');
    expect(rankFor(0.97, 1)).toBe('A');
    expect(rankFor(0.85, 3)).toBe('B');
    expect(rankFor(0.75, 3)).toBe('C');
    expect(rankFor(0.5, 9)).toBe('D');
  });

  it('computes unstable rate', () => {
    expect(unstableRate([10, 10, 10])).toBe(0);
    expect(unstableRate([-10, 10])).toBe(100);
  });
});

describe('revolver', () => {
  it('holds six rounds', () => {
    const r = new Revolver();
    for (let i = 0; i < 6; i++) expect(r.fire(i)).toBe(true);
    expect(r.fire(7)).toBe(false);
  });

  it('reloads instantly on the beat and slowly off it', () => {
    const r = new Revolver();
    r.fire(0);
    expect(r.reload(1, 0.02, 0.5)).toBe('perfect');
    expect(r.canFire(1)).toBe(true);
    r.fire(1);
    expect(r.reload(1.2, 0.2, 0.5)).toBe('slow');
    expect(r.canFire(1.4)).toBe(false);
    expect(r.reload(1.4, 0, 0.5)).toBe('busy');
    expect(r.canFire(1.7)).toBe(true);
    expect(r.reload(2, 0, 0.5)).toBe('full');
  });
});

describe('dead eye', () => {
  it('charges, activates for four beats and tracks marks', () => {
    const d = new DeadEye();
    expect(d.activate(0, 0.5)).toBe(false);
    for (let i = 0; i < 13; i++) d.charge(0.08, 0);
    expect(d.ready).toBe(true);
    expect(d.activate(10, 0.5)).toBe(true);
    expect(d.isActive(11.9)).toBe(true);
    expect(d.isActive(12)).toBe(false);
    expect(d.remaining(11, 0.5)).toBeCloseTo(0.5);
    expect(d.mark(3)).toBe(true);
    expect(d.mark(3)).toBe(false);
    expect(d.consume(3)).toBe(true);
    expect(d.isMarked(3)).toBe(false);
    d.charge(0.5, 11);
    expect(d.meter).toBe(0);
  });
});

describe('mods', () => {
  it('toggles and excludes incompatible mods', () => {
    expect(toggleMod([], 'dt')).toEqual(['dt']);
    expect(toggleMod(['dt', 'hidden'], 'ht')).toEqual(['hidden', 'ht']);
    expect(toggleMod(['sd'], 'nf')).toEqual(['nf']);
    expect(toggleMod(['nf'], 'nf')).toEqual([]);
  });

  it('derives rate, multiplier and key', () => {
    expect(playbackRate(['dt'])).toBe(1.5);
    expect(playbackRate(['ht'])).toBe(0.75);
    expect(playbackRate([])).toBe(1);
    expect(modMultiplier(['hidden', 'dt'])).toBeCloseTo(1.06 * 1.12);
    expect(modsKey(['dt', 'hidden'])).toBe('HDDT');
    expect(modsKey([])).toBe('NM');
  });
});

describe('hit detection', () => {
  const o = { x: 0, y: 0, z: 0 };
  it('hits spheres and capsules in front, not behind', () => {
    const fwd = aimDirection(0, 0);
    expect(raySphere(o, fwd, { x: 0.2, y: 0, z: -10 }, 0.3)).toBeCloseTo(10);
    expect(raySphere(o, fwd, { x: 0.4, y: 0, z: -10 }, 0.3)).toBeNull();
    expect(raySphere(o, fwd, { x: 0, y: 0, z: 10 }, 0.3)).toBeNull();
    expect(rayCapsule(o, fwd, { x: 0.3, y: -1, z: -10 }, { x: 0.3, y: 1, z: -10 }, 0.35)).not.toBeNull();
    expect(rayCapsule(o, fwd, { x: 0.3, y: 1, z: -10 }, { x: 0.3, y: 2, z: -10 }, 0.35)).toBeNull();
  });

  it('anglesTo inverts aimDirection', () => {
    const d = aimDirection(0.4, 0.2);
    const a = anglesTo(o, { x: d.x * 14, y: d.y * 14, z: d.z * 14 });
    expect(a.yaw).toBeCloseTo(0.4);
    expect(a.pitch).toBeCloseTo(0.2);
  });
});

describe('sensitivity', () => {
  it('converts between games and cm/360', () => {
    const cs = degPerCountFromGame('cs2', 2);
    expect(cs).toBeCloseTo(0.044);
    expect(cmPer360(cs, 800)).toBeCloseTo(25.98, 1);
    expect(gameSensitivity('valorant', cs)).toBeCloseTo(0.6286, 3);
    expect(degPerCountFromCm(cmPer360(cs, 800), 800)).toBeCloseTo(cs);
  });

  it('converts horizontal to vertical FOV', () => {
    expect(verticalFov(103)).toBeCloseTo(70.5, 0);
  });
});
