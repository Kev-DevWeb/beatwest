import * as THREE from 'three';
import { Batch, type Mats } from './build';
import { ACCENT } from './palette';

/** First-person revolver and hand, attached to the camera. */
export class Revolver3D {
  readonly group = new THREE.Group();
  private drum: THREE.Group;
  private flash: THREE.Mesh;
  private light: THREE.PointLight;
  private recoil = 0;
  private drumTarget = 0;
  private reload = 0;
  private reloadTime = 0.3;
  private sway = 0;

  constructor(m: Mats) {
    const steel = new THREE.MeshLambertMaterial({ color: 0x4c4a56 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1a20 });
    const grip = new THREE.MeshLambertMaterial({ color: 0x48281a });
    const glove = new THREE.MeshLambertMaterial({ color: 0x1a1412 });
    const strip = new THREE.MeshBasicMaterial({ color: ACCENT.neonB });

    const body = new Batch();
    body.cyl(steel, 0.016, 0.018, 0.3, 0, 0.024, -0.2, 10, Math.PI / 2);            // barrel
    body.box(dark, 0.012, 0.014, 0.26, 0, 0.046, -0.19);                            // top rib
    body.box(steel, 0.008, 0.022, 0.012, 0, 0.058, -0.335);                         // front sight
    body.box(dark, 0.022, 0.03, 0.2, 0, 0.0, -0.16);                                // ejector housing
    body.box(steel, 0.032, 0.062, 0.15, 0, 0.004, 0.0);                             // frame
    body.box(dark, 0.014, 0.03, 0.03, 0, 0.05, 0.075, -0.5);                        // hammer
    body.box(grip, 0.034, 0.13, 0.05, 0, -0.085, 0.085, 0.38);                      // grip
    body.box(m.brass, 0.036, 0.016, 0.052, 0, -0.148, 0.108, 0.38);                 // butt cap
    body.box(glove, 0.06, 0.1, 0.075, 0.004, -0.09, 0.085, 0.38);                   // hand
    body.box(glove, 0.058, 0.03, 0.09, 0.004, -0.035, 0.03);                        // fingers round the guard
    body.box(glove, 0.07, 0.085, 0.26, 0.012, -0.16, 0.25, 0.5);                    // forearm
    this.group.add(body.build());
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.24), strip);
    line.position.set(0, 0.055, -0.19);
    this.group.add(line);

    // Six-chamber cylinder: turns one chamber per shot.
    const drum = new Batch();
    drum.cyl(steel, 0.036, 0.036, 0.075, 0, 0, 0, 12, Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      drum.cyl(dark, 0.009, 0.009, 0.078, Math.cos(a) * 0.023, Math.sin(a) * 0.023, 0, 6, Math.PI / 2);
    }
    this.drum = drum.build();
    this.drum.position.set(0, 0.018, -0.045);
    this.group.add(this.drum);

    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6a0 }));
    (this.flash.material as THREE.MeshBasicMaterial).color.multiplyScalar(1.6);
    this.flash.position.set(0, 0.024, -0.39);
    this.flash.visible = false;
    this.light = new THREE.PointLight(0xffb060, 0, 9, 1.5);
    this.light.position.set(0, 0.05, -0.5);
    this.group.add(this.flash, this.light);
    this.group.position.set(0.2, -0.19, -0.46);
  }

  fire(): void {
    this.recoil = 1;
    this.drumTarget += Math.PI / 3;
    this.flash.visible = true;
    this.flash.scale.setScalar(0.7 + Math.random() * 0.8);
    this.light.intensity = 5;
  }

  /** @param seconds how long the gun is out of action (0 for a perfect, on-beat reload) */
  startReload(seconds: number): void {
    this.reloadTime = Math.max(0.28, seconds);
    this.reload = this.reloadTime;
    this.drumTarget += Math.PI * 4;
  }

  /** World position of the muzzle, for tracers. */
  muzzle(target = new THREE.Vector3()): THREE.Vector3 {
    return this.flash.getWorldPosition(target);
  }

  update(dt: number, lookSpeed: number): void {
    this.recoil = Math.max(0, this.recoil - dt * 7.5);
    this.reload = Math.max(0, this.reload - dt);
    this.light.intensity = Math.max(0, this.light.intensity - dt * 70);
    if (this.recoil < 0.85) this.flash.visible = false;
    this.drum.rotation.z += (this.drumTarget - this.drum.rotation.z) * Math.min(1, dt * 18);
    // The gun lags slightly behind fast turns, like a real arm would.
    this.sway += (Math.max(-1, Math.min(1, lookSpeed * 0.15)) - this.sway) * Math.min(1, dt * 10);
    const r = this.reload / this.reloadTime;
    const dip = Math.sin(Math.min(1, r) * Math.PI);
    const kick = this.recoil * this.recoil;
    this.group.rotation.set(kick * 0.42 + dip * 0.9, this.sway * 0.06, dip * 0.5 - this.sway * 0.05);
    this.group.position.set(0.2 + this.sway * 0.012, -0.19 - dip * 0.1 + kick * 0.015, -0.46 + kick * 0.06);
  }
}

/** The mine cart you ride down the rail: gives the player a body in the world. */
export function buildCart(m: Mats): THREE.Group {
  const b = new Batch();
  b.box(m.woodLight, 1.9, 0.12, 2.5, 0, 0.62, -0.1);
  b.box(m.wood, 1.9, 0.52, 0.1, 0, 0.94, -1.32);
  for (const x of [-0.95, 0.95]) b.box(m.wood, 0.1, 0.52, 2.5, x, 0.94, -0.1);
  b.box(m.trim, 2.02, 0.07, 0.16, 0, 1.22, -1.32);
  for (const x of [-0.95, 0.95]) b.box(m.trim, 0.16, 0.07, 2.56, x, 1.22, -0.1).box(m.metal, 0.14, 0.62, 0.14, x, 0.94, -1.32);
  b.box(m.brass, 1.6, 0.05, 0.05, 0, 1.3, -1.36);
  return b.build();
}
