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
    skyTop: 0x121a36,
    skyHorizon: 0x2a3757,
    ambientSky: 0x55679a,
    ambientGround: 0x232a3e,
    ambientIntensity: 0.78,
    sunColor: 0xa7b8dc,
    sunIntensity: 0.3,
    lampFactor: 1,
    windowFactor: 1,
  },
  {
    minuteOfDay: 4 * 60 + 40,
    name: 'late night',
    skyTop: 0x141d3a,
    skyHorizon: 0x2f3d5f,
    ambientSky: 0x58699c,
    ambientGround: 0x252c41,
    ambientIntensity: 0.8,
    sunColor: 0xa7b8dc,
    sunIntensity: 0.3,
    lampFactor: 1,
    windowFactor: 1,
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
    lampFactor: 0.7,
    windowFactor: 0.85,
  },
  {
    minuteOfDay: 7 * 60 + 20,
    name: 'morning',
    skyTop: 0x8fb4d8,
    skyHorizon: 0xdde8ee,
    ambientSky: 0xc3d3e4,
    ambientGround: 0x8a8a72,
    ambientIntensity: 0.9,
    sunColor: 0xfff0d8,
    sunIntensity: 1.7,
    lampFactor: 0,
    windowFactor: 0.14,
  },
  {
    minuteOfDay: 12 * 60 + 30,
    name: 'day',
    skyTop: 0x6fa2d0,
    skyHorizon: 0xd3e2ec,
    ambientSky: 0xcfdcea,
    ambientGround: 0x939577,
    ambientIntensity: 0.92,
    sunColor: 0xfff6e4,
    sunIntensity: 1.9,
    lampFactor: 0,
    windowFactor: 0.05,
  },
  {
    minuteOfDay: 17 * 60 + 40,
    name: 'golden hour',
    skyTop: 0x86a6cc,
    skyHorizon: 0xecd2ad,
    ambientSky: 0xcfd1d8,
    ambientGround: 0x8f7d63,
    ambientIntensity: 0.92,
    sunColor: 0xffd9a3,
    sunIntensity: 1.6,
    lampFactor: 0,
    windowFactor: 0.3,
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
    lampFactor: 0.85,
    windowFactor: 0.92,
  },
  {
    minuteOfDay: 20 * 60 + 45,
    name: 'nightfall',
    skyTop: 0x1a2448,
    skyHorizon: 0x445377,
    ambientSky: 0x7484b0,
    ambientGround: 0x2b3247,
    ambientIntensity: 0.95,
    sunColor: 0xa7b8dc,
    sunIntensity: 0.38,
    lampFactor: 1,
    windowFactor: 1,
  },
];

/** When the sun comes up and goes down, which drives its direction. */
export const SUNRISE_MINUTE = 5 * 60 + 40;
export const SUNSET_MINUTE = 19 * 60 + 30;
