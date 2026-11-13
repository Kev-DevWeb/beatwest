/** Owns the AudioContext, plays the song and is the single source of truth for song time. */
export class AudioPlayer {
  readonly ctx: AudioContext;
  readonly sfxGain: GainNode;
  private musicGain: GainNode;
  private filter: BiquadFilterNode;
  private source: AudioBufferSourceNode | null = null;
  private startAt = 0;
  private rate = 1;
  /** Calibration offset in real seconds. */
  offset = 0;
  ended = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.connect(this.musicGain).connect(this.ctx.destination);
    this.sfxGain.connect(this.ctx.destination);
  }

  setVolumes(music: number, sfx: number): void {
    this.musicGain.gain.value = music;
    this.sfxGain.gain.value = sfx;
  }

  get latency(): number {
    return this.ctx.outputLatency || this.ctx.baseLatency || 0;
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  bufferFromSamples(samples: Float32Array, sampleRate: number): AudioBuffer {
    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  static toMono(buffer: AudioBuffer): Float32Array {
    const out = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
    }
    return out;
  }

  async start(buffer: AudioBuffer, rate: number, leadIn = 1.2): Promise<void> {
    this.stop();
    await this.ctx.resume();
    this.rate = rate;
    this.ended = false;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(this.filter);
    source.onended = () => { if (this.source === source) this.ended = true; };
    this.startAt = this.ctx.currentTime + leadIn;
    source.start(this.startAt);
    this.source = source;
    this.setMuffled(false);
  }

  /** Position in the song (seconds of song, so it advances faster with Double Time). */
  songTime(): number {
    return (this.ctx.currentTime - this.startAt - this.latency - this.offset) * this.rate;
  }

  pause(): Promise<void> { return this.ctx.suspend(); }
  resume(): Promise<void> { return this.ctx.resume(); }

  stop(): void {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* not started yet */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  /** Low-pass the music (Dead Eye). */
  setMuffled(on: boolean): void {
    this.filter.frequency.setTargetAtTime(on ? 600 : 20000, this.ctx.currentTime, 0.06);
  }
}
