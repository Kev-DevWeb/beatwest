import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeRng } from '../chart/rng';
import { aimDirection, type V3 } from '../game/hit';
import { verticalFov } from '../input/sensitivity';

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

export const NEON = { magenta: 0xff2bd6, cyan: 0x00ffe1, amber: 0xffa53a, red: 0xff3344, green: 0x5dff8a };

const LOOP = 140;
const AHEAD_MARGIN = 14;

interface Looping { object: THREE.Object3D; baseZ: number }

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
  /** Targets and effects are added here. */
  readonly dynamic = new THREE.Group();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private looping: Looping[] = [];
  private backdrop = new THREE.Group();
  private grid: THREE.GridHelper;
  private gun = new THREE.Group();
  private recoil = 0;
  private pulse = 0;
  private gunFlash: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.fog = new THREE.Fog(0x1a0830, 25, 150);
    this.scene.add(new THREE.AmbientLight(0x8a6cff, 1.3));
    const sun = new THREE.DirectionalLight(0xff8a5c, 1.6);
    sun.position.set(0, 12, -30);
    this.scene.add(sun);
    this.scene.add(this.camera, this.dynamic, this.backdrop);

    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.55, 0.45, 0.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildBackdrop();
    this.grid = this.buildGround();
    this.buildTown();
    this.gunFlash = this.buildGun();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildBackdrop(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(700, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 p;
          void main(){
            float h = clamp(normalize(p).y, 0.0, 1.0);
            vec3 horizon = vec3(0.42, 0.08, 0.30), top = vec3(0.03, 0.01, 0.09);
            gl_FragColor = vec4(mix(horizon, top, pow(h, 0.45)), 1.0);
          }`,
      }),
    );
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(85, 48),
      new THREE.ShaderMaterial({
        fog: false,
        transparent: true,
        depthWrite: false,
        vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec2 u;
          void main(){
            float band = fract(u.y * 16.0);
            if (u.y < 0.55 && band < 0.12 + (0.55 - u.y) * 0.9) discard;
            gl_FragColor = vec4(mix(vec3(0.95, 0.16, 0.45), vec3(1.0, 0.62, 0.18), u.y) * 0.5, 1.0);
          }`,
      }),
    );
    sun.position.set(0, 28, -520);
    this.backdrop.add(sky, sun);

    const mesa = new THREE.MeshBasicMaterial({ color: 0x1a0a2e, fog: false });
    const rng = makeRng(77);
    for (let i = 0; i < 14; i++) {
      const w = 40 + rng() * 70, h = 14 + rng() * 34;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.5, h, 7), mesa);
      const side = i % 2 ? 1 : -1;
      m.position.set(side * (70 + rng() * 240), h / 2 - 1, -260 - rng() * 180);
      this.backdrop.add(m);
    }
  }

  private buildGround(): THREE.GridHelper {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshBasicMaterial({ color: 0x0b0418 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    this.backdrop.add(ground);
    const grid = new THREE.GridHelper(320, 160, NEON.magenta, 0x6a2a9c);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    this.scene.add(grid);
    for (const x of [-0.75, 0.75]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 320), new THREE.MeshBasicMaterial({ color: NEON.cyan }));
      rail.position.set(x, 0.03, -120);
      this.backdrop.add(rail);
    }
    return grid;
  }

  private wantedTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(20,4,40,0.85)';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#ffa53a';
    g.lineWidth = 6;
    g.strokeRect(6, 6, 244, 116);
    g.fillStyle = '#ffa53a';
    g.font = 'bold 54px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('WANTED', 128, 66);
    g.font = 'bold 22px monospace';
    g.fillStyle = '#00ffe1';
    g.fillText('DEAD OR OFFLINE', 128, 102);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildTown(): void {
    const rng = makeRng(1887);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const wall = [0x1b0f33, 0x231040, 0x16122e].map((c) => new THREE.MeshLambertMaterial({ color: c }));
    const glow = [NEON.magenta, NEON.cyan, NEON.amber].map((c) => new THREE.MeshBasicMaterial({ color: c }));
    const dim = new THREE.MeshBasicMaterial({ color: 0x2c1750 });
    const sign = new THREE.MeshBasicMaterial({ map: this.wantedTexture(), transparent: true });
    const cactus = new THREE.MeshBasicMaterial({ color: NEON.green, wireframe: true });

    const add = (object: THREE.Object3D, z: number) => {
      object.position.z = z;
      this.scene.add(object);
      this.looping.push({ object, baseZ: z });
    };
    const part = (parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      parent.add(m);
    };

    for (const side of [-1, 1]) {
      for (let i = 0; i < LOOP / 10; i++) {
        const g = new THREE.Group();
        const w = 6 + rng() * 3, h = 5 + rng() * 7, depth = 7 + rng() * 2;
        const front = side * 10.5;                    // x of the street-facing wall
        const cx = front + side * (w / 2);
        part(g, wall[Math.floor(rng() * 3)], w, h, depth, cx, h / 2, 0);
        // False front, the classic western facade.
        part(g, wall[Math.floor(rng() * 3)], 0.4, h + 1.6, depth * 0.9, front, (h + 1.6) / 2, 0);
        const trim = glow[Math.floor(rng() * 3)];
        part(g, trim, 0.12, 0.12, depth * 0.92, front - side * 0.25, h + 1.6, 0);
        // Porch roof and posts.
        part(g, wall[0], 2.2, 0.15, depth * 0.9, front - side * 1.1, 3, 0);
        for (const pz of [-depth * 0.4, depth * 0.4]) part(g, dim, 0.15, 3, 0.15, front - side * 2.1, 1.5, pz);
        // Windows.
        const cols = 3;
        for (let r = 0; r < Math.floor((h - 3) / 2.2); r++) {
          for (let c = 0; c < cols; c++) {
            const lit = rng() < 0.6;
            part(g, lit ? glow[Math.floor(rng() * 3)] : dim, 0.1, 1, 0.9, front - side * 0.26, 4.4 + r * 2.2, (c - 1) * (depth / 3.6));
          }
        }
        if (rng() < 0.45) {
          const s = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), sign);
          s.position.set(front - side * 0.6, h + 3.2, 0);
          s.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          g.add(s);
        }
        add(g, -i * 10 - rng() * 1.5);
      }
      for (let i = 0; i < 7; i++) {
        const g = new THREE.Group();
        const x = side * (6.2 + rng() * 1.2), h = 1.6 + rng() * 1.4;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, h, 6), cactus);
        trunk.position.set(x, h / 2, 0);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, h * 0.45, 6), cactus);
        arm.position.set(x + 0.45, h * 0.6, 0);
        g.add(trunk, arm);
        add(g, -i * 20 - 5 - rng() * 8);
      }
    }
  }

  private buildGun(): THREE.Mesh {
    const metal = new THREE.MeshLambertMaterial({ color: 0x8a84b0 });
    const grip = new THREE.MeshLambertMaterial({ color: 0x5a2b1a });
    const glow = new THREE.MeshBasicMaterial({ color: NEON.cyan });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 10), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.2);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.07, 6), metal);
    drum.rotation.x = Math.PI / 2;
    drum.position.set(0, 0.005, -0.03);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.14), metal);
    frame.position.set(0, -0.005, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.045), grip);
    handle.position.set(0, -0.07, 0.07);
    handle.rotation.x = 0.35;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.28), glow);
    strip.position.set(0, 0.042, -0.2);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
    flash.position.set(0, 0.02, -0.38);
    flash.visible = false;
    this.gun.add(barrel, drum, frame, handle, strip, flash);
    this.gun.position.set(0.22, -0.2, -0.5);
    this.camera.add(this.gun);
    return flash;
  }

  setFov(horizontal169: number): void {
    this.camera.fov = verticalFov(horizontal169);
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  kick(): void {
    this.recoil = 1;
    this.gunFlash.visible = true;
  }

  beat(): void {
    this.pulse = 1;
  }

  /** Screen position (px) of a world point, or null when behind the camera. */
  project(p: V3): { x: number; y: number } | null {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  update(songTime: number, yaw: number, pitch: number, dt: number, deadEye: boolean): void {
    const o = railPosition(songTime);
    this.camera.position.set(o.x, o.y, o.z);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.backdrop.position.z = o.z;
    this.grid.position.z = Math.round(o.z / 2) * 2;
    const edge = o.z + AHEAD_MARGIN;
    for (const l of this.looping) {
      const behind = (((edge - l.baseZ) % LOOP) + LOOP) % LOOP;
      l.object.position.z = edge - behind;
    }
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.pulse = Math.max(0, this.pulse - dt * 4);
    if (this.recoil < 0.7) this.gunFlash.visible = false;
    this.gun.rotation.x = this.recoil * 0.35;
    this.gun.position.z = -0.5 + this.recoil * 0.05;
    this.bloom.strength = 0.5 + this.pulse * 0.3 + (deadEye ? 0.5 : 0);
    (this.grid.material as THREE.Material).opacity = 0.45 + this.pulse * 0.4;
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
