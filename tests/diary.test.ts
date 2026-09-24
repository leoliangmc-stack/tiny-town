import { describe, expect, it } from 'vitest';

import { TICKS_PER_GAME_DAY } from '../src/simulation/constants.js';
import { World } from '../src/simulation/World.js';
import { isClickable, placePosition, tripFor } from '../src/ui/diary.js';

describe('the clickable diary (SPEC.md 2.10)', () => {
  const world = new World({ seed: 'diary' });
  world.tickMany(TICKS_PER_GAME_DAY);
  world.setWeather('Rain');
  world.tickMany(TICKS_PER_GAME_DAY);
  const entries = world.log.entries;

  it('says who and where for the entries about people', () => {
    const about = entries.filter(isClickable);
    expect(about.length).toBeGreaterThan(entries.length / 2);
    for (const entry of about) {
      for (const id of entry.who ?? []) {
        expect(world.citizenSystem.find(id), entry.text).toBeDefined();
      }
      if (entry.where) {
        expect(placePosition(entry.where), entry.text).toBeDefined();
      }
    }
  });

  it('leaves the weather and the last light out as plain lines', () => {
    const weather = entries.find((entry) => entry.text.startsWith('Rain set in'));
    expect(weather).toBeDefined();
    expect(isClickable(weather!)).toBe(false);
    const lastLight = entries.find((entry) => entry.text.startsWith('The last light'));
    expect(lastLight).toBeDefined();
    expect(isClickable(lastLight!)).toBe(false);
  });

  it('flies to the place and selects the person who is still there', () => {
    const fresh = World.restore({ day: 3, minute: 11 * 60, weather: 'Sunny' });
    const atWork = fresh.citizens.find(
      (citizen) => citizen.activity === 'Work' && citizen.place.kind === 'building',
    )!;
    const trip = tripFor(
      { day: 3, minute: 600, text: '', who: [atWork.id], where: atWork.place.id },
      fresh,
    );
    expect(trip?.select).toBe(atWork.id);
    expect(trip?.point).toEqual(placePosition(atWork.place.id));
  });

  it('says the people have moved on when they have gone', () => {
    const fresh = World.restore({ day: 3, minute: 11 * 60, weather: 'Sunny' });
    const [first, second] = fresh.citizens.filter((citizen) => citizen.place.id !== 'park-lawn');
    const one = tripFor(
      { day: 3, minute: 600, text: '', who: [first.id], where: 'park-lawn' },
      fresh,
    );
    expect(one?.select).toBeUndefined();
    expect(one?.note).toBe(`${first.name} has moved on.`);
    const two = tripFor(
      { day: 3, minute: 600, text: '', who: [first.id, second.id], where: 'park-lawn' },
      fresh,
    );
    expect(two?.note).toBe(`${first.name} and ${second.name} have moved on.`);
  });

  it('goes to the person as they are now when the entry has no place', () => {
    const fresh = World.restore({ day: 3, minute: 11 * 60, weather: 'Sunny' });
    const citizen = fresh.citizens[0];
    const trip = tripFor({ day: 3, minute: 600, text: '', who: [citizen.id] }, fresh);
    expect(trip?.select).toBe(citizen.id);
    expect(trip?.point).toEqual(fresh.followTarget(citizen.id)?.position);
  });
});
