import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ACCENT, WORLD } from './palette';
import type { Textures } from './textures';

/** Shared world materials. Lit ones are Lambert (cheap) and receive fog; glowing ones are unlit. */
export interface Mats {
  wood: THREE.Material;
  woodDark: THREE.Material;
  woodLight: THREE.Material;
  woodRed: THREE.Material;
  woodTeal: THREE.Material;
  roof: THREE.Material;
  metal: THREE.Material;
  trim: THREE.Material;
  glass: THREE.Material;
  windowLit: THREE.Material;
  /** Slightly over-bright so lanterns get a soft bloom. Pulses with the music. */
  lantern: THREE.MeshBasicMaterial;
  brass: THREE.Material;
}

export function makeMaterials(tex: Textures): Mats {
  const lit = (color: number, map?: THREE.Texture) => new THREE.MeshLambertMaterial({ color, map });
  const lantern = new THREE.MeshBasicMaterial({ color: ACCENT.lantern });
  lantern.color.multiplyScalar(1.5);
  return {
    wood: lit(WORLD.wood, tex.planksV),
    woodDark: lit(WORLD.woodDark, tex.planksV),
    woodLight: lit(WORLD.woodLight, tex.planksH),
    woodRed: lit(WORLD.woodRed, tex.planksV),
    woodTeal: lit(WORLD.woodTeal, tex.planksV),
    roof: lit(WORLD.roof, tex.corrugated),
    metal: lit(WORLD.metal),
    trim: lit(WORLD.trim),
    glass: new THREE.MeshBasicMaterial({ color: WORLD.glass }),
    windowLit: new THREE.MeshBasicMaterial({ color: WORLD.windowLit }),
    lantern,
    brass: lit(ACCENT.brass),
  };
}

const TILE = 2.5;   // metres covered by one repeat of a texture

/** Box whose UVs are scaled to its real size so textures keep a constant density. */
function boxGeometry(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[face][0]) / TILE, (uv.getY(i) * dims[face][1]) / TILE);
    }
  }
  return g;
}

const m4 = new THREE.Matrix4();
const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);

/** Collects many primitives and bakes them into one mesh per material (few draw calls). */
export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    quat.setFromEuler(euler.set(rx, ry, rz));
    geo.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), quat, one));
    const list = this.parts.get(mat) ?? [];
    list.push(geo.index ? geo.toNonIndexed() : geo);
    this.parts.set(mat, list);
    return this;
  }

  box(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    return this.add(mat, boxGeometry(sx, sy, sz), x, y, z, rx, ry, rz);
  }

  cyl(mat: THREE.Material, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, sides = 10, rx = 0, rz = 0): this {
    return this.add(mat, new THREE.CylinderGeometry(rTop, rBottom, h, sides), x, y, z, rx, 0, rz);
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (merged) group.add(new THREE.Mesh(merged, mat));
    }
    this.parts.clear();
    return group;
  }
}
