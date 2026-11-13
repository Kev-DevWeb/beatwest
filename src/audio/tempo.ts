export interface Tempo {
  bpm: number;
  /** Time in seconds of a beat (the grid is `phase + k * 60 / bpm`). */
  phase: number;
}

const MIN_BPM = 70;
const MAX_BPM = 180;

function autocorr(x: Float32Array, lag: number): number {
  let s = 0;
  const n = x.length - lag;
  for (let i = 0; i < n; i++) s += x[i] * x[i + lag];
  return n > 0 ? s / n : 0;
}

/** Finds the lag with the highest autocorrelation in [lo, hi], refined to sub-frame precision. */
function peakLag(x: Float32Array, lo: number, hi: number): number {
  let best = lo, bestV = -Infinity;
  for (let l = lo; l <= hi; l++) {
    const v = autocorr(x, l);
    if (v > bestV) { bestV = v; best = l; }
  }
  const a = autocorr(x, best - 1), b = bestV, c = autocorr(x, best + 1);
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? (0.5 * (a - c)) / denom : 0;
  return best + Math.max(-0.5, Math.min(0.5, shift));
}

export function estimateTempo(flux: Float32Array, frameRate: number, timeBias = 0): Tempo {
  const n = flux.length;
  if (n < frameRate * 2) return { bpm: 120, phase: 0 };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;
  const sharp = new Float32Array(n);
  for (let i = 0; i < n; i++) sharp[i] = Math.max(0, flux[i] - mean);
  // Slight blur so beat periods that fall between two frames still correlate.
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = 0.25 * (sharp[i - 1] ?? 0) + 0.5 * sharp[i] + 0.25 * (sharp[i + 1] ?? 0);
  }

  const minLag = Math.floor((60 * frameRate) / MAX_BPM);
  const maxLag = Math.ceil((60 * frameRate) / MIN_BPM);
  let bestLag = minLag, bestScore = -Infinity;
  for (let l = minLag; l <= maxLag; l++) {
    const bpm = (60 * frameRate) / l;
    // Mild preference for tempos around 125 BPM to break octave ties.
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.6, 2));
    // Reward lags whose multiples also line up (true beat periods do).
    const score = (autocorr(x, l) + 0.5 * autocorr(x, 2 * l) + 0.25 * autocorr(x, 4 * l)) * prior;
    if (score > bestScore) { bestScore = score; bestLag = l; }
  }
  // Octave check: if twice the tempo fits the music almost as well, prefer the faster grid.
  const half = bestLag / 2;
  if (half >= minLag) {
    const fast = Math.max(autocorr(x, Math.floor(half)), autocorr(x, Math.ceil(half)));
    if (fast > 0.6 * autocorr(x, bestLag)) bestLag = fast === autocorr(x, Math.floor(half)) ? Math.floor(half) : Math.ceil(half);
  }
  // Refine using a longer span: an error of one frame over 8 beats is 8x smaller per beat.
  let lag = peakLag(x, bestLag - 1, bestLag + 1);
  for (const mult of [4, 8, 16]) {
    if (lag * mult + 4 >= n / 2) break;
    const centre = Math.round(lag * mult);
    lag = peakLag(x, centre - 2, centre + 2) / mult;
  }
  const bpm = (60 * frameRate) / lag;

  // Phase: the grid offset that collects the most onset energy.
  const steps = Math.ceil(lag);
  let bestPhase = 0, bestSum = -Infinity;
  for (let p = 0; p < steps; p++) {
    let s = 0;
    for (let pos = p; pos < n; pos += lag) s += x[Math.round(pos)] ?? 0;
    if (s > bestSum) { bestSum = s; bestPhase = p; }
  }
  const period = 60 / bpm;
  let phase = bestPhase / frameRate + timeBias;
  phase = ((phase % period) + period) % period;
  return { bpm, phase };
}

/** First point of the grid `phase + k * step` at or after `t`. */
export function nextGrid(t: number, phase: number, step: number): number {
  return phase + Math.ceil((t - phase) / step - 1e-9) * step;
}

/** Signed distance in seconds from `t` to the nearest beat. */
export function beatDistance(t: number, bpm: number, phase: number): number {
  const period = 60 / bpm;
  const r = (((t - phase) % period) + period) % period;
  return r > period / 2 ? r - period : r;
}
