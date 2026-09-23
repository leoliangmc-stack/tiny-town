/**
 * The shape of the ground (SPEC.md 2.3, decision 29): a slope that leans
 * towards the sea, flat under the beach, two to three storeys higher on the
 * far side of the town, then a gentle rise on towards the hills.
 *
 * This is a pure function of position with no Three.js in it. The renderer
 * reads it for the ground mesh, the streets and everything that stands on
 * them; the simulation never does. Citizens and vehicles move in two
 * dimensions and the state hash never sees a height, so the slope cannot
 * touch determinism.
 *
 * Inside the town the rise is linear in z, on purpose: a slab of road or
 * pavement laid at the height of its centre and tilted by the grade then
 * meets the ground exactly along its whole length, and every east-west street
 * stays level. X plays no part.
 */

/** Where the slope begins, just inland of the sand, and where its main climb ends. */
export const SLOPE_FROM_Z = -62;
export const SLOPE_TO_Z = 70;

/** How much the town rises between those two lines: about three storeys. */
export const TOWN_RISE = 9;

/** The grade of the town's slope, in metres of height per metre of ground. */
export const TOWN_GRADE = TOWN_RISE / (SLOPE_TO_Z - SLOPE_FROM_Z);

/** Beyond the town the ground keeps climbing, more gently, to the hills. */
const UPLAND_GRADE = 0.03;
const UPLAND_TO_Z = 330;

/** Height of the ground at a point. */
export function groundHeight(_x: number, z: number): number {
  if (z <= SLOPE_FROM_Z) {
    return 0;
  }
  if (z <= SLOPE_TO_Z) {
    return (z - SLOPE_FROM_Z) * TOWN_GRADE;
  }
  return TOWN_RISE + (Math.min(z, UPLAND_TO_Z) - SLOPE_TO_Z) * UPLAND_GRADE;
}

/** The grade of the ground at a point: how fast it rises with z. */
export function groundGrade(_x: number, z: number): number {
  if (z <= SLOPE_FROM_Z) {
    return 0;
  }
  if (z <= SLOPE_TO_Z) {
    return TOWN_GRADE;
  }
  return z < UPLAND_TO_Z ? UPLAND_GRADE : 0;
}

/**
 * The rotation about X that lays a flat shape on the slope at a point, so its
 * far edge sits as high as the ground there. Three.js rotates a plane's +Z
 * edge downwards for a positive angle, hence the sign.
 */
export function groundTiltX(x: number, z: number): number {
  return -Math.atan(groundGrade(x, z));
}
