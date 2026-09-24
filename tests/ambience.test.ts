import { describe, expect, it } from 'vitest';

import { bedLevels } from '../src/render/Ambience.js';
import { Fireworks } from '../src/render/Fireworks.js';

const at = (hour: number, minute = 0): number => hour * 60 + minute;

/** The App's eased weather once it has settled (App.ts CLOUD_AMOUNT). */
const SUNNY = { cloud: 0, rain: 0 };
const CLOUDY = { cloud: 0.7, rain: 0 };
const RAIN = { cloud: 1, rain: 1 };

describe('the ambient beds (SPEC.md 2.12)', () => {
  it('has birds at dawn, the street by day and insects at night', () => {
    const dawn = bedLevels(at(6), SUNNY);
    expect(dawn.birds).toBe(1);
    expect(dawn.insects).toBe(0);

    const noon = bedLevels(at(12), SUNNY);
    expect(noon.street).toBe(1);
    expect(noon.insects).toBe(0);
    expect(noon.birds).toBeLessThan(0.5);

    const night = bedLevels(at(23), SUNNY);
    expect(night.insects).toBe(1);
    expect(night.street).toBe(0);
    expect(night.birds).toBe(0);
  });

  it('crossfades rather than cuts', () => {
    const levels = [at(4, 30), at(7, 15), at(20)].map((minute) => bedLevels(minute, SUNNY));
    expect(levels[0].insects).toBeGreaterThan(0);
    expect(levels[0].insects).toBeLessThan(1);
    expect(levels[1].street).toBeGreaterThan(0);
    expect(levels[1].street).toBeLessThan(1);
    expect(levels[2].insects).toBeGreaterThan(0);
    expect(levels[2].street).toBeGreaterThan(0);
  });
});

describe('each weather sounds its own (decision 43)', () => {
  it('brings gulls and more birds in the sun', () => {
    const sunny = bedLevels(at(11), SUNNY);
    const cloudy = bedLevels(at(11), CLOUDY);
    expect(sunny.gulls).toBe(1);
    expect(cloudy.gulls).toBe(0);
    expect(sunny.birds).toBeGreaterThan(cloudy.birds * 2);
    expect(sunny.wind).toBe(0);
  });

  it('brings the wind under cloud', () => {
    const cloudy = bedLevels(at(11), CLOUDY);
    expect(cloudy.wind).toBe(1);
    expect(cloudy.rain).toBe(0);
    expect(bedLevels(at(23), CLOUDY).wind).toBe(1);
  });

  it('lets the rain in and hushes the birds and the insects', () => {
    const rain = bedLevels(at(11), RAIN);
    expect(rain.rain).toBe(1);
    expect(rain.gulls).toBe(0);
    expect(rain.wind).toBeLessThan(bedLevels(at(11), CLOUDY).wind);
    expect(bedLevels(at(6), RAIN).birds).toBeLessThan(0.2);
    expect(bedLevels(at(23), RAIN).insects).toBeLessThan(0.3);
  });

  it('gives the three weathers three different mixes', () => {
    const mixes = [SUNNY, CLOUDY, RAIN].map((sky) => JSON.stringify(bedLevels(at(11), sky)));
    expect(new Set(mixes).size).toBe(3);
  });
});

describe('Mid-Autumn night has its own sound (decision 43)', () => {
  it('plays the tune over a hushed night and nothing of the day', () => {
    const festival = bedLevels(at(21, 30), SUNNY, true);
    expect(festival.festival).toBe(1);
    expect(festival.insects).toBeGreaterThan(0);
    expect(festival.insects).toBeLessThan(bedLevels(at(21, 30), SUNNY).insects);
    expect(festival.street + festival.gulls + festival.wind + festival.rain).toBe(0);
    expect(bedLevels(at(21, 30), SUNNY).festival).toBe(0);
  });

  it('hears every launch and burst the fireworks make', () => {
    const fireworks = new Fireworks();
    for (let frame = 0; frame < 60 * 20; frame += 1) {
      fireworks.update(1 / 60);
    }
    const sounds = fireworks.takeSounds();
    const launches = sounds.filter((sound) => sound.kind === 'launch');
    const bursts = sounds.filter((sound) => sound.kind === 'burst');
    expect(launches.length).toBeGreaterThan(0);
    expect(bursts.length).toBeGreaterThan(0);
    expect(sounds.some((sound) => sound.big)).toBe(true);
    for (const burst of bursts) {
      // A burst is heard from up in the sky, where it is seen.
      expect(burst.position.y).toBeGreaterThan(5);
    }
    expect(fireworks.takeSounds()).toHaveLength(0);
  });
});
