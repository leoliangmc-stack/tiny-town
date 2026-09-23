import {
  DoubleSide,
  Group,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';

/**
 * The rainbow button (SPEC.md 2.8, decision 38). One press stands a rainbow
 * over the sea, a second makes it a double one (a fainter secondary bow
 * outside, its colours reversed), a third takes it down. Rain is only rain:
 * nothing here watches the weather to raise a bow by itself.
 *
 * It is pure render side. It is placed when it first appears, so that its
 * top sits near the top of the viewer's picture over the water, and it keeps
 * turning to face the camera. Cloud, rain and night only make it fainter.
 */

export type RainbowMode = 'none' | 'single' | 'double';

/** Real seconds to fade in and out. */
const FADE_IN_SECONDS = 2.5;
const FADE_OUT_SECONDS = 1.5;

/** How far out from the point the camera looks at the bow stands: over the sea. */
const DISTANCE = 170;
/** Where the bow's top lands on the screen, from -1 at the bottom to 1 at the top. */
const APEX_SCREEN_HEIGHT = 0.86;
const MIN_RADIUS = 50;
/** The band's width against the bow's radius, as in the sky: about 2 of 42 degrees. */
const BAND = 0.075;
/** The secondary bow's radius against the primary's: 51 over 42 degrees. */
const SECONDARY_RATIO = 1.21;
/** How much of the bow survives at night: a pale moonbow. */
const NIGHT_STRENGTH = 0.35;
/** How much survives while it pours. */
const RAIN_STRENGTH = 0.6;

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

  private readonly primary: Mesh<RingGeometry, ShaderMaterial>;
  private readonly secondary: Mesh<RingGeometry, ShaderMaterial>;
  private current: RainbowMode = 'none';
  /** Fade of each bow, from 0 to 1. */
  private primaryFade = 0;
  private secondaryFade = 0;

  constructor() {
    this.root.name = 'rainbow';
    this.primary = makeBow(false);
    this.secondary = makeBow(true);
    this.root.add(this.primary, this.secondary);
    this.root.visible = false;
  }

  /** What the button has asked for: nothing, one bow or two. */
  get mode(): RainbowMode {
    return this.current;
  }

  /**
   * The button: none, then a rainbow, then a double, then none again. A new
   * rainbow is stood where the viewer is looking; the double keeps it there.
   */
  cycle(camera: PerspectiveCamera, target: Vector3): RainbowMode {
    const next = nextRainbowMode(this.current);
    this.setMode(next, camera, target);
    return next;
  }

  /** Sets the rainbow outright, for the button, tooling and screenshots. */
  setMode(mode: RainbowMode, camera: PerspectiveCamera, target: Vector3): void {
    if (this.current === 'none' && mode !== 'none') {
      this.place(camera, target);
    }
    this.current = mode;
  }

  /** Takes it down: fades out from wherever it is. */
  clear(): void {
    this.current = 'none';
  }

  /** Stands the bows over the sea along the way the camera looks. */
  private place(camera: PerspectiveCamera, target: Vector3): void {
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
      bow.scale.setScalar(radius * scale);
      bow.material.uniforms.inner.value = 1 - BAND;
      bow.material.uniforms.outer.value = 1;
    }
  }

  /**
   * Moves the fades on. `rain` is how hard it is raining (0 to 1), `cloud`
   * how overcast it is, and `daylight` 1 by day and 0 at night.
   */
  update(
    deltaSeconds: number,
    rain: number,
    cloud: number,
    daylight: number,
    camera: PerspectiveCamera,
  ): void {
    const approach = (value: number, wanted: number): number =>
      wanted > value
        ? Math.min(wanted, value + deltaSeconds / FADE_IN_SECONDS)
        : Math.max(wanted, value - deltaSeconds / FADE_OUT_SECONDS);
    this.primaryFade = approach(this.primaryFade, this.current === 'none' ? 0 : 1);
    this.secondaryFade = approach(this.secondaryFade, this.current === 'double' ? 1 : 0);

    const weather = (1 - (1 - RAIN_STRENGTH) * rain) * (1 - 0.45 * cloud);
    const light = NIGHT_STRENGTH + (1 - NIGHT_STRENGTH) * daylight;
    const strength = weather * light;
    this.primary.material.uniforms.strength.value = this.primaryFade * strength * 0.55;
    this.secondary.material.uniforms.strength.value = this.secondaryFade * strength * 0.26;
    this.primary.visible = this.primaryFade > 0.002;
    this.secondary.visible = this.secondaryFade > 0.002;
    this.root.visible = this.primary.visible;
    if (!this.root.visible) {
      return;
    }

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

/** What one press of the 🌈 button turns a rainbow into. */
export function nextRainbowMode(mode: RainbowMode): RainbowMode {
  return mode === 'none' ? 'single' : mode === 'single' ? 'double' : 'none';
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
