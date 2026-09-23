import { clockWords, type EventLog } from './EventLog.js';

/** The three weathers of v1 (SPEC.md 2.8). */
export type Weather = 'Sunny' | 'Cloudy' | 'Rain';

/**
 * The weather over the town (SPEC.md 2.8). It is set from outside, by the
 * viewer, and takes effect at once; the renderer eases the picture over a
 * few real seconds on its own. What it changes in the town is written into
 * the CitizenSystem's rules, which read `current` every tick.
 *
 * A change is one line in the diary, so the entries that follow ("because
 * of the rain...") have their cause on the page.
 */
export class WeatherSystem {
  current: Weather = 'Sunny';

  set(weather: Weather, log: EventLog, day: number, minute: number): void {
    if (weather === this.current) {
      return;
    }
    const before = this.current;
    this.current = weather;
    log.record(day, minute, weatherLine(before, weather, minute), 'always');
  }

  get isRaining(): boolean {
    return this.current === 'Rain';
  }
}

function weatherLine(from: Weather, to: Weather, minute: number): string {
  const at = clockWords(minute);
  if (to === 'Rain') {
    return `Rain set in over the town at ${at}.`;
  }
  if (from === 'Rain') {
    return to === 'Sunny'
      ? `The rain stopped and the sun came out at ${at}.`
      : `The rain eased off at ${at}, leaving a grey sky.`;
  }
  return to === 'Cloudy' ? `Clouds came over at ${at}.` : `The sun came out at ${at}.`;
}
