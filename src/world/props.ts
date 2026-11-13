import * as THREE from 'three';
import type { Note } from '../chart/types';
import { Batch, type Mats } from './build';
import { aimPoint, railPosition } from './stage';

const RISE = 0.4;
const FALL = 0.22;
/** Height of a target's head above its feet at scale 1 (must match entities.ts). */
const HEAD_Y = 1.55;

interface Cover { group: THREE.Group; bornAt: number; fallAt: number; z: number; scale: number }

/**
 * Pop-up shooting-gallery pieces tied to the level: every bandit and civilian gets a
 * stand to emerge from, with a dark board behind (so the figure reads against the sky)
 * and something to duck behind in front. Legs stretch to whatever height the note needs.
 */
export class Covers {
  private top: THREE.BufferGeometry[] = [];
  private topMats: THREE.Material[][] = [];
  private legs: THREE.Mesh;
  private covers = new Map<number, Cover>();

  constructor(private parent: THREE.Object3D, m: Mats) {
    // Two variants of the standing platform; local origin is where the feet go, facing +Z.
    for (const variant of [0, 1]) {
      const b = new Batch();
      b.box(m.woodLight, 1.5, 0.12, 1.15, 0, -0.06, 0);
      b.box(m.woodDark, 1.5, 2.2, 0.1, 0, 1.1, -0.52);
      b.box(m.trim, 1.62, 0.12, 0.16, 0, 2.24, -0.52).box(m.trim, 0.12, 2.2, 0.14, -0.75, 1.1, -0.5).box(m.trim, 0.12, 2.2, 0.14, 0.75, 1.1, -0.5);
      if (variant === 0) {
        b.box(m.wood, 0.62, 0.52, 0.5, -0.36, 0.26, 0.5).cyl(m.wood, 0.27, 0.24, 0.66, 0.36, 0.33, 0.48, 10);
      } else {
        b.box(m.trim, 1.5, 0.12, 0.08, 0, 0.6, 0.55).box(m.trim, 1.5, 0.1, 0.08, 0, 0.3, 0.55);
        for (const x of [-0.7, 0, 0.7]) b.box(m.trim, 0.1, 0.62, 0.1, x, 0.31, 0.55);
      }
      const built = b.build();
      this.top.push(...built.children.map((c) => (c as THREE.Mesh).geometry));
      this.topMats.push(built.children.map((c) => (c as THREE.Mesh).material as THREE.Material));
    }
    // Legs are modelled one metre tall hanging below the platform and scaled to reach the ground.
    const legs = new Batch();
    for (const [x, z] of [[-0.68, -0.5], [0.68, -0.5], [-0.68, 0.5], [0.68, 0.5]]) legs.box(m.trim, 0.12, 1, 0.12, x, -0.5, z);
    legs.box(m.trim, 1.5, 0.08, 0.08, 0, -0.5, 0.5, 0, 0, 0.55).box(m.trim, 1.5, 0.08, 0.08, 0, -0.5, -0.5, 0, 0, -0.55);
    this.legs = legs.build().children[0] as THREE.Mesh;
  }

  /** Builds the stand for a note if it does not exist yet. */
  ensure(note: Note, scale: number, now: number): void {
    if (this.covers.has(note.id) || (note.kind !== 'bandit' && note.kind !== 'civilian')) return;
    const p = aimPoint(note.time, note.yaw, note.pitch);
    const cam = railPosition(note.time);
    const feet = p.y - HEAD_Y * scale;
    const group = new THREE.Group();
    const variant = Math.abs(note.id) % 2;
    const offset = variant === 0 ? 0 : this.topMats[0].length;
    this.topMats[variant].forEach((mat, i) => group.add(new THREE.Mesh(this.top[offset + i], mat)));
    if (feet > 0.14) {
      const legs = new THREE.Mesh(this.legs.geometry, this.legs.material);
      legs.scale.y = feet / scale - 0.1;
      legs.position.y = -0.1;
      group.add(legs);
    }
    group.position.set(p.x, feet, p.z);
    group.rotation.y = Math.atan2(cam.x - p.x, cam.z - p.z);
    group.scale.set(scale, 0.001, scale);
    this.parent.add(group);
    this.covers.set(note.id, { group, bornAt: now, fallAt: -1, z: p.z, scale });
  }

  /** Folds a stand away once its target is gone, so it cannot hide later targets. */
  collapse(id: number, now: number): void {
    const c = this.covers.get(id);
    if (c && c.fallAt < 0) c.fallAt = now;
  }

  update(now: number, camZ: number): void {
    for (const [id, c] of this.covers) {
      let k = Math.min(1, (now - c.bornAt) / RISE);
      k = 1 - (1 - k) * (1 - k);
      if (c.fallAt >= 0) k = Math.max(0, 1 - (now - c.fallAt) / FALL);
      c.group.scale.y = Math.max(0.001, k) * c.scale;
      if ((c.fallAt >= 0 && k <= 0) || c.z > camZ + 3) {
        this.parent.remove(c.group);
        this.covers.delete(id);
      }
    }
  }

  clear(): void {
    for (const c of this.covers.values()) this.parent.remove(c.group);
    this.covers.clear();
  }
}
