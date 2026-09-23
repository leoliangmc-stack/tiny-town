import { describe, expect, it } from 'vitest';

import {
  CITIZEN_COOLDOWN_SECONDS,
  ICON_SECONDS,
  IconScheduler,
  MAX_ICONS,
} from '../src/render/OverheadIcons.js';

describe('icons over the heads (SPEC.md 2.10)', () => {
  it('shows three to five at most, dropping the rest', () => {
    expect(MAX_ICONS).toBeGreaterThanOrEqual(3);
    expect(MAX_ICONS).toBeLessThanOrEqual(5);

    const icons = new IconScheduler();
    // Rain starts with twenty people in the street: they all open umbrellas.
    const taken = Array.from({ length: 20 }, (_, i) => icons.offer(`c${i}`, 'umbrella'));
    expect(taken.filter(Boolean)).toHaveLength(MAX_ICONS);
    expect(icons.icons).toHaveLength(MAX_ICONS);
  });

  it('fades each icon in and out over two to three seconds', () => {
    expect(ICON_SECONDS).toBeGreaterThanOrEqual(2);
    expect(ICON_SECONDS).toBeLessThanOrEqual(3);
    expect(IconScheduler.opacity(0)).toBe(0);
    expect(IconScheduler.opacity(ICON_SECONDS / 2)).toBe(1);
    expect(IconScheduler.opacity(ICON_SECONDS - 0.1)).toBeLessThan(0.2);

    const icons = new IconScheduler();
    icons.offer('c1', 'umbrella');
    icons.advance(ICON_SECONDS - 0.01);
    expect(icons.icons).toHaveLength(1);
    icons.advance(0.02);
    expect(icons.icons).toHaveLength(0);
  });

  it('frees a slot for the next person once an icon has gone', () => {
    const icons = new IconScheduler();
    for (let i = 0; i < MAX_ICONS; i += 1) {
      icons.offer(`c${i}`, 'umbrella');
    }
    expect(icons.offer('late', 'umbrella')).toBe(false);
    icons.advance(ICON_SECONDS);
    expect(icons.offer('late', 'umbrella')).toBe(true);
  });

  it('does not show the same person again straight away', () => {
    const icons = new IconScheduler();
    icons.offer('c1', 'umbrella');
    icons.advance(ICON_SECONDS);
    expect(icons.offer('c1', 'umbrella')).toBe(false);
    icons.advance(CITIZEN_COOLDOWN_SECONDS);
    expect(icons.offer('c1', 'umbrella')).toBe(true);
  });

  it('takes everything down at speed', () => {
    const icons = new IconScheduler();
    icons.offer('c1', 'umbrella');
    icons.offer('c2', 'umbrella');
    icons.clear();
    expect(icons.icons).toHaveLength(0);
  });
});
