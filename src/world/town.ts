import * as THREE from 'three';
import { makeRng } from '../chart/rng';
import { Batch, type Mats } from './build';
import { ACCENT } from './palette';
import { signTexture, type Textures } from './textures';

/** Length of street (metres) after which the scenery repeats. */
export const LOOP = 168;
/** Distance from the rail to the building fronts. */
const FRONT = 11;
const POLE_X = 8.3;

export interface TownPiece {
  object: THREE.Object3D;
  baseZ: number;
  /** Something that turns (windmill blades). */
  spin?: THREE.Object3D;
}

interface Spec {
  name: string;
  sub?: string;
  w: number;
  h: number;
  depth: number;
  wall: keyof Mats;
  front: keyof Mats;
  stories: 1 | 2;
  top: 'flat' | 'step' | 'arch';
  neon?: number;
  swingDoors?: boolean;
  steeple?: boolean;
  openFront?: boolean;
}

const SPECS: Spec[] = [
  { name: 'SALOON', sub: 'WHISKEY · COOLANT · CARDS', w: 12, h: 7.2, depth: 9, wall: 'wood', front: 'woodRed', stories: 2, top: 'arch', neon: ACCENT.neonA, swingDoors: true },
  { name: 'BANK', w: 9, h: 6.4, depth: 8, wall: 'woodDark', front: 'woodLight', stories: 1, top: 'step' },
  { name: 'SHERIFF', w: 7.5, h: 4.8, depth: 7, wall: 'wood', front: 'woodTeal', stories: 1, top: 'flat' },
  { name: 'GENERAL STORE', w: 10, h: 5.6, depth: 8, wall: 'woodDark', front: 'wood', stories: 1, top: 'step' },
  { name: 'HOTEL', sub: 'BEDS · CHARGING', w: 10.5, h: 8.4, depth: 9, wall: 'wood', front: 'woodTeal', stories: 2, top: 'flat', neon: ACCENT.neonB },
  { name: 'GUNSMITH', w: 7, h: 5, depth: 7, wall: 'woodDark', front: 'woodRed', stories: 1, top: 'step' },
  { name: 'FORGE', w: 8.5, h: 4.6, depth: 8, wall: 'woodDark', front: 'woodDark', stories: 1, top: 'flat', openFront: true },
  { name: 'CHAPEL', w: 7, h: 6.5, depth: 10, wall: 'woodLight', front: 'woodLight', stories: 1, top: 'flat', steeple: true },
  { name: 'ASSAY OFFICE', w: 8, h: 5.2, depth: 7, wall: 'wood', front: 'woodLight', stories: 1, top: 'arch' },
  { name: 'PARTS & REPAIR', w: 9.5, h: 5.8, depth: 8, wall: 'woodDark', front: 'woodTeal', stories: 1, top: 'flat' },
];

