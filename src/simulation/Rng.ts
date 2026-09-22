/**
 * Seeded random number generator.
 *
 * Every random choice in the simulation must come from one of these, so that
 * the same seed always produces the same town (SPEC.md 3.2).
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // A zero state would make the generator stick, so nudge it away from it.
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }

  /** Next float in [0, 1). */
  next(): number {
    // mulberry32: small, fast, and good enough for gameplay randomness.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next float in [min, max). */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Next integer in [min, max], both ends included. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability, where 0 never happens and 1 always does. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** One item of a non-empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Rng.pick needs a non-empty list');
    }
    return items[this.nextInt(0, items.length - 1)];
  }

  /**
   * A named child generator. Systems take their own stream so that adding a
   * random call in one system does not shift the numbers another system gets.
   */
  fork(label: string): Rng {
    return new Rng((this.state ^ hashString(label)) >>> 0);
  }
}

/** Turns a seed string into a 32 bit number. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
