import * as THREE from 'three';
import type { Note } from '../chart/types';
import { rayCapsule, raySphere, type V3 } from '../game/hit';
import { aimPoint, NEON, railPosition } from './stage';

export type HitZone = 'head' | 'body';

const HEAD_Y = 1.55;
const HEAD_RADIUS = 0.26;
const BODY_RADIUS = 0.36;
const SPAWN_TIME = 0.18;
const DEATH_TIME = 0.16;

const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(1, 14, 10);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
const octa = new THREE.OctahedronGeometry(1);
const torus = new THREE.TorusGeometry(1, 0.08, 6, 24);
const ringGeo = new THREE.RingGeometry(0.94, 1, 40);
const crossGeo = new THREE.RingGeometry(0.2, 0.3, 4);

const mat = {
  metal: new THREE.MeshLambertMaterial({ color: 0x4a4466 }),
  dark: new THREE.MeshLambertMaterial({ color: 0x1c1830 }),
  leather: new THREE.MeshLambertMaterial({ color: 0x6b3a1e }),
  red: new THREE.MeshBasicMaterial({ color: NEON.red }),
  amber: new THREE.MeshBasicMaterial({ color: NEON.amber }),
  cyan: new THREE.MeshBasicMaterial({ color: NEON.cyan }),
  magenta: new THREE.MeshBasicMaterial({ color: NEON.magenta }),
  green: new THREE.MeshBasicMaterial({ color: NEON.green, transparent: true, opacity: 0.75 }),
  greenWire: new THREE.MeshBasicMaterial({ color: NEON.green, wireframe: true }),
  white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
};

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, s: [number, number, number], p: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(...s);
  m.position.set(...p);
  parent.add(m);
  return m;
}

function buildRobot(civilian: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = civilian ? mat.green : mat.metal;
  const limb = civilian ? mat.green : mat.dark;
  part(g, box, limb, [0.2, 0.75, 0.22], [-0.16, 0.38, 0]);
  part(g, box, limb, [0.2, 0.75, 0.22], [0.16, 0.38, 0]);
  part(g, box, body, [0.62, 0.62, 0.32], [0, 1.03, 0]);
  part(g, sphere, body, [0.19, 0.2, 0.19], [0, HEAD_Y, 0]);
  if (civilian) {
    // Hands up and a halo: clearly not a threat.
    part(g, box, limb, [0.14, 0.6, 0.14], [-0.42, 1.45, 0]);
    part(g, box, limb, [0.14, 0.6, 0.14], [0.42, 1.45, 0]);
    const halo = part(g, torus, mat.white, [0.3, 0.3, 0.3], [0, 1.95, 0]);
    halo.rotation.x = Math.PI / 2;
  } else {
    part(g, box, mat.dark, [0.14, 0.55, 0.14], [-0.4, 1.02, 0]);
    part(g, box, mat.dark, [0.14, 0.14, 0.5], [0.4, 1.2, 0.2]);          // gun arm, pointing at you
    part(g, box, mat.amber, [0.06, 0.1, 0.22], [0.4, 1.22, 0.52]);
    part(g, box, mat.red, [0.3, 0.06, 0.05], [0, HEAD_Y + 0.02, 0.17]);  // visor
    part(g, box, mat.magenta, [0.5, 0.05, 0.02], [0, 1.15, 0.17]);       // chest light
    part(g, cyl, mat.leather, [0.4, 0.03, 0.4], [0, HEAD_Y + 0.17, 0]);  // hat brim
    part(g, cyl, mat.leather, [0.2, 0.2, 0.2], [0, HEAD_Y + 0.28, 0]);   // hat crown
    part(g, box, mat.red, [0.3, 0.3, 0.02], [0, 1.28, -0.17]);           // bandana tail hint
  }
  return g;
}

function buildPlatform(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl, mat.dark, [0.6, 0.08, 0.6], [0, -0.04, 0]);
  part(g, cyl, mat.cyan, [0.45, 0.03, 0.45], [0, -0.1, 0]);
  return g;
}

/** One on-screen target: a bandit, a burst diamond, a drone or a civilian. */
export class Target {
  readonly group = new THREE.Group();
  readonly ring: THREE.Mesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private marker: THREE.Mesh | null = null;
  private model: THREE.Object3D;
  private start: V3;
  private end: V3;
  /** Current centre of the precise hit zone (head / diamond / drone) in world space. */
  readonly aim = new THREE.Vector3();
  alive = true;
  private diedAt = -1;
  /** Song seconds the crosshair spent on a drone. */
  tracked = 0;
  isTracked = false;

