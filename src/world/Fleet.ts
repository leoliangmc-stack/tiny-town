import type { VehicleKind } from '../entities/Vehicle.js';

/**
 * The eight vehicles in town (SPEC.md 2.5), and who they belong to.
 *
 * Six are private cars, one per household, given to the six longest commutes
 * among the adults who would rather not walk them: Rex (169 m on foot),
 * Mateo (161 m), Maya (161 m), Nina (158 m), Lucia (142 m) and Walter
 * (132 m, and 63). Ada walks a commute just as long, but she likes being out
 * of doors. Two are delivery vans that live in the supermarket car park and
 * go out on the rounds with Paul and Sven; the other three drivers walk their
 * rounds until there is a van free.
 *
 * Colours are warm and low in saturation (DESIGN.md §10).
 */
export interface VehicleTemplate {
  id: string;
  kind: VehicleKind;
  color: number;
  ownerId?: string;
  workplaceId?: string;
  /** The citizen who takes this van out; only for workplace vehicles. */
  driverId?: string;
}

export const FLEET: readonly VehicleTemplate[] = [
  { id: 'car-rex', kind: 'car', color: 0xc9705f, ownerId: 'rex' },
  { id: 'car-mateo', kind: 'suv', color: 0x6a8caf, ownerId: 'mateo' },
  { id: 'car-maya', kind: 'car', color: 0xe6c88a, ownerId: 'maya' },
  { id: 'car-nina', kind: 'car', color: 0xf5f0e6, ownerId: 'nina' },
  { id: 'car-lucia', kind: 'suv', color: 0x8faf8f, ownerId: 'lucia' },
  { id: 'car-walter', kind: 'car', color: 0x7c8a9a, ownerId: 'walter' },
  { id: 'van-1', kind: 'van', color: 0xe6a15c, workplaceId: 'supermarket', driverId: 'paul' },
  { id: 'van-2', kind: 'van', color: 0xe6a15c, workplaceId: 'supermarket', driverId: 'sven' },
];

/**
 * Car owners who take the car out again in the evening, so headlights cross
 * the dark streets (SPEC.md 2.14). Lucia likes the cafe; Mateo has the energy.
 */
export const NIGHT_OUT_IDS: readonly string[] = ['lucia', 'mateo'];

/** Metres per game minute: comfortably faster than a walker's 4.4. */
export const VEHICLE_SPEED: Record<VehicleKind, number> = {
  car: 18,
  suv: 17,
  van: 15,
};

/** Body sizes in metres, before the cabin and wheels go on. */
export const VEHICLE_SIZE: Record<VehicleKind, { length: number; width: number; height: number }> =
  {
    car: { length: 4.2, width: 1.9, height: 1.2 },
    suv: { length: 4.5, width: 2.0, height: 1.5 },
    van: { length: 5.2, width: 2.0, height: 1.9 },
  };
