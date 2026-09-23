import type { Point } from './geometry.js';

export type BuildingKind =
  'house' | 'apartment' | 'cafe' | 'school' | 'supermarket' | 'bakery' | 'office';

/** What a house's front yard holds, so each home shows a sign of life (DESIGN.md §4). */
export type YardProp = 'mailbox' | 'bicycle' | 'bin' | 'flower-pots' | 'none';

/** What stands on a house's roof terrace (DESIGN.md §4). */
export type RoofProp = 'washing' | 'pots' | 'tank' | 'chair';

/**
 * How one house looks, in the island vernacular (SPEC.md 2.3, decision 29).
 * Every house gets its own combination so no two homes read the same. The
 * values are chosen in world/Town.ts from the house number, so they never
 * change between runs.
 */
export interface HouseStyle {
  /** Which side the set-back upper storey stands on; 'none' is a single cube. */
  upper: 'left' | 'right' | 'none';
  /** A small blue dome on the top of the house. */
  dome: boolean;
  /** White, or one of the pale washes on a fifth of the houses. */
  wallColor: number;
  /** Door, shutters and window frames, one colour per house. */
  trimColor: number;
  /** An external stair up the front to the roof terrace. */
  stair: boolean;
  roofProp: RoofProp;
  /** A strip of flowers along the front of the house. */
  flowerBed: boolean;
  prop: YardProp;
  /** Magenta bougainvillea climbing the front wall: rationed to a handful of houses. */
  bougainvillea: boolean;
}

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
  /** Height of the parapet above the roof. */
  roofHeight: number;
  rotationY: number;
  /** Number of window rows on the facades. */
  floors: number;
  /** Only houses carry a style; public buildings have their own fixed look. */
  style?: HouseStyle;
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
