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

  /** How strongly street lamps and their pools of light show, 0 to 1. */
  lampFactor: number;
  /** How strongly lit windows show, 0 to 1. Daylight washes them out. */
  windowFactor: number;
}

/**
 * The stops of the day, in order. The day wraps around, so the last stop
 * blends back into the first.
 */
export const TIME_PALETTES: readonly TimePalette[] = [
  {
    minuteOfDay: 0,
    name: 'night',
    skyTop: 0x070c20,
    skyHorizon: 0x1b2950,
    ambientSky: 0x435a8d,
    ambientGround: 0x161d36,
    ambientIntensity: 0.62,
    sunColor: 0x9db4e4,
    sunIntensity: 0.35,
    lampFactor: 1,
    windowFactor: 1,
  },
  {
    minuteOfDay: 4 * 60 + 40,
    name: 'late night',
    skyTop: 0x0a1229,
    skyHorizon: 0x223058,
    ambientSky: 0x455a93,
    ambientGround: 0x181f39,
    ambientIntensity: 0.64,
    sunColor: 0x9db4e4,
    sunIntensity: 0.35,
    lampFactor: 1,
    windowFactor: 1,
  },
  {
    minuteOfDay: 5 * 60 + 55,
    name: 'dawn',
    skyTop: 0x2b4079,
    skyHorizon: 0xeb9a66,
    ambientSky: 0x93a6d6,
    ambientGround: 0x554a41,
    ambientIntensity: 0.95,
    sunColor: 0xffab6e,
    sunIntensity: 1.05,
    lampFactor: 0.7,
    windowFactor: 0.85,
  },
  {
    minuteOfDay: 7 * 60 + 20,
    name: 'morning',
    skyTop: 0x6b9ed6,
    skyHorizon: 0xdaeaf6,
    ambientSky: 0xaacaea,
    ambientGround: 0x6f7c5e,
    ambientIntensity: 0.8,
    sunColor: 0xfff1d4,
    sunIntensity: 2.0,
    lampFactor: 0,
    windowFactor: 0.14,
  },
  {
    minuteOfDay: 12 * 60 + 30,
    name: 'day',
    skyTop: 0x4b8ed2,
    skyHorizon: 0xcbe7f9,
    ambientSky: 0xbdd9f1,
    ambientGround: 0x7f8e67,
    ambientIntensity: 0.82,
    sunColor: 0xfff8e6,
    sunIntensity: 2.35,
    lampFactor: 0,
    windowFactor: 0.05,
  },
  {
    minuteOfDay: 17 * 60 + 40,
    name: 'golden hour',
    skyTop: 0x5d90cd,
    skyHorizon: 0xf4d4a4,
    ambientSky: 0xbecadd,
    ambientGround: 0x7d6b4f,
    ambientIntensity: 0.78,
    sunColor: 0xffd28c,
    sunIntensity: 1.9,
    lampFactor: 0,
    windowFactor: 0.3,
  },
  {
    minuteOfDay: 19 * 60 + 15,
    name: 'dusk',
    skyTop: 0x2a4083,
    skyHorizon: 0xf58d55,
    ambientSky: 0xa598c8,
    ambientGround: 0x5e4a52,
    ambientIntensity: 1.2,
    sunColor: 0xff8447,
    sunIntensity: 1.4,
    lampFactor: 0.85,
    windowFactor: 0.92,
  },
  {
    minuteOfDay: 20 * 60 + 45,
    name: 'nightfall',
    skyTop: 0x0d1638,
    skyHorizon: 0x35447a,
    ambientSky: 0x4a5d99,
    ambientGround: 0x1b2340,
    ambientIntensity: 0.72,
    sunColor: 0x9db4e4,
    sunIntensity: 0.4,
    lampFactor: 1,
    windowFactor: 1,
  },
];

/** When the sun comes up and goes down, which drives its direction. */
export const SUNRISE_MINUTE = 5 * 60 + 40;
export const SUNSET_MINUTE = 19 * 60 + 30;