  constructor(readonly note: Note, readonly scale: number, readonly spawnedAt: number) {
    this.start = aimPoint(note.time, note.yaw, note.pitch);
    this.end = note.kind === 'drone' ? aimPoint(note.time + note.duration, note.yaw2, note.pitch2) : this.start;
    const cam = railPosition(note.time);
    const face = Math.atan2(cam.x - this.start.x, cam.z - this.start.z);

    if (note.kind === 'bandit' || note.kind === 'civilian') {
      this.model = buildRobot(note.kind === 'civilian');
      this.model.scale.setScalar(scale);
      this.model.rotation.y = face;
      const feetY = this.start.y - HEAD_Y * scale;
      this.model.position.set(this.start.x, feetY, this.start.z);
      if (feetY > 0.25) this.model.add(buildPlatform());
    } else if (note.kind === 'burst') {
      this.model = new THREE.Group();
      part(this.model, octa, mat.amber, [0.26, 0.34, 0.26], [0, 0, 0]);
      part(this.model, octa, mat.white, [0.1, 0.13, 0.1], [0, 0, 0]);
      this.model.scale.setScalar(scale);
      this.model.position.set(this.start.x, this.start.y, this.start.z);
    } else {
      this.model = new THREE.Group();
      part(this.model, sphere, mat.dark, [0.3, 0.22, 0.3], [0, 0, 0]);
      part(this.model, sphere, mat.cyan, [0.12, 0.12, 0.12], [0, -0.12, 0]);
      const halo = part(this.model, torus, mat.cyan, [0.48, 0.48, 0.48], [0, 0, 0]);
      halo.rotation.x = Math.PI / 2;
      this.model.scale.setScalar(scale);
      this.model.position.set(this.start.x, this.start.y, this.start.z);
    }
    this.group.add(this.model);
    this.aim.set(this.start.x, this.start.y, this.start.z);

    if (note.kind === 'bandit' || note.kind === 'burst') {
      this.ringMat = new THREE.MeshBasicMaterial({
        color: note.kind === 'bandit' ? NEON.cyan : NEON.amber,
        transparent: true, depthTest: false, side: THREE.DoubleSide,
      });
      this.ring = new THREE.Mesh(ringGeo, this.ringMat);
      this.ring.renderOrder = 5;
      this.ring.position.copy(this.aim);
      this.group.add(this.ring);
    }
  }

  get isShootable(): boolean {
    return this.note.kind !== 'drone';
  }

  /** Radius of the precise zone, used for Dead Eye marking and drone tracking. */
  get radius(): number {
    const base = this.note.kind === 'drone' ? 0.5 : this.note.kind === 'burst' ? 0.34 : HEAD_RADIUS;
    return base * this.scale;
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
    this.marker = new THREE.Mesh(crossGeo, new THREE.MeshBasicMaterial({ color: NEON.red, depthTest: false, side: THREE.DoubleSide }));
    this.marker.renderOrder = 6;
    this.marker.scale.setScalar(1.6 * this.scale);
    this.marker.position.copy(this.aim);
    this.group.add(this.marker);
  }

  kill(now: number): void {
    if (!this.alive) return;
    this.alive = false;
    this.diedAt = now;
  }

  /**
   * @param now real seconds (monotonic) for spawn/death animation
   * @param songTime current song position
   * @param approach seconds of song between appearing and the beat
   * @returns false once the target can be removed from the scene
   */
  update(now: number, songTime: number, approach: number, camera: THREE.Camera, hidden: boolean): boolean {
    const n = this.note;
    if (n.kind === 'drone') {
      const k = Math.max(0, Math.min(1, (songTime - n.time) / n.duration));
      this.aim.set(
        this.start.x + (this.end.x - this.start.x) * k,
        this.start.y + (this.end.y - this.start.y) * k + Math.sin(songTime * 5) * 0.08,
        this.start.z + (this.end.z - this.start.z) * k,
      );
      this.model.position.copy(this.aim);
      this.model.rotation.y = songTime * 3;
      this.model.scale.setScalar(this.scale * (this.isTracked ? 1.25 : 1));
    } else if (n.kind === 'burst') {
      this.model.rotation.y = songTime * 4;
    }

    let visible = Math.min(1, (now - this.spawnedAt) / SPAWN_TIME);
    if (!this.alive) {
      visible = 1 - (now - this.diedAt) / DEATH_TIME;
      if (visible <= 0) return false;
    }
    this.group.scale.set(1, 1, 1);
    this.model.scale.y = this.scale * Math.max(0.01, visible) * (n.kind === 'drone' && this.isTracked ? 1.25 : 1);

    if (this.ring && this.ringMat) {
      const left = Math.max(0, (n.time - songTime) / approach);     // 1 → 0 as the beat arrives
      this.ring.quaternion.copy(camera.quaternion);
      this.ring.scale.setScalar(this.scale * (0.42 + left * 1.5));
      const fade = hidden ? Math.max(0, (left - 0.55) / 0.45) : 1;
      this.ringMat.opacity = this.alive ? Math.min(1, (1 - left) * 2 + 0.25) * fade : 0;
      if (this.marker) this.marker.quaternion.copy(camera.quaternion);
    }
    return true;
  }

  dispose(): void {
    this.ringMat?.dispose();
    (this.marker?.material as THREE.Material | undefined)?.dispose();
  }
}

/** Short bursts of sparks when something is hit. */
export class Sparks {
  private bursts: { points: THREE.Points; velocity: Float32Array; born: number }[] = [];

  constructor(private parent: THREE.Object3D) {}

  emit(at: THREE.Vector3, color: number, now: number, count = 22): void {
    const positions = new Float32Array(count * 3);
    const velocity = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), s = 2 + Math.random() * 5;
      velocity.set([Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s + 1.5, Math.sin(b) * Math.sin(a) * s], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.14, transparent: true, depthWrite: false }));
    this.parent.add(points);
    this.bursts.push({ points, velocity, born: now });
  }

  update(now: number, dt: number): void {
    this.bursts = this.bursts.filter((b) => {
      const age = now - b.born;
      if (age > 0.5) {
        this.parent.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        return false;
      }
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        b.velocity[i + 1] -= 9 * dt;
        arr[i] += b.velocity[i] * dt;
        arr[i + 1] += b.velocity[i + 1] * dt;
        arr[i + 2] += b.velocity[i + 2] * dt;
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = 1 - age / 0.5;
      return true;
    });
  }

  clear(): void {
    for (const b of this.bursts) {
      this.parent.remove(b.points);
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
    }
    this.bursts = [];
  }
}
