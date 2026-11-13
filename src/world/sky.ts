import * as THREE from 'three';
import { makeRng } from '../chart/rng';
import { SKY } from './palette';
import type { Textures } from './textures';

const lin = (hex: number) => new THREE.Color(hex);

/** Dusk backdrop: gradient dome, huge sun, layered mesas, drifting dust. Follows the camera. */
export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.ShaderMaterial;
  private halo: THREE.Mesh;
  private dust: THREE.Points;
  private dustSpeed: Float32Array;
  private energy = 0;
  private flash = 0;

  constructor(tex: Textures, dustCount: number) {
    this.dome = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: lin(SKY.top) }, uMid: { value: lin(SKY.mid) }, uHorizon: { value: lin(SKY.horizon) },
        uEnergy: { value: 0 }, uPulse: { value: 0 }, uFlash: { value: 0 },
      },
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 d;
        uniform vec3 uTop, uMid, uHorizon;
        uniform float uEnergy, uPulse, uFlash;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec3 n = normalize(d);
          float h = clamp(n.y, 0.0, 1.0);
          vec3 col = mix(uMid, uTop, smoothstep(0.08, 0.6, h));
          // Warm band hugging the horizon, strongest towards the sun (straight ahead, -Z).
          float ahead = pow(max(0.0, -n.z), 3.0);
          float band = exp(-h * (9.0 - 4.0 * ahead));
          col = mix(col, uHorizon, band * (0.35 + 0.65 * ahead) * (0.8 + 0.25 * uEnergy + 0.12 * uPulse));
          // Thin streaks of cloud catching the last light.
          float streak = smoothstep(0.55, 0.9, sin(n.y * 46.0 + sin(n.x * 5.0) * 2.0) * 0.5 + 0.5);
          col += uHorizon * streak * 0.10 * smoothstep(0.03, 0.12, h) * (1.0 - smoothstep(0.12, 0.34, h)) * ahead;
          // First stars overhead.
          vec2 sp = n.xz / max(0.2, n.y) * 42.0;
          float star = step(0.975, hash(floor(sp))) * smoothstep(0.1, 0.0, length(fract(sp) - 0.5)) * smoothstep(0.3, 0.75, h);
          col += vec3(0.8, 0.85, 1.0) * star * 0.7;
          col += vec3(0.75, 0.7, 1.0) * uFlash * (0.1 + 0.35 * band);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), this.dome));

    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(95, 64),
      new THREE.ShaderMaterial({
        fog: false, transparent: true, depthWrite: false,
        uniforms: { uA: { value: lin(SKY.sun) }, uB: { value: lin(0xe2483a) } },
        vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec2 u; uniform vec3 uA, uB;
          void main(){
            // Horizontal slits near the bottom: the one nod to retro-futurism in the sky.
            float band = fract(u.y * 15.0);
            if (u.y < 0.5 && band < 0.1 + (0.5 - u.y) * 0.9) discard;
            gl_FragColor = vec4(mix(uB, uA, smoothstep(0.1, 0.9, u.y)) * 0.85, 1.0);
          }`,
      }),
    );
    sun.position.set(0, 34, -640);
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshBasicMaterial({ map: tex.glow, color: SKY.horizon, transparent: true, opacity: 0.5, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
    );
    this.halo.position.set(0, 30, -650);
    this.group.add(this.halo, sun);

    // Three layers of mesas; the farther, the lighter and hazier (atmospheric perspective).
    const rng = makeRng(404);
    const layers: [number, number, number, number][] = [
      [-560, SKY.mesaFar, 70, 1.0], [-430, SKY.mesaMid, 52, 0.8], [-310, SKY.mesaNear, 36, 0.6],
    ];
    for (const [z, color, height, gapChance] of layers) {
      const shape = new THREE.Shape();
      const half = 900;
      shape.moveTo(-half, -4);
      let x = -half;
      while (x < half) {
        const isGap = Math.abs(x) < 150 ? true : rng() < gapChance * 0.45;   // keep the sun visible down the street
        const w = 50 + rng() * 130;
        const h = isGap ? 2 + rng() * 5 : height * (0.45 + rng() * 0.55);
        const slope = 6 + rng() * 14;
        shape.lineTo(x + slope, h);
        if (!isGap && rng() < 0.5) { shape.lineTo(x + w * 0.4, h); shape.lineTo(x + w * 0.45, h * 0.8); }
        shape.lineTo(x + w - slope, isGap ? h : h * (0.85 + rng() * 0.15));
        shape.lineTo(x + w, 2);
        x += w;
      }
      shape.lineTo(half, -4);
      const mesa = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, fog: false }));
      mesa.position.set(0, 0, z);
      this.group.add(mesa);
    }

    const positions = new Float32Array(dustCount * 3);
    this.dustSpeed = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      positions.set([(rng() - 0.5) * 40, rng() * 6, -4 - rng() * 56], i * 3);
      this.dustSpeed[i] = 0.3 + rng() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      map: tex.glow, color: 0xd9a37a, size: 0.07, transparent: true, opacity: 0.22, depthWrite: false, fog: false,
    }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  /** Brief lightning far away, for the loudest parts of a song. */
  lightning(): void {
    this.flash = 1;
  }

  /**
   * @param travelled metres the camera moved this frame (dust streams past)
   * @param energy loudness of the music right now, 0..1
   * @param pulse 1 on a beat, decaying to 0
   * @param timeScale 0 freezes the dust (Dead Eye)
   */
  update(camZ: number, travelled: number, dt: number, energy: number, pulse: number, timeScale: number): void {
    this.group.position.z = camZ;
    this.energy += (energy - this.energy) * Math.min(1, dt * 3);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.dome.uniforms.uEnergy.value = this.energy;
    this.dome.uniforms.uPulse.value = pulse;
    this.dome.uniforms.uFlash.value = this.flash;
    this.halo.scale.setScalar(1 + pulse * 0.05 + this.energy * 0.12);

    const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < this.dustSpeed.length; i++) {
      const k = i * 3;
      a[k] += this.dustSpeed[i] * dt * 0.6 * timeScale;
      a[k + 1] += Math.sin(camZ * 0.1 + i) * dt * 0.05 * timeScale;
      a[k + 2] += travelled;                    // the group moves with the camera, so drift them back
      if (a[k + 2] > -4) a[k + 2] -= 56;
      if (a[k] > 20) a[k] -= 40;
    }
    pos.needsUpdate = true;
  }
}
