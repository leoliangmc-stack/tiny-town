/**
 * Fixed-step simulation constants.
 *
 * The simulation always advances in whole ticks of the same size. Speed is
 * applied by running MORE ticks per frame, never by scaling the step size.
 * See SPEC.md 3.2.
 */

/** How many simulation ticks make up one game minute. */
export const TICKS_PER_GAME_MINUTE = 10;

/** Game minutes advanced by a single tick. */
export const GAME_MINUTES_PER_TICK = 1 / TICKS_PER_GAME_MINUTE;

/** Game minutes in one game day. */
export const MINUTES_PER_GAME_DAY = 24 * 60;

/** Ticks in one game day. */
export const TICKS_PER_GAME_DAY = MINUTES_PER_GAME_DAY * TICKS_PER_GAME_MINUTE;

/** At 1x speed one real second is one game minute (SPEC.md 2.2). */
export const GAME_MINUTES_PER_REAL_SECOND_AT_1X = 1;

/** Real seconds one tick consumes at 1x speed. */
export const REAL_SECONDS_PER_TICK_AT_1X =
  GAME_MINUTES_PER_TICK / GAME_MINUTES_PER_REAL_SECOND_AT_1X;

/** Speed multipliers offered to the viewer. 0 means paused. */
export const SPEED_LEVELS = [0, 1, 5, 20, 100] as const;

export type SpeedLevel = (typeof SPEED_LEVELS)[number];

/** Default speed on load: a whole day takes about 4.8 real minutes. */
export const DEFAULT_SPEED: SpeedLevel = 5;

/** The town always starts at Day 1, 05:30 (SPEC.md 2.2). */
export const START_DAY = 1;
export const START_MINUTE_OF_DAY = 5 * 60 + 30;

/**
 * Upper bound of ticks a single frame may run. It keeps a long stall (a
 * backgrounded tab, a slow first frame) from queueing an unbounded catch-up
 * burst. At 100x and 60 fps a normal frame needs about 17 ticks.
 */
export const MAX_TICKS_PER_FRAME = 2000;
