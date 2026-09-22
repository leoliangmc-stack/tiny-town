import type { Point } from './geometry.js';

export type BuildingKind = 'house' | 'cafe' | 'school' | 'supermarket' | 'bakery' | 'office';

/**
 * One building in the fixed town layout.
 *
 * `rotationY` turns the building around its centre. At 0 the front wall, and
 * with it the door, faces +Z; at PI it faces -Z.
 */
export interface Building {
  id: string;
  kind: BuildingKind;
  name: string;
  /** Centre of the footprint. */
  position: Point;
  /** Footprint size before rotation: width runs along X, depth along Z. */
  width: number;
  depth: number;
  /** Height of the walls, without the roof. */
  wallHeight: number;
  /** Extra height of the roof above the walls. */
  roofHeight: number;
  rotationY: number;
  /** Number of window rows on the facades. */
  floors: number;
}

/** Unit vector the front of the building faces. */
export function frontDirection(building: Building): Point {
  return { x: Math.sin(building.rotationY), z: Math.cos(building.rotationY) };
}

/** The point a citizen stands on when entering or leaving the building. */
export function doorPosition(building: Building): Point {
  const front = frontDirection(building);
  const distanceToDoor = building.depth / 2 + 1.2;
  return {
    x: building.position.x + front.x * distanceToDoor,
    z: building.position.z + front.z * distanceToDoor,
  };
}

/** True when the point is inside the building's footprint, plus a margin. */
export function containsPoint(building: Building, point: Point, margin = 0): boolean {
  const dx = point.x - building.position.x;
  const dz = point.z - building.position.z;
  // Rotate the point into the building's own axes.
  const cos = Math.cos(-building.rotationY);
  const sin = Math.sin(-building.rotationY);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  return (
    Math.abs(localX) <= building.width / 2 + margin &&
    Math.abs(localZ) <= building.depth / 2 + margin
  );
}

/** The building's axis-aligned extent, used for framing the camera. */
export function footprintBounds(building: Building): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const cos = Math.abs(Math.cos(building.rotationY));
  const sin = Math.abs(Math.sin(building.rotationY));
  const halfX = (building.width * cos + building.depth * sin) / 2;
  const halfZ = (building.width * sin + building.depth * cos) / 2;
  return {
    minX: building.position.x - halfX,
    maxX: building.position.x + halfX,
    minZ: building.position.z - halfZ,
    maxZ: building.position.z + halfZ,
  };
}
