import * as THREE from 'three';
import { makeRng } from '../chart/rng';

/** Procedural textures drawn on canvases: the game ships no image files. */

function texture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const grey = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;

function planks(vertical: boolean): THREE.CanvasTexture {
  const rng = makeRng(vertical ? 11 : 12);
  return texture(256, 256, (g, w, h) => {
    const n = 8, size = w / n;
    for (let i = 0; i < n; i++) {
      const base = 150 + Math.floor(rng() * 80);
      g.fillStyle = grey(base);
      if (vertical) g.fillRect(i * size, 0, size, h); else g.fillRect(0, i * size, w, size);
      for (let k = 0; k < 26; k++) {          // grain
        g.fillStyle = grey(base + (rng() < 0.5 ? -28 : 22), 0.35);
        const along = rng() * h, len = 20 + rng() * 90, across = i * size + rng() * size;
        if (vertical) g.fillRect(across, along, 1, len); else g.fillRect(along, across, len, 1);
      }
      g.fillStyle = grey(30, 0.9);              // gap between boards
      if (vertical) g.fillRect(i * size, 0, 2, h); else g.fillRect(0, i * size, w, 2);
      for (const p of [0.08, 0.92]) {          // nails
        g.fillStyle = grey(60);
        if (vertical) g.fillRect(i * size + size / 2 - 1, p * h, 3, 3); else g.fillRect(p * w, i * size + size / 2 - 1, 3, 3);
      }
    }
  });
}

function dirt(): THREE.CanvasTexture {
  const rng = makeRng(21);
  return texture(512, 512, (g, w, h) => {
    g.fillStyle = grey(170);
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = grey(110 + Math.floor(rng() * 120), 0.35);
      const s = 1 + rng() * 3;
      g.fillRect(rng() * w, rng() * h, s, s);
    }
    for (let i = 0; i < 60; i++) {             // pebbles
      g.fillStyle = grey(90 + Math.floor(rng() * 60), 0.7);
      g.beginPath();
      g.ellipse(rng() * w, rng() * h, 2 + rng() * 4, 1.5 + rng() * 3, rng() * 3, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 14; i++) {             // wheel ruts running along the street
      g.fillStyle = grey(95, 0.22);
      g.fillRect(rng() * w, 0, 3 + rng() * 6, h);
    }
  });
}

function corrugated(): THREE.CanvasTexture {
  return texture(128, 128, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const v = 150 + Math.round(60 * Math.sin((x / w) * Math.PI * 16));
      g.fillStyle = grey(v);
      g.fillRect(x, 0, 1, h);
    }
    g.fillStyle = grey(70, 0.5);
    g.fillRect(0, h - 3, w, 3);
  });
}

/** Sleepers and ballast for the rail the player rides on. */
function track(): THREE.CanvasTexture {
  const rng = makeRng(31);
  return texture(128, 128, (g, w, h) => {
    g.fillStyle = grey(120);
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = grey(70 + Math.floor(rng() * 90), 0.5);
      g.fillRect(rng() * w, rng() * h, 2, 2);
    }
    g.fillStyle = grey(45);
    g.fillRect(6, h * 0.3, w - 12, h * 0.4);
    g.fillStyle = grey(75, 0.6);
    g.fillRect(6, h * 0.3, w - 12, 3);
  });
}

function radial(inner: string, outer: string): THREE.CanvasTexture {
  return texture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, false);
}

export interface SignStyle { ink: string; board: string; font?: string; sub?: string }

const signs: (() => void)[] = [];

/** A painted or neon sign. Redrawn by `redrawSigns()` once the display font has loaded. */
export function signTexture(text: string, style: SignStyle): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = style.board;
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = style.ink;
    g.lineWidth = 5;
    g.strokeRect(8, 8, 496, 112);
    g.fillStyle = style.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = style.sub ? 62 : 76;
    g.font = `${size}px ${style.font ?? 'Rye, Georgia, serif'}`;
    while (g.measureText(text).width > 460 && size > 20) { size -= 4; g.font = `${size}px ${style.font ?? 'Rye, Georgia, serif'}`; }
    g.fillText(text, 256, style.sub ? 52 : 68);
    if (style.sub) {
      g.font = '600 22px "Chakra Petch", monospace';
      g.fillText(style.sub, 256, 100);
    }
    t.needsUpdate = true;
  };
  draw();
  signs.push(draw);
  return t;
}

export const redrawSigns = () => signs.forEach((d) => d());

export interface Textures {
  planksV: THREE.Texture;
  planksH: THREE.Texture;
  dirt: THREE.Texture;
  corrugated: THREE.Texture;
  track: THREE.Texture;
  /** White-to-transparent blob: light pools, halos, dust motes. */
  glow: THREE.Texture;
  /** Black-to-transparent blob: fake shadows and the dark disc behind floating targets. */
  shade: THREE.Texture;
}

export function makeTextures(): Textures {
  return {
    planksV: planks(true),
    planksH: planks(false),
    dirt: dirt(),
    corrugated: corrugated(),
    track: track(),
    glow: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
    shade: radial('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'),
  };
}
