import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { aimDirection, type V3 } from '../game/hit';
import { verticalFov } from '../input/sensitivity';
import { makeMaterials, type Mats } from './build';
import { SKY, WORLD } from './palette';
import { Sky } from './sky';
import { makeTextures, type Textures } from './textures';
import { buildTown, LOOP, type TownPiece } from './town';
import { buildCart, Revolver3D } from './viewmodel';

/** Metres per second of song the camera travels down the street. */
export const SPEED = 4;
export const EYE_HEIGHT = 1.7;
/** How far away a target is on its beat. */
export const TARGET_DISTANCE = 14;

export const railPosition = (t: number): V3 => ({ x: 0, y: EYE_HEIGHT, z: -SPEED * t });

/** World position that sits at the given view angles when the camera reaches song time `t`. */
export function aimPoint(t: number, yaw: number, pitch: number): V3 {
  const o = railPosition(t), d = aimDirection(yaw, pitch);
  return { x: o.x + d.x * TARGET_DISTANCE, y: o.y + d.y * TARGET_DISTANCE, z: o.z + d.z * TARGET_DISTANCE };
}

export type Quality = 'low' | 'medium' | 'high';
const QUALITY: Record<Quality, { pixelRatio: number; bloom: boolean; dust: number; samples: number }> = {
  low: { pixelRatio: 1, bloom: false, dust: 0, samples: 0 },
  medium: { pixelRatio: 1.25, bloom: true, dust: 120, samples: 2 },
  high: { pixelRatio: 2, bloom: true, dust: 240, samples: 4 },
};

const AHEAD_MARGIN = 14;
const GROUND_TILE = 12;

