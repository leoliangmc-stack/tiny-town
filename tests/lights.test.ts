import { describe, expect, it } from 'vitest';

import { beaconFactorAt, SUNRISE_MINUTE, SUNSET_MINUTE } from '../src/render/palettes.js';

describe('the lighthouse beacon', () => {
  it('is fully off through the day', () => {
    for (let minute = SUNRISE_MINUTE + 20; minute <= SUNSET_MINUTE - 20; minute += 5) {
      expect(beaconFactorAt(minute)).toBe(0);
    }
  });

  it('is fully on through the night', () => {
    for (const minute of [SUNSET_MINUTE, 22 * 60, 0, 3 * 60, SUNRISE_MINUTE - 1]) {
      expect(beaconFactorAt(minute)).toBe(1);
    }
  });

  it('fades rather than snaps at dusk and dawn', () => {
    const dusk = beaconFactorAt(SUNSET_MINUTE - 10);
    const dawn = beaconFactorAt(SUNRISE_MINUTE + 10);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
  });
});
