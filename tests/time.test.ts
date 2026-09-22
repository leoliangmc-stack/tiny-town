import { describe, expect, it } from 'vitest';

import {
  MAX_TICKS_PER_FRAME,
  START_DAY,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_MINUTE,
} from '../src/simulation/constants.js';
import { TickScheduler } from '../src/simulation/TickScheduler.js';
import { TimeSystem } from '../src/simulation/TimeSystem.js';

describe('TimeSystem', () => {
  it('starts at Day 1, 05:30', () => {
    const time = new TimeSystem();

    expect(time.day).toBe(START_DAY);
    expect(time.hour).toBe(5);
    expect(time.minute).toBe(30);
    expect(time.format()).toBe('Day 1 · 05:30');
  });

  it('rolls over to the next day at midnight', () => {
    const time = new TimeSystem();
    const ticksUntilMidnight = (24 * 60 - (5 * 60 + 30)) * TICKS_PER_GAME_MINUTE;

    for (let i = 0; i < ticksUntilMidnight - 1; i += 1) {
      time.tick();
    }
    expect(time.day).toBe(START_DAY);
    expect(time.hour).toBe(23);

    time.tick();
    expect(time.day).toBe(START_DAY + 1);
    expect(time.hour).toBe(0);
    expect(time.minute).toBe(0);
  });

  it('reports day progress between 0 and 1', () => {
    const time = new TimeSystem();

    for (let i = 0; i < TICKS_PER_GAME_DAY; i += TICKS_PER_GAME_MINUTE) {
      expect(time.dayProgress).toBeGreaterThanOrEqual(0);
      expect(time.dayProgress).toBeLessThan(1);
      for (let tick = 0; tick < TICKS_PER_GAME_MINUTE; tick += 1) {
        time.tick();
      }
    }
  });
});

describe('TickScheduler', () => {
  it('carries leftover frame time into the next frame', () => {
    const scheduler = new TickScheduler(1);

    // One tick is 0.1 real seconds at 1x, so a 60 fps frame earns less than one.
    expect(scheduler.ticksForFrame(1 / 60)).toBe(0);

    let ticks = 0;
    for (let i = 0; i < 60; i += 1) {
      ticks += scheduler.ticksForFrame(1 / 60);
    }

    expect(ticks).toBe(10);
  });

  it('runs no ticks while paused', () => {
    const scheduler = new TickScheduler(0);

    expect(scheduler.isPaused).toBe(true);
    expect(scheduler.ticksForFrame(1)).toBe(0);
  });

  it('caps the catch-up burst after a long stall', () => {
    const scheduler = new TickScheduler(100);

    expect(scheduler.ticksForFrame(60)).toBe(MAX_TICKS_PER_FRAME);
  });

  it('ignores zero and negative frame times', () => {
    const scheduler = new TickScheduler(20);

    expect(scheduler.ticksForFrame(0)).toBe(0);
    expect(scheduler.ticksForFrame(-1)).toBe(0);
  });
});
