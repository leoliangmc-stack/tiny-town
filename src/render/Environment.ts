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
} from 'three';

import { MINUTES_PER_GAME_DAY } from '../simulation/constants.js';

import { SUNRISE_MINUTE, SUNSET_MINUTE, TIME_PALETTES, type TimePalette } from './palettes.js';

/** Radius of the sky dome. It sits outside everything else in the scene. */
const SKY_RADIUS = 400;

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

const SUN_DISTANCE = 220;

/** Shadows fade in over this much elevation above the night time minimum. */
const SHADOW_FADE_ELEVATION = (5 * Math.PI) / 180;

/**
 * How dark a shadow gets at most. Well under one: the town is a soft miniature
 * under diffuse light, not a sundial (DESIGN.md §11).
 */
const SHADOW_STRENGTH = 0.7;

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  varying vec3 vWorldPosition;

  void main() {
    // Blend from the horizon up to the zenith, with the band near the horizon
    // kept tight so dawn and dusk keep their warm edge.
    float height = normalize(vWorldPosition).y;
    float blend = pow(clamp(height, 0.0, 1.0), 1.7);
    gl_FragColor = vec4(mix(horizonColor, topColor, blend), 1.0);

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
}

/**
 * Sky, fog and the two lights that carry the day.
 *
 * Everything here is driven by the game clock, which is what turns the town
 * from dawn to night in front of the viewer (SPEC.md 2.7).
 */
export class Environment {
  readonly sun: DirectionalLight;

  private readonly hemisphere: HemisphereLight;
  private readonly skyMaterial: ShaderMaterial;
  private readonly fog: Fog;

  private readonly skyTop = new Color();
  private readonly skyHorizon = new Color();
  private readonly fogColor = new Color();
  private readonly ambientSky = new Color();
  private readonly ambientGround = new Color();
  private readonly sunColor = new Color();

  readonly state: EnvironmentState = { lampFactor: 0, windowFactor: 0 };

  constructor(scene: Scene) {
    this.skyMaterial = new ShaderMaterial({
      uniforms: {
        topColor: { value: new Color(0x4b8ed2) },
        horizonColor: { value: new Color(0xcbe7f9) },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new Mesh(new SphereGeometry(SKY_RADIUS, 24, 16), this.skyMaterial);
    sky.name = 'sky';
    scene.add(sky);

    // The camera sits about eighty metres out, so the haze starts well beyond
    // the town: near enough to swallow the edge of the ground, far enough to
    // leave the town itself clear.
    this.fog = new Fog(0xcbe7f9, 120, 300);
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
  }

  /**
   * Sets where the haze starts and ends. The camera backs off further on a
   * narrow screen, so the range follows the framing rather than being fixed.
   */
  setFogRange(near: number, far: number): void {
    this.fog.near = near;
    this.fog.far = far;
  }

  /** Moves the whole environment to the given minute of the game day. */
  update(minuteOfDay: number): void {
    const palette = paletteAt(minuteOfDay);

    this.skyTop.setHex(palette.skyTop);
    this.skyHorizon.setHex(palette.skyHorizon);
    this.fogColor.setHex(palette.skyHorizon);
    this.ambientSky.setHex(palette.ambientSky);
    this.ambientGround.setHex(palette.ambientGround);
    this.sunColor.setHex(palette.sunColor);

    (this.skyMaterial.uniforms.topColor.value as Color).copy(this.skyTop);
    (this.skyMaterial.uniforms.horizonColor.value as Color).copy(this.skyHorizon);
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
    this.sun.position.set(
      Math.cos(azimuth) * Math.cos(elevation) * SUN_DISTANCE,
      Math.sin(elevation) * SUN_DISTANCE,
      Math.sin(azimuth) * Math.cos(elevation) * SUN_DISTANCE,
    );

    this.state.lampFactor = palette.lampFactor;
    this.state.windowFactor = palette.windowFactor;
  }
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
    lampFactor: mix(from.lampFactor, to.lampFactor, t),
    windowFactor: mix(from.windowFactor, to.windowFactor, t),
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
    azimuth: Math.PI + (sinceSunset / nightLength) * Math.PI,
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
