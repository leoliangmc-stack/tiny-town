import type { Point } from './geometry.js';

/** The three shapes of car in town (DESIGN.md §8). */
export type VehicleKind = 'car' | 'suv' | 'van';

/**
 * A vehicle is either parked at a node of the road graph or driving along a
 * path between two of them (SPEC.md 2.5).
 */
export interface Vehicle {
  id: string;
  kind: VehicleKind;
  /** Body colour, as a hex number. */
  color: number;
  /** The citizen who owns it, or the workplace it belongs to. */
  ownerId?: string;
  workplaceId?: string;
  /** Where it spends the night: a parking node id on the road graph. */
  homeNodeId: string;

  /** Metres per game minute on the open road. */
  speed: number;

  state: 'parked' | 'driving';
  /** The node it is parked at, when parked. */
  parkedAtNodeId: string;
  /** The citizen aboard, when driving. */
  driverId?: string;

  position: Point;
  /** Direction it faces, as an angle around Y in radians. */
  heading: number;
  /** Distance driven in total, which turns the wheels in the renderer. */
  distanceDriven: number;

  /** The route being driven, on the road centrelines; empty when parked. */
  path: Point[];
  pathIndex: number;
  /** Where the drive ends: the parking node to take. */
  destinationNodeId?: string;

  /** What holds it right now: a red light, the car in front, or nothing. */
  waiting: 'light' | 'car' | null;
  /** Game minutes spent held, cleared when it moves. Read by the tests. */
  heldForMinutes: number;
}
