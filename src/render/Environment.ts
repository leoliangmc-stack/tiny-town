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
  Vector4,
} from 'three';

import { MINUTES_PER_GAME_DAY } from '../simulation/constants.js';
import { Rng } from '../simulation/Rng.js';

import {
  beaconFactorAt,
  SUNRISE_MINUTE,
  SUNSET_MINUTE,
  TIME_PALETTES,
  type TimePalette,
} from './palettes.js';

/** Radius of the sky dome. It sits outside everything else in the scene. */
export const SKY_RADIUS = 900;

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

/**
 * The leading stars of the night (DESIGN.md §20): the few that carry a bloom
 * and a spike. They are placed once, with the seeded generator, and handed to
 * the sky shader as uniforms; the thousands behind them come from hash grids
 * inside the shader.
 */
const BRIGHT_STAR_COUNT = 48;

/**
 * Star colours by temperature, roughly in the proportions the naked eye meets
 * them: blue-white, white, yellow-white, yellow-orange and orange-red. The
 * shader carries the same table for the stars it makes itself.
 */
const STAR_COLORS: ReadonlyArray<{ upTo: number; color: [number, number, number] }> = [
  { upTo: 0.12, color: [0.72, 0.82, 1.0] },
  { upTo: 0.45, color: [0.96, 0.97, 1.0] },
  { upTo: 0.75, color: [1.0, 0.95, 0.82] },
  { upTo: 0.92, color: [1.0, 0.85, 0.6] },
  { upTo: 1.0, color: [1.0, 0.62, 0.42] },
];

function starColor(t: number): Color {
  const entry = STAR_COLORS.find((candidate) => t < candidate.upTo) ?? STAR_COLORS[4];
  return new Color(...entry.color);
}