function building(spec: Spec, m: Mats, tex: Textures, rng: () => number): THREE.Group {
  const b = new Batch();
  const { w, h, depth } = spec;
  const wall = m[spec.wall] as THREE.Material, front = m[spec.front] as THREE.Material;
  const fh = h + 1.5;                                  // false front rises above the real roof

  // Local frame: the facade is the plane z = 0 and looks towards +Z; the lot extends to -Z.
  b.box(wall, w, h, depth, 0, h / 2, -depth / 2);
  b.box(m.roof, w + 0.5, 0.18, depth + 0.4, 0, h + 0.09, -depth / 2);
  if (!spec.openFront) {
    b.box(front, w + 0.3, fh, 0.24, 0, fh / 2, 0.08);
    b.box(m.trim, w + 0.7, 0.2, 0.5, 0, fh + 0.1, 0.1);
    if (spec.top === 'step') b.box(front, w * 0.5, 0.9, 0.24, 0, fh + 0.65, 0.08).box(m.trim, w * 0.5 + 0.4, 0.16, 0.44, 0, fh + 1.18, 0.1);
    if (spec.top === 'arch') {
      b.box(front, w * 0.7, 0.6, 0.24, 0, fh + 0.5, 0.08).box(front, w * 0.4, 0.6, 0.24, 0, fh + 1.1, 0.08);
      b.box(m.trim, w * 0.4 + 0.4, 0.16, 0.44, 0, fh + 1.48, 0.1);
    }
    for (const sx of [-1, 1]) b.box(m.trim, 0.22, fh, 0.3, sx * (w / 2 + 0.05), fh / 2, 0.1);
  } else {
    // Open shed: back wall glow of a forge, posts instead of a facade.
    b.box(m.trim, w, 0.4, 0.3, 0, h - 0.2, 0.1);
    b.box(m.windowLit, 1.6, 1.1, 0.1, -w * 0.2, 1.2, -depth + 0.4);
    b.box(m.metal, 1.2, 0.8, 0.9, w * 0.15, 0.4, -1.6).cyl(m.metal, 0.25, 0.3, 2.6, -w * 0.2, h + 1.2, -depth + 1.2, 8);
  }

  // Porch: deck, posts and a slanted awning (or a balcony on two-storey buildings).
  const deckZ = 1.35;
  b.box(m.woodLight, w + 0.4, 0.3, 2.5, 0, 0.15, deckZ);
  b.box(m.woodLight, 2.4, 0.16, 0.5, 0, 0.08, deckZ + 1.45);
  const posts = Math.max(2, Math.round(w / 3));
  for (let i = 0; i <= posts; i++) {
    const x = -w / 2 + 0.1 + (i * (w - 0.2)) / posts;
    b.box(m.trim, 0.17, 3.0, 0.17, x, 1.8, deckZ + 1.1);
  }
  if (spec.stories === 2) {
    b.box(m.woodLight, w + 0.4, 0.16, 2.5, 0, 3.38, deckZ);
    b.box(m.trim, w + 0.4, 0.1, 0.1, 0, 4.4, deckZ + 1.2);
    for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.55) b.box(m.trim, 0.07, 0.95, 0.07, x, 3.9, deckZ + 1.2);
    b.box(m.roof, w + 0.7, 0.12, 2.9, 0, h - 0.5, deckZ + 0.1, 0.16);
    for (let i = 0; i <= posts; i++) {
      const x = -w / 2 + 0.1 + (i * (w - 0.2)) / posts;
      b.box(m.trim, 0.14, h - 4.1, 0.14, x, 3.46 + (h - 4.1) / 2, deckZ + 1.1);
    }
  } else {
    b.box(m.roof, w + 0.7, 0.12, 2.9, 0, 3.32, deckZ + 0.1, 0.16);
  }

  // Door and windows. Only a few windows are lit, and dimly.
  if (!spec.openFront) {
    b.box(m.glass, 1.5, 2.4, 0.1, 0, 1.5, 0.24);
    b.box(m.trim, 1.8, 0.16, 0.2, 0, 2.78, 0.26);
    if (spec.swingDoors) for (const sx of [-1, 1]) b.box(m.woodLight, 0.68, 1.1, 0.08, sx * 0.38, 1.35, 0.34);
    const window = (x: number, y: number) => {
      b.box(rng() < 0.3 ? m.windowLit : m.glass, 1.05, 1.35, 0.08, x, y, 0.23);
      b.box(m.trim, 1.3, 0.12, 0.16, x, y + 0.74, 0.26).box(m.trim, 1.3, 0.12, 0.22, x, y - 0.74, 0.28);
      b.box(m.trim, 0.08, 1.35, 0.12, x, y, 0.27).box(m.trim, 1.05, 0.07, 0.12, x, y, 0.27);
    };
    const cols = Math.max(1, Math.floor((w / 2 - 1.6) / 1.9));
    for (let c = 1; c <= cols; c++) {
      const x = 1.0 + c * ((w / 2 - 1.2) / (cols + 0.3));
      for (const sx of [-1, 1]) {
        window(sx * x, 1.85);
        if (spec.stories === 2) window(sx * x, 5.2);
      }
    }
    if (spec.stories === 2) b.box(m.glass, 1.2, 2.0, 0.1, 0, 4.5, 0.24);
  }

  // Rooftop clutter: the cyber half of cyber-western.
  if (rng() < 0.7) b.cyl(m.metal, 0.9, 0.9, 1.5, -w * 0.22, h + 0.95, -depth * 0.55, 10).box(m.metal, 0.12, 0.6, 0.12, -w * 0.22, h + 2.0, -depth * 0.55);
  if (rng() < 0.6) {
    const ax = w * 0.3, az = -depth * 0.4;
    b.box(m.metal, 0.07, 3.2, 0.07, ax, h + 1.6, az).box(m.metal, 1.1, 0.05, 0.05, ax, h + 2.6, az).box(m.metal, 0.7, 0.05, 0.05, ax, h + 3.0, az);
  }
  if (rng() < 0.5) b.box(m.metal, 1.3, 0.7, 0.9, w * 0.1, h + 0.5, -depth * 0.75);
  if (spec.steeple) {
    b.box(wall, 2.4, 4.2, 2.4, 0, h + 2.1, -1.4).box(m.glass, 1.0, 1.3, 0.1, 0, h + 2.6, -0.18);
    b.add(m.roof, new THREE.ConeGeometry(2.1, 3.4, 4), 0, h + 5.9, -1.4, 0, Math.PI / 4);
    b.box(m.trim, 0.14, 1.5, 0.14, 0, h + 8.2, -1.4).box(m.trim, 0.8, 0.14, 0.14, 0, h + 8.4, -1.4);
  }
  // Pipes down the facade.
  if (rng() < 0.6) b.box(m.metal, 0.12, h, 0.12, w / 2 - 0.5, h / 2, 0.3);

  // Lantern under the porch.
  const lx = (rng() < 0.5 ? -1 : 1) * (w / 2 - 1.2);
  b.box(m.trim, 0.04, 0.5, 0.04, lx, 2.95, deckZ + 0.9).box(m.lantern, 0.2, 0.28, 0.2, lx, 2.6, deckZ + 0.9);

  const group = b.build();
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({
    map: tex.glow, color: ACCENT.lantern, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(lx, 0.32, deckZ + 0.9);
  group.add(pool);

  // Sign board. Most are painted and dull; a couple of buildings get neon.
  if (!spec.steeple) {
    const neon = spec.neon !== undefined;
    const ink = neon ? '#' + new THREE.Color(spec.neon!).getHexString() : '#b89a6a';
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(spec.name, { ink, board: neon ? '#0d0810' : '#1d1310', sub: spec.sub }) });
    mat.color.setScalar(neon ? 1.35 : 0.5);
    const sw = Math.min(w * 0.8, 7);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 4), mat);
    sign.position.set(0, spec.openFront ? h + 0.9 : h + 0.55, spec.openFront ? 0.3 : 0.22);
    group.add(sign);
  }
  return group;
}

