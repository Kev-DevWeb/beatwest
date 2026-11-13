export type ModId = 'hidden' | 'dt' | 'ht' | 'sd' | 'nf';

export interface ModInfo { id: ModId; short: string; name: string; description: string; multiplier: number }

export const MODS: ModInfo[] = [
  { id: 'hidden', short: 'HD', name: 'Hidden', description: 'El anillo de desenfunde se desvanece', multiplier: 1.06 },
  { id: 'dt', short: 'DT', name: 'Double Time', description: 'La canción va a 1.5×', multiplier: 1.12 },
  { id: 'ht', short: 'HT', name: 'Half Time', description: 'La canción va a 0.75×', multiplier: 0.3 },
  { id: 'sd', short: 'SD', name: 'Sudden Death', description: 'Un fallo y se acabó', multiplier: 1 },
  { id: 'nf', short: 'NF', name: 'No Fail', description: 'No puedes morir', multiplier: 0.5 },
];

const EXCLUSIVE: [ModId, ModId][] = [['dt', 'ht'], ['sd', 'nf']];

/** Turns a mod on or off, switching off whatever is incompatible with it. */
export function toggleMod(active: ModId[], id: ModId): ModId[] {
  if (active.includes(id)) return active.filter((m) => m !== id);
  const blocked = EXCLUSIVE.filter((p) => p.includes(id)).map((p) => (p[0] === id ? p[1] : p[0]));
  return [...active.filter((m) => !blocked.includes(m)), id];
}

export function modMultiplier(active: ModId[]): number {
  return active.reduce((m, id) => m * (MODS.find((x) => x.id === id)?.multiplier ?? 1), 1);
}

export function playbackRate(active: ModId[]): number {
  if (active.includes('dt')) return 1.5;
  if (active.includes('ht')) return 0.75;
  return 1;
}

export function modsKey(active: ModId[]): string {
  return MODS.filter((m) => active.includes(m.id)).map((m) => m.short).join('') || 'NM';
}
