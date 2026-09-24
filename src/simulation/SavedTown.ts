import { START_DAY, type SpeedLevel } from './constants.js';
import type { Weather } from './WeatherSystem.js';

/**
 * What the town remembers between visits (SPEC.md 2.13): the day, the time,
 * the weather and the speed the viewer chose. Nothing about the citizens; they
 * are rebuilt from their schedules on the way back in.
 */
export interface SavedTown {
  version: 1;
  day: number;
  /** Minutes since midnight. */
  minute: number;
  weather: Weather;
  speed: Exclude<SpeedLevel, 0>;
}

/**
 * A restored town starts at this hour and is fast-forwarded to the saved
 * minute (decision 41): everybody is at home asleep, so the day plays out
 * from a clean start and the diary has the day so far in it.
 */
export const RESTORE_FROM_MINUTE = 3 * 60;

const WEATHERS: readonly Weather[] = ['Sunny', 'Cloudy', 'Rain'];
const SPEEDS: readonly number[] = [1, 5, 20, 100];

/** Reads a save back, or nothing if it is missing, from another version or damaged. */
export function parseSavedTown(value: unknown): SavedTown | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const save = value as Record<string, unknown>;
  const { version, day, minute, weather, speed } = save;
  if (version !== 1) {
    return undefined;
  }
  if (typeof day !== 'number' || !Number.isInteger(day) || day < START_DAY || day > 100_000) {
    return undefined;
  }
  if (typeof minute !== 'number' || !(minute >= 0 && minute < 24 * 60)) {
    return undefined;
  }
  if (typeof weather !== 'string' || !WEATHERS.includes(weather as Weather)) {
    return undefined;
  }
  if (typeof speed !== 'number' || !SPEEDS.includes(speed)) {
    return undefined;
  }
  return {
    version: 1,
    day,
    minute,
    weather: weather as Weather,
    speed: speed as SavedTown['speed'],
  };
}