function waterTower(m: Mats): THREE.Group {
  const b = new Batch();
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) b.box(m.trim, 0.25, 9, 0.25, x, 4.5, z);
  b.box(m.trim, 3.6, 0.14, 0.14, 0, 4, -1.6, 0, 0, 0.5).box(m.trim, 3.6, 0.14, 0.14, 0, 4, 1.6, 0, 0, -0.5);
  b.box(m.woodDark, 4.2, 0.25, 4.2, 0, 9.1, 0);
  b.cyl(m.wood, 2.4, 2.2, 4.2, 0, 11.3, 0, 12);
  b.add(m.roof, new THREE.ConeGeometry(2.8, 1.6, 12), 0, 14.2, 0);
  return b.build();
}

function windmill(m: Mats): { group: THREE.Group; blades: THREE.Group } {
  const b = new Batch();
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(m.trim, 0.16, 15, 0.16, x * 0.9, 7.5, z * 0.9, z * 0.05, 0, -x * 0.05);
  for (const y of [3, 7, 11]) b.box(m.trim, 2.2, 0.1, 0.1, 0, y, 0.9).box(m.trim, 2.2, 0.1, 0.1, 0, y, -0.9);
  const group = b.build();
  const wheel = new Batch();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    wheel.box(m.metal, 0.5, 2.6, 0.04, Math.sin(a) * 1.7, Math.cos(a) * 1.7, 0, 0, 0.35, -a);
  }
  wheel.cyl(m.trim, 0.25, 0.25, 0.3, 0, 0, 0, 8, Math.PI / 2);
  const blades = wheel.build();
  blades.position.set(0, 15.4, 1.1);
  group.add(blades);
  return { group, blades };
}