/** Everything about one frame the stage needs from the game. */
export interface Frame {
  songTime: number;
  yaw: number;
  pitch: number;
  dt: number;
  deadEye: boolean;
  /** Loudness of the music right now, 0..1. */
  energy: number;
  /** Metres to drop the camera (the fall when a run is failed). */
  fall: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.03, 1200);
  /** Targets, covers and effects are added here. */
  readonly dynamic = new THREE.Group();
  readonly mats: Mats;
  readonly textures: Textures;
  readonly gun: Revolver3D;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sky: Sky;
  private town: TownPiece[];
  private ground: THREE.Mesh;
  private track: THREE.Mesh;
  private cart: THREE.Group;
  private pulse = 0;
  private shakeAmount = 0;
  private punch = 0;
  private baseFov = 70;
  private lastZ = 0;
  private lastYaw = 0;
  private lanternBase: THREE.Color;
  private quality: Quality;
  /** 0..1 multiplier for camera shake and sway, from settings. */
  motion = 1;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    const q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.textures = makeTextures();
    this.mats = makeMaterials(this.textures);
    this.lanternBase = this.mats.lantern.color.clone();

    this.scene.fog = new THREE.Fog(SKY.fog, 18, 150);
    this.scene.add(new THREE.HemisphereLight(0xa87a9a, 0x2a1a1c, 1.5));
    // Low sun from ahead and slightly to the left: one side of the street warm, the other in shade.
    const sun = new THREE.DirectionalLight(0xff9a5c, 2.4);
    sun.position.set(-0.55, 0.4, -1);
    this.scene.add(sun);
    this.scene.add(this.camera, this.dynamic);

    this.sky = new Sky(this.textures, q.dust);
    this.scene.add(this.sky.group);

    // Dirt street and the rail the cart runs on; both scroll their texture instead of moving.
    this.textures.dirt.repeat.set(600 / GROUND_TILE, 600 / GROUND_TILE);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: WORLD.ground, map: this.textures.dirt }));
    this.ground.rotation.x = -Math.PI / 2;
    this.textures.track.repeat.set(1, 260 / 1.3);
    this.track = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 260), new THREE.MeshLambertMaterial({ color: 0x4a3a34, map: this.textures.track }));
    this.track.rotation.x = -Math.PI / 2;
    this.track.position.y = 0.015;
    const rails = new THREE.Group();
    for (const x of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 260), this.mats.metal);
      rail.position.set(x, 0.07, 0);
      const shine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 260), new THREE.MeshBasicMaterial({ color: 0x8a5a48 }));
      shine.position.set(x, 0.125, 0);
      rails.add(rail, shine);
    }
    this.track.add(rails);
    rails.rotation.x = Math.PI / 2;
    this.scene.add(this.ground, this.track);

    this.town = buildTown(this.mats, this.textures);
    this.town.forEach((p) => this.scene.add(p.object));

    this.cart = buildCart(this.mats);
    this.scene.add(this.cart);
    this.gun = new Revolver3D(this.mats);
    this.camera.add(this.gun.group);

    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: q.samples, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // High threshold: only over-bright things (targets, lanterns, neon signs) bloom.
    this.bloom = new UnrealBloomPass(size, 0.7, 0.5, 0.95);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setFov(horizontal169: number): void {
    this.baseFov = verticalFov(horizontal169);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  /** Pixels a sphere of the given radius covers at target distance (used to keep heads hittable). */
  pixelRadius(radius: number): number {
    return (radius / TARGET_DISTANCE / Math.tan((this.baseFov * Math.PI) / 360)) * (window.innerHeight / 2);
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Gun recoil, muzzle flash and cylinder turn. */
  kick(): void {
    this.gun.fire();
    this.shake(0.25);
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(1.5, this.shakeAmount + amount);
  }

  /** Brief zoom-in for emphasis (headshots). */
  zoomPunch(): void {
    this.punch = 1;
  }

  beat(): void {
    this.pulse = 1;
  }

  lightning(): void {
    this.sky.lightning();
  }

  /** Screen position (px) of a world point, or null when behind the camera. */
  project(p: V3): { x: number; y: number } | null {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  update(f: Frame): void {
    const o = railPosition(f.songTime);
    const m = this.motion;
    // Cart sway: a slow roll plus a small bump on every beat. Tiny, so it never moves the aim.
    const bump = this.pulse * this.pulse * 0.012 * m;
    const sway = Math.sin(f.songTime * 2.1) * 0.006 * m;
    this.shakeAmount = Math.max(0, this.shakeAmount - f.dt * 5);
    const s = this.shakeAmount * this.shakeAmount * 0.012 * m;
    this.camera.position.set(o.x + sway, o.y - bump - f.fall, o.z);
    this.camera.rotation.set(
      f.pitch + (Math.random() - 0.5) * s + f.fall * 0.5,
      f.yaw + (Math.random() - 0.5) * s,
      sway * 0.6 + (Math.random() - 0.5) * s + f.fall * 0.25,
      'YXZ',
    );
    this.punch = Math.max(0, this.punch - f.dt * 9);
    const fov = this.baseFov - this.punch * 1.6 * m - (f.deadEye ? 4 : 0);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, f.dt * 14);
      this.camera.updateProjectionMatrix();
    }

    const travelled = this.lastZ - o.z;
    this.lastZ = o.z;
    this.pulse = Math.max(0, this.pulse - f.dt * 4);
    this.sky.update(o.z, Math.abs(travelled) < 5 ? travelled : 0, f.dt, f.energy, this.pulse, f.deadEye ? 0.08 : 1);

    this.ground.position.z = o.z;
    this.textures.dirt.offset.y = -o.z / GROUND_TILE;
    this.track.position.z = o.z - 100;
    this.textures.track.offset.y = -o.z / 1.3;
    this.cart.position.set(o.x, -bump * 2 - f.fall, o.z);
    this.cart.rotation.z = sway * 1.5 + f.fall * 0.25;

    const edge = o.z + AHEAD_MARGIN;
    for (const p of this.town) {
      const behind = (((edge - p.baseZ) % LOOP) + LOOP) % LOOP;
      p.object.position.z = edge - behind;
      if (p.spin) p.spin.rotation.z += f.dt * (0.6 + f.energy * 1.4);
    }

    // Lanterns breathe with the music; nothing near the targets pulses.
    this.mats.lantern.color.copy(this.lanternBase).multiplyScalar(0.85 + this.pulse * 0.35 + f.energy * 0.2);
    this.gun.update(f.dt, (f.yaw - this.lastYaw) / Math.max(f.dt, 0.001));
    this.lastYaw = f.yaw;
    this.bloom.strength = 0.65 + (f.deadEye ? 0.35 : 0);
  }

  /** Renders the given objects once so their shaders are compiled before the song starts. */
  warmUp(objects: THREE.Object3D[]): void {
    for (const o of objects) this.dynamic.add(o);
    this.composer.render();
    for (const o of objects) this.dynamic.remove(o);
  }

  render(): void {
    this.composer.render();
  }
}
