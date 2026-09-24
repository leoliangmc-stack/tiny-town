import { describe, expect, it } from 'vitest';

import { isOutside } from '../src/entities/Citizen.js';
import { START_DAY, START_MINUTE_OF_DAY } from '../src/simulation/constants.js';
import { parseSavedTown, RESTORE_FROM_MINUTE } from '../src/simulation/SavedTown.js';
import { World } from '../src/simulation/World.js';
import { townBounds } from '../src/world/Town.js';

const SAVE = { version: 1, day: 5, minute: 10 * 60 + 15, weather: 'Rain', speed: 20 } as const;

describe('the saved town (SPEC.md 2.13)', () => {
  it('reads a good save back', () => {
    expect(parseSavedTown(JSON.parse(JSON.stringify(SAVE)))).toEqual(SAVE);
  });

  it('ignores a damaged save, or one from another version', () => {
    expect(parseSavedTown(undefined)).toBeUndefined();
    expect(parseSavedTown('Day 5')).toBeUndefined();
    expect(parseSavedTown({ ...SAVE, version: 2 })).toBeUndefined();
    expect(parseSavedTown({ ...SAVE, day: 0 })).toBeUndefined();
    expect(parseSavedTown({ ...SAVE, day: 2.5 })).toBeUndefined();
    expect(parseSavedTown({ ...SAVE, minute: 24 * 60 })).toBeUndefined();
    expect(parseSavedTown({ ...SAVE, minute: Number.NaN })).toBeUndefined();
    expect(parseSavedTown({ ...SAVE, weather: 'Snow' })).toBeUndefined();
    expect(parseSavedTown({ ...SAVE, speed: 0 })).toBeUndefined();
  });

  it('starts a new run on Day 1 at 05:30 as before', () => {
    const world = new World();
    expect(world.time.day).toBe(START_DAY);
    expect(world.time.minuteOfDay).toBe(START_MINUTE_OF_DAY);
  });
});

describe('restoring a town (decision 41)', () => {
  it('comes back at the saved day, time and weather', () => {
    const world = World.restore(SAVE);
    expect(world.time.day).toBe(5);
    expect(world.time.minuteOfDay).toBeCloseTo(SAVE.minute, 6);
    expect(world.weather.current).toBe('Rain');
    // The weather was set, not changed: no "rain set in" line for a return.
    expect(world.log.entries.some((entry) => entry.text.startsWith('Rain set in'))).toBe(false);
  });

  it('puts the citizens where their day has taken them, with the day so far in the diary', () => {
    const world = World.restore({ day: 3, minute: 11 * 60, weather: 'Sunny' });
    const atWork = world.citizens.filter((citizen) => citizen.activity === 'Work');
    const asleep = world.citizens.filter((citizen) => citizen.activity === 'Sleep');
    expect(atWork.length).toBeGreaterThan(10);
    expect(asleep).toHaveLength(0);
    expect(world.log.entries.length).toBeGreaterThan(0);
    expect(world.log.entries.every((entry) => entry.day === 3)).toBe(true);

    const bounds = townBounds();
    const reach = Math.max(
      Math.hypot(bounds.minX, bounds.minZ),
      Math.hypot(bounds.maxX, bounds.maxZ),
    );
    for (const citizen of world.citizens) {
      expect(Math.hypot(citizen.position.x, citizen.position.z)).toBeLessThan(reach);
    }
  });

  it('always rebuilds the same town from the same save', () => {
    expect(World.restore(SAVE).stateHash()).toBe(World.restore(SAVE).stateHash());
  });

  it('starts the night before for a save made in the small hours', () => {
    const world = World.restore({ day: 4, minute: 1 * 60 + 30, weather: 'Cloudy' });
    expect(world.time.day).toBe(4);
    expect(world.time.minuteOfDay).toBeCloseTo(90, 6);
    expect(world.citizens.every((citizen) => !isOutside(citizen))).toBe(true);
    expect(RESTORE_FROM_MINUTE).toBeGreaterThan(90);
  });

  it('keeps living after a restore', () => {
    const world = World.restore(SAVE);
    const before = world.time.day;
    world.tickMany(10 * 60 * 24);
    expect(world.time.day).toBe(before + 1);
    expect(world.citizens.some((citizen) => isOutside(citizen))).toBe(true);
  });
});
