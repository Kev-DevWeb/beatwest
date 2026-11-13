/** Degrees turned per mouse count at sensitivity 1 in each game. */
export const GAME_YAW = {
  cs2: { name: 'CS2 / CS:GO', yaw: 0.022 },
  apex: { name: 'Apex Legends', yaw: 0.022 },
  valorant: { name: 'Valorant', yaw: 0.07 },
  overwatch: { name: 'Overwatch 2', yaw: 0.0066 },
} as const;

export type GameId = keyof typeof GAME_YAW;

export const degPerCountFromGame = (game: GameId, sensitivity: number) => GAME_YAW[game].yaw * sensitivity;

export const gameSensitivity = (game: GameId, degPerCount: number) => degPerCount / GAME_YAW[game].yaw;

/** Centimetres of mouse travel for a full 360° turn. */
export const cmPer360 = (degPerCount: number, dpi: number) => (360 / (degPerCount * dpi)) * 2.54;

export const degPerCountFromCm = (cm: number, dpi: number) => 360 / ((cm / 2.54) * dpi);

/** Vertical FOV (degrees) for a horizontal FOV measured at 16:9, the convention most shooters use. */
export const verticalFov = (horizontal169: number) =>
  (2 * Math.atan(Math.tan((horizontal169 * Math.PI) / 360) * (9 / 16)) * 180) / Math.PI;
