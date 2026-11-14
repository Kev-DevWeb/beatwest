import { describe, expect, it } from 'vitest';
import { analyzeSamples } from '../src/audio/analyze';
import { renderDemoTrack } from '../src/audio/demoTrack';
import { BOUNDS, generateChart, INTERLUDE_LEAD_BEATS, LEAD_IN, MAX_BURST, MAX_RUN, TUNING } from '../src/chart/generator';
import { interludeClicks, isShot, ROUNDS, type Chart, type Difficulty } from '../src/chart/types';
import { DeadEye } from '../src/game/deadEye';
import { aimDirection, anglesTo, rayCapsule, raySphere } from '../src/game/hit';
import { judge, judgeTracking } from '../src/game/judge';
import { modMultiplier, modsKey, playbackRate, toggleMod } from '../src/game/mods';
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

  }

  for (const d of DIFFS) {
    it(`${d}: density and bursts stay playable`, () => {
      const chart = generateChart(analysis, d);
      const beat = 60 / chart.bpm;
      const shots = chart.notes.filter(isShot).map((n) => n.time);
      // Never more than the cap in any four beats.
      for (const t of shots) {
        expect(shots.filter((u) => u >= t && u < t + 4 * beat).length).toBeLessThanOrEqual(TUNING[d].maxPerBar);
      }
      // Long runs are broken by a one-beat rest.
      let streak = 1;
      for (let i = 1; i < shots.length; i++) {
        streak = shots[i] - shots[i - 1] >= beat * 0.99 ? 1 : streak + 1;
        expect(streak).toBeLessThanOrEqual(MAX_RUN);
      }
      // Rapid runs are short.
      const quick = Math.max(beat * 0.3, 0.2);
      let run = 1;
      for (let i = 1; i < shots.length; i++) {
        run = shots[i] - shots[i - 1] <= quick ? run + 1 : 1;
        expect(run).toBeLessThanOrEqual(MAX_BURST);
      }
    });
  }

  it('normal is busier than before and hard is no longer double it', () => {
    const count = (d: Difficulty) => generateChart(analysis, d).notes.filter(isShot).length;
    expect(count('normal')).toBeGreaterThan(80);
    expect(count('hard')).toBeLessThan(count('normal') * 1.45);
    expect(count('extreme')).toBeLessThan(count('normal') * 2);
  });

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

describe('chart generator at the browser sample rate', () => {
  // Browsers usually run audio at 48 kHz; the curve must hold there too, not only at 44.1 kHz.
  const at48k = analyzeSamples(renderDemoTrack(48000), 48000);

  it('keeps a steady progression between difficulties', () => {
    const counts = DIFFS.map((d) => generateChart(at48k, d).notes.filter(isShot).length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1] * 1.08);
      expect(counts[i]).toBeLessThan(counts[i - 1] * 1.45);
    }
  });

  it('gives nearly the same density as at 44.1 kHz', () => {
    for (const d of DIFFS) {
      const a = generateChart(analysis, d).notes.filter(isShot).length;
      const b = generateChart(at48k, d).notes.filter(isShot).length;
      expect(Math.abs(a - b) / a).toBeLessThan(0.12);
    }
  });
});

/** Checks every reload interlude of a chart: rhythm, spacing and, above all, nothing to shoot. */
function checkInterludes(chart: Chart): void {
  const beat = 60 / chart.bpm, bar = 4 * beat;
  const onGrid = (t: number, step: number) => Math.abs((t - chart.phase) / step - Math.round((t - chart.phase) / step)) < 1e-6;
  expect(chart.interludes.length).toBeGreaterThanOrEqual(2);
  chart.interludes.forEach((il, i) => {
    // Rounds on eighths or sixteenths, cylinder shut on a beat after the last one.
    expect([beat / 2, beat / 4]).toContain(il.step);
    const clicks = interludeClicks(il);
    expect(clicks).toHaveLength(ROUNDS);
    clicks.forEach((c) => expect(onGrid(c, il.step)).toBe(true));
    expect(onGrid(il.close, beat)).toBe(true);
    expect(il.close).toBeGreaterThan(clicks[ROUNDS - 1]);
    // One every 6 to 12 bars.
    if (i > 0) {
      const since = il.start - chart.interludes[i - 1].close;
      expect(since).toBeGreaterThanOrEqual(6 * bar - 1e-6);
      expect(since).toBeLessThanOrEqual(12 * bar + 1e-6);
    }
    // Nothing is on screen while the cylinder is open: every target has either been dealt
    // with before it starts, or first appears once it has shut.
    for (const n of chart.notes) {
      const appears = n.time - chart.approach;
      const gone = isShot(n) ? n.time : n.time + n.duration;
      const before = gone <= il.start - (isShot(n) ? INTERLUDE_LEAD_BEATS * beat : 0) + 1e-6;
      const after = appears >= il.close - 1e-6;
      expect(before || after).toBe(true);
    }
  });
}

describe('reload interludes', () => {
  const at48k = analyzeSamples(renderDemoTrack(48000), 48000);
  for (const d of DIFFS) {
    it(`${d}: interludes are on the beat, well spaced and free of targets`, () => {
      checkInterludes(generateChart(analysis, d));
      checkInterludes(generateChart(at48k, d));
    });
  }

  it('prefers the natural break in the demo track', () => {
    // Bars 12-16 of the demo have no drums: the first interlude belongs there.
    const chart = generateChart(analysis, 'hard');
    const bar = (4 * 60) / chart.bpm;
    expect(chart.interludes[0].start).toBeGreaterThan(12 * bar - 1);
    expect(chart.interludes[0].close).toBeLessThan(16 * bar + 1);
  });
});
