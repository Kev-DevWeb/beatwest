export interface V3 { x: number; y: number; z: number }

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Distance along the ray (unit `dir`) to a sphere, or null if it misses. */
export function raySphere(origin: V3, dir: V3, centre: V3, radius: number): number | null {
  const oc = sub(centre, origin);
  const t = dot(oc, dir);
  if (t < 0) return null;
  const d2 = dot(oc, oc) - t * t;
  return d2 <= radius * radius ? t : null;
}

/** Distance along the ray to a capsule (segment a–b with radius), or null if it misses. */
export function rayCapsule(origin: V3, dir: V3, a: V3, b: V3, radius: number): number | null {
  const seg = sub(b, a);
  const w = sub(origin, a);
  const dd = dot(dir, dir), ds = dot(dir, seg), ss = dot(seg, seg);
  const dw = dot(dir, w), sw = dot(seg, w);
  const denom = dd * ss - ds * ds;
  let s = denom > 1e-9 ? (dd * sw - ds * dw) / denom : 0;
  s = Math.max(0, Math.min(1, s));
  const t = (ds * s - dw) / dd;
  if (t < 0) return null;
  const px = origin.x + dir.x * t - (a.x + seg.x * s);
  const py = origin.y + dir.y * t - (a.y + seg.y * s);
  const pz = origin.z + dir.z * t - (a.z + seg.z * s);
  return px * px + py * py + pz * pz <= radius * radius ? t : null;
}

/** Unit view direction for the game's yaw/pitch convention (yaw 0 looks down −Z, positive yaw turns left). */
export function aimDirection(yaw: number, pitch: number): V3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** Inverse of `aimDirection`: the yaw/pitch needed to look from `from` at `to`. */
export function anglesTo(from: V3, to: V3): { yaw: number; pitch: number } {
  const d = sub(to, from);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}
