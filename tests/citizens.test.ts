import { describe, expect, it } from 'vitest';

import type { Citizen } from '../src/entities/Citizen.js';
import { closestPointOnSegment, distance, type Point } from '../src/entities/geometry.js';
import {
  GAME_MINUTES_PER_TICK,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_MINUTE,
} from '../src/simulation/constants.js';
import { World } from '../src/simulation/World.js';
import { BUILDINGS } from '../src/world/Town.js';
import { RESIDENTS } from '../src/world/Population.js';

const DAYS_TO_RUN = 30;

/** Shortest distance from a point to a polyline. */
function distanceToPath(point: Point, path: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    best = Math.min(best, distance(point, closestPointOnSegment(point, path[i - 1], path[i])));
  }
  return best;
}

/** Activities where standing still is the whole point. */
function isStationaryOnPurpose(citizen: Citizen): boolean {
  return (
    citizen.activity === 'Sleep' || citizen.activity === 'AtHome' || citizen.activity === 'AtCafe'
  );
}

describe('citizens over 30 game days', () => {
  const world = new World({ seed: 'phase-1-citizens' });

  const lastPosition = new Map<string, Point>();
  const stillForMinutes = new Map<string, number>();
  const cafeVisitsPerDay = new Map<string, Set<number>>();

  let maxStillMinutes = 0;
  let maxDistanceOffPath = 0;
  let maxDistanceFromCentre = 0;

  for (const citizen of world.citizens) {
    lastPosition.set(citizen.id, { ...citizen.position });
    stillForMinutes.set(citizen.id, 0);
    cafeVisitsPerDay.set(citizen.id, new Set());
  }

  for (let tick = 0; tick < TICKS_PER_GAME_DAY * DAYS_TO_RUN; tick += 1) {
    world.tick();

    for (const citizen of world.citizens) {
      if (citizen.activity === 'AtCafe') {
        cafeVisitsPerDay.get(citizen.id)?.add(world.time.day);
      }

      const previous = lastPosition.get(citizen.id) as Point;
      const moved = distance(previous, citizen.position) > 1e-6;
      if (moved || isStationaryOnPurpose(citizen)) {
        lastPosition.set(citizen.id, { ...citizen.position });
        stillForMinutes.set(citizen.id, 0);
      } else {
        const still = (stillForMinutes.get(citizen.id) ?? 0) + GAME_MINUTES_PER_TICK;
        stillForMinutes.set(citizen.id, still);
        maxStillMinutes = Math.max(maxStillMinutes, still);
      }

      if (citizen.path.length > 1) {
        maxDistanceOffPath = Math.max(
          maxDistanceOffPath,
          distanceToPath(citizen.position, citizen.path),
        );
      }
      maxDistanceFromCentre = Math.max(
        maxDistanceFromCentre,
        Math.hypot(citizen.position.x, citizen.position.z),
      );
    }
  }

  it('keeps every citizen moving while they are outside', () => {
    expect(maxStillMinutes).toBeLessThan(30);
  });

  it('keeps every citizen on their route', () => {
    expect(maxDistanceOffPath).toBeLessThan(0.01);
  });

  it('never lets a citizen leave the town', () => {
    expect(maxDistanceFromCentre).toBeLessThan(50);
    for (const citizen of world.citizens) {
      expect(Number.isFinite(citizen.position.x)).toBe(true);
      expect(Number.isFinite(citizen.position.z)).toBe(true);
    }
  });

  it('sends everyone to the cafe on every day of the run', () => {
    for (const citizen of world.citizens) {
      // The first day starts at 05:30, so day 1 is a full day for everyone.
      expect(cafeVisitsPerDay.get(citizen.id)?.size).toBe(DAYS_TO_RUN);
    }
  });

  it('ends the run with everyone accounted for', () => {
    expect(world.citizens).toHaveLength(RESIDENTS.length);
    for (const citizen of world.citizens) {
      expect(['Sleep', 'AtHome', 'WalkToCafe', 'AtCafe', 'WalkHome']).toContain(citizen.activity);
    }
  });
});

describe('a single day', () => {
  function runToMinute(minuteOfDay: number): World {
    const world = new World({ seed: 'phase-1-day' });
    while (world.time.minuteOfDay < minuteOfDay || world.time.day === 1) {
      world.tick();
      if (world.time.day === 2 && world.time.minuteOfDay >= minuteOfDay) {
        break;
      }
    }
    return world;
  }

  it('has everyone asleep at home in the small hours', () => {
    const world = runToMinute(3 * 60);

    for (const citizen of world.citizens) {
      expect(citizen.activity).toBe('Sleep');
    }
    for (const building of BUILDINGS) {
      expect(world.isLit(building.id)).toBe(false);
    }
  });

  it('lights a house once someone is home and awake', () => {
    const world = runToMinute(20 * 60);
    const litHouses = BUILDINGS.filter(
      (building) => building.kind === 'house' && world.isLit(building.id),
    );

    expect(litHouses.length).toBeGreaterThan(0);
  });

  it('turns the houses dark again one by one after bedtime', () => {
    const world = new World({ seed: 'phase-1-day' });
    const runUntil = (day: number, minuteOfDay: number): void => {
      while (world.time.day < day || world.time.minuteOfDay < minuteOfDay) {
        world.tick();
      }
    };

    // 21:30 on day 2 is before the earliest bedtime.
    runUntil(2, 21 * 60 + 30);
    const litBeforeBedtime = BUILDINGS.filter((b) => world.isLit(b.id)).length;

    runUntil(3, 30);
    const litAfterBedtime = BUILDINGS.filter((b) => world.isLit(b.id)).length;

    expect(litBeforeBedtime).toBeGreaterThan(litAfterBedtime);
    expect(litAfterBedtime).toBe(0);
  });

  it('gives the same day the same result at any speed', () => {
    const slow = new World({ seed: 'determinism' });
    const fast = new World({ seed: 'determinism' });

    for (let i = 0; i < TICKS_PER_GAME_DAY; i += 1) {
      slow.tick();
    }
    for (let i = 0; i < TICKS_PER_GAME_DAY / TICKS_PER_GAME_MINUTE; i += 1) {
      fast.tickMany(TICKS_PER_GAME_MINUTE);
    }

    expect(JSON.stringify(fast.citizens)).toBe(JSON.stringify(slow.citizens));
  });
});
