import {
  GAME_MINUTES_PER_TICK,
  MINUTES_PER_GAME_DAY,
  START_DAY,
  START_MINUTE_OF_DAY,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_MINUTE,
} from './constants.js';

/** A readable snapshot of the game clock. */
export interface TimeOfDay {
  day: number;
  hour: number;
  minute: number;
}

/**
 * The game clock. It only ever moves one fixed tick at a time, so the clock is
 * identical for a given tick count no matter how fast the frames came in.
 */
export class TimeSystem {
  /** Ticks elapsed since the start of the run. */
  private elapsedTicks = 0;

  /** Ticks elapsed within the current day, counted from 00:00. */
  private get ticksIntoDay(): number {
    return (START_MINUTE_OF_DAY * TICKS_PER_GAME_MINUTE + this.elapsedTicks) % TICKS_PER_GAME_DAY;
  }

  /** Advances the clock by exactly one tick. */
  tick(): void {
    this.elapsedTicks += 1;
  }

  get totalTicks(): number {
    return this.elapsedTicks;
  }

  /** Game minutes elapsed since the start of the run. */
  get totalGameMinutes(): number {
    return this.elapsedTicks * GAME_MINUTES_PER_TICK;
  }

  /** Current day, starting at Day 1. */
  get day(): number {
    return (
      START_DAY +
      Math.floor(
        (START_MINUTE_OF_DAY * TICKS_PER_GAME_MINUTE + this.elapsedTicks) / TICKS_PER_GAME_DAY,
      )
    );
  }

  /** Minutes since midnight, with a fractional part inside the current minute. */
  get minuteOfDay(): number {
    return this.ticksIntoDay * GAME_MINUTES_PER_TICK;
  }

  get hour(): number {
    return Math.floor(this.minuteOfDay / 60);
  }

  get minute(): number {
    return Math.floor(this.minuteOfDay) % 60;
  }

  /** Where we are in the day as a 0..1 value, used by lighting later on. */
  get dayProgress(): number {
    return this.minuteOfDay / MINUTES_PER_GAME_DAY;
  }

  get timeOfDay(): TimeOfDay {
    return { day: this.day, hour: this.hour, minute: this.minute };
  }

  /** The clock as "Day 12 · 08:42". */
  format(): string {
    const hour = String(this.hour).padStart(2, '0');
    const minute = String(this.minute).padStart(2, '0');
    return `Day ${this.day} · ${hour}:${minute}`;
  }
}
