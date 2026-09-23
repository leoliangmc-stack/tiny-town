import {
  DoubleSide,
  Group,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';

import { Rng } from '../simulation/Rng.js';

/**
 * The rainbow after rain (SPEC.md 2.8, decision 36). When the viewer turns
 * the rain off by day, a rainbow usually stands over the sea, and now and
 * then a double one: a fainter secondary bow outside, its colours reversed.
 *
 * It is pure render side. The dice are this module's own seeded generator,
 * never the world's, so the simulation and its hash cannot tell a rainbow
 * happened. It is placed once, when it appears, so that its top sits near
 * the top of the viewer's picture over the water, and it keeps turning to
 * face the camera.
 */

const RAINBOW_CHANCE = 0.85;
const DOUBLE_CHANCE = 0.3;

/** How long it stands, in game minutes, but never less than this many real seconds. */
const HOLD_GAME_MINUTES = 40;
const HOLD_MIN_SECONDS = 12;
/** Real seconds to fade out at the end. */
const FADE_OUT_SECONDS = 5;

/** How far out from the point the camera looks at the bow stands: over the sea. */
const DISTANCE = 170;
/** Where the bow's top lands on the screen, from -1 at the bottom to 1 at the top. */
const APEX_SCREEN_HEIGHT = 0.86;
const MIN_RADIUS = 50;
/** The band's width against the bow's radius, as in the sky: about 2 of 42 degrees. */
const BAND = 0.075;
/** The secondary bow's radius against the primary's: 51 over 42 degrees. */
const SECONDARY_RATIO = 1.21;

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vLocal;
  varying float vWorldY;
  void main() {
    vLocal = position.xy;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldY = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float inner;
  uniform float outer;
  uniform float strength;
  uniform float reversed;
  varying vec2 vLocal;
  varying float vWorldY;

  // Red on the outside of a primary bow, violet inside.
  vec3 spectrum(float t) {
    vec3 c = vec3(0.0);
    c += vec3(0.55, 0.25, 0.85) * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.12, 0.28, t));
    c += vec3(0.25, 0.45, 1.0) * smoothstep(0.12, 0.26, t) * (1.0 - smoothstep(0.26, 0.42, t));
    c += vec3(0.25, 0.85, 0.45) * smoothstep(0.3, 0.44, t) * (1.0 - smoothstep(0.44, 0.6, t));
    c += vec3(1.0, 0.92, 0.3) * smoothstep(0.48, 0.6, t) * (1.0 - smoothstep(0.6, 0.74, t));
    c += vec3(1.0, 0.6, 0.2) * smoothstep(0.6, 0.72, t) * (1.0 - smoothstep(0.72, 0.86, t));
    c += vec3(1.0, 0.25, 0.2) * smoothstep(0.72, 0.86, t) * (1.0 - smoothstep(0.9, 1.0, t));
    return c;
  }

  void main() {
    float r = length(vLocal);
    float t = clamp((r - inner) / (outer - inner), 0.0, 1.0);
    if (reversed > 0.5) t = 1.0 - t;
    vec3 color = spectrum(t);
    // Soft at both edges, and gone where it meets the sea.
    float edge = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.82, 1.0, t));
    float foot = smoothstep(0.0, 18.0, vWorldY);
    float alpha = edge * foot * strength;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

export class Rainbow {
  readonly root = new Group();

  private readonly rng = new Rng('rainbow');
  private readonly primary: Mesh<RingGeometry, ShaderMaterial>;
  private readonly secondary: Mesh<RingGeometry, ShaderMaterial>;
  private double = false;
  private active = false;
  /** Game minutes and real seconds since it appeared. */
  private gameMinutes = 0;
  private seconds = 0;
  /** Fade from 0 to 1 while it comes, then down again. */
  private envelope = 0;

  constructor() {
    this.root.name = 'rainbow';
    this.primary = makeBow(false);
    this.secondary = makeBow(true);
    this.root.add(this.primary, this.secondary);
    this.root.visible = false;
  }

  /** Whether a rainbow is up right now, and whether it is a double. */
  get state(): { active: boolean; double: boolean } {
    return { active: this.active, double: this.double };
  }

