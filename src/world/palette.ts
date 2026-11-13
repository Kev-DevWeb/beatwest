/**
 * Single source of colour. Art rule: brightness and saturation belong to the targets;
 * the world lives in shadow. Nothing in WORLD may come close to a TARGET colour.
 */

/** Lit world surfaces (what textures are tinted with). Dark, matte, low saturation. */
export const WORLD = {
  wood: 0x3d2a24,
  woodDark: 0x241816,
  woodLight: 0x554034,
  woodRed: 0x4a231f,
  woodTeal: 0x1e3236,
  roof: 0x2a2430,
  metal: 0x34343f,
  trim: 0x18100f,
  ground: 0x4a352c,
  glass: 0x0b0910,
  /** Lamp-lit window: warm but dim, must stay below the bloom threshold. */
  windowLit: 0x6b4420,
};

/** Backdrop. Bright only at the horizon, straight ahead. */
export const SKY = {
  top: 0x0d0a26,
  mid: 0x4a2148,
  horizon: 0xd9643a,
  sun: 0xffa45c,
  fog: 0x5a2c3c,
  mesaNear: 0x1c0f22,
  mesaMid: 0x3a1c34,
  mesaFar: 0x6a3248,
};

/** Rare accents: lanterns and a handful of signs. */
export const ACCENT = { lantern: 0xffb25e, neonA: 0xff3d9a, neonB: 0x35d6c8, brass: 0x8a6a2c };

export interface TargetPalette {
  bandit: number;
  head: number;
  burst: number;
  drone: number;
  civilian: number;
  ring: number;
  perfect: number;
}

export type PaletteId = 'default' | 'colorblind';

/** Colours reserved for things you shoot (or must not shoot). */
export const TARGETS: Record<PaletteId, TargetPalette> = {
  default: { bandit: 0xff4d1f, head: 0xfff0b8, burst: 0xffd91a, drone: 0x2fe9ff, civilian: 0x8dffb0, ring: 0xffffff, perfect: 0xffd24a },
  // Avoids relying on red/green: magenta hostiles, blue drones, white civilians.
  colorblind: { bandit: 0xff48d8, head: 0xffffff, burst: 0xffe600, drone: 0x4aa3ff, civilian: 0xeaeaea, ring: 0xffffff, perfect: 0xffe600 },
};

/** WCAG relative luminance of an sRGB hex colour, 0..1. */
export function luminance(hex: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((hex >> 16) & 255) + 0.7152 * lin((hex >> 8) & 255) + 0.0722 * lin(hex & 255);
}
