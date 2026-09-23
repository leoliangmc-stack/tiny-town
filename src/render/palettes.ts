/**
 * The colour of the day.
 *
 * Every light, the sky and the fog read from one of these stops, interpolated
 * by the time of day. This is the file to replace when Claude Design delivers
 * the final palettes (SPEC.md 2.7 and 2.11); nothing else needs to change.
 *
 * Colours are hex numbers. Intensities are multipliers for the Three.js lights.
 */
export interface TimePalette {
  /** Minute of the day this stop describes. */
  minuteOfDay: number;
  name: string;

  /**
   * Sky dome gradient, from the zenith down to the horizon. The horizon colour
   * is also the fog colour, which is what hides the edge of the ground.
   */
  skyTop: number;
  skyHorizon: number;

  /** Hemisphere light: bounce from the sky and from the ground. */
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;

  /** The sun during the day, the moon at night. */
  sunColor: number;
  sunIntensity: number;

  /**
   * A warm light from the far side of the town, opposite the sun, that puts a
   * rim on roofs and walls at dawn and dusk (DESIGN.md §11). Zero by day.
   */
  rimIntensity: number;
  /** How strongly street lamps and their pools of light show, 0 to 1. */
  lampFactor: number;
  /** How strongly lit windows show, 0 to 1. Daylight washes them out. */
  windowFactor: number;

  /** The sea: its deep colour, its colour near the sand, and the glint it throws. */
  seaDeep: number;
  seaShallow: number;
  seaGlint: number;
  /** Clouds: the side facing the light, and the side away from it. */
  cloudLit: number;
  cloudShade: number;
  /** How visible the sun disc, the stars and the moon are, 0 to 1. */
  sunStrength: number;
  starStrength: number;
  moonStrength: number;
}

/**
 * The stops of the day, in order. The day wraps around, so the last stop
 * blends back into the first.
 */
