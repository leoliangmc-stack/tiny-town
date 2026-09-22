import { describe, expect, it } from 'vitest';

import {
  GAME_MINUTES_PER_TICK,
  MINUTES_PER_GAME_DAY,
  SPEED_LEVELS,
  START_DAY,
  START_MINUTE_OF_DAY,
  TICKS_PER_GAME_DAY,
  type SpeedLevel,
} from '../src/simulation/constants.js';
import { TickScheduler } from '../src/simulation/TickScheduler.js';
import { World } from '../src/simulation/World.js';

const DAYS_TO_RUN = 30;
const FRAME_SECONDS = 1 / 60;

/**
 * Runs a world through the same frame loop the renderer uses, but with no
 * renderer attached and with fake frame times.
 */
function runFrames(world: World, speed: SpeedLevel, frames: number): void {
  const scheduler = new TickScheduler(speed);
  for (let i = 0; i < frames; i += 1) {
    world.tickMany(scheduler.ticksForFrame(FRAME_SECONDS));
  }
}

describe('headless run', () => {
  it('runs 30 game days with no renderer attached', () => {
    const world = new World({ seed: 'headless-30-days' });

    world.tickMany(TICKS_PER_GAME_DAY * DAYS_TO_RUN);

    expect(world.time.day).toBe(START_DAY + DAYS_TO_RUN);
    expect(world.time.minuteOfDay).toBeCloseTo(START_MINUTE_OF_DAY, 6);
    expect(world.time.totalGameMinutes).toBeCloseTo(MINUTES_PER_GAME_DAY * DAYS_TO_RUN, 6);
  });

  it('runs 30 game days through the frame loop at 100x', () => {
    const world = new World({ seed: 'headless-30-days' });
    const speed = 100;
    const realSecondsNeeded = (MINUTES_PER_GAME_DAY * DAYS_TO_RUN) / speed;

    runFrames(world, speed, Math.ceil(realSecondsNeeded / FRAME_SECONDS));

    expect(world.time.day).toBeGreaterThanOrEqual(START_DAY + DAYS_TO_RUN);
  });
});

describe('speed levels', () => {
  it.each(SPEED_LEVELS.filter((speed): speed is Exclude<SpeedLevel, 0> => speed !== 0))(
    'advances the clock one game minute per real second per speed step at %sx',
    (speed) => {
      const world = new World();
      const realSeconds = 60;
      const expected = realSeconds * speed;

      runFrames(world, speed, realSeconds * 60);

      // The clock moves in whole ticks, so the last partial tick is still due.
      expect(world.time.totalGameMinutes).toBeGreaterThan(expected - 2 * GAME_MINUTES_PER_TICK);
      expect(world.time.totalGameMinutes).toBeLessThanOrEqual(expected);
    },
  );

  it('does not advance the clock while paused', () => {
    const world = new World();

    runFrames(world, 0, 600);

    expect(world.time.totalTicks).toBe(0);
  });

  it('reaches the same clock at 1x and at 100x for the same tick count', () => {
    const slow = new World({ seed: 'determinism' });
    const fast = new World({ seed: 'determinism' });

    runFrames(slow, 1, 60 * 60);
    fast.tickMany(slow.time.totalTicks);

    expect(fast.time.format()).toBe(slow.time.format());
    expect(fast.time.totalTicks).toBe(slow.time.totalTicks);
  });
});
