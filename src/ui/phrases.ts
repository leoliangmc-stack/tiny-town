import type { Citizen } from '../entities/Citizen.js';
import type { Weather } from '../simulation/WeatherSystem.js';
import { getBuilding, getZone } from '../world/Town.js';

/**
 * The words the UI uses for what the simulation knows (SPEC.md 2.9): what a
 * citizen is doing right now, who their family is, what the weather is.
 * Plain sentences for people, never ids or numbers from the state.
 */

/** How each outdoor zone reads in a sentence. */
const ZONE_WORDS: Record<string, string> = {
  'cafe-terrace': 'on the cafe terrace',
  'school-playground': 'in the schoolyard',
  'supermarket-forecourt': 'outside the supermarket',
  'bakery-front': 'outside the bakery',
  'office-front': 'outside the office',
  'park-lawn': 'in the park',
};

/** "at Maple House", "in the park", "at the Corner Cafe". */
function placeWords(citizen: Citizen, id: string, kind: 'building' | 'zone' | 'street'): string {
  if (kind === 'zone') {
    return ZONE_WORDS[id] ?? 'in town';
  }
  if (id === citizen.homeId) {
    return 'at home';
  }
  try {
    return `at ${getBuilding(id).name}`;
  } catch {
    return ZONE_WORDS[id] ?? 'in town';
  }
}

/** Where a trip is going, for someone on the street: "the park", "home", "work". */
function destinationWords(citizen: Citizen): string {
  const pending = citizen.pending;
  const id = pending?.place.id ?? citizen.place.id;
  const kind = pending?.place.kind ?? 'building';
  if (id === citizen.homeId) {
    return 'home';
  }
  if (citizen.workplaceId && id === citizen.workplaceId) {
    return 'work';
  }
  if (kind === 'zone') {
    return (ZONE_WORDS[id] ?? 'in town').replace(/^(on|in|outside) /, (match) =>
      match === 'outside ' ? 'outside ' : 'the ',
    );
  }
  try {
    return getBuilding(id).name;
  } catch {
    return 'town';
  }
}

/** One short line for what the citizen is doing right now. */
export function describeActivity(citizen: Citizen): string {
  const { activity, place } = citizen;
  switch (activity) {
    case 'Sleep':
      return 'Asleep at home';
    case 'Eat':
      return place.id === citizen.homeId ? 'Having a meal at home' : 'Having a meal';
    case 'Work': {
      if (citizen.job === 'Student') {
        return 'In class at school';
      }
      const where = citizen.workplaceId ? getBuilding(citizen.workplaceId).name : 'work';
      return place.id === citizen.workplaceId ? `Working at ${where}` : `Working, out at ${where}`;
    }
    case 'Walk':
      return `Walking to ${destinationWords(citizen)}`;
    case 'GoHome':
      return 'Walking home';
    case 'Drive':
      return `Driving to ${destinationWords(citizen)}`;
    case 'Shop':
      return 'Shopping at the supermarket';
    case 'Socialize':
      return `Chatting ${placeWords(citizen, place.id, place.kind)}`;
    case 'Relax':
      if (place.kind === 'zone') {
        return `Relaxing ${placeWords(citizen, place.id, place.kind)}`;
      }
      return place.id === citizen.homeId
        ? 'At home'
        : `Resting ${placeWords(citizen, place.id, place.kind)}`;
    default:
      return 'About town';
  }
}

/** "Wife Ada, son Leo", or "Lives alone" when there is nobody. */
export function describeFamily(
  citizen: Citizen,
  find: (id: string) => Citizen | undefined,
): string {
  const parts: string[] = [];
  const name = (id: string): string => find(id)?.name ?? id;
  const relation = (id: string, female: string, male: string): string => {
    const other = find(id);
    return `${other?.gender === 'female' ? female : male} ${name(id)}`;
  };
  if (citizen.family.spouse) {
    parts.push(relation(citizen.family.spouse, 'wife', 'husband'));
  }
  for (const id of citizen.family.parents) {
    parts.push(relation(id, 'mother', 'father'));
  }
  for (const id of citizen.family.children) {
    parts.push(relation(id, 'daughter', 'son'));
  }
  for (const id of citizen.family.siblings) {
    parts.push(relation(id, 'sister', 'brother'));
  }
  if (parts.length === 0) {
    return 'Lives alone';
  }
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The friends by name, or a quiet line when there are none. */
export function describeFriends(
  citizen: Citizen,
  find: (id: string) => Citizen | undefined,
): string {
  const names = citizen.friends.map((id) => find(id)?.name ?? id);
  return names.length > 0 ? names.join(', ') : 'Keeps to themselves';
}

/** "Maple House" for a house, or the block's name. */
export function describeHome(citizen: Citizen): string {
  try {
    return getBuilding(citizen.homeId).name;
  } catch {
    return 'In town';
  }
}

export function weatherGlyph(weather: Weather): string {
  return weather === 'Sunny' ? '☀' : weather === 'Cloudy' ? '☁' : '☂';
}

export function nextWeather(weather: Weather): Weather {
  return weather === 'Sunny' ? 'Cloudy' : weather === 'Cloudy' ? 'Rain' : 'Sunny';
}

/** The zone a place id names, for the log or the panel; undefined for buildings. */
export function zoneName(id: string): string | undefined {
  try {
    return getZone(id).id;
  } catch {
    return undefined;
  }
}