  /**
   * The rain has just stopped. Roll for a rainbow; if one comes, stand it
   * over the sea near the top of the picture. Returns whether one came.
   */
  rainStopped(camera: PerspectiveCamera, target: Vector3): boolean {
    if (this.rng.next() >= RAINBOW_CHANCE) {
      return false;
    }
    this.double = this.rng.next() < DOUBLE_CHANCE;
    this.show(camera, target);
    return true;
  }

  /** Stands a rainbow up now, whatever the dice say. For tooling and screenshots. */
  show(camera: PerspectiveCamera, target: Vector3, double = this.double): void {
    this.double = double;
    this.active = true;
    this.gameMinutes = 0;
    this.seconds = 0;
    this.envelope = 0;

    // Out along the way the camera looks, flattened onto the ground.
    const forward = target.clone().sub(camera.position).setY(0).normalize();
    const centre = target.clone().addScaledVector(forward, DISTANCE);
    centre.y = 0;

    // The bow's top lands near the top of the picture: cast the ray through
    // that point of the screen and see how high it is where the bow stands.
    const ray = new Vector3(0, APEX_SCREEN_HEIGHT, 0.5).unproject(camera).sub(camera.position);
    const reach =
      centre.clone().sub(camera.position).dot(forward) / Math.max(1e-3, ray.dot(forward));
    const apexHeight = camera.position.y + ray.y * reach;
    const radius = Math.max(MIN_RADIUS, apexHeight);

    for (const [bow, scale] of [
      [this.primary, 1],
      [this.secondary, SECONDARY_RATIO],
    ] as const) {
      bow.position.copy(centre);
      const outer = radius * scale;
      bow.scale.setScalar(outer);
      bow.material.uniforms.inner.value = 1 - BAND;
      bow.material.uniforms.outer.value = 1;
    }
    this.secondary.visible = this.double;
  }

  /** Clears any rainbow at once: rain again, night, or the Mid-Autumn sky. */
  clear(): void {
    this.active = false;
    this.envelope = 0;
    this.root.visible = false;
  }

  /**
   * Moves the rainbow on. `clearSky` is how far the rain has gone (0 while
   * it pours, 1 when it has stopped), `cloud` how overcast it is.
   */
  update(
    deltaSeconds: number,
    gameMinutes: number,
    clearSky: number,
    cloud: number,
    camera: PerspectiveCamera,
  ): void {
    if (!this.active) {
      return;
    }
    this.seconds += deltaSeconds;
    this.gameMinutes += gameMinutes;
    const holding = this.gameMinutes < HOLD_GAME_MINUTES || this.seconds < HOLD_MIN_SECONDS;
    if (holding) {
      this.envelope = Math.min(1, this.envelope + deltaSeconds / 2.5);
    } else {
      this.envelope -= deltaSeconds / FADE_OUT_SECONDS;
      if (this.envelope <= 0) {
        this.clear();
        return;
      }
    }

    const strength = this.envelope * clearSky * (1 - 0.45 * cloud);
    this.root.visible = strength > 0.005;
    this.primary.material.uniforms.strength.value = strength * 0.55;
    this.secondary.material.uniforms.strength.value = strength * 0.26;

    // Face the camera, turning about the vertical only.
    for (const bow of [this.primary, this.secondary]) {
      bow.rotation.set(
        0,
        Math.atan2(camera.position.x - bow.position.x, camera.position.z - bow.position.z),
        0,
      );
    }
  }

  dispose(): void {
    for (const bow of [this.primary, this.secondary]) {
      bow.geometry.dispose();
      bow.material.dispose();
    }
  }
}

/** A half ring of unit outer radius, standing upright in its XY plane. */
function makeBow(reversed: boolean): Mesh<RingGeometry, ShaderMaterial> {
  const geometry = new RingGeometry(1 - BAND, 1, 160, 1, 0, Math.PI);
  const material = new ShaderMaterial({
    uniforms: {
      inner: { value: 1 - BAND },
      outer: { value: 1 },
      strength: { value: 0 },
      reversed: { value: reversed ? 1 : 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = reversed ? 'rainbow-secondary' : 'rainbow-primary';
  mesh.frustumCulled = false;
  // Drawn after the sky and the sea, before the glows.
  mesh.renderOrder = 1;
  return mesh;
}
