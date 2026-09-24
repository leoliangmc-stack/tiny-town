import { describe, expect, it } from 'vitest';

import { bedLevels } from '../src/render/Ambience.js';

const at = (hour: number, minute = 0): number => hour * 60 + minute;

describe('the ambient beds (SPEC.md 2.12)', () => {
  it('has birds at dawn, the street by day and insects at night', () => {
    const dawn = bedLevels(at(6), 0);
    expect(dawn.birds).toBe(1);
    expect(dawn.insects).toBe(0);

    const noon = bedLevels(at(12), 0);
    expect(noon.street).toBe(1);
    expect(noon.insects).toBe(0);
    expect(noon.birds).toBeLessThan(0.5);

    const night = bedLevels(at(23), 0);
    expect(night.insects).toBe(1);
    expect(night.street).toBe(0);
    expect(night.birds).toBe(0);
  });

  it('crossfades rather than cuts', () => {
    const levels = [at(4, 30), at(7, 15), at(20)].map((minute) => bedLevels(minute, 0));
    expect(levels[0].insects).toBeGreaterThan(0);
    expect(levels[0].insects).toBeLessThan(1);
    expect(levels[1].street).toBeGreaterThan(0);
    expect(levels[1].street).toBeLessThan(1);
    expect(levels[2].insects).toBeGreaterThan(0);
    expect(levels[2].street).toBeGreaterThan(0);
  });

  it('lets the rain in and thins out the birds and the insects', () => {
    expect(bedLevels(at(12), 0).rain).toBe(0);
    expect(bedLevels(at(12), 1).rain).toBe(1);
    expect(bedLevels(at(6), 1).birds).toBeLessThan(0.2);
    expect(bedLevels(at(23), 1).insects).toBeLessThan(0.3);
  });
});