export const TIME_PALETTES: readonly TimePalette[] = [
  {
    minuteOfDay: 0,
    name: 'night',
    skyTop: 0x080d1f,
    skyHorizon: 0x1b2540,
    ambientSky: 0x55679a,
    ambientGround: 0x232a3e,
    ambientIntensity: 0.78,
    sunColor: 0xa7b8dc,
    sunIntensity: 0.3,
    rimIntensity: 0,
    lampFactor: 1,
    windowFactor: 1,
    seaDeep: 0x0f1a30,
    seaShallow: 0x1d2c48,
    seaGlint: 0xbfcbe8,
    cloudLit: 0x2a3554,
    cloudShade: 0x121a30,
    sunStrength: 0,
    starStrength: 1,
    moonStrength: 1,
  },
  {
    minuteOfDay: 4 * 60 + 40,
    name: 'late night',
    skyTop: 0x0a1024,
    skyHorizon: 0x1e2946,
    ambientSky: 0x58699c,
    ambientGround: 0x252c41,
    ambientIntensity: 0.8,
    sunColor: 0xa7b8dc,
    sunIntensity: 0.3,
    rimIntensity: 0,
    lampFactor: 1,
    windowFactor: 1,
    seaDeep: 0x111c33,
    seaShallow: 0x20304d,
    seaGlint: 0xbfcbe8,
    cloudLit: 0x2e3a5b,
    cloudShade: 0x151d34,
    sunStrength: 0,
    starStrength: 0.9,
    moonStrength: 0.9,
  },
  {
    minuteOfDay: 5 * 60 + 55,
    name: 'dawn',
    skyTop: 0x4a5d8c,
    skyHorizon: 0xe8a97e,
    ambientSky: 0xa5b1d1,
    ambientGround: 0x66584f,
    ambientIntensity: 1.05,
    sunColor: 0xf7b98a,
    sunIntensity: 1.0,
    rimIntensity: 0.55,
    lampFactor: 0.7,
    windowFactor: 0.85,
    seaDeep: 0x35507a,
    seaShallow: 0x6f8aa8,
    seaGlint: 0xffc48a,
    cloudLit: 0xf2b58c,
    cloudShade: 0x6a6f95,
    sunStrength: 0.9,
    starStrength: 0.15,
    moonStrength: 0.2,
  },
  {
    minuteOfDay: 7 * 60 + 20,
    name: 'morning',
    skyTop: 0x7aa8d4,
    skyHorizon: 0xdde8ee,
    ambientSky: 0xc3d3e4,
    ambientGround: 0x8a8a72,
    ambientIntensity: 0.9,
    sunColor: 0xfff0d8,
    sunIntensity: 1.7,
    rimIntensity: 0.15,
    lampFactor: 0,
    windowFactor: 0.14,
    seaDeep: 0x3f6d92,
    seaShallow: 0x83adc0,
    seaGlint: 0xfff2d8,
    cloudLit: 0xfbf7f0,
    cloudShade: 0xaebdcf,
    sunStrength: 1,
    starStrength: 0,
    moonStrength: 0,
  },
  {
    minuteOfDay: 12 * 60 + 30,
    name: 'day',
    skyTop: 0x5893cc,
    skyHorizon: 0xd3e2ec,
    ambientSky: 0xcfdcea,
    ambientGround: 0x939577,
    ambientIntensity: 0.92,
    sunColor: 0xfff6e4,
    sunIntensity: 1.9,
    rimIntensity: 0,
    lampFactor: 0,
    windowFactor: 0.05,
    seaDeep: 0x3b6b92,
    seaShallow: 0x80b0c4,
    seaGlint: 0xffffff,
    cloudLit: 0xffffff,
    cloudShade: 0xb0c1d3,
    sunStrength: 1,
    starStrength: 0,
    moonStrength: 0,
  },
  {
    minuteOfDay: 17 * 60 + 40,
    name: 'golden hour',
    skyTop: 0x7a9fc9,
    skyHorizon: 0xecd2ad,
    ambientSky: 0xcfd1d8,
    ambientGround: 0x8f7d63,
    ambientIntensity: 0.92,
    sunColor: 0xffd9a3,
    sunIntensity: 1.6,
    rimIntensity: 0.35,
    lampFactor: 0,
    windowFactor: 0.3,
    seaDeep: 0x3e6590,
    seaShallow: 0x8aa8bc,
    seaGlint: 0xffd9a0,
    cloudLit: 0xfde3bd,
    cloudShade: 0xb6b3c4,
    sunStrength: 1,
    starStrength: 0,
    moonStrength: 0,
  },
  {
    minuteOfDay: 19 * 60 + 15,
    name: 'dusk',
    skyTop: 0x4a5590,
    skyHorizon: 0xeba97a,
    ambientSky: 0xbfa9bb,
    ambientGround: 0x7a6152,
    ambientIntensity: 1.3,
    sunColor: 0xf7a06a,
    sunIntensity: 1.4,
    rimIntensity: 0.7,
    lampFactor: 0.85,
    windowFactor: 0.92,
    seaDeep: 0x2f3f6e,
    seaShallow: 0x6c7a9c,
    seaGlint: 0xffa66a,
    cloudLit: 0xf7a978,
    cloudShade: 0x5c5a86,
    sunStrength: 0.85,
    starStrength: 0.2,
    moonStrength: 0.3,
  },
  {
    minuteOfDay: 20 * 60 + 45,
    name: 'nightfall',
    skyTop: 0x101a3a,
    skyHorizon: 0x445377,
    ambientSky: 0x7484b0,
    ambientGround: 0x2b3247,
    ambientIntensity: 0.95,
    sunColor: 0xa7b8dc,
    sunIntensity: 0.38,
    rimIntensity: 0.15,
    lampFactor: 1,
    windowFactor: 1,
    seaDeep: 0x162441,
    seaShallow: 0x2c3c60,
    seaGlint: 0xc8d2ec,
    cloudLit: 0x3a4670,
    cloudShade: 0x1a2340,
    sunStrength: 0,
    starStrength: 0.85,
    moonStrength: 0.9,
  },
];

/** When the sun comes up and goes down, which drives its direction. */
export const SUNRISE_MINUTE = 5 * 60 + 40;
export const SUNSET_MINUTE = 19 * 60 + 30;

/** The lighthouse fades in over this many game minutes before sunset, and out after sunrise. */
const BEACON_FADE_MINUTES = 20;

/**
 * How lit the lighthouse is, 0 to 1. Unlike the street lamps, which come on
 * in the dusk while the sun is still up, a lighthouse only works in the dark:
 * it is off from shortly after sunrise until shortly before sunset.
 */
export function beaconFactorAt(minuteOfDay: number): number {
  const fadeOutEnd = SUNRISE_MINUTE + BEACON_FADE_MINUTES;
  const fadeInStart = SUNSET_MINUTE - BEACON_FADE_MINUTES;
  if (minuteOfDay < SUNRISE_MINUTE || minuteOfDay >= SUNSET_MINUTE) {
    return 1;
  }
  if (minuteOfDay < fadeOutEnd) {
    return 1 - (minuteOfDay - SUNRISE_MINUTE) / BEACON_FADE_MINUTES;
  }
  if (minuteOfDay >= fadeInStart) {
    return (minuteOfDay - fadeInStart) / BEACON_FADE_MINUTES;
  }
  return 0;
}
