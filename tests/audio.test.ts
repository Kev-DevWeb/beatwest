import { describe, expect, it } from 'vitest';
import { analyzeSamples } from '../src/audio/analyze';
import { computeEnvelope, pickOnsets } from '../src/audio/onsets';
import { beatDistance, estimateTempo } from '../src/audio/tempo';
import { DEMO_BPM, renderDemoTrack } from '../src/audio/demoTrack';

const SR = 44100;

function clickTrack(bpm: number, seconds: number, offset = 0.5): { samples: Float32Array; times: number[] } {
  const samples = new Float32Array(Math.round(seconds * SR));
  const times: number[] = [];
  for (let t = offset; t < seconds - 0.2; t += 60 / bpm) {
    times.push(t);
    const s0 = Math.round(t * SR);
    for (let i = 0; i < 2000; i++) {
      samples[s0 + i] += Math.sin((2 * Math.PI * 1000 * i) / SR) * Math.exp(-i / 300) * 0.8;
    }
  }
  return { samples, times };
}

describe('onset detection', () => {
  it('finds every click within 15 ms', () => {
    const { samples, times } = clickTrack(120, 12);
    const onsets = pickOnsets(computeEnvelope(samples, SR));
    expect(onsets.length).toBe(times.length);
    onsets.forEach((o, i) => expect(Math.abs(o.time - times[i])).toBeLessThan(0.015));
  });

  it('returns nothing for silence', () => {
    expect(pickOnsets(computeEnvelope(new Float32Array(SR * 3), SR))).toEqual([]);
  });
});

describe('tempo estimation', () => {
  for (const bpm of [90, 120, 128, 150, 174]) {
    it(`detects ${bpm} BPM within 1 BPM and locks the beat phase`, () => {
      const { samples, times } = clickTrack(bpm, 30, 0.37);
      const env = computeEnvelope(samples, SR);
      const tempo = estimateTempo(env.flux, env.frameRate, env.timeBias);
      expect(Math.abs(tempo.bpm - bpm)).toBeLessThan(1);
      expect(Math.abs(beatDistance(times[3], tempo.bpm, tempo.phase))).toBeLessThan(0.02);
    });
  }
});

describe('demo track', () => {
  const samples = renderDemoTrack(SR);
  const analysis = analyzeSamples(samples, SR);

  it('is analysed at its real tempo', () => {
    expect(Math.abs(analysis.bpm - DEMO_BPM)).toBeLessThan(1);
    expect(analysis.duration).toBeGreaterThan(40);
  });

  it('puts beats on the kicks', () => {
    const beat = 60 / DEMO_BPM;
    expect(Math.abs(beatDistance(8 * beat, analysis.bpm, analysis.phase))).toBeLessThan(0.03);
  });

  it('yields plenty of onsets and a stable hash', () => {
    expect(analysis.onsets.length).toBeGreaterThan(100);
    expect(analysis.hash).toBe(analyzeSamples(samples, SR).hash);
  });
});
