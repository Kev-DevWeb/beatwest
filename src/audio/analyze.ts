import { computeEnvelope, pickOnsets, type Onset } from './onsets';
import { estimateTempo } from './tempo';

export interface Analysis {
  duration: number;
  bpm: number;
  phase: number;
  onsets: Onset[];
  /** Loudness curve, 0..1, sampled `energyRate` times per second. */
  energy: Float32Array;
  energyRate: number;
  /** Stable identifier of the audio content; seeds the level generator. */
  hash: number;
}

export function hashSamples(samples: Float32Array): number {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(samples.length / 50000));
  for (let i = 0; i < samples.length; i += step) {
    h ^= Math.round(samples[i] * 32767) & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  h ^= samples.length;
  return (Math.imul(h, 0x01000193) >>> 0);
}

export function analyzeSamples(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): Analysis {
  const env = computeEnvelope(samples, sampleRate, (f) => onProgress?.(f * 0.85));
  const onsets = pickOnsets(env);
  onProgress?.(0.9);
  const tempo = estimateTempo(env.flux, env.frameRate, env.timeBias);

  // Downsample loudness to ~20 values per second, normalised to the song's peak.
  const group = Math.max(1, Math.round(env.frameRate / 20));
  const out = new Float32Array(Math.ceil(env.energy.length / group));
  let max = 1e-9;
  for (let i = 0; i < out.length; i++) {
    let s = 0, c = 0;
    for (let j = i * group; j < Math.min(env.energy.length, (i + 1) * group); j++) { s += env.energy[j]; c++; }
    out[i] = c ? s / c : 0;
    if (out[i] > max) max = out[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= max;
  onProgress?.(1);
  return {
    duration: samples.length / sampleRate,
    bpm: tempo.bpm,
    phase: tempo.phase,
    onsets,
    energy: out,
    energyRate: env.frameRate / group,
    hash: hashSamples(samples),
  };
}
