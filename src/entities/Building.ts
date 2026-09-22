import type { Point } from './geometry.js';

export type BuildingKind = 'house' | 'cafe';

/**
 * One building in the fixed town layout.
 *
 * `rotationY` turns the building around its centre. At 0 the front wall, and
 * with it the door, faces +Z; at PI/2 it faces +X.
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
  const distanceToDoor = building.depth / 2 + 1;
  return {
    x: building.position.x + front.x * distanceToDoor,
    z: building.position.z + front.z * distanceToDoor,
  };
}
