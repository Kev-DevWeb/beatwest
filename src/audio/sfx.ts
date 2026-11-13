import type { AudioPlayer } from './player';

/** Synthesised sound effects: no audio files needed. */
export class Sfx {
  private ctx: AudioContext;
  private out: GainNode;
  private noise: AudioBuffer;

  constructor(player: AudioPlayer) {
    this.ctx = player.ctx;
    this.out = player.sfxGain;
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.6, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  private env(gain: number, duration: number, at: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    g.connect(this.out);
    return g;
  }

  private tone(freq: number, toFreq: number, gain: number, duration: number, type: OscillatorType = 'sine', delay = 0): void {
    const at = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (toFreq !== freq) o.frequency.exponentialRampToValueAtTime(toFreq, at + duration);
    o.connect(this.env(gain, duration, at));
    o.start(at);
    o.stop(at + duration + 0.02);
  }

  private burst(gain: number, duration: number, freq: number, type: BiquadFilterType = 'bandpass', delay = 0, q = 1): void {
    const at = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    s.connect(f).connect(this.env(gain, duration, at));
    s.start(at, Math.random() * 0.2);
    s.stop(at + duration + 0.02);
  }

  /** Revolver: sharp crack, body thump and a short tail. */
  shot(): void {
    this.burst(0.55, 0.05, 3200, 'highpass');
    this.burst(0.5, 0.16, 1100, 'bandpass', 0, 0.7);
    this.tone(190, 46, 0.6, 0.13);
    this.burst(0.14, 0.35, 500, 'lowpass', 0.03);
  }

  /** Bullet on metal; headshots ring like a bell. */
  hit(headshot: boolean, perfect: boolean): void {
    this.tone(headshot ? 1480 : 620, headshot ? 1480 : 540, 0.22, headshot ? 0.22 : 0.1, 'triangle');
    this.tone(headshot ? 2217 : 931, headshot ? 2217 : 880, 0.12, headshot ? 0.3 : 0.08);
    this.burst(0.18, 0.04, 5200, 'bandpass', 0, 3);
    if (perfect) this.tone(headshot ? 2960 : 1864, headshot ? 2960 : 1864, 0.07, 0.22);
  }

  miss(): void {
    this.burst(0.4, 0.09, 2400, 'highpass');
    this.tone(120, 60, 0.4, 0.3, 'sawtooth');
  }

  civilian(): void {
    this.tone(330, 165, 0.3, 0.32, 'square');
    this.tone(247, 123, 0.2, 0.32, 'square', 0.06);
  }

  empty(): void {
    this.burst(0.28, 0.025, 4200, 'highpass');
    this.tone(900, 700, 0.06, 0.03, 'square');
  }

  /** Cylinder swinging open: played the moment R is pressed. */
  reloadOpen(): void {
    this.burst(0.28, 0.03, 2600);
    this.tone(240, 190, 0.07, 0.05, 'square');
  }

  /**
   * One round sliding into a chamber, scheduled at an exact AudioContext time so it lands on
   * a subdivision of the beat. `index` (0..5) raises the pitch as the cylinder fills.
   */
  bullet(at: number, index: number): void {
    const d = Math.max(0, at - this.ctx.currentTime);
    const f = 620 * Math.pow(1.122, index);
    this.burst(0.2, 0.02, 3800 + index * 300, 'bandpass', d, 4);
    this.tone(f, f * 0.97, 0.1, 0.05, 'triangle', d);
  }

  /** Cylinder snapping shut, scheduled on the beat. A perfect reload adds a bright note. */
  reloadClose(at: number, perfect: boolean): void {
    const d = Math.max(0, at - this.ctx.currentTime);
    this.burst(0.36, 0.045, 1700, 'bandpass', d);
    this.tone(160, 90, 0.26, 0.07, 'sine', d);
    if (perfect) this.tone(988, 1480, 0.12, 0.12, 'triangle', d);
  }

  deadEye(): void {
    this.tone(70, 380, 0.3, 0.55, 'sawtooth');
    this.burst(0.2, 0.5, 900, 'lowpass');
  }

  /** A target tagged during Dead Eye. */
  mark(): void {
    this.tone(1760, 1760, 0.1, 0.06, 'square');
  }

  /** Combo milestone: quick rising arpeggio. */
  milestone(): void {
    [659, 784, 988, 1319].forEach((f, i) => this.tone(f, f, 0.12, 0.16, 'triangle', i * 0.055));
  }

  /** Metronome click scheduled at an exact AudioContext time (calibration). */
  tick(at: number, accent: boolean): void {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = accent ? 1500 : 1000;
    o.connect(this.env(0.4, 0.05, at));
    o.start(at);
    o.stop(at + 0.07);
  }
}
