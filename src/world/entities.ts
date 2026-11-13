import * as THREE from 'three';
import type { Note } from '../chart/types';
import { rayCapsule, raySphere, type V3 } from '../game/hit';
import type { TargetPalette } from './palette';
import { aimPoint, railPosition } from './stage';
import type { Textures } from './textures';

export type HitZone = 'head' | 'body';

export const HEAD_Y = 1.55;
const HEAD_RADIUS = 0.26;
const BODY_RADIUS = 0.36;
const SPAWN_TIME = 0.2;
const SINK_TIME = 0.25;
const BEAM_TIME = 0.45;
const RING_FINAL = 0.44;

const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(1, 18, 12);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 16);
const cone = new THREE.ConeGeometry(1, 1, 7);
const octa = new THREE.OctahedronGeometry(1);
const torus = new THREE.TorusGeometry(1, 0.09, 8, 28);
const ringGeo = new THREE.RingGeometry(0.93, 1, 56);
const refGeo = new THREE.RingGeometry(0.965, 1, 56);
const crossGeo = new THREE.RingGeometry(0.55, 0.8, 4);
const beamGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1, true);
const plane = new THREE.PlaneGeometry(1, 1);

/**
 * Unlit, fog-free material with a bright rim: targets ignore the dusty haze and
 * keep a glowing edge, so their silhouette reads against anything.
 */
