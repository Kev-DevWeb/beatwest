import { describe, expect, it } from 'vitest';
import { luminance, SKY, TARGETS, WORLD } from '../src/world/palette';

describe('palette: targets must out-shine the world', () => {
  const worldMax = Math.max(...Object.values(WORLD).map(luminance));

  it('keeps every world surface dark', () => {
    expect(worldMax).toBeLessThan(0.08);
  });

  for (const [name, p] of Object.entries(TARGETS)) {
    it(`${name}: every target colour is far brighter than any world surface`, () => {
      for (const key of ['bandit', 'burst', 'drone', 'civilian', 'head'] as const) {
        expect(luminance(p[key]) - worldMax).toBeGreaterThan(0.15);
      }
    });

    it(`${name}: heads are brighter than the brightest part of the sky`, () => {
      expect(luminance(p.head) - luminance(SKY.horizon)).toBeGreaterThan(0.3);
    });
  }

  it('computes relative luminance', () => {
    expect(luminance(0x000000)).toBe(0);
    expect(luminance(0xffffff)).toBeCloseTo(1);
  });
});
