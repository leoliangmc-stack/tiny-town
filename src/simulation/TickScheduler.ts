import {
  DEFAULT_SPEED,
  MAX_TICKS_PER_FRAME,
  REAL_SECONDS_PER_TICK_AT_1X,
  type SpeedLevel,
} from './constants.js';

/**
 * Turns real frame time into a whole number of simulation ticks.
 *
 * This is the only place where real time meets game time. A faster speed means
 * more ticks per frame; the tick itself is always the same size, so the
 * simulation cannot tell 1x from 100x (SPEC.md 3.2).
 */
export class TickScheduler {
  private speed: SpeedLevel = DEFAULT_SPEED;

  /** Unspent frame time, already scaled by speed, in 1x real seconds. */
  private accumulator = 0;

  constructor(speed: SpeedLevel = DEFAULT_SPEED) {
    this.speed = speed;
  }

  getSpeed(): SpeedLevel {
    return this.speed;
  }

  setSpeed(speed: SpeedLevel): void {
    this.speed = speed;
  }

  get isPaused(): boolean {
    return this.speed === 0;
  }

  /**
   * Returns how many ticks this frame should run for the given real delta in
   * seconds. Leftover time is carried into the next frame so the long run rate
   * stays exact.
   */
  ticksForFrame(deltaSeconds: number): number {
    if (this.speed === 0 || deltaSeconds <= 0) {
      return 0;
    }

    this.accumulator += deltaSeconds * this.speed;

    let ticks = Math.floor(this.accumulator / REAL_SECONDS_PER_TICK_AT_1X);
    this.accumulator -= ticks * REAL_SECONDS_PER_TICK_AT_1X;

    if (ticks > MAX_TICKS_PER_FRAME) {
      // A long stall (backgrounded tab, slow first frame) would otherwise queue
      // a catch-up burst the frame can never work through. Drop the backlog.
      ticks = MAX_TICKS_PER_FRAME;
      this.accumulator = 0;
    }

    return ticks;
  }

  /** Throws away unspent frame time, for example after a tab regains focus. */
  reset(): void {
    this.accumulator = 0;
  }
}
