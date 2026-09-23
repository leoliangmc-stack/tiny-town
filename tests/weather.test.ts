import { mkdirSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isOutside } from '../src/entities/Citizen.js';
import { distance, type Point } from '../src/entities/geometry.js';
import {
  GAME_MINUTES_PER_TICK,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_MINUTE,
} from '../src/simulation/constants.js';
import { World } from '../src/simulation/World.js';

/**
 * SPEC.md 2.8: the weather must change what people do, not just how the town
 * looks. Rain empties the outdoors, sends the sociable to the cafe, and the
 * diary says why.
 */

/** Ticks from the run's start (Day 1 05:30) to a clock time on a day. */
function tickAt(day: number, hour: number, minute = 0): number {
  return ((day - 1) * 24 * 60 + hour * 60 + minute - (5 * 60 + 30)) * TICKS_PER_GAME_MINUTE;
}

function runTo(world: World, tick: number): void {
  while (world.time.totalTicks < tick) {
    world.tick();
  }
}

describe('rain', () => {
  it('empties the outdoors within thirty minutes', () => {
    const control = new World({ seed: 'weather' });
    const rainy = new World({ seed: 'weather' });
    runTo(control, tickAt(2, 10));
    runTo(rainy, tickAt(2, 10));
    expect(rainy.stateHash()).toBe(control.stateHash());

    rainy.setWeather('Rain');
    runTo(control, tickAt(2, 10, 30));
    runTo(rainy, tickAt(2, 10, 30));

    // In the open: on the streets and in the park, not under the cafe's
    // awning and not in a car, which is where the rain sends people.
    const openControl = control.citizenSystem.inTheOpenCount;
    const openRainy = rainy.citizenSystem.inTheOpenCount;
    expect(openControl).toBeGreaterThan(5);
    expect(openRainy).toBeLessThanOrEqual(openControl * 0.6);
  });

  it('sends the sociable to the cafe and the rest home, and says so', () => {
    const world = new World({ seed: 'weather' });
    runTo(world, tickAt(2, 10));
    world.setWeather('Rain');
    runTo(world, tickAt(2, 11));

    const texts = world.log.forDay(2).map((entry) => entry.text);
    expect(texts.some((text) => text.startsWith('Rain set in over the town'))).toBe(true);
    expect(texts.some((text) => /because of the rain/i.test(text))).toBe(true);
    // Nobody is left standing in the park once the hardy have been counted.
    const inPark = world.citizens.filter(
      (citizen) =>
        citizen.place.kind === 'zone' &&
        citizen.place.id === 'park-lawn' &&
        citizen.personality.outdoorPreference < 80,
    );
    expect(inPark).toHaveLength(0);
  });

  it('is in the state hash', () => {
    const a = new World({ seed: 'weather' });
    const b = new World({ seed: 'weather' });
    b.setWeather('Cloudy');
    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});

describe('thirty days with rain every third day', () => {
  const world = new World({ seed: 'weather-month' });
  const DAYS = 30;
  const lastPosition = new Map<string, Point>();
  const stillFor = new Map<string, number>();
  let maxStill = 0;
  let maxFromCentre = 0;
  for (const citizen of world.citizens) {
    lastPosition.set(citizen.id, { ...citizen.position });
    stillFor.set(citizen.id, 0);
  }

  for (let tick = 0; tick < TICKS_PER_GAME_DAY * DAYS; tick += 1) {
    world.tick();
    const { day, minuteOfDay } = world.time;
    if (day % 3 === 0) {
      if (minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 15 * 60 + 30) {
        world.setWeather('Rain');
      } else if (minuteOfDay >= 15 * 60 + 30) {
        world.setWeather('Cloudy');
      }
    } else if (day % 3 === 1 && minuteOfDay >= 8 * 60) {
      world.setWeather('Sunny');
    }

    for (const citizen of world.citizens) {
      const previous = lastPosition.get(citizen.id) as Point;
      const moved = distance(previous, citizen.position) > 1e-6;
      const exempt =
        !isOutside(citizen) || citizen.activity === 'Sleep' || citizen.activity === 'Work';
      if (moved || exempt) {
        lastPosition.set(citizen.id, { ...citizen.position });
        stillFor.set(citizen.id, 0);
      } else {
        const still = (stillFor.get(citizen.id) ?? 0) + GAME_MINUTES_PER_TICK;
        stillFor.set(citizen.id, still);
        maxStill = Math.max(maxStill, still);
      }
      maxFromCentre = Math.max(maxFromCentre, Math.hypot(citizen.position.x, citizen.position.z));
    }
  }

  const rainyEntries = world.log.entries.filter((entry) => entry.day % 3 === 0);

  it('writes at least one line that blames the rain', () => {
    expect(rainyEntries.some((entry) => /because of the rain/i.test(entry.text))).toBe(true);
  });

  it('has two people meet at the cafe because of the rain at least once a month', () => {
    expect(
      rainyEntries.some((entry) => /driven in by the rain|in out of the rain/.test(entry.text)),
    ).toBe(true);
  });

  it('never leaves anyone standing in the open or off the map', () => {
    expect(maxStill).toBeLessThan(30);
    expect(maxFromCentre).toBeLessThan(140);
  });

  it('can write a rainy day out for the author', () => {
    if (!process.env.TINY_TOWN_DUMP_LOG) {
      return;
    }
    const day = 6;
    const lines = world.log.forDay(day).map((entry) => world.log.format(entry));
    mkdirSync('docs', { recursive: true });
    writeFileSync(`docs/phase-5-eventlog-rainy-day${day}.txt`, `${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(5);
  });
});
