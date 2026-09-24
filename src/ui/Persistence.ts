import type { App } from '../render/App.js';
import { parseSavedTown, type SavedTown } from '../simulation/SavedTown.js';

/**
 * Keeps the town between visits in the browser's local storage (SPEC.md
 * 2.13): the day, the time, the weather and the chosen speed, written every
 * few seconds and whenever the page is hidden or closed. Storage can be
 * missing or refuse a write (a private window, blocked site data); the town
 * then simply starts fresh next time.
 */

const STORAGE_KEY = 'tiny-town:save';
const SAVE_EVERY_MS = 5000;

/** The saved town, or nothing on a first visit or a damaged save. */
export function loadSavedTown(): SavedTown | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseSavedTown(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export class Persistence {
  /** Set while the town is being reset, so the reload does not save it again. */
  private resetting = false;

  constructor(private readonly app: App) {
    window.setInterval(() => this.save(), SAVE_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.save();
      }
    });
    window.addEventListener('pagehide', () => this.save());
  }

  save(): void {
    if (this.resetting) {
      return;
    }
    const { time, weather } = this.app.world;
    const save: SavedTown = {
      version: 1,
      day: time.day,
      minute: time.minuteOfDay,
      weather: weather.current,
      speed: this.app.chosenSpeed,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    } catch {
      // Nowhere to keep it; the next visit starts at Day 1 05:30.
    }
  }

  /** Forgets the town and starts again from Day 1 05:30 (SPEC.md 2.13). */
  reset(): void {
    this.resetting = true;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing was kept.
    }
    window.location.reload();
  }
}
