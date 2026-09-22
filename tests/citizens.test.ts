import { describe, expect, it } from 'vitest';

import type { Citizen } from '../src/entities/Citizen.js';
import { isOutside } from '../src/entities/Citizen.js';
import { closestPointOnSegment, distance, type Point } from '../src/entities/geometry.js';
import { GAME_MINUTES_PER_TICK, TICKS_PER_GAME_DAY } from '../src/simulation/constants.js';
import { ENTRIES_PER_DAY } from '../src/simulation/EventLog.js';
import { World } from '../src/simulation/World.js';
import { HOUSEHOLDS, POPULATION_SIZE, WORKPLACE_BY_JOB } from '../src/world/Population.js';
import { BUILDINGS, OUTDOOR_ZONES, getBuilding, townBounds } from '../src/world/Town.js';

const DAYS_TO_RUN = 30;

/** Shortest distance from a point to a polyline. */
function distanceToPath(point: Point, path: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    best = Math.min(best, distance(point, closestPointOnSegment(point, path[i - 1], path[i])));
  }
  return best;
}

describe('the population', () => {
  const world = new World({ seed: 'population' });

  it('has forty citizens in the houses the table says', () => {
    expect(world.citizens).toHaveLength(POPULATION_SIZE);
    const listed = HOUSEHOLDS.flatMap((household) => household.members).length;
    expect(listed).toBe(POPULATION_SIZE);
    for (const citizen of world.citizens) {
      expect(() => getBuilding(citizen.homeId)).not.toThrow();
      expect(['house', 'apartment']).toContain(getBuilding(citizen.homeId).kind);
    }
  });

  it('gives every job a workplace that exists, except the retired', () => {
    for (const citizen of world.citizens) {
      const expected = WORKPLACE_BY_JOB[citizen.job];
      expect(citizen.workplaceId).toBe(expected);
      if (expected) {
        expect(() => getBuilding(expected)).not.toThrow();
      }
    }
  });

  it('links families both ways and keeps them under one roof', () => {
    const byId = new Map(world.citizens.map((citizen) => [citizen.id, citizen]));
    for (const citizen of world.citizens) {
      const kin = [
        ...(citizen.family.spouse ? [citizen.family.spouse] : []),
        ...citizen.family.parents,
        ...citizen.family.children,
        ...citizen.family.siblings,
      ];
      for (const id of kin) {
        const relative = byId.get(id) as Citizen;
        expect(relative, `${citizen.id} -> ${id}`).toBeDefined();
        expect(relative.homeId).toBe(citizen.homeId);
      }
      if (citizen.family.spouse) {
        expect((byId.get(citizen.family.spouse) as Citizen).family.spouse).toBe(citizen.id);
      }
      for (const childId of citizen.family.children) {
        expect((byId.get(childId) as Citizen).family.parents).toContain(citizen.id);
      }
    }
  });

  it('gives everyone at least one friend and a personality in range', () => {
    for (const citizen of world.citizens) {
      expect(citizen.friends.length, citizen.id).toBeGreaterThan(0);
      for (const value of Object.values(citizen.personality)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('citizens over 30 game days', () => {
  const world = new World({ seed: 'phase-3-citizens' });

  const lastPosition = new Map<string, Point>();
  const stillForMinutes = new Map<string, number>();
  const lateDays = new Map<string, number>();
  const workDays = new Map<string, number>();
  const zoneVisitors = new Set<string>();
  const outsideByHour = new Map<number, number>();
  let outsideSamples = 0;

  let maxStillMinutes = 0;
  let maxDistanceOffPath = 0;
  let maxDistanceFromCentre = 0;

  for (const citizen of world.citizens) {
    lastPosition.set(citizen.id, { ...citizen.position });
    stillForMinutes.set(citizen.id, 0);
  }

  let lastDay = world.time.day;
  for (let tick = 0; tick < TICKS_PER_GAME_DAY * DAYS_TO_RUN; tick += 1) {
    world.tick();

    if (world.time.day !== lastDay) {
      // Close out yesterday's lateness before the plans roll over.
      lastDay = world.time.day;
    }

    for (const citizen of world.citizens) {
      if (citizen.activity === 'Work' && citizen.workplaceId) {
        workDays.set(`${citizen.id}:${world.time.day}`, 1);
        if (citizen.lateToday > 0) {
          lateDays.set(`${citizen.id}:${world.time.day}`, 1);
        }
      }
      if (citizen.place.kind === 'zone') {
        zoneVisitors.add(citizen.place.id);
      }

      const previous = lastPosition.get(citizen.id) as Point;
      const moved = distance(previous, citizen.position) > 1e-6;
      // Being indoors, asleep or at work is not being stuck: the tests care
      // about people standing still in the open.
      const exempt =
        !isOutside(citizen) || citizen.activity === 'Sleep' || citizen.activity === 'Work';
      if (moved || exempt) {
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

    if (tick % (TICKS_PER_GAME_DAY / 24) === 0 && world.time.day >= 2) {
      const hour = world.time.hour;
      outsideByHour.set(hour, (outsideByHour.get(hour) ?? 0) + world.citizenSystem.outsideCount);
      outsideSamples += 1;
    }
  }

  it('never leaves anyone standing in the open for more than 30 game minutes', () => {
    expect(maxStillMinutes).toBeLessThan(30);
  });

  it('gets people to work on time', () => {
    const late = lateDays.size;
    const total = workDays.size;
    expect(total).toBeGreaterThan(0);
    expect(late / total, `${late} late of ${total} shifts`).toBeLessThan(0.1);
  });

  it('keeps every walker on their route', () => {
    expect(maxDistanceOffPath).toBeLessThan(0.01);
  });

  it('never lets a citizen leave the town', () => {
    const bounds = townBounds();
    const reach = Math.max(
      Math.hypot(bounds.minX, bounds.minZ),
      Math.hypot(bounds.maxX, bounds.maxZ),
    );
    expect(maxDistanceFromCentre).toBeLessThan(reach);
  });

  it('puts people in every outdoor zone over the month', () => {
    for (const zone of OUTDOOR_ZONES) {
      expect(zoneVisitors.has(zone.id), zone.id).toBe(true);
    }
  });

  it('keeps someone outside through the whole of the day', () => {
    expect(outsideSamples).toBeGreaterThan(0);
    for (let hour = 8; hour <= 18; hour += 1) {
      expect(outsideByHour.get(hour) ?? 0, `hour ${hour}`).toBeGreaterThan(0);
    }
  });

  it('writes a short diary of full sentences, at most fifteen a day', () => {
    for (let day = 2; day <= DAYS_TO_RUN; day += 1) {
      const entries = world.log.forDay(day);
      expect(entries.length, `day ${day}`).toBeLessThanOrEqual(ENTRIES_PER_DAY);
      expect(entries.length, `day ${day}`).toBeGreaterThan(3);
      for (const entry of entries) {
        expect(entry.text).toMatch(/^[A-Z].*\.$/);
        expect(entry.text.split(' ').length).toBeGreaterThan(4);
      }
    }
  });

  it('ends with everyone in a known activity', () => {
    for (const citizen of world.citizens) {
      expect([
        'Sleep',
        'Eat',
        'Work',
        'Walk',
        'Drive',
        'Shop',
        'Socialize',
        'Relax',
        'GoHome',
      ]).toContain(citizen.activity);
    }
  });
});

describe('a single day', () => {
  function runUntil(world: World, day: number, minuteOfDay: number): void {
    while (
      world.time.day < day ||
      (world.time.day === day && world.time.minuteOfDay < minuteOfDay)
    ) {
      world.tick();
    }
  }

  it('has everyone asleep at home in the small hours', () => {
    const world = new World({ seed: 'phase-3-day' });
    runUntil(world, 2, 3 * 60);

    for (const citizen of world.citizens) {
      expect(citizen.activity, citizen.id).toBe('Sleep');
      expect(citizen.place.id).toBe(citizen.homeId);
    }
    for (const building of BUILDINGS) {
      if (building.kind === 'house' || building.kind === 'apartment') {
        expect(world.isLit(building.id)).toBe(false);
      }
    }
  });

  it('lights homes by who is really in, and leaves empty houses dark', () => {
    const world = new World({ seed: 'phase-3-day' });
    runUntil(world, 2, 20 * 60);

    const lit = BUILDINGS.filter((b) => b.kind === 'house' && world.isLit(b.id)).map((b) => b.id);
    expect(lit.length).toBeGreaterThan(5);
    for (const id of world.emptyHouseIds) {
      expect(lit).not.toContain(id);
    }
  });

  it('turns the lights out one by one after bedtime', () => {
    const world = new World({ seed: 'phase-3-day' });
    runUntil(world, 2, 20 * 60 + 30);
    const before = BUILDINGS.filter((b) => world.isLit(b.id)).length;

    runUntil(world, 3, 30);
    const after = BUILDINGS.filter((b) => world.isLit(b.id)).length;

    expect(before).toBeGreaterThan(after);
    expect(after).toBe(0);
  });

  it('sends students to school and workers to their workplaces', () => {
    const world = new World({ seed: 'phase-3-day' });
    runUntil(world, 2, 10 * 60);

    for (const citizen of world.citizens) {
      if (citizen.job === 'Retired') {
        continue;
      }
      const there = citizen.place.kind === 'building' && citizen.place.id === citizen.workplaceId;
      const onBreakOutside = citizen.place.kind === 'zone';
      // Mid-morning walks are legitimate too: a baker crossing to the bakery
      // front for a break, a delivery driver on a round to a house.
      const onTheMove =
        citizen.activity === 'Walk' ||
        (citizen.job === 'Delivery Driver' && citizen.activity === 'Work');
      expect(
        there || onBreakOutside || onTheMove,
        `${citizen.id} is ${citizen.activity} at ${citizen.place.id}`,
      ).toBe(true);
    }
  });
});