function glow(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uRim: { value: new THREE.Color() }, uGlow: { value: 1 }, uRimK: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor, uRim; uniform float uGlow, uRimK; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN);
        float rim = pow(1.0 - abs(dot(n, normalize(vV))), 2.2);
        float shade = 0.6 + 0.4 * (n.y * 0.5 + 0.5);
        gl_FragColor = vec4(uColor * shade * uGlow + uRim * rim * uRimK, 1.0);
      }`,
  });
}

const M = {
  body: glow(), dark: glow(), head: glow(), core: glow(),
  civBody: glow(), civHead: glow(),
  burst: glow(), burstCore: glow(),
  drone: glow(), droneShell: glow(),
  black: new THREE.MeshBasicMaterial({ color: 0x050305 }),
};
const colours = { bandit: new THREE.Color(), burst: new THREE.Color(), drone: new THREE.Color(), civilian: new THREE.Color(), ring: new THREE.Color(), perfect: new THREE.Color(), head: new THREE.Color() };
let shade: THREE.Texture | null = null;

function set(m: THREE.ShaderMaterial, color: THREE.Color, glowK: number, rim: THREE.Color, rimK: number): void {
  m.uniforms.uColor.value.copy(color);
  m.uniforms.uRim.value.copy(rim);
  m.uniforms.uGlow.value = glowK;
  m.uniforms.uRimK.value = rimK;
}

/** Recolours every target material (default or colour-blind palette). */
export function applyTargetPalette(p: TargetPalette, textures: Textures): void {
  shade = textures.shade;
  for (const k of Object.keys(colours) as (keyof typeof colours)[]) colours[k].setHex(p[k]);
  const white = new THREE.Color(0xffffff);
  const hot = colours.bandit.clone().lerp(white, 0.35);
  set(M.body, colours.bandit, 1.0, hot, 1.7);
  set(M.dark, colours.bandit.clone().multiplyScalar(0.1), 1, colours.bandit, 2.4);
  set(M.head, colours.head, 2.3, white, 1.2);
  set(M.core, colours.bandit, 3.2, white, 0.5);
  set(M.civBody, colours.civilian, 0.8, white, 1.0);
  set(M.civHead, colours.civilian, 1.5, white, 1.0);
  set(M.burst, colours.burst, 1.9, white, 1.6);
  set(M.burstCore, white, 3, white, 0);
  set(M.drone, colours.drone, 1.8, white, 1.4);
  set(M.droneShell, colours.drone.clone().multiplyScalar(0.12), 1, colours.drone, 2.6);
}

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, s: [number, number, number], p: [number, number, number], rx = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(...s);
  m.position.set(...p);
  m.rotation.x = rx;
  parent.add(m);
  return m;
}

function buildBandit(): THREE.Group {
  const g = new THREE.Group();
  part(g, box, M.dark, [0.2, 0.78, 0.22], [-0.16, 0.39, 0]);
  part(g, box, M.dark, [0.2, 0.78, 0.22], [0.16, 0.39, 0]);
  part(g, box, M.dark, [0.56, 0.6, 0.3], [0, 1.02, 0]);
  part(g, cone, M.body, [0.52, 0.62, 0.42], [0, 1.16, 0]);                 // poncho
  part(g, box, M.dark, [0.14, 0.55, 0.14], [-0.42, 0.98, 0]);
  part(g, box, M.dark, [0.14, 0.14, 0.52], [0.4, 1.22, 0.22]);            // gun arm, pointing at you
  part(g, box, M.core, [0.07, 0.11, 0.24], [0.4, 1.24, 0.55]);
  part(g, sphere, M.head, [0.19, 0.2, 0.19], [0, HEAD_Y, 0]);
  part(g, box, M.black, [0.3, 0.05, 0.06], [0, HEAD_Y + 0.02, 0.165]);     // visor slit
  part(g, cyl, M.dark, [0.42, 0.03, 0.42], [0, HEAD_Y + 0.16, 0]);         // hat brim
  part(g, cyl, M.dark, [0.21, 0.2, 0.21], [0, HEAD_Y + 0.27, 0]);          // hat crown
  part(g, box, M.core, [0.44, 0.03, 0.44], [0, HEAD_Y + 0.19, 0]);         // hat band
  return g;
}

function buildCivilian(): THREE.Group {
  const g = new THREE.Group();
  part(g, box, M.civBody, [0.2, 0.78, 0.22], [-0.16, 0.39, 0]);
  part(g, box, M.civBody, [0.2, 0.78, 0.22], [0.16, 0.39, 0]);
  part(g, box, M.civBody, [0.58, 0.62, 0.3], [0, 1.03, 0]);
  part(g, box, M.civBody, [0.13, 0.62, 0.13], [-0.42, 1.5, 0]);            // hands up
  part(g, box, M.civBody, [0.13, 0.62, 0.13], [0.42, 1.5, 0]);
  part(g, sphere, M.civHead, [0.19, 0.2, 0.19], [0, HEAD_Y, 0]);
  part(g, torus, M.civHead, [0.3, 0.3, 0.3], [0, 2.02, 0], Math.PI / 2);   // halo
  return g;
}

/** One on-screen target: a bandit, a burst diamond, a drone or a civilian. */
export class Target {
  readonly group = new THREE.Group();
  private model: THREE.Object3D;
  private ring: THREE.Mesh | null = null;
  private ref: THREE.Mesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private refMat: THREE.MeshBasicMaterial | null = null;
  private marker: THREE.Mesh | null = null;
  private beam: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private backing: THREE.Mesh | null = null;
  private owned: THREE.Material[] = [];
  private start: V3;
  private end: V3;
  private baseY = 0;
  private ringFinal = RING_FINAL;
  /** Current centre of the precise hit zone (head / diamond / drone) in world space. */
  readonly aim = new THREE.Vector3();
  /** Colour of the debris when it is destroyed. */
  readonly color: THREE.Color;
  alive = true;
  private diedAt = -1;
  private sink = false;
  /** Song seconds the crosshair spent on a drone. */
  tracked = 0;
  isTracked = false;

  constructor(readonly note: Note, readonly scale: number, readonly spawnedAt: number) {
    this.start = aimPoint(note.time, note.yaw, note.pitch);
    this.end = note.kind === 'drone' ? aimPoint(note.time + note.duration, note.yaw2, note.pitch2) : this.start;
    const cam = railPosition(note.time);
    const grounded = note.kind === 'bandit' || note.kind === 'civilian';
    this.color = (note.kind === 'bandit' ? colours.bandit : note.kind === 'burst' ? colours.burst : note.kind === 'drone' ? colours.drone : colours.civilian).clone();

    if (grounded) {
      this.model = note.kind === 'bandit' ? buildBandit() : buildCivilian();
      this.model.rotation.y = Math.atan2(cam.x - this.start.x, cam.z - this.start.z);
      this.baseY = this.start.y - HEAD_Y * scale;
    } else if (note.kind === 'burst') {
      this.model = new THREE.Group();
      part(this.model, octa, M.burst, [0.26, 0.34, 0.26], [0, 0, 0]);
      part(this.model, octa, M.burstCore, [0.1, 0.13, 0.1], [0, 0, 0]);
      this.baseY = this.start.y;
    } else {
      this.model = new THREE.Group();
      part(this.model, sphere, M.droneShell, [0.32, 0.2, 0.32], [0, 0, 0]);
      part(this.model, sphere, M.drone, [0.13, 0.13, 0.13], [0, -0.1, 0]);
      part(this.model, torus, M.drone, [0.48, 0.48, 0.48], [0, 0, 0], Math.PI / 2);
      this.baseY = this.start.y;
    }
    this.model.scale.setScalar(scale);
    this.model.position.set(this.start.x, this.baseY, this.start.z);
    this.group.add(this.model);
    this.aim.set(this.start.x, this.start.y, this.start.z);

    // Column of light announcing the spawn.
    this.beamMat = this.own(new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.scale.set(scale, 10, scale);
    this.beam.position.set(this.start.x, this.start.y + 5.6, this.start.z);
    this.group.add(this.beam);

    // Floating targets have no stand behind them: give them a soft dark disc instead.
    if (!grounded && shade) {
      this.backing = new THREE.Mesh(plane, this.own(new THREE.MeshBasicMaterial({ map: shade, transparent: true, opacity: 0.75, depthWrite: false })));
      this.backing.scale.setScalar(2.4 * scale);
      this.backing.renderOrder = -1;
      this.group.add(this.backing);
    }

    if (note.kind === 'bandit' || note.kind === 'burst') {
      const common = { transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide } as const;
      this.ringMat = this.own(new THREE.MeshBasicMaterial({ color: colours.ring, ...common }));
      this.refMat = this.own(new THREE.MeshBasicMaterial({ color: colours.ring, opacity: 0.45, ...common }));
      this.ring = new THREE.Mesh(ringGeo, this.ringMat);
      this.ref = new THREE.Mesh(refGeo, this.refMat);
      this.ring.renderOrder = 5;
      this.ref.renderOrder = 5;
      this.ringFinal = (note.kind === 'burst' ? 0.34 : RING_FINAL) * scale;
      this.ref.scale.setScalar(this.ringFinal);
      this.group.add(this.ring, this.ref);
    }
  }

  private own<T extends THREE.Material>(m: T): T {
    this.owned.push(m);
    return m;
  }

  get isShootable(): boolean {
    return this.note.kind !== 'drone';
  }

  /** Radius of the precise zone, used for Dead Eye marking and drone tracking. */
  get radius(): number {
    const base = this.note.kind === 'drone' ? 0.5 : this.note.kind === 'burst' ? 0.34 : HEAD_RADIUS;
    return base * this.scale;
  }

  /** Where this bandit's gun is, for the shot it fires when you are too slow. */
  get muzzle(): THREE.Vector3 {
    return new THREE.Vector3(0.4, 1.24, 0.6).multiplyScalar(this.scale).applyEuler(this.model.rotation).add(this.model.position);
  }

  hitTest(origin: V3, dir: V3): { zone: HitZone; distance: number } | null {
    if (!this.alive) return null;
    const head = raySphere(origin, dir, this.aim, this.radius);
    if (head !== null) return { zone: 'head', distance: head };
    if (this.note.kind === 'bandit' || this.note.kind === 'civilian') {
      const feet = this.aim.y - HEAD_Y * this.scale;
      const d = rayCapsule(
        origin, dir,
        { x: this.aim.x, y: feet + 0.45 * this.scale, z: this.aim.z },
        { x: this.aim.x, y: feet + 1.25 * this.scale, z: this.aim.z },
        BODY_RADIUS * this.scale,
      );
      if (d !== null) return { zone: 'body', distance: d };
    }
    return null;
  }

  setMarked(): void {
    if (this.marker) return;
    this.marker = new THREE.Mesh(crossGeo, this.own(new THREE.MeshBasicMaterial({ color: colours.perfect, depthTest: false, depthWrite: false, side: THREE.DoubleSide })));
    (this.marker.material as THREE.MeshBasicMaterial).color.multiplyScalar(2);
    this.marker.renderOrder = 6;
    this.marker.scale.setScalar(this.scale * 0.9);
    this.group.add(this.marker);
  }

  /** @param sink true when it leaves on its own (missed / civilian walking off) rather than being shot */
  kill(now: number, sink = false): void {
    if (!this.alive) return;
    this.alive = false;
    this.diedAt = now;
    this.sink = sink;
    if (!sink) this.model.visible = false;      // debris takes over
    if (this.backing) this.backing.visible = false;
  }

  /**
   * @param now real seconds (monotonic) for spawn/death animation
   * @param songTime current song position
   * @param approach seconds of song between appearing and the beat
   * @param perfect half-width of the Perfect window in song seconds
   * @returns false once the target can be removed from the scene
   */
  update(now: number, songTime: number, approach: number, perfect: number, camera: THREE.Camera, hidden: boolean): boolean {
    const n = this.note;
    const age = now - this.spawnedAt;
    const k = Math.min(1, age / SPAWN_TIME);
    const grounded = n.kind === 'bandit' || n.kind === 'civilian';

    if (n.kind === 'drone') {
      const f = Math.max(0, Math.min(1, (songTime - n.time) / n.duration));
      this.aim.set(
        this.start.x + (this.end.x - this.start.x) * f,
        this.start.y + (this.end.y - this.start.y) * f + Math.sin(songTime * 5) * 0.08,
        this.start.z + (this.end.z - this.start.z) * f,
      );
      this.model.position.copy(this.aim);
      this.model.rotation.y = songTime * 3;
    } else if (n.kind === 'burst') {
      this.model.rotation.y = songTime * 4;
    }

    if (this.alive) {
      if (grounded) {
        // Pops up from behind its cover.
        const ease = 1 - (1 - k) * (1 - k);
        this.model.position.y = this.baseY - (1 - ease) * 1.1 * this.scale;
        this.model.scale.set(this.scale, this.scale * (0.5 + 0.5 * ease), this.scale);
      } else {
        const pop = k < 1 ? k * (1.25 - 0.25 * k) : 1;
        this.model.scale.setScalar(this.scale * pop * (this.isTracked ? 1.25 : 1));
      }
    } else {
      const gone = (now - this.diedAt) / SINK_TIME;
      if (gone >= 1) return false;
      if (this.sink) this.model.position.y = this.baseY - gone * 1.6 * this.scale;
    }

    this.beamMat.opacity = Math.max(0, 0.6 * (1 - age / BEAM_TIME));
    this.beam.visible = this.beamMat.opacity > 0;

    if (this.backing) {
      this.backing.quaternion.copy(camera.quaternion);
      this.backing.position.copy(this.aim).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 0.5);
    }
    if (this.ring && this.ringMat && this.ref && this.refMat) {
      const left = Math.max(0, (n.time - songTime) / approach);     // 1 → 0 as the beat arrives
      const inPerfect = Math.abs(songTime - n.time) <= perfect;
      for (const r of [this.ring, this.ref]) {
        r.quaternion.copy(camera.quaternion);
        r.position.copy(this.aim);
      }
      this.ring.scale.setScalar(this.ringFinal + this.scale * left * (n.kind === 'burst' ? 0.9 : 1.5));
      const fade = hidden ? Math.max(0, (left - 0.55) / 0.45) : 1;
      // Rings are a timing aid, not the target: they stay below the bloom threshold until the Perfect instant.
      this.ringMat.opacity = this.alive ? Math.min(0.85, (1 - left) * 1.8 + 0.2) * fade : 0;
      this.ringMat.color.copy(inPerfect ? colours.perfect : colours.ring).multiplyScalar(inPerfect ? 1.8 : 0.8);
      this.refMat.opacity = this.alive ? (inPerfect ? 0.9 : 0.3) * (hidden ? fade : 1) : 0;
      this.refMat.color.copy(inPerfect ? colours.perfect : colours.ring);
    }
    if (this.marker) {
      this.marker.visible = this.alive;
      this.marker.quaternion.copy(camera.quaternion);
      this.marker.position.copy(this.aim);
      this.marker.rotation.z += Math.PI / 4;
    }
    return true;
  }

  dispose(): void {
    this.owned.forEach((m) => m.dispose());
  }
}
