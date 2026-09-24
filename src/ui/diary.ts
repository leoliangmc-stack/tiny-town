import { doorPosition } from '../entities/Building.js';
import type { Point } from '../entities/geometry.js';
import type { LogEntry } from '../simulation/EventLog.js';
import type { World } from '../simulation/World.js';
import { BUILDINGS, OUTDOOR_ZONES } from '../world/Town.js';

/**
 * Where a click on a diary entry takes the camera (SPEC.md 2.10): to the
 * place it happened, selecting whoever it was about if they are still there,
 * or saying they have moved on. With no place, to the person as they are now.
 */
export interface DiaryTrip {
  /** Where the camera goes. */
  point: Point;
  /** Who to select when they arrive, if anybody. */
  select?: string;
  /** A short note when the people in the entry have gone. */
  note?: string;
}

/** True when a click on the entry can go anywhere. */
export function isClickable(entry: LogEntry): boolean {
  return entry.where !== undefined || (entry.who?.length ?? 0) > 0;
}

export function tripFor(entry: LogEntry, world: World): DiaryTrip | undefined {
  const who = (entry.who ?? [])
    .map((id) => world.citizenSystem.find(id))
    .filter((citizen) => citizen !== undefined);

  if (entry.where) {
    const point = placePosition(entry.where);
    if (!point) {
      return undefined;
    }
    const stillThere = who.find(
      (citizen) => citizen.place.kind !== 'street' && citizen.place.id === entry.where,
    );
    if (stillThere) {
      return { point, select: stillThere.id };
    }
    if (who.length === 0) {
      return { point };
    }
    const names = who.map((citizen) => citizen.name);
    const verb = names.length === 1 ? 'has' : 'have';
    return { point, note: `${listNames(names)} ${verb} moved on.` };
  }

  const first = who[0];
  if (!first) {
    return undefined;
  }
  const target = world.followTarget(first.id);
  return target ? { point: target.position, select: first.id } : undefined;
}

/** The middle of an outdoor zone, or the door of a building. */
export function placePosition(id: string): Point | undefined {
  const zone = OUTDOOR_ZONES.find((candidate) => candidate.id === id);
  if (zone) {
    return { x: (zone.minX + zone.maxX) / 2, z: (zone.minZ + zone.maxZ) / 2 };
  }
  const building = BUILDINGS.find((candidate) => candidate.id === id);
  return building ? doorPosition(building) : undefined;
}

/** "Tom", "Tom and Sarah", "Tom, Sarah and two others". */
function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  const others = names.length - 2;
  return `${names[0]}, ${names[1]} and ${others === 1 ? 'one other' : `${others} others`}`;
}