/** Direction, brightness and colour of the leading stars, in a fixed order. */
function brightStars(): { directions: Vector4[]; colors: Color[] } {
  const rng = new Rng('sky:bright-stars');
  const directions: Vector4[] = [];
  const colors: Color[] = [];
  for (let k = 0; k < BRIGHT_STAR_COUNT; k += 1) {
    const y = rng.nextFloat(0.12, 1);
    const azimuth = rng.nextFloat(0, Math.PI * 2);
    const radius = Math.sqrt(1 - y * y);
    // A few blaze, most are merely bright.
    const magnitude = Math.pow(rng.next(), 1.6);
    directions.push(
      new Vector4(Math.cos(azimuth) * radius, y, Math.sin(azimuth) * radius, magnitude),
    );
    colors.push(starColor(rng.next()));
  }
  return { directions, colors };
}

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
  uniform float moonFull;
  uniform float starStrength;
  uniform vec3 cloudLit;
  uniform vec3 cloudShade;
  uniform float cloudCover;
  uniform float time;
  uniform vec4 brightStars[BRIGHT_STAR_COUNT];
  uniform vec3 brightColors[BRIGHT_STAR_COUNT];
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

  // Star colours by temperature; the same table as STAR_COLORS on the CPU.
  vec3 starColor(float t) {
    if (t < 0.12) return vec3(0.72, 0.82, 1.0);
    if (t < 0.45) return vec3(0.96, 0.97, 1.0);
    if (t < 0.75) return vec3(1.0, 0.95, 0.82);
    if (t < 0.92) return vec3(1.0, 0.85, 0.6);
    return vec3(1.0, 0.62, 0.42);
  }

  // Maps a direction onto one face of a cube: the face index and the
  // coordinates on it, so a grid of cells on the face becomes a grid of
  // patches on the sphere with no slivers. The inverse takes them back.
  vec2 cubeFace(vec3 dir, out float face) {
    vec3 a = abs(dir);
    if (a.x >= a.y && a.x >= a.z) {
      face = dir.x > 0.0 ? 0.0 : 1.0;
      return dir.yz / a.x;
    }
    if (a.y >= a.z) {
      face = dir.y > 0.0 ? 2.0 : 3.0;
      return dir.xz / a.y;
    }
    face = dir.z > 0.0 ? 4.0 : 5.0;
    return dir.xy / a.z;
  }

  vec3 cubeDir(vec2 uv, float face) {
    if (face < 0.5) return normalize(vec3(1.0, uv));
    if (face < 1.5) return normalize(vec3(-1.0, uv));
    if (face < 2.5) return normalize(vec3(uv.x, 1.0, uv.y));
    if (face < 3.5) return normalize(vec3(uv.x, -1.0, uv.y));
    if (face < 4.5) return normalize(vec3(uv, 1.0));
    return normalize(vec3(uv, -1.0));
  }

  // One layer of stars from a hash grid on the cube faces: at most one star
  // per cell, each with its own place, brightness, colour and twinkle.
  // \`scale\` sets how fine the grid is and so how many stars there are;
  // \`threshold\` how many cells stay empty; \`size\` the angular radius of
  // the brightest, in radians.
  vec3 starLayer(vec3 dir, float scale, float threshold, float size, float t) {
    float face;
    vec2 uv = cubeFace(dir, face);
    vec2 cell = uv * scale;
    vec2 i = floor(cell);
    vec3 key = vec3(i, face * 7.0 + 3.0);
    float seed = hash(key);
    // Cells shrink towards the cube's corners; thin the stars there to keep
    // the sky even.
    float shrink = pow(1.0 + dot(uv, uv), 1.5);
    if (seed < 1.0 - (1.0 - threshold) / shrink) return vec3(0.0);
    vec2 offset = vec2(hash(key + 1.3), hash(key + 2.7)) - 0.5;
    vec3 starDir = cubeDir((i + 0.5 + offset * 0.5) / scale, face);
    float ang = length(dir - starDir);
    // Most stars are faint; a magnitude distribution, not a coin toss.
    float mag = pow(hash(key + 7.7), 3.0);
    float radius = size * (0.35 + 1.0 * mag);
    float core = smoothstep(radius, radius * 0.3, ang);
    float glow = exp(-(ang * ang) / (radius * radius * 2.0)) * mag * 0.5;
    // A star's glow must die before the cell's edge, or the edge cuts it:
    // fade it radially inside the star's own distance to that edge.
    float edgeDistance = (0.5 - max(abs(offset.x), abs(offset.y)) * 0.5) / scale;
    glow *= smoothstep(edgeDistance, edgeDistance * 0.45, ang);
    float twinkle = 0.78 + 0.22 * sin(t * (1.1 + 2.2 * hash(key + 5.5)) + seed * 60.0);
    return starColor(hash(key + 9.1)) * (core + glow) * (0.2 + 0.8 * mag) * twinkle;
  }

  void main() {
    vec3 dir = normalize(vWorldPosition);
    float height = clamp(dir.y, 0.0, 1.0);

    // The gradient: the horizon band gives way to the top colour well before
    // the zenith, so a low view still sees the sky's own colour.
    vec3 color = mix(horizonColor, topColor, smoothstep(0.0, 0.45, height));

    // The night sky (DESIGN.md §20): a Milky Way with structure, thousands of
    // faint stars, hundreds of middling ones and a few dozen that blaze.
    if (starStrength > 0.001 && dir.y > -0.02) {
      float horizonFade = smoothstep(-0.02, 0.18, dir.y);

      // The Milky Way's frame: a great circle that arches over the sea, from
      // the east horizon up through the northern sky and down to the west,
      // with its bright core over the water.
      vec3 bandNormal = normalize(vec3(0.15, -0.7, -0.7));
      vec3 bandU = normalize(cross(bandNormal, vec3(0.0, 1.0, 0.0)));
      vec3 bandV = cross(bandNormal, bandU);
      float across = dot(dir, bandNormal);
      float along = atan(dot(dir, bandV), dot(dir, bandU));
      vec3 coreDir = normalize(vec3(0.1, 0.75, -0.65));
      float coreAlong = atan(dot(coreDir, bandV), dot(coreDir, bandU));
      float coreness = 0.5 + 0.5 * cos(along - coreAlong);

      // The band: a bright core that widens, ragged edges, wisps of structure
      // and a dark dust lane that splits it, wandering as it goes.
      float ragged = 0.65 + 0.7 * fbm(vec2(along * 2.5, 11.0));
      float width = (0.05 + 0.09 * coreness) * ragged;
      float profile = exp(-(across * across) / (width * width));
      // Clumps and rifts rather than streaks: the noise is warped by itself
      // so nothing lines up with the band.
      vec2 bandCoord = vec2(along * 9.0, across * 7.0);
      vec2 warp = vec2(fbm(bandCoord + 2.0), fbm(bandCoord + 5.0)) - 0.5;
      float structure = fbm(bandCoord + warp * 1.5);
      float wisps = fbm(bandCoord * 2.6 + warp * 2.0 + 7.0);
      float laneCentre = 0.015 * sin(along * 2.0 + 0.8) + 0.01 * sin(along * 5.0);
      float laneWidth = 0.018 + 0.014 * coreness;
      float lane = exp(-pow((across - laneCentre) / laneWidth, 2.0))
        * (0.5 + 0.5 * coreness)
        * (0.55 + 0.45 * fbm(vec2(along * 4.0, 3.0)));
      float glow = profile * pow(0.25 + 0.75 * structure, 2.2) * (0.5 + 0.8 * wisps) * (0.25 + 0.75 * coreness);
      glow *= 1.0 - 0.85 * lane;
      vec3 milkyColor = mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.86, 0.62), coreness * 0.9);
      color += milkyColor * glow * 0.95 * starStrength * horizonFade;

      // Stars: the faint dust of the sky, denser inside the band; the
      // middling stars; and the leading few with a bloom and a spike.
      vec3 stars = vec3(0.0);
      stars += starLayer(dir, 230.0, 0.72 - 0.4 * profile, 0.0007, time) * 0.7;
      stars += starLayer(dir, 70.0, 0.84, 0.0018, time);
      color += stars * starStrength * horizonFade;

      for (int k = 0; k < BRIGHT_STAR_COUNT; k++) {
        vec3 s = brightStars[k].xyz;
        float mag = brightStars[k].w;
        float ang = length(dir - s);
        if (ang > 0.08) continue;
        float radius = 0.0022 + 0.003 * mag;
        float core = smoothstep(radius, radius * 0.3, ang);
        float bloom = exp(-ang * ang / (radius * radius * 7.0)) * 0.6;
        vec3 tangent = normalize(cross(s, abs(s.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 bitangent = cross(s, tangent);
        vec3 delta = dir - s;
        float sx = dot(delta, tangent);
        float sy = dot(delta, bitangent);
        float spike = exp(-abs(sx) * 80.0) * exp(-abs(sy) * 1500.0)
          + exp(-abs(sy) * 80.0) * exp(-abs(sx) * 1500.0);
        float twinkle = 0.86 + 0.14 * sin(time * 2.0 + float(k) * 1.7);
        float light = (core * 1.6 + bloom + spike * 0.7 * mag * mag) * (0.5 + 0.7 * mag);
        color += brightColors[k] * light * starStrength * twinkle * horizonFade;
      }
    }

    // The moon: a crescent with maria, lit from the side, with a soft halo
    // that stays well below the stars.
    if (moonStrength > 0.001) {
      float mc = dot(dir, moonDirection);
      // The usual moon is a crescent; on Mid-Autumn night it is full,
      // larger and warmer (SPEC.md 2.15).
      float moonRadius = mix(0.03, 0.05, moonFull);
      float moonDisc = disc(dir, moonDirection, 1.0 - moonRadius * moonRadius * 0.5, 0.00004 + 0.0001 * moonFull);
      vec3 moonT = normalize(cross(moonDirection, vec3(0.0, 1.0, 0.0)));
      vec3 moonB = cross(moonDirection, moonT);
      vec3 md = dir - moonDirection;
      vec2 mp = vec2(dot(md, moonT), dot(md, moonB)) / moonRadius;
      float r2 = dot(mp, mp);
      vec3 sphereNormal = vec3(mp, sqrt(max(0.0, 1.0 - r2)));
      vec3 phaseLight = normalize(mix(vec3(0.8, 0.2, 0.22), vec3(0.0, 0.0, 1.0), moonFull));
      float lambert = dot(sphereNormal, phaseLight);
      float maria = 0.72 + 0.28 * smoothstep(0.4, 0.62, fbm(mp * 3.2 + 3.0) * 0.7 + fbm(mp * 7.0 + 9.0) * 0.3);
      float limb = 0.8 + 0.2 * sphereNormal.z;
      float lit = 0.05 + 0.95 * smoothstep(-0.08, 0.4, lambert);
      vec3 moonFace = mix(vec3(0.93, 0.92, 0.86), vec3(1.0, 0.8, 0.5), moonFull) * maria * limb * lit;
      // The full moon is kept below white so its gold survives tone mapping.
      color += moonFace * moonDisc * moonStrength * mix(1.5, 1.05, moonFull);
      float halo = pow(max(mc, 0.0), 700.0) * 0.16 + pow(max(mc, 0.0), 140.0) * 0.04;
      halo += moonFull * (pow(max(mc, 0.0), 300.0) * 0.12 + pow(max(mc, 0.0), 40.0) * 0.035);
      color += mix(vec3(0.75, 0.8, 0.95), vec3(1.0, 0.85, 0.6), moonFull) * halo * moonStrength;
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
      // Nights are clear: the stars are the subject then (DESIGN.md §20).
      float cover = smoothstep(edge, edge + 0.14, n) * (1.0 - 0.85 * starStrength);
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
  /** The lighthouse: on only in the dark, where the street lamps start at dusk. */
  beaconFactor: number;
  windowFactor: number;
  /** Unit vector towards the sun by day, or the moon by night. */
  lightDirection: Vector3;
  /** Colour of the light on the water and the clouds. */
  lightColor: Color;
  /** How strongly the sea should glint under the light, 0 to 1. */
  glintStrength: number;
  /** How much of the day's sun is up, 0 at night and 1 at noon. */
  daylight: number;
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
  private fogNear = 170;
  private fogFar = 340;
  private cloud = 0;
  private rain = 0;
  /** Where the full moon hangs on Mid-Autumn night; undefined on any other. */
  private fullMoon: Vector3 | undefined;
  /**
   * Where the full moon's disc is drawn, if not at `fullMoon`: the Moon Palace
   * keeps it lined up behind itself from wherever the camera is. The light
   * and the glint on the sea keep to `fullMoon`, so shadows never swing
   * as the camera turns.
   */
  private moonDisc: Vector3 | undefined;

  private readonly skyTop = new Color();
  private readonly skyHorizon = new Color();
  private readonly fogColor = new Color();
  private readonly ambientSky = new Color();
  private readonly ambientGround = new Color();
  private readonly sunColor = new Color();

  readonly state: EnvironmentState = {
    lampFactor: 0,
    beaconFactor: 0,
    windowFactor: 0,
    lightDirection: new Vector3(0, 1, 0),
    lightColor: new Color(),
    glintStrength: 0,
    daylight: 0,
    seaDeep: new Color(),
    seaShallow: new Color(),
    seaGlint: new Color(),
    horizon: new Color(),
  };

  constructor(scene: Scene) {
    const stars = brightStars();
    this.skyMaterial = new ShaderMaterial({
      uniforms: {
        topColor: { value: new Color(0x4b8ed2) },
        horizonColor: { value: new Color(0xcbe7f9) },
        sunDirection: { value: new Vector3(0, 1, 0) },
        sunColor: { value: new Color(0xfff6e4) },
        sunStrength: { value: 1 },
        moonDirection: { value: new Vector3(0, 1, 0) },
        moonStrength: { value: 0 },
        moonFull: { value: 0 },
        starStrength: { value: 0 },
        cloudLit: { value: new Color(0xffffff) },
        cloudShade: { value: new Color(0xc2cfdd) },
        cloudCover: { value: 0.45 },
        time: { value: 0 },
        brightStars: { value: stars.directions },
        brightColors: { value: stars.colors },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      defines: { BRIGHT_STAR_COUNT },
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
   * Sets the shadow map size, or turns shadows off with 0 (Phase 7 quality
   * tiers). The old map is dropped so the renderer makes a new one.
   */
  setShadowMap(size: number): void {
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
    }
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  /**
   * Sets where the haze starts and ends. The camera backs off further on a
   * narrow screen, so the range follows the framing rather than being fixed.
   */
  /**
   * Mid-Autumn night (SPEC.md 2.15): a full moon at the given direction, or
   * back to the usual crescent on its usual path with undefined.
   */
  setFullMoon(direction: Vector3 | undefined): void {
    this.fullMoon = direction?.clone().normalize();
    this.moonDisc = undefined;
  }

  /** Draws the full moon's disc along this direction; undefined puts it back. */
  setMoonDisc(direction: Vector3 | undefined): void {
    if (!direction) {
      this.moonDisc = undefined;
      return;
    }
    this.moonDisc = (this.moonDisc ?? new Vector3()).copy(direction).normalize();
  }

  setFogRange(near: number, far: number): void {
    this.fogNear = near;
    this.fogFar = far;
  }

  /**
   * How overcast and how wet the picture is, 0 to 1 each, eased by the
   * caller over the transition (SPEC.md 2.8). Cloud greys and darkens the
   * sky and the light and thickens the cloud layer; rain brings the haze in.
   */
  setWeather(cloud: number, rain: number): void {
    this.cloud = cloud;
    this.rain = rain;
  }

  /**
   * Moves the whole environment to the given minute of the game day.
   * `elapsedSeconds` is real time, for the clouds' drift and the stars'
   * twinkle only; it never touches the simulation.
   */
  update(minuteOfDay: number, elapsedSeconds = 0): void {
    const palette = paletteAt(minuteOfDay);
    const uniforms = this.skyMaterial.uniforms;
    const { cloud, rain } = this;

    this.skyTop.setHex(palette.skyTop);
    this.skyHorizon.setHex(palette.skyHorizon);
    this.fogColor.setHex(palette.skyHorizon);
    this.ambientSky.setHex(palette.ambientSky);
    this.ambientGround.setHex(palette.ambientGround);
    this.sunColor.setHex(palette.sunColor);

    // Overcast: the sky loses its colour and a little of its light; the
    // horizon and the haze go the same grey, so the join stays invisible.
    overcast(this.skyTop, cloud, 0.28 + 0.1 * rain);
    overcast(this.skyHorizon, cloud, 0.14 + 0.08 * rain);
    overcast(this.fogColor, cloud, 0.14 + 0.08 * rain);
    overcast(this.ambientSky, cloud, 0.12);
    overcast(this.sunColor, cloud, 0.1);
    this.fog.near = this.fogNear * (1 - 0.25 * rain);
    this.fog.far = this.fogFar * (1 - 0.18 * rain);

    (uniforms.topColor.value as Color).copy(this.skyTop);
    (uniforms.horizonColor.value as Color).copy(this.skyHorizon);
    this.fog.color.copy(this.fogColor);

    this.hemisphere.color.copy(this.ambientSky);
    this.hemisphere.groundColor.copy(this.ambientGround);
    this.hemisphere.intensity = palette.ambientIntensity * (1 - 0.15 * cloud);

    this.sun.color.copy(this.sunColor);
    this.sun.intensity = palette.sunIntensity * (1 - 0.55 * cloud - 0.15 * rain);

    const { azimuth, elevation } = sunAngles(minuteOfDay);

    // A sun on the horizon throws shadows the length of the map, which reads as
    // scratches across the grass rather than as light. Fade them out instead.
    this.sun.shadow.intensity =
      SHADOW_STRENGTH *
      (1 - 0.75 * cloud) *
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
    const moonDirection = this.fullMoon
      ? this.fullMoon.clone()
      : directionFrom(moonAzimuth(minuteOfDay), MOON_ELEVATION);

    (uniforms.sunDirection.value as Vector3).copy(sunDirection);
    (uniforms.sunColor.value as Color).copy(this.sunColor);
    uniforms.sunStrength.value = palette.sunStrength * (1 - 0.9 * cloud);
    uniforms.cloudCover.value = 0.45 + 0.7 * cloud;
    (uniforms.cloudLit.value as Color).lerp(uniforms.cloudShade.value as Color, cloud * 0.55);
    (uniforms.moonDirection.value as Vector3).copy(
      this.fullMoon && this.moonDisc ? this.moonDisc : moonDirection,
    );
    const full = this.fullMoon ? 1 : 0;
    uniforms.moonFull.value = full;
    uniforms.moonStrength.value = palette.moonStrength * (1 - 0.8 * cloud);
    // A full moon washes out the faintest stars.
    uniforms.starStrength.value = palette.starStrength * (1 - 0.3 * full) * (1 - 0.85 * cloud);
    (uniforms.cloudLit.value as Color).setHex(palette.cloudLit);
    (uniforms.cloudShade.value as Color).setHex(palette.cloudShade);
    uniforms.time.value = elapsedSeconds;

    const state = this.state;
    state.lampFactor = palette.lampFactor;
    state.beaconFactor = this.fullMoon ? 1 : beaconFactorAt(minuteOfDay);
    state.windowFactor = palette.windowFactor;
    const moonlit = palette.moonStrength > palette.sunStrength;
    state.lightDirection.copy(moonlit ? moonDirection : sunDirection);
    state.lightColor.setHex(moonlit ? 0xc9d3ea : palette.sunColor);
    state.daylight = Math.min(1, palette.sunStrength);
    state.glintStrength =
      (moonlit ? palette.moonStrength * 0.4 : palette.sunStrength) * (1 - cloud);
    state.seaDeep.setHex(palette.seaDeep);
    state.seaShallow.setHex(palette.seaShallow);
    overcast(state.seaDeep, cloud, 0.15);
    overcast(state.seaShallow, cloud, 0.15);
    state.seaGlint.setHex(palette.seaGlint);
    state.horizon.copy(this.skyHorizon);
  }
}

/** Greys a colour towards its own luminance and darkens it, by `amount`. */
function overcast(color: Color, amount: number, darken: number): void {
  if (amount <= 0) {
    return;
  }
  const luminance = 0.3 * color.r + 0.59 * color.g + 0.11 * color.b;
  color.lerp(new Color(luminance, luminance, luminance), amount * 0.8);
  color.multiplyScalar(1 - darken * amount);
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
