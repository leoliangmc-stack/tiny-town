/**
 * The town's diary (SPEC.md 2.10).
 *
 * Only causes and milestones go in, each as one full sentence, and no more than
 * about fifteen a day. Small things (a lunch outside, a walk in the park) are
 * kept only while the day still has room; things that changed somebody's day
 * (arriving late, running into a friend) always go in.
 */

export interface LogEntry {
  day: number;
  /** Minute of the day the entry was written. */
  minute: number;
  text: string;
}

/**
 * `colour` fills the day while there is room, `milestone` always fits until
 * the day is full, `always` is for the one or two lines a day must not lose.
 */
export type Priority = 'milestone' | 'colour' | 'always';

export const ENTRIES_PER_DAY = 15;

/** Colour entries stop once the day has this many, leaving room for milestones. */
const COLOUR_CAP = 7;

export class EventLog {
  readonly entries: LogEntry[] = [];
  private countToday = 0;
  private day = 0;

  record(day: number, minute: number, text: string, priority: Priority = 'milestone'): void {
    if (day !== this.day) {
      this.day = day;
      this.countToday = 0;
    }
    const cap = priority === 'colour' ? COLOUR_CAP : ENTRIES_PER_DAY;
    if (priority !== 'always' && this.countToday >= cap) {
      return;
    }
    this.entries.push({ day, minute, text });
    this.countToday += 1;
  }

  forDay(day: number): LogEntry[] {
    return this.entries.filter((entry) => entry.day === day);
  }

  /** "Day 3 · 08:42  Tom arrived at the bakery ten minutes late." */
  format(entry: LogEntry): string {
    const hour = String(Math.floor(entry.minute / 60)).padStart(2, '0');
    const minute = String(Math.floor(entry.minute) % 60).padStart(2, '0');
    return `Day ${entry.day} · ${hour}:${minute}  ${entry.text}`;
  }
}

/** "eleven minutes", "one minute": numbers read better as words in a diary. */
export function minutesInWords(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes));
  const words = [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
  ];
  const number = whole <= 20 ? words[whole - 1] : String(whole);
  return `${number} minute${whole === 1 ? '' : 's'}`;
}

/** "05:12" from a minute of the day. */
export function clockWords(minute: number): string {
  const hour = String(Math.floor(minute / 60)).padStart(2, '0');
  const rest = String(Math.floor(minute) % 60).padStart(2, '0');
  return `${hour}:${rest}`;
}
