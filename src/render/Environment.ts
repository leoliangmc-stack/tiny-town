import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

import { MINUTES_PER_GAME_DAY } from '../simulation/constants.js';

import { SUNRISE_MINUTE, SUNSET_MINUTE, TIME_PALETTES, type TimePalette } from './palettes.js';

/** Radius of the sky dome. It sits outside everything else in the scene. */
const SKY_RADIUS = 900;

/** How high the sun climbs at noon, in radians. A lower sun keeps shadows long. */
const MAX_SUN_ELEVATION = (52 * Math.PI) / 180;

/**
 * Where the sun stands at midday, measured from +X (east) towards +Z (south).
 *
 * It is deliberately off to one side of the default camera: with the sun
 * directly behind the viewer every shadow hides behind its own building and
 * the town goes flat at noon.
 */
const NOON_AZIMUTH = (135 * Math.PI) / 180;

/** The sun never drops below this, so night keeps a low raking moonlight. */
const MIN_SUN_ELEVATION = (4 * Math.PI) / 180;

/** Shadows fade in over this much elevation above the night time minimum. */
const SHADOW_FADE_ELEVATION = (5 * Math.PI) / 180;

/**
 * How dark a shadow gets at most. Well under one: the town is a soft miniature
 * under diffuse light, not a sundial (DESIGN.md §11).
 */
const SHADOW_STRENGTH = 0.7;

const SUN_DISTANCE = 220;

/** The moon crosses the sky at this height through the night. */
const MOON_ELEVATION = (30 * Math.PI) / 180;

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The whole sky in one pass (DESIGN.md §20): the gradient, a sun disc with a
 * halo, drifting clouds, and at night stars, a faint Milky Way and a moon.
 * Everything takes its colour from the palette uniforms; nothing here has a
 * colour of its own.
 */
