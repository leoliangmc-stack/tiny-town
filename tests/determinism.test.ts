import { describe, expect, it } from 'vitest';

import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_MINUTE } from '../src/simulation/constants.js';
import { TickScheduler } from '../src/simulation/TickScheduler.js';
import type { Weather } from '../src/simulation/WeatherSystem.js';
import { World } from '../src/simulation/World.js';

/**
 * SPEC.md 3.2 rule 3 and 5.3: the same seed must give the same world at 1x and
 * at 100x. Speed only changes how many ticks a frame runs, never what a tick
 * does, so the state hash at 23:59 has to match to the last bit.
 */

/** The weather scripted into the run, as [tick since start, weather]. */
const WEATHER_SCRIPT: Array<[number, Weather]> = [
  [(12 * 60 - 5 * 60 - 30) * TICKS_PER_GAME_MINUTE, 'Rain'],
  [(16 * 60 - 5 * 60 - 30) * TICKS_PER_GAME_MINUTE, 'Sunny'],
  [(24 * 60 + 9 * 60 - 5 * 60 - 30) * TICKS_PER_GAME_MINUTE, 'Cloudy'],
  [(24 * 60 + 14 * 60 - 5 * 60 - 30) * TICKS_PER_GAME_MINUTE, 'Rain'],
  [(24 * 60 + 18 * 60 - 5 * 60 - 30) * TICKS_PER_GAME_MINUTE, 'Sunny'],
];

/**
 * Runs the world through fake frames at the given speed until 23:59 of day
 * 2, changing the weather on the scripted ticks whatever the frame size.
 */
function runToLateEvening(speed: 1 | 100): World {
  const world = new World({ seed: 'determinism' });
  const scheduler = new TickScheduler(speed);
  const target = TICKS_PER_GAME_DAY * 2 - TICKS_PER_GAME_MINUTE; // 23:59 on day 2

  // Day 1 starts at 05:30, so tick counts are measured from the run start.
  const ticksNeeded = target - (5 * 60 + 30) * TICKS_PER_GAME_MINUTE;
  let scripted = 0;
  while (world.time.totalTicks < ticksNeeded) {
    const nextChange = WEATHER_SCRIPT[scripted]?.[0] ?? Infinity;
    if (world.time.totalTicks === nextChange) {
      world.setWeather(WEATHER_SCRIPT[scripted][1]);
      scripted += 1;
    }
    const limit = Math.min(ticksNeeded, nextChange) - world.time.totalTicks;
    const ticks = Math.min(scheduler.ticksForFrame(1 / 60), limit);
    world.tickMany(ticks);
  }
  return world;
}

describe('determinism', () => {
  it('gives the same world at 1x and 100x, to the hash', () => {
    const slow = runToLateEvening(1);
    const fast = runToLateEvening(100);

    expect(slow.time.format()).toBe('Day 2 · 23:59');
    expect(fast.time.format()).toBe(slow.time.format());
    expect(fast.stateHash()).toBe(slow.stateHash());
    expect(fast.log.entries).toEqual(slow.log.entries);
    // The script really ran: the diary has the rain in it.
    expect(slow.log.entries.some((entry) => entry.text.startsWith('Rain set in'))).toBe(true);
  });

  it('changes with the seed', () => {
    const a = new World({ seed: 'one' });
    const b = new World({ seed: 'two' });
    a.tickMany(TICKS_PER_GAME_DAY);
    b.tickMany(TICKS_PER_GAME_DAY);

    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});
