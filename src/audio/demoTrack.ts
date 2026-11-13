/** Built-in synthesised track so the game can be played (and tested) without uploading anything. */
export const DEMO_BPM = 128;
const BARS = 26;

function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

export function renderDemoTrack(sampleRate: number): Float32Array {
  const beat = 60 / DEMO_BPM;
  const total = Math.ceil(BARS * 4 * beat * sampleRate);
  const out = new Float32Array(total);
  const rnd = noise(1887);

  const add = (start: number, length: number, fn: (t: number) => number) => {
    const s0 = Math.round(start * sampleRate);
    const len = Math.round(length * sampleRate);
    for (let i = 0; i < len && s0 + i < total; i++) out[s0 + i] += fn(i / sampleRate);
  };
  const kick = (t0: number) =>
    add(t0, 0.28, (t) => Math.sin(2 * Math.PI * (45 * t + (95 / 28) * (1 - Math.exp(-28 * t)))) * Math.exp(-9 * t) * 0.9);
  const snare = (t0: number) =>
    add(t0, 0.2, (t) => (rnd() * 0.5 + Math.sin(2 * Math.PI * 190 * t) * 0.35) * Math.exp(-22 * t));
  const hat = (t0: number, gain: number) => {
    let prev = 0;
    add(t0, 0.05, (t) => { const n = rnd(); const hp = n - prev; prev = n; return hp * gain * Math.exp(-90 * t); });
  };
  const tone = (t0: number, len: number, freq: number, gain: number, decay: number, square: boolean) =>
    add(t0, len, (t) => {
      const ph = 2 * Math.PI * freq * t;
      const w = square
        ? Math.sin(ph) + Math.sin(3 * ph) / 3 + Math.sin(5 * ph) / 5
        : Math.sin(ph) + 0.5 * Math.sin(2 * ph);
      const attack = Math.min(1, t / 0.004);
      const release = Math.min(1, (len - t) / 0.01);
      return w * gain * attack * release * Math.exp(-decay * t);
    });

  // A minor: Am, F, C, G
  const roots = [55, 43.65, 65.41, 49];
  const arps = [
    [440, 523.25, 659.25, 523.25],
    [349.23, 440, 523.25, 440],
    [523.25, 659.25, 783.99, 659.25],
    [392, 493.88, 587.33, 493.88],
  ];

  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * 4 * beat;
    const chord = bar % 4;
    const intro = bar < 4;
    const breakdown = bar >= 12 && bar < 16;
    const drop = bar >= 16 && bar < 24;
    const outro = bar >= 24;

    if (!breakdown && !outro) {
      for (let b = 0; b < 4; b++) {
        kick(t0 + b * beat);
        if (!intro && (b === 1 || b === 3)) snare(t0 + b * beat);
        const div = drop ? 4 : 2;
        for (let k = 0; k < div; k++) hat(t0 + (b + k / div) * beat, k === 0 ? 0.25 : 0.16);
      }
    }
    if (!intro && !breakdown && !outro) {
      for (let e = 0; e < 8; e++) tone(t0 + e * 0.5 * beat, 0.45 * beat, roots[chord] * 2, 0.28, 6, false);
    }
    if (breakdown) {
      // Sustained pad with a sparse melody: a calm stretch between the busy sections.
      for (const f of [roots[chord] * 4, arps[chord][0], arps[chord][2]]) tone(t0, 4 * beat, f, 0.07, 0.1, false);
      tone(t0, beat, arps[chord][1] * 2, 0.16, 3, true);
    }
    if (drop) {
      for (let s = 0; s < 8; s++) tone(t0 + s * 0.5 * beat, 0.4 * beat, arps[chord][s % 4] * 2, 0.11, 9, true);
    }
    if (outro && bar === 24) {
      kick(t0);
      for (const f of [110, 220, 329.63]) tone(t0, 6 * beat, f, 0.12, 0.8, false);
    }
  }
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? 0.85 / peak : 1;
  for (let i = 0; i < total; i++) out[i] *= g;
  return out;
}
