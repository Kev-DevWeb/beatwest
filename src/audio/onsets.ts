import { fft } from './fft';

export interface Onset {
  /** Seconds from the start of the song. */
  time: number;
  /** 0..1, relative to the strongest hits in the song. */
  strength: number;
}

export interface Envelope {
  /** Spectral flux per frame (how much new sound energy appeared). */
  flux: Float32Array;
  /** RMS loudness per frame. */
  energy: Float32Array;
  /** Frames per second. */
  frameRate: number;
  /** Seconds to add to `frame / frameRate` to get the time of the sound that caused it. */
  timeBias: number;
}

export const FFT_SIZE = 1024;
export const HOP = 256;

export function computeEnvelope(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): Envelope {
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  const flux = new Float32Array(frames);
  const energy = new Float32Array(frames);
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const bins = FFT_SIZE / 2;
  let prev = new Float32Array(bins);
  let cur = new Float32Array(bins);

  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    let sq = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = samples[start + i];
      sq += s * s;
      re[i] = s * window[i];
      im[i] = 0;
    }
    energy[f] = Math.sqrt(sq / FFT_SIZE);
    fft(re, im);
    let sum = 0;
    for (let b = 1; b < bins; b++) {
      const mag = Math.log1p(100 * Math.hypot(re[b], im[b]));
      cur[b] = mag;
      const d = mag - prev[b];
      if (d > 0) sum += d;
    }
    flux[f] = sum;
    const t = prev; prev = cur; cur = t;
    if (onProgress && (f & 1023) === 0) onProgress(f / frames);
  }
  // A transient produces its biggest flux jump shortly after it enters the
  // analysis window; measured empirically on click tracks (see tests).
  const timeBias = (FFT_SIZE - HOP * 1.5) / sampleRate;
  return { flux, energy, frameRate: sampleRate / HOP, timeBias };
}

export function pickOnsets(env: Envelope): Onset[] {
  const { flux, frameRate, timeBias } = env;
  const n = flux.length;
  const before = Math.round(0.12 * frameRate);
  const after = Math.round(0.04 * frameRate);
  const local = Math.max(2, Math.round(0.03 * frameRate));
  const minGap = 0.05;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean = n ? mean / n : 0;

  const raw: { time: number; value: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = flux[i];
    if (v <= mean * 0.3) continue;
    let isMax = true;
    for (let j = Math.max(0, i - local); j <= Math.min(n - 1, i + local); j++) {
      if (flux[j] > v) { isMax = false; break; }
    }
    if (!isMax) continue;
    let acc = 0, cnt = 0;
    for (let j = Math.max(0, i - before); j <= Math.min(n - 1, i + after); j++) { acc += flux[j]; cnt++; }
    if (v < (acc / cnt) * 1.4 + mean * 0.15) continue;
    const time = i / frameRate + timeBias;
    const last = raw[raw.length - 1];
    if (last && time - last.time < minGap) {
      if (v > last.value) { last.time = time; last.value = v; }
      continue;
    }
    raw.push({ time, value: v });
  }
  if (!raw.length) return [];
  const sorted = raw.map((r) => r.value).sort((a, b) => a - b);
  const ref = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 1;
  return raw.map((r) => ({ time: r.time, strength: Math.min(1, r.value / ref) }));
}
