import {
  ACESFilmicToneMapping,
  Clock,
  MathUtils,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { DEFAULT_SPEED, type SpeedLevel } from '../simulation/constants.js';
import { TickScheduler } from '../simulation/TickScheduler.js';
import { World } from '../simulation/World.js';

import { CitizenView } from './CitizenView.js';
import { Environment } from './Environment.js';
import { TownView } from './TownView.js';

/**
 * The default camera, as a direction rather than a position, so the framing can
 * react to the shape of the screen.
 *
 * Yaw is measured from +Z towards +X. Landscape sits across the line the sun
 * travels, which keeps dawn and dusk raking across the town instead of flat on
 * or straight into the lens. Portrait turns the camera along the long axis of
 * the town, so it stands up the screen rather than across it (SPEC.md 2.9).
 */
const LANDSCAPE_VIEW = {
  yawDegrees: -52,
  pitchDegrees: 29,
  fieldOfView: 42,
  margin: 0.86,
  lift: 0.07,
};
/**
 * Portrait takes a wider lens. A narrow screen would otherwise push the camera
 * so far back that the town sits in the haze, small and flat.
 */
const PORTRAIT_VIEW = {
  yawDegrees: -96,
  pitchDegrees: 50,
  fieldOfView: 60,
  margin: 0.92,
  lift: 0.05,
};

const CAMERA_TARGET = new Vector3(0, 2, 0);

/**
 * The box the town lives in, relative to CAMERA_TARGET. It is deliberately
 * asymmetric: the town sits on the ground, so there is nothing to frame below
 * it, and the built area is a little smaller than the ground it stands on.
 * Phase 2 reads this from the real layout instead of stating it here.
 */
const TOWN_BOUNDS_MIN = new Vector3(-34, -2, -27);
const TOWN_BOUNDS_MAX = new Vector3(34, 8, 27);

/** Speeds reachable from the keyboard while there is no UI yet. */
const SPEED_KEYS: Record<string, SpeedLevel> = {
  Digit1: 1,
  Digit2: 5,
  Digit3: 20,
  Digit4: 100,
};

/**
 * The renderer side of the app: the Three.js scene and the frame loop that
 * drives the simulation.
 *
 * The simulation never reaches back into here. This class reads the World; the
 * World knows nothing about Three.js (SPEC.md 3.2).
 */
export class App {
  readonly world: World;
  readonly scheduler: TickScheduler;

  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new Clock();

  private readonly environment: Environment;
  private readonly townView = new TownView();
  private readonly citizenView: CitizenView;

  private animationFrame = 0;
  private running = false;
  /** Speed to return to when the viewer unpauses. */
  private speedBeforePause: SpeedLevel = DEFAULT_SPEED;

  constructor(container: HTMLElement, world: World = new World()) {
    this.container = container;
    this.world = world;
    this.scheduler = new TickScheduler(DEFAULT_SPEED);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(42, this.aspectRatio(), 0.5, 900);
    this.controls = this.createControls();
    this.environment = new Environment(this.scene);
    this.frameTown();
    this.citizenView = new CitizenView(world);
    this.scene.add(this.townView.root);
    this.scene.add(this.citizenView.root);

    // Draw the town in its opening light before the first frame runs.
    this.environment.update(world.time.minuteOfDay);
    this.townView.update(world, this.environment.state, 10);
    this.citizenView.update(10);

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /** Orbit style camera: drag to rotate, wheel or pinch to zoom, two fingers to pan. */
  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.copy(CAMERA_TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 18;
    controls.maxDistance = 190;
    // Keep the camera above the horizon so it never looks up from under the ground.
    controls.maxPolarAngle = Math.PI / 2 - 0.08;
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    return controls;
  }

  /**
   * Places the camera so the whole town fits, whatever shape the screen is.
   *
   * A portrait screen turns the camera almost due east, which lays the long
   * axis of the town up the screen rather than across it, and then backs off
   * until every corner of the town is inside the frustum.
   */
  private frameTown(): void {
    const portrait = this.aspectRatio() < 1;
    const view = portrait ? PORTRAIT_VIEW : LANDSCAPE_VIEW;

    this.camera.fov = view.fieldOfView;
    this.camera.updateProjectionMatrix();

    const yaw = MathUtils.degToRad(view.yawDegrees);
    const pitch = MathUtils.degToRad(view.pitchDegrees);
    const direction = new Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    );

    // The margin is at or under one on purpose: in landscape the outermost
    // trees sit right on the edge of the frame rather than floating in grass.
    const distance = this.fitDistance(direction) * view.margin;

    // Aiming a little above the town pushes it down the frame and fills the
    // space it leaves with sky rather than with empty grass. A portrait screen
    // has more spare height, so it needs more of this.
    const visibleHeight = 2 * distance * Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const target = CAMERA_TARGET.clone().setY(CAMERA_TARGET.y + visibleHeight * view.lift);

    this.camera.position.copy(direction).multiplyScalar(distance).add(target);
    this.controls.target.copy(target);
    this.controls.update();

    // Keep the haze behind the town whatever distance the framing chose.
    this.environment.setFogRange(distance * 0.95, distance + 240);
  }

  /**
   * The closest the camera can sit along `direction` with every corner of the
   * town still inside the frustum.
   */
  private fitDistance(direction: Vector3): number {
    const forward = direction.clone().negate();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();

    const tanVertical = Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const tanHorizontal = tanVertical * this.camera.aspect;

    const corner = new Vector3();
    let needed = 0;

    for (const x of [TOWN_BOUNDS_MIN.x, TOWN_BOUNDS_MAX.x]) {
      for (const y of [TOWN_BOUNDS_MIN.y, TOWN_BOUNDS_MAX.y]) {
        for (const z of [TOWN_BOUNDS_MIN.z, TOWN_BOUNDS_MAX.z]) {
          corner.set(x, y, z);
          const depth = corner.dot(direction);
          needed = Math.max(
            needed,
            depth + Math.abs(corner.dot(right)) / tanHorizontal,
            depth + Math.abs(corner.dot(up)) / tanVertical,
          );
        }
      }
    }

    return needed;
  }

  private aspectRatio(): number {
    const height = this.container.clientHeight || 1;
    return this.container.clientWidth / height;
  }

  getSpeed(): SpeedLevel {
    return this.scheduler.getSpeed();
  }

  setSpeed(speed: SpeedLevel): void {
    if (speed !== 0) {
      this.speedBeforePause = speed;
    }
    this.scheduler.setSpeed(speed);
  }

  togglePause(): void {
    this.setSpeed(this.scheduler.isPaused ? this.speedBeforePause : 0);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.clock.start();
    this.scheduler.reset();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
  }

  /** One rendered frame: run the ticks this frame has earned, then draw. */
  private readonly frame = (): void => {
    this.animationFrame = requestAnimationFrame(this.frame);

    const deltaSeconds = this.clock.getDelta();
    this.world.tickMany(this.scheduler.ticksForFrame(deltaSeconds));

    this.environment.update(this.world.time.minuteOfDay);
    this.townView.update(this.world, this.environment.state, deltaSeconds);
    this.citizenView.update(deltaSeconds);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private readonly handleResize = (): void => {
    const wasPortrait = this.camera.aspect < 1;
    this.camera.aspect = this.aspectRatio();
    this.camera.updateProjectionMatrix();
    // Turning the phone swaps the framing; a plain window resize leaves the
    // viewer's own camera alone.
    if (wasPortrait !== this.camera.aspect < 1) {
      this.frameTown();
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  /**
   * Temporary speed keys, in place until the real controls arrive in Phase 6:
   * 1, 2, 3 and 4 for the four speeds, space to pause.
   */
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      event.preventDefault();
      this.togglePause();
      return;
    }
    const speed = SPEED_KEYS[event.code];
    if (speed !== undefined) {
      this.setSpeed(speed);
    }
  };

  /**
   * Pauses while the page is hidden and stays paused on the way back, rather
   * than catching up on the time that passed (SPEC.md 2.13).
   */
  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.setSpeed(0);
    } else {
      this.scheduler.reset();
      this.clock.getDelta();
    }
  };

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