function pole(m: Mats, tex: Textures, side: number, lantern: boolean): THREE.Group {
  const b = new Batch();
  const arm = -side;                                  // the lantern arm reaches over the street
  b.box(m.trim, 0.2, 7.5, 0.2, 0, 3.75, 0).box(m.trim, 1.7, 0.14, 0.14, 0, 6.9, 0);
  for (const x of [-0.7, 0.7]) b.cyl(m.metal, 0.06, 0.06, 0.2, x, 7.05, 0, 6);
  if (lantern) b.box(m.trim, 1.0, 0.08, 0.08, arm * 0.5, 4.4, 0).box(m.lantern, 0.24, 0.34, 0.24, arm * 0.95, 4.15, 0);
  const group = b.build();
  // Sagging wires to the next pole down the street.
  const wire = new THREE.LineBasicMaterial({ color: 0x120c10 });
  for (const x of [-0.7, 0.7]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      pts.push(new THREE.Vector3(x, 7.15 - Math.sin(k * Math.PI) * 0.7, -k * 24));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
  }
  if (lantern) {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({
      map: tex.glow, color: ACCENT.lantern, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(arm * 0.95, 0.03, 0);
    group.add(pool);
  }
  group.position.x = side * POLE_X;
  return group;
}

function streetClutter(m: Mats, rng: () => number): THREE.Group {
  const b = new Batch();
  const kind = Math.floor(rng() * 3);
  if (kind === 0) {                                   // water trough and hitching rail
    b.box(m.woodDark, 2.2, 0.5, 0.7, 0, 0.35, 0).box(m.trim, 2.6, 0.1, 0.1, 0, 1.05, 0.9);
    for (const x of [-1.2, 1.2]) b.box(m.trim, 0.12, 1.05, 0.12, x, 0.52, 0.9);
  } else if (kind === 1) {                            // barrels
    b.cyl(m.wood, 0.36, 0.32, 0.9, 0, 0.45, 0, 10).cyl(m.wood, 0.36, 0.32, 0.9, 0.8, 0.45, 0.2, 10).cyl(m.woodDark, 0.36, 0.32, 0.9, 0.4, 1.3, 0.1, 10);
  } else {                                            // crates
    b.box(m.woodLight, 1, 1, 1, 0, 0.5, 0).box(m.wood, 0.8, 0.8, 0.8, 0.95, 0.4, 0.15, 0, 0.3).box(m.woodDark, 0.7, 0.7, 0.7, 0.2, 1.35, 0, 0, 0.5);
  }
  return b.build();
}

export function buildTown(m: Mats, tex: Textures): TownPiece[] {
  const rng = makeRng(1887);
  const pieces: TownPiece[] = [];
  const place = (object: THREE.Object3D, z: number, spin?: THREE.Object3D) => { pieces.push({ object, baseZ: z, spin }); };

  for (const side of [-1, 1]) {
    const order = [...SPECS].sort(() => rng() - 0.5);
    let z = -rng() * 3, i = 0;
    while (true) {
      const spec = order[i++ % order.length];
      if (-z + spec.w > LOOP - 1) break;
      const g = building(spec, m, tex, rng);
      g.position.x = side * FRONT;
      g.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;     // turn the facade towards the street
      place(g, z - spec.w / 2);
      if (rng() < 0.6) {
        const c = streetClutter(m, rng);
        c.position.x = side * (FRONT - 2.2);
        c.rotation.y = rng() * 6;
        place(c, z - spec.w - 0.6);
      }
      z -= spec.w + 1.2 + rng() * 2.2;
    }
    for (let k = 0; k < LOOP / 24; k++) place(pole(m, tex, side, k % 2 === (side > 0 ? 0 : 1)), -k * 24 - 6);
  }

  const tower = waterTower(m);
  tower.position.x = -24;
  place(tower, -40);
  const tower2 = waterTower(m);
  tower2.position.x = 26;
  place(tower2, -128);
  const mill = windmill(m);
  mill.group.position.x = 25;
  mill.group.rotation.y = -Math.PI / 2;
  place(mill.group, -70, mill.blades);
  return pieces;
}