const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float sunStrength;
  uniform vec3 moonDirection;
  uniform float moonStrength;
  uniform float starStrength;
  uniform vec3 cloudLit;
  uniform vec3 cloudShade;
  uniform float cloudCover;
  uniform float time;
  varying vec3 vWorldPosition;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Value noise and three octaves of it: soft enough for clouds.
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise2(p);
      p = p * 2.1 + vec2(3.7, 1.9);
      amplitude *= 0.5;
    }
    return value;
  }

  // A soft disc with a halo around a direction, for the sun and the moon.
  float disc(vec3 dir, vec3 toward, float radius, float softness) {
    float c = dot(dir, toward);
    return smoothstep(radius - softness, radius, c);
  }

  void main() {
    vec3 dir = normalize(vWorldPosition);
    float height = clamp(dir.y, 0.0, 1.0);

    // The gradient: the horizon band gives way to the top colour well before
    // the zenith, so a low view still sees the sky's own colour.
    vec3 color = mix(horizonColor, topColor, smoothstep(0.0, 0.45, height));

    // Stars: a scatter of points, most cells empty, fading out near the horizon.
    if (starStrength > 0.001 && dir.y > 0.0) {
      vec3 cell = dir * 190.0;
      vec3 i = floor(cell);
      vec3 f = fract(cell) - 0.5;
      float seed = hash(i);
      float present = step(0.978, seed);
      vec3 offset = vec3(hash(i + 1.3), hash(i + 2.7), hash(i + 4.1)) - 0.5;
      float d = length(f - offset * 0.6);
      float twinkle = 0.7 + 0.3 * sin(time * 1.7 + seed * 40.0);
      float star = present * smoothstep(0.11, 0.0, d) * twinkle;
      color += vec3(0.9, 0.93, 1.0) * star * starStrength * smoothstep(0.03, 0.25, dir.y);

      // The Milky Way: a soft, patchy band along one great circle.
      // The band arches over the sea: from the east horizon up through the
      // northern sky and down to the west.
      vec3 bandNormal = normalize(vec3(0.15, -0.7, -0.7));
      float band = smoothstep(0.22, 0.0, abs(dot(dir, bandNormal)));
      float patches = fbm(vec2(dot(dir, vec3(3.0, 0.0, 1.0)) * 3.0, dot(dir, vec3(0.0, 3.0, 1.0)) * 3.0));
      float milky = band * (0.25 + 0.75 * patches) * 0.18;
      color += vec3(0.78, 0.82, 0.95) * milky * starStrength * smoothstep(0.05, 0.3, dir.y);
    }

    // The moon: a disc, a shaded edge for the phase, and a halo.
    if (moonStrength > 0.001) {
      float moonDisc = disc(dir, moonDirection, 0.99955, 0.00025);
      vec3 shadowSide = normalize(moonDirection + vec3(0.024, 0.012, 0.0));
      float shade = disc(dir, shadowSide, 0.99955, 0.00035);
      float lit = moonDisc * (1.0 - shade * 0.75);
      float halo = pow(max(dot(dir, moonDirection), 0.0), 900.0) * 0.28;
      color += vec3(0.92, 0.93, 0.88) * lit * moonStrength * 1.6;
      color += vec3(0.75, 0.8, 0.95) * halo * moonStrength;
    }

    // The sun: a hot disc and a wide soft halo, both in the palette's sun colour.
    if (sunStrength > 0.001) {
      float c = max(dot(dir, sunDirection), 0.0);
      float sunDisc = disc(dir, sunDirection, 0.9996, 0.0003);
      float halo = pow(c, 160.0) * 0.55 + pow(c, 14.0) * 0.12;
      color += sunColor * (sunDisc * 4.0 + halo) * sunStrength;
    }

    // Clouds: noise on a high flat layer, drifting, fading to the horizon.
    if (dir.y > 0.01) {
      vec2 sheet = dir.xz / (dir.y + 0.12) * 0.9 + vec2(time * 0.004, time * 0.0015);
      float n = fbm(sheet);
      float edge = 0.54 - cloudCover * 0.12;
      float cover = smoothstep(edge, edge + 0.14, n);
      float towardSun = 0.5 + 0.5 * dot(dir, sunDirection);
      float lightness = smoothstep(edge, edge + 0.3, n) * 0.6 + towardSun * 0.25;
      vec3 cloud = mix(cloudShade, cloudLit, lightness);
      float fade = smoothstep(0.02, 0.22, dir.y);
      color = mix(color, cloud, cover * fade * 0.85);
    }

    gl_FragColor = vec4(color, 1.0);

    // Colours arrive in linear space and the canvas expects sRGB, so the sky
    // has to go through the same tone mapping and encoding as every other
    // material. Without these two lines it renders far darker than its palette.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The state of the world's light at one moment, read by the rest of the renderer. */
export interface EnvironmentState {
  lampFactor: number;
  windowFactor: number;
  /** Unit vector towards the sun by day, or the moon by night. */
  lightDirection: Vector3;
  /** Colour of the light on the water and the clouds. */
  lightColor: Color;
  /** How strongly the sea should glint under the light, 0 to 1. */
  glintStrength: number;
  seaDeep: Color;
  seaShallow: Color;
  seaGlint: Color;
  horizon: Color;
}

/**
 * Sky, fog and the two lights that carry the day.
 *
 * Everything here is driven by the game clock, which is what turns the town
 * from dawn to night in front of the viewer (SPEC.md 2.7).
 */
export class Environment {
  readonly sun: DirectionalLight;
  /** Warm light from behind the town, opposite the sun; see TimePalette.rimIntensity. */
  private readonly rim: DirectionalLight;

  private readonly hemisphere: HemisphereLight;
  private readonly skyMaterial: ShaderMaterial;
  private readonly fog: Fog;

  private readonly skyTop = new Color();
  private readonly skyHorizon = new Color();
  private readonly fogColor = new Color();
  private readonly ambientSky = new Color();
  private readonly ambientGround = new Color();
  private readonly sunColor = new Color();

  readonly state: EnvironmentState = {
    lampFactor: 0,
    windowFactor: 0,
    lightDirection: new Vector3(0, 1, 0),
    lightColor: new Color(),
    glintStrength: 0,
    seaDeep: new Color(),
    seaShallow: new Color(),
    seaGlint: new Color(),
    horizon: new Color(),
  };

  constructor(scene: Scene) {
    this.skyMaterial = new ShaderMaterial({
      uniforms: {
        topColor: { value: new Color(0x4b8ed2) },
        horizonColor: { value: new Color(0xcbe7f9) },
        sunDirection: { value: new Vector3(0, 1, 0) },
        sunColor: { value: new Color(0xfff6e4) },
        sunStrength: { value: 1 },
        moonDirection: { value: new Vector3(0, 1, 0) },
        moonStrength: { value: 0 },
        starStrength: { value: 0 },
        cloudLit: { value: new Color(0xffffff) },
        cloudShade: { value: new Color(0xc2cfdd) },
        cloudCover: { value: 0.45 },
        time: { value: 0 },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new Mesh(new SphereGeometry(SKY_RADIUS, 32, 20), this.skyMaterial);
    sky.name = 'sky';
    scene.add(sky);

    // The camera sits about eighty metres out, so the haze starts well beyond
    // the town: near enough to swallow the edge of the ground, far enough to
    // leave the town itself clear.
    this.fog = new Fog(0xcbe7f9, 170, 340);
    scene.fog = this.fog;

    this.hemisphere = new HemisphereLight(0xbdd9f1, 0x7f8e67, 1);
    scene.add(this.hemisphere);

    this.sun = new DirectionalLight(0xfff8e6, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 60;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -110;
    this.sun.shadow.camera.right = 110;
    this.sun.shadow.camera.top = 110;
    this.sun.shadow.camera.bottom = -110;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.06;
    // A wide filter kernel blurs the shadow edge into something soft.
    this.sun.shadow.radius = 6;
    // The shadow camera keeps its default 10x10 frustum until this is called,
    // which leaves everything but the middle of the town without a shadow.
    this.sun.shadow.camera.updateProjectionMatrix();
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.rim = new DirectionalLight(0xffb27a, 0);
    scene.add(this.rim);
    scene.add(this.rim.target);
  }

  /**
   * Sets where the haze starts and ends. The camera backs off further on a
   * narrow screen, so the range follows the framing rather than being fixed.
   */
  setFogRange(near: number, far: number): void {
    this.fog.near = near;
    this.fog.far = far;
  }

  /**
   * Moves the whole environment to the given minute of the game day.
   * `elapsedSeconds` is real time, for the clouds' drift and the stars'
   * twinkle only; it never touches the simulation.
   */
  update(minuteOfDay: number, elapsedSeconds = 0): void {
    const palette = paletteAt(minuteOfDay);
    const uniforms = this.skyMaterial.uniforms;

    this.skyTop.setHex(palette.skyTop);
    this.skyHorizon.setHex(palette.skyHorizon);
    this.fogColor.setHex(palette.skyHorizon);
    this.ambientSky.setHex(palette.ambientSky);
    this.ambientGround.setHex(palette.ambientGround);
    this.sunColor.setHex(palette.sunColor);

    (uniforms.topColor.value as Color).copy(this.skyTop);
    (uniforms.horizonColor.value as Color).copy(this.skyHorizon);
    this.fog.color.copy(this.fogColor);

    this.hemisphere.color.copy(this.ambientSky);
    this.hemisphere.groundColor.copy(this.ambientGround);
    this.hemisphere.intensity = palette.ambientIntensity;

    this.sun.color.copy(this.sunColor);
    this.sun.intensity = palette.sunIntensity;

    const { azimuth, elevation } = sunAngles(minuteOfDay);

    // A sun on the horizon throws shadows the length of the map, which reads as
    // scratches across the grass rather than as light. Fade them out instead.
    this.sun.shadow.intensity =
      SHADOW_STRENGTH *
      smoothStep(Math.min(1, Math.max(0, (elevation - MIN_SUN_ELEVATION) / SHADOW_FADE_ELEVATION)));

    const sunDirection = directionFrom(azimuth, elevation);
    this.sun.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);

    // The rim sits low on the far side, so it catches edges the sun does not.
    this.rim.intensity = palette.rimIntensity;
    this.rim.position.set(
      -Math.cos(azimuth) * SUN_DISTANCE,
      SUN_DISTANCE * 0.25,
      -Math.sin(azimuth) * SUN_DISTANCE,
    );

    // The moon takes its own path through the night, opposite the sun's.
    const moonDirection = directionFrom(moonAzimuth(minuteOfDay), MOON_ELEVATION);

    (uniforms.sunDirection.value as Vector3).copy(sunDirection);
    (uniforms.sunColor.value as Color).copy(this.sunColor);
    uniforms.sunStrength.value = palette.sunStrength;
    (uniforms.moonDirection.value as Vector3).copy(moonDirection);
    uniforms.moonStrength.value = palette.moonStrength;
    uniforms.starStrength.value = palette.starStrength;
    (uniforms.cloudLit.value as Color).setHex(palette.cloudLit);
    (uniforms.cloudShade.value as Color).setHex(palette.cloudShade);
    uniforms.time.value = elapsedSeconds;

    const state = this.state;
    state.lampFactor = palette.lampFactor;
    state.windowFactor = palette.windowFactor;
    const moonlit = palette.moonStrength > palette.sunStrength;
    state.lightDirection.copy(moonlit ? moonDirection : sunDirection);
    state.lightColor.setHex(moonlit ? 0xc9d3ea : palette.sunColor);
    state.glintStrength = moonlit ? palette.moonStrength * 0.4 : palette.sunStrength;
    state.seaDeep.setHex(palette.seaDeep);
    state.seaShallow.setHex(palette.seaShallow);
    state.seaGlint.setHex(palette.seaGlint);
    state.horizon.copy(this.skyHorizon);
  }
}

/** A unit vector from an azimuth (from +X towards +Z) and an elevation. */
function directionFrom(azimuth: number, elevation: number): Vector3 {
  return new Vector3(
    Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.sin(azimuth) * Math.cos(elevation),
  );
}

/**
 * Where the moon stands: it rises in the east at dusk, crosses the northern
 * sky over the sea in the small hours, and sets in the west by dawn. The
 * northern path is a liberty taken so the moon and its glint lie over the
 * water in the default view (SPEC.md 2.14).
 */
function moonAzimuth(minuteOfDay: number): number {
  const nightLength = MINUTES_PER_GAME_DAY - (SUNSET_MINUTE - SUNRISE_MINUTE);
  const sinceSunset = (minuteOfDay - SUNSET_MINUTE + MINUTES_PER_GAME_DAY) % MINUTES_PER_GAME_DAY;
  const through = Math.min(1, sinceSunset / nightLength);
  return -through * Math.PI;
}

/** Blends the two palette stops around the given time. */
export function paletteAt(minuteOfDay: number): TimePalette {
  const stops = TIME_PALETTES;
  let nextIndex = stops.findIndex((stop) => stop.minuteOfDay > minuteOfDay);
  if (nextIndex === -1) {
    nextIndex = 0;
  }
  const fromIndex = (nextIndex - 1 + stops.length) % stops.length;

  const from = stops[fromIndex];
  const to = stops[nextIndex];

  const span =
    (to.minuteOfDay - from.minuteOfDay + MINUTES_PER_GAME_DAY) % MINUTES_PER_GAME_DAY ||
    MINUTES_PER_GAME_DAY;
  const into = (minuteOfDay - from.minuteOfDay + MINUTES_PER_GAME_DAY) % MINUTES_PER_GAME_DAY;
  // Ease the blend so the sky lingers in each palette and turns over quickly.
  const t = smoothStep(Math.min(1, into / span));

  return {
    minuteOfDay,
    name: t < 0.5 ? from.name : to.name,
    skyTop: mixHex(from.skyTop, to.skyTop, t),
    skyHorizon: mixHex(from.skyHorizon, to.skyHorizon, t),
    ambientSky: mixHex(from.ambientSky, to.ambientSky, t),
    ambientGround: mixHex(from.ambientGround, to.ambientGround, t),
    ambientIntensity: mix(from.ambientIntensity, to.ambientIntensity, t),
    sunColor: mixHex(from.sunColor, to.sunColor, t),
    sunIntensity: mix(from.sunIntensity, to.sunIntensity, t),
    rimIntensity: mix(from.rimIntensity, to.rimIntensity, t),
    lampFactor: mix(from.lampFactor, to.lampFactor, t),
    windowFactor: mix(from.windowFactor, to.windowFactor, t),
    seaDeep: mixHex(from.seaDeep, to.seaDeep, t),
    seaShallow: mixHex(from.seaShallow, to.seaShallow, t),
    seaGlint: mixHex(from.seaGlint, to.seaGlint, t),
    cloudLit: mixHex(from.cloudLit, to.cloudLit, t),
    cloudShade: mixHex(from.cloudShade, to.cloudShade, t),
    sunStrength: mix(from.sunStrength, to.sunStrength, t),
    starStrength: mix(from.starStrength, to.starStrength, t),
    moonStrength: mix(from.moonStrength, to.moonStrength, t),
  };
}

/** Where the sun stands: due east at sunrise, due south at noon, due west at sunset. */
export function sunAngles(minuteOfDay: number): { azimuth: number; elevation: number } {
  const dayLength = SUNSET_MINUTE - SUNRISE_MINUTE;
  const nightLength = MINUTES_PER_GAME_DAY - dayLength;

  const isDaytime = minuteOfDay >= SUNRISE_MINUTE && minuteOfDay < SUNSET_MINUTE;

  if (isDaytime) {
    const through = (minuteOfDay - SUNRISE_MINUTE) / dayLength;
    return {
      azimuth: NOON_AZIMUTH - Math.PI / 2 + through * Math.PI,
      elevation: Math.max(MIN_SUN_ELEVATION, Math.sin(through * Math.PI) * MAX_SUN_ELEVATION),
    };
  }

  // After sunset the light keeps swinging round at a grazing angle, so the
  // night has a soft direction to it and nothing pops when the sun sets.
  const sinceSunset = (minuteOfDay - SUNSET_MINUTE + MINUTES_PER_GAME_DAY) % MINUTES_PER_GAME_DAY;
  return {
    azimuth: NOON_AZIMUTH + Math.PI / 2 + (sinceSunset / nightLength) * Math.PI,
    elevation: MIN_SUN_ELEVATION,
  };
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function mixHex(from: number, to: number, t: number): number {
  const a = new Color().setHex(from);
  const b = new Color().setHex(to);
  return a.lerp(b, t).getHex();
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}
