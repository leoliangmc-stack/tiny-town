import { describe, expect, it } from 'vitest';

import { TICKS_PER_GAME_MINUTE } from '../src/simulation/constants.js';
import { World } from '../src/simulation/World.js';
import {
  describeActivity,
  describeFamily,
  describeFriends,
  describeHome,
  nextWeather,
  weatherGlyph,
} from '../src/ui/phrases.js';

/**
 * SPEC.md Test 4: the panel must say what the citizen is really doing, in
 * words a person reads, with no ids or state in them.
 */

/** Runs on to a clock time on a day; the run starts on Day 1 at 05:30. */
function runTo(world: World, day: number, hour: number, minute = 0): void {
  const target = ((day - 1) * 24 * 60 + hour * 60 + minute - (5 * 60 + 30)) * TICKS_PER_GAME_MINUTE;
  while (world.time.totalTicks < target) {
    world.tick();
  }
}

describe('the words the panel uses', () => {
  const world = new World({ seed: 'ui' });
  const find = (id: string) => world.citizenSystem.find(id);

  it('says what everyone is doing, all day, without leaking an id', () => {
    for (const [hour, minute] of [
      [5, 30],
      [8, 45],
      [12, 40],
      [17, 30],
      [22, 45],
    ]) {
      runTo(world, 1, hour, minute);
      for (const citizen of world.citizens) {
        const line = describeActivity(citizen);
        expect(line.length).toBeGreaterThan(4);
        expect(line).not.toMatch(/house-\d|apartment-\d|-lawn|-terrace|undefined/);
        expect(line.charAt(0)).toBe(line.charAt(0).toUpperCase());
      }
    }
  });

  it('matches the activity the simulation holds', () => {
    runTo(world, 2, 3, 0);
    const asleep = world.citizens.find((citizen) => citizen.activity === 'Sleep');
    expect(asleep).toBeDefined();
    expect(describeActivity(asleep!)).toBe('Asleep at home');

    runTo(world, 2, 10, 30);
    const working = world.citizens.find(
      (citizen) =>
        citizen.activity === 'Work' &&
        citizen.job !== 'Student' &&
        citizen.place.id === citizen.workplaceId,
    );
    expect(working).toBeDefined();
    expect(describeActivity(working!)).toMatch(/^Working at /);
    const walking = world.citizens.find((citizen) => citizen.activity === 'Walk');
    if (walking) {
      expect(describeActivity(walking)).toMatch(/^Walking to /);
    }
  });

  it('names family and friends, and the home by its name', () => {
    const withFamily = world.citizens.find((citizen) => citizen.family.spouse);
    expect(withFamily).toBeDefined();
    const family = describeFamily(withFamily!, find);
    expect(family).toMatch(/^(Wife|Husband) [A-Z]/);
    const spouseName = find(withFamily!.family.spouse!)!.name;
    expect(family).toContain(spouseName);

    const alone = world.citizens.find(
      (citizen) =>
        !citizen.family.spouse &&
        citizen.family.parents.length === 0 &&
        citizen.family.children.length === 0 &&
        citizen.family.siblings.length === 0,
    );
    if (alone) {
      expect(describeFamily(alone, find)).toBe('Lives alone');
    }

    for (const citizen of world.citizens) {
      expect(describeHome(citizen)).toMatch(/House|Court$/);
      expect(describeFriends(citizen, find)).not.toMatch(/[a-z]+-\d/);
    }
  });

  it('cycles the weather and has a glyph for each', () => {
    expect(nextWeather('Sunny')).toBe('Cloudy');
    expect(nextWeather('Cloudy')).toBe('Rain');
    expect(nextWeather('Rain')).toBe('Sunny');
    expect(new Set(['Sunny', 'Cloudy', 'Rain'].map((w) => weatherGlyph(w as never))).size).toBe(3);
  });
});
