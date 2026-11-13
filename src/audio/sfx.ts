import type { AudioPlayer } from './player';

/** Synthesised sound effects: no audio files needed. */
export class Sfx {
  private ctx: AudioContext;
  private out: GainNode;
  private noise: AudioBuffer;

  constructor(player: AudioPlayer) {
    this.ctx = player.ctx;
    this.out = player.sfxGain;
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.4, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  private env(gain: number, duration: number, at = this.ctx.currentTime): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    g.connect(this.out);
    return g;
  }

  private tone(freq: number, toFreq: number, gain: number, duration: number, type: OscillatorType = 'sine', at = this.ctx.currentTime): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (toFreq !== freq) o.frequency.exponentialRampToValueAtTime(toFreq, at + duration);
    o.connect(this.env(gain, duration, at));
    o.start(at);
    o.stop(at + duration + 0.02);
  }

  private burst(gain: number, duration: number, filterFreq: number, type: BiquadFilterType = 'bandpass'): void {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    s.connect(f).connect(this.env(gain, duration));
    s.start();
    s.stop(this.ctx.currentTime + duration + 0.02);
  }

  shot(): void {
    this.burst(0.5, 0.12, 1800);
    this.tone(160, 50, 0.5, 0.1);
  }

  hit(headshot: boolean, perfect: boolean): void {
    this.tone(headshot ? 1320 : 660, headshot ? 1760 : 660, 0.25, 0.09, 'triangle');
    if (perfect) this.tone(2640, 2640, 0.1, 0.12);
  }

  miss(): void {
    this.tone(110, 70, 0.35, 0.25, 'sawtooth');
  }

  civilian(): void {
    this.tone(300, 150, 0.3, 0.3, 'square');
  }

  empty(): void {
    this.burst(0.25, 0.03, 4000, 'highpass');
  }

  reload(perfect: boolean): void {
    this.burst(0.3, 0.04, 2500);
    this.tone(perfect ? 880 : 330, perfect ? 1320 : 330, 0.15, 0.08, 'square');
  }

  deadEye(): void {
    this.tone(80, 400, 0.3, 0.5, 'sawtooth');
  }

  /** Metronome click scheduled at an exact AudioContext time (calibration). */
  tick(at: number, accent: boolean): void {
    this.tone(accent ? 1500 : 1000, accent ? 1500 : 1000, 0.4, 0.05, 'square', at);
  }
}
