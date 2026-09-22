import { describe, expect, it } from 'vitest';

import { Rng } from '../src/simulation/Rng.js';

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const first = new Rng('tiny-town');
    const second = new Rng('tiny-town');

    const a = Array.from({ length: 100 }, () => first.next());
    const b = Array.from({ length: 100 }, () => second.next());

    expect(a).toEqual(b);
  });

  it('produces a different sequence for a different seed', () => {
    const a = new Rng('tiny-town').next();
    const b = new Rng('other-town').next();

    expect(a).not.toBe(b);
  });

  it('stays inside the requested ranges', () => {
    const rng = new Rng(42);

    for (let i = 0; i < 1000; i += 1) {
      const float = rng.nextFloat(-5, 5);
      expect(float).toBeGreaterThanOrEqual(-5);
      expect(float).toBeLessThan(5);

      const int = rng.nextInt(1, 6);
      expect(Number.isInteger(int)).toBe(true);
      expect(int).toBeGreaterThanOrEqual(1);
      expect(int).toBeLessThanOrEqual(6);
    }
  });

  it('gives each fork its own stream', () => {
    const parent = new Rng('tiny-town');
    const citizens = parent.fork('citizens');
    const weather = parent.fork('weather');

    expect(citizens.next()).not.toBe(weather.next());
  });

  it('picks from a list and refuses an empty one', () => {
    const rng = new Rng('picks');

    expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']));
    expect(() => rng.pick([])).toThrow();
  });
});
