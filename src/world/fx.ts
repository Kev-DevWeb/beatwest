import * as THREE from 'three';

const MAX_SHARDS = 260;
const MAX_TRACERS = 10;
const dummy = new THREE.Object3D();
const colour = new THREE.Color();
const up = new THREE.Vector3(0, 0, 1);

interface Shard { life: number; max: number; p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Euler; size: number }
interface Tracer { mesh: THREE.Mesh; life: number; max: number }

/** Pooled visual effects: debris from destroyed targets, bullet tracers, sparks. */
export class Fx {
  private shards: THREE.InstancedMesh;
  private live: (Shard | null)[] = new Array(MAX_SHARDS).fill(null);
  private cursor = 0;
  private tracers: Tracer[] = [];
  private sparks: { points: THREE.Points; velocity: Float32Array; life: number }[] = [];

  constructor(private parent: THREE.Object3D) {
    this.shards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_SHARDS);
    this.shards.frustumCulled = false;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_SHARDS; i++) {
      this.shards.setMatrixAt(i, dummy.matrix);
      this.shards.setColorAt(i, colour.set(0));
    }
    parent.add(this.shards);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mesh.visible = false;
      parent.add(mesh);
      this.tracers.push({ mesh, life: 0, max: 1 });
    }
  }

  /** Chunks flying off a destroyed target. `push` is the direction the bullet was travelling. */
  shatter(at: THREE.Vector3, color: THREE.Color, count: number, push: THREE.Vector3, energy = 1): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor = (this.cursor + 1) % MAX_SHARDS;
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 4.5) * energy;
      this.live[i] = {
        life: 0, max: 0.55 + Math.random() * 0.45,
        p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.4).multiplyScalar(energy < 1 ? 0.05 : 1)),
        v: new THREE.Vector3(Math.cos(a) * s * (energy < 1 ? 0.3 : 1) + push.x * 3, (1.5 + Math.random() * 4) * energy, Math.sin(a) * s * (energy < 1 ? 0.3 : 1) + push.z * 3),
        spin: new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6),
        rot: new THREE.Euler(),
        size: (0.06 + Math.random() * 0.13) * (energy < 1 ? 0.2 : 1),
      };
      this.shards.setColorAt(i, colour.copy(color).multiplyScalar(0.5 + Math.random() * 0.9));
    }
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, width = 0.025, life = 0.09): void {
    const t = this.tracers.find((x) => x.life >= x.max) ?? this.tracers[0];
    const len = from.distanceTo(to);
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.quaternion.setFromUnitVectors(up, to.clone().sub(from).normalize());
    t.mesh.scale.set(width, width, len);
    (t.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    t.mesh.visible = true;
    t.life = 0;
    t.max = life;
  }

  burst(at: THREE.Vector3, color: THREE.Color, count: number): void {
    const positions = new Float32Array(count * 3), velocity = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), s = 3 + Math.random() * 7;
      velocity.set([Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s + 1, Math.sin(b) * Math.sin(a) * s], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    points.frustumCulled = false;
    this.parent.add(points);
    this.sparks.push({ points, velocity, life: 0 });
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < MAX_SHARDS; i++) {
      const s = this.live[i];
      if (!s) continue;
      dirty = true;
      s.life += dt;
      if (s.life >= s.max) {
        this.live[i] = null;
        dummy.scale.setScalar(0);
      } else {
        s.v.y -= 14 * dt;
        s.p.addScaledVector(s.v, dt);
        if (s.p.y < 0.05) { s.p.y = 0.05; s.v.y *= -0.35; s.v.x *= 0.6; s.v.z *= 0.6; }
        s.rot.x += s.spin.x * dt; s.rot.y += s.spin.y * dt; s.rot.z += s.spin.z * dt;
        dummy.position.copy(s.p);
        dummy.rotation.copy(s.rot);
        dummy.scale.setScalar(s.size * Math.min(1, (s.max - s.life) * 5));
      }
      dummy.updateMatrix();
      this.shards.setMatrixAt(i, dummy.matrix);
    }
    if (dirty) this.shards.instanceMatrix.needsUpdate = true;

    for (const t of this.tracers) {
      if (t.life >= t.max) continue;
      t.life += dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t.life / t.max);
      if (t.life >= t.max) t.mesh.visible = false;
    }

    this.sparks = this.sparks.filter((b) => {
      b.life += dt;
      if (b.life > 0.4) { this.drop(b.points); return false; }
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        b.velocity[i + 1] -= 12 * dt;
        arr[i] += b.velocity[i] * dt; arr[i + 1] += b.velocity[i + 1] * dt; arr[i + 2] += b.velocity[i + 2] * dt;
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = 1 - b.life / 0.4;
      return true;
    });
  }

  private drop(points: THREE.Points): void {
    this.parent.remove(points);
    points.geometry.dispose();
    (points.material as THREE.Material).dispose();
  }

  clear(): void {
    this.sparks.forEach((b) => this.drop(b.points));
    this.sparks = [];
    this.live.fill(null);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_SHARDS; i++) this.shards.setMatrixAt(i, dummy.matrix);
    this.shards.instanceMatrix.needsUpdate = true;
    this.tracers.forEach((t) => { t.life = t.max; t.mesh.visible = false; });
  }
}
