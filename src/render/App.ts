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

import { isAboard, isOutside } from '../entities/Citizen.js';
import { DEFAULT_SPEED, type SpeedLevel } from '../simulation/constants.js';
import type { Weather } from '../simulation/WeatherSystem.js';
import { TickScheduler } from '../simulation/TickScheduler.js';
import { World } from '../simulation/World.js';

import { groundHeight, TOWN_RISE } from '../world/Terrain.js';
import { townBounds } from '../world/Town.js';

import { CitizenView } from './CitizenView.js';
import { DebugView } from './DebugView.js';
import { Environment } from './Environment.js';
import { Rain } from './Rain.js';
import { SUNRISE_MINUTE, SUNSET_MINUTE } from './palettes.js';
import { Scenery } from './Scenery.js';
import { TownView } from './TownView.js';
import { VehicleView } from './VehicleView.js';
import { Wildlife } from './Wildlife.js';

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
  yawDegrees: -25,
  pitchDegrees: 28,
  nightPitchDegrees: 18,
  fieldOfView: 42,
  margin: 0.95,
  lift: 0.09,
};
/**
 * Portrait takes a wider lens. A narrow screen would otherwise push the camera
 * so far back that the town sits in the haze, small and flat.
 */
const PORTRAIT_VIEW = {
  yawDegrees: -100,
  pitchDegrees: 38,
  nightPitchDegrees: 28,
  fieldOfView: 60,
  margin: 0.88,
  lift: 0.12,
};

const CAMERA_TARGET = new Vector3(0, 6, 0);

/**
 * The night tilt (SPEC.md 2.9, decision 28): after dark the default camera
 * comes down from the day pitch to the night pitch, bringing the stars in
 * over the lit town, and goes back up at dawn. Each move takes about an hour
 * of game time, centred a little after sunset and a little before sunrise, so
 * the sky is dark by the time the camera arrives.
 */
const TILT_MINUTES = 60;
const TILT_AFTER_SUNSET = 20;
const TILT_BEFORE_SUNRISE = 20;

/** How far into the night the camera is, 0 by day and 1 by night. */
function nightAmount(minuteOfDay: number): number {
  const ease = (t: number): number => t * t * (3 - 2 * t);
  const clamp = (t: number): number => Math.min(1, Math.max(0, t));
  const duskStart = SUNSET_MINUTE + TILT_AFTER_SUNSET - TILT_MINUTES / 2;
  const dawnStart = SUNRISE_MINUTE - TILT_BEFORE_SUNRISE - TILT_MINUTES / 2;
  const dusk = ease(clamp((minuteOfDay - duskStart) / TILT_MINUTES));
  const dawn = ease(clamp((minuteOfDay - dawnStart) / TILT_MINUTES));
  // Dusk carries the camera down; dawn brings it back. Between midnight and
  // dawn only the dawn term moves; between dawn and dusk both are settled.
  return minuteOfDay < SUNRISE_MINUTE + TILT_MINUTES ? 1 - dawn : dusk;
}

/** Tallest thing in the town, on the highest ground, for the camera to frame over. */
const TOWN_HEIGHT = 13 + TOWN_RISE;

/** `?debug` draws the navigation graphs and the routes over the town. */
function debugRequested(): boolean {
  return new URLSearchParams(window.location.search).has('debug');
}

/** Weathers reachable from the keyboard while there is no UI yet (SPEC.md 2.8). */
const WEATHER_KEYS: Record<string, Weather> = {
  KeyS: 'Sunny',
  KeyC: 'Cloudy',
  KeyR: 'Rain',
};

/** How overcast each weather looks, and how long the picture takes to get there. */
const CLOUD_AMOUNT: Record<Weather, number> = { Sunny: 0, Cloudy: 0.7, Rain: 1 };
const WEATHER_EASE_SECONDS = 1.6;
const DRY_OUT_SECONDS = 6;

/**
 * Follow (SPEC.md 2.9, Test 5): the camera sits this far from the citizen,
 * this high, and eases onto them; a flight to or from a citizen takes this
 * long. The eased target smooths the hand-offs at doors and car doors,
 * which are a few metres at most (Phase 4's test).
 */
const FOLLOW_DISTANCE = 30;
const FOLLOW_PITCH = (32 * Math.PI) / 180;
const FOLLOW_EASE_SECONDS = 0.22;
const FLIGHT_SECONDS = 1.4;
const FOLLOW_LOOK_HEIGHT = 1.2;

/** A camera framing: where the lens is and what it looks at. */
interface Framing {
  position: Vector3;
  target: Vector3;
}

/** A flight from one framing to another, eased over FLIGHT_SECONDS. */
interface Flight {
  from: Framing;
  to: () => Framing;
  elapsed: number;
  /** What to do when the lens arrives. */
  onArrive: () => void;
}

/** Hidden power-user keys; the UI is the way in (SPEC.md 2.9). */
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
  private readonly scenery = new Scenery();
  private readonly townView = new TownView();
  private readonly wildlife = new Wildlife();
  private readonly rain: Rain;
  private readonly citizenView: CitizenView;
  /** The eased picture of the weather: overcast, falling rain, wet ground. */
  private cloudAmount = 0;
  private rainAmount = 0;
  private wetness = 0;
  private readonly vehicleView: VehicleView;
  private readonly debugView: DebugView | undefined;

  private animationFrame = 0;
  private running = false;
  /** Speed to return to when the viewer unpauses. */
  private speedBeforePause: SpeedLevel = DEFAULT_SPEED;

  /**
   * Whether the camera still follows the default framing and its night tilt.
   * The first drag, wheel or pinch hands the camera to the viewer for good
   * (SPEC.md 2.9): the free view wins over any automatic move.
   */
  private autoFraming = true;
  /** The citizen the camera follows, if any (SPEC.md 2.9). */
  private followingId: string | undefined;
  private readonly followPoint = new Vector3();
  private flight: Flight | undefined;
  private readonly frameListeners: Array<() => void> = [];
  /** A pointer or wheel is held on the controls right now. */
  private pointerDown = false;

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
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(42, this.aspectRatio(), 0.5, 2500);
    this.controls = this.createControls();
    this.environment = new Environment(this.scene);
    this.frameTown();
    this.citizenView = new CitizenView(world);
    this.vehicleView = new VehicleView(world);
    this.rain = new Rain(this.aspectRatio() < 1);
    this.scene.add(this.rain.root);
    this.scene.add(this.scenery.root);
    this.scene.add(this.townView.root);
    this.scene.add(this.wildlife.root);
    this.scene.add(this.citizenView.root);
    this.scene.add(this.vehicleView.root);

    if (debugRequested()) {
      this.debugView = new DebugView(world);
      this.scene.add(this.debugView.root);
    }

    // Draw the town in its opening light before the first frame runs.
    this.environment.update(world.time.minuteOfDay, 0);
    this.scenery.update(this.environment.state, 0, this.camera.position);
    this.townView.update(world, this.environment.state, 10, 0, this.camera);
    this.citizenView.update(10, this.camera);
    this.vehicleView.update(this.environment.state, 10, this.camera);

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
    // The real limits are set from the framing distance once the town has been
    // measured; these are placeholders until then.
    controls.minDistance = 18;
    controls.maxDistance = 400;
    // Keep the camera above the horizon so it never looks up from under the ground.
    controls.maxPolarAngle = Math.PI / 2 - 0.08;
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    // A press alone (a future click on a citizen) does not take the camera;
    // a press that moves it does. The automatic framing holds still while a
    // pointer is down, so the only movement it can see is the viewer's.
    controls.addEventListener('start', () => {
      this.pointerDown = true;
    });
    controls.addEventListener('change', () => {
      if (this.pointerDown) {
        this.autoFraming = false;
      }
    });
    controls.addEventListener('end', () => {
      this.pointerDown = false;
    });
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
    this.autoFraming = true;
    this.placeDefaultCamera();
  }

  /**
   * Puts the camera on the default framing for this screen shape and this
   * hour: the day pitch, the night pitch, or the slow move between them.
   * Called every frame while the viewer has not taken the camera.
   */
  private placeDefaultCamera(): void {
    const framing = this.defaultFraming();
    this.camera.position.copy(framing.position);
    this.controls.target.copy(framing.target);
  }

  /**
   * The default framing for this screen shape and this hour, without
   * moving anything: the place a flight home aims at.
   */
  private defaultFraming(): Framing {
    const portrait = this.aspectRatio() < 1;
    const view = portrait ? PORTRAIT_VIEW : LANDSCAPE_VIEW;

    if (this.camera.fov !== view.fieldOfView) {
      this.camera.fov = view.fieldOfView;
      this.camera.updateProjectionMatrix();
    }

    const yaw = MathUtils.degToRad(view.yawDegrees);
    const night = nightAmount(this.world.time.minuteOfDay);
    const pitch = MathUtils.degToRad(
      view.pitchDegrees + (view.nightPitchDegrees - view.pitchDegrees) * night,
    );
    const direction = new Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    );

    // The margin is at or under one on purpose: in landscape the outermost
    // trees sit right on the edge of the frame rather than floating in grass.
    // Aiming a little above the town pushes it down the frame and fills the
    // space it leaves with sky rather than with empty grass. A portrait screen
    // has more spare height, so it needs more of this.
    //
    // Raising the aim also moves the town within the frame, so the fit is done
    // twice: once to find out how far up to aim, then again with the town in
    // its new place, or the far corners would fall outside the picture.
    const firstPass = this.fitDistance(direction, 0) * view.margin;
    const lift = 2 * firstPass * Math.tan(MathUtils.degToRad(this.camera.fov) / 2) * view.lift;
    const distance = this.fitDistance(direction, lift) * view.margin;

    const target = CAMERA_TARGET.clone().setY(CAMERA_TARGET.y + lift);
    const position = direction.clone().multiplyScalar(distance).add(target);

    // Let the viewer come in close and pull back a little further than the
    // default, but no further. A limit left over from a smaller town would
    // quietly drag the camera in and crop the framing.
    if (!this.followingId) {
      this.controls.minDistance = 25;
      this.controls.maxDistance = distance * 1.6;
    }

    // Keep the haze behind the town whatever distance the framing chose.
    // The haze must start beyond the far side of the town, or the whole
    // picture goes milky; the town sits between about 0.7 and 1.4 times the
    // framing distance from the lens.
    this.environment.setFogRange(distance * 1.35, distance * 1.35 + 360);
    return { position, target };
  }

  /**
   * The closest the camera can sit along `direction` with every corner of the
   * town still inside the frustum, when the camera aims `lift` metres above
   * the town centre.
   */
  private fitDistance(direction: Vector3, lift: number): number {
    const forward = direction.clone().negate();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();

    const tanVertical = Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const tanHorizontal = tanVertical * this.camera.aspect;

    const corner = new Vector3();
    let needed = 0;

    const bounds = townBounds();

    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [-CAMERA_TARGET.y - lift, TOWN_HEIGHT - CAMERA_TARGET.y - lift]) {
        for (const z of [bounds.minZ, bounds.maxZ]) {
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

    // The picture eases towards the weather over a couple of real seconds;
    // the ground dries out more slowly than it gets wet (SPEC.md 2.8).
    const weather = this.world.weather.current;
    const ease = 1 - Math.exp(-deltaSeconds / WEATHER_EASE_SECONDS);
    this.cloudAmount += (CLOUD_AMOUNT[weather] - this.cloudAmount) * ease;
    const rainTarget = weather === 'Rain' ? 1 : 0;
    this.rainAmount += (rainTarget - this.rainAmount) * ease;
    const dryEase = 1 - Math.exp(-deltaSeconds / DRY_OUT_SECONDS);
    this.wetness += (rainTarget - this.wetness) * (rainTarget > this.wetness ? ease : dryEase);
    this.environment.setWeather(this.cloudAmount, this.rainAmount);
    this.townView.setWetness(this.wetness);

    // Real elapsed time drives clouds, swell and twinkle only; the
    // simulation never sees it (SPEC.md 2.14).
    this.environment.update(this.world.time.minuteOfDay, this.clock.elapsedTime);
    this.scenery.update(this.environment.state, this.clock.elapsedTime, this.camera.position);
    this.townView.update(
      this.world,
      this.environment.state,
      deltaSeconds,
      this.clock.elapsedTime,
      this.camera,
    );
    const speed = this.scheduler.getSpeed();
    this.citizenView.update(deltaSeconds, this.camera, weather === 'Rain', speed < 20);
    this.vehicleView.update(this.environment.state, deltaSeconds, this.camera);
    this.rain.update(deltaSeconds, this.rainAmount, this.camera, this.controls.target);
    // The animals run on real time too, and hide at speed (SPEC.md 2.14).
    this.wildlife.update(deltaSeconds, this.scheduler.getSpeed(), this.environment.state);

    this.debugView?.update(this.world);

    if (this.flight) {
      this.fly(deltaSeconds);
    } else if (this.followingId) {
      this.trackFollowed(deltaSeconds);
    } else if (this.autoFraming && !this.pointerDown) {
      this.placeDefaultCamera();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    for (const listener of this.frameListeners) {
      listener();
    }
  };

  // --- Selection and follow (SPEC.md 2.9) ----------------------------------

  /** The canvas, for the UI to listen to taps on. */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Called after every frame; the UI reads the world from here. */
  addFrameListener(listener: () => void): void {
    this.frameListeners.push(listener);
  }

  get following(): string | undefined {
    return this.followingId;
  }

  /** True once the viewer has taken the camera and nothing is bringing it back. */
  get cameraTaken(): boolean {
    return !this.autoFraming && !this.followingId && !this.flight;
  }

  get isPortrait(): boolean {
    return this.aspectRatio() < 1;
  }

  /**
   * The citizen drawn nearest to a point on the screen, within `radiusPx`,
   * or nothing. Only people who can be seen count: on foot or in a car.
   */
  pickCitizen(clientX: number, clientY: number, radiusPx: number): string | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const projected = new Vector3();
    let best: string | undefined;
    let bestDistance = radiusPx;
    for (const citizen of this.world.citizens) {
      if (!isOutside(citizen) && !isAboard(citizen)) {
        continue;
      }
      const target = this.world.followTarget(citizen.id);
      if (!target) {
        continue;
      }
      projected.set(
        target.position.x,
        groundHeight(target.position.x, target.position.z) + 1,
        target.position.z,
      );
      projected.project(this.camera);
      if (projected.z > 1) {
        continue;
      }
      const screenX = rect.left + ((projected.x + 1) / 2) * rect.width;
      const screenY = rect.top + ((1 - projected.y) / 2) * rect.height;
      const away = Math.hypot(screenX - clientX, screenY - clientY);
      if (away < bestDistance) {
        bestDistance = away;
        best = citizen.id;
      }
    }
    return best;
  }

  /** Flies to a citizen and stays with them until stopFollowing. */
  follow(citizenId: string): void {
    const target = this.world.followTarget(citizenId);
    if (!target) {
      return;
    }
    this.followingId = citizenId;
    this.autoFraming = false;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 90;
    this.followPoint.set(
      target.position.x,
      groundHeight(target.position.x, target.position.z) + FOLLOW_LOOK_HEIGHT,
      target.position.z,
    );
    // Keep the viewer's bearing; come down to a good height and distance.
    const bearing = this.camera.position.clone().sub(this.controls.target);
    const yaw = Math.atan2(bearing.x, bearing.z);
    const offset = new Vector3(
      Math.sin(yaw) * Math.cos(FOLLOW_PITCH),
      Math.sin(FOLLOW_PITCH),
      Math.cos(yaw) * Math.cos(FOLLOW_PITCH),
    ).multiplyScalar(FOLLOW_DISTANCE);
    this.startFlight(
      () => ({ position: this.followPoint.clone().add(offset), target: this.followPoint.clone() }),
      () => undefined,
    );
  }

  /** Lets the citizen go and flies back to the god view (SPEC.md 2.9). */
  stopFollowing(): void {
    if (!this.followingId) {
      return;
    }
    this.followingId = undefined;
    this.returnToTown();
  }

  /**
   * Hands the camera back to the default framing and the night tilt, with a
   * flight rather than a cut: the "back to town" the SPEC promised.
   */
  returnToTown(): void {
    this.followingId = undefined;
    this.controls.enablePan = true;
    this.startFlight(
      () => this.defaultFraming(),
      () => {
        this.autoFraming = true;
      },
    );
  }

  private startFlight(to: () => Framing, onArrive: () => void): void {
    this.flight = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to,
      elapsed: 0,
      onArrive,
    };
  }

  /** One step of a flight: smoothstep from the start to a moving end. */
  private fly(deltaSeconds: number): void {
    const flight = this.flight;
    if (!flight) {
      return;
    }
    if (this.followingId) {
      this.easeFollowPoint(deltaSeconds);
    }
    flight.elapsed += deltaSeconds;
    const t = Math.min(1, flight.elapsed / FLIGHT_SECONDS);
    const eased = t * t * (3 - 2 * t);
    const to = flight.to();
    this.camera.position.copy(flight.from.position).lerp(to.position, eased);
    this.controls.target.copy(flight.from.target).lerp(to.target, eased);
    if (t >= 1) {
      this.flight = undefined;
      flight.onArrive();
    }
  }

  /** Eases the followed point towards the citizen, so hand-offs never jump. */
  private easeFollowPoint(deltaSeconds: number): void {
    const target = this.followingId ? this.world.followTarget(this.followingId) : undefined;
    if (!target) {
      return;
    }
    const wanted = new Vector3(
      target.position.x,
      groundHeight(target.position.x, target.position.z) + FOLLOW_LOOK_HEIGHT,
      target.position.z,
    );
    this.followPoint.lerp(wanted, 1 - Math.exp(-deltaSeconds / FOLLOW_EASE_SECONDS));
  }

  /** Keeps the camera on the followed citizen, leaving the viewer their orbit. */
  private trackFollowed(deltaSeconds: number): void {
    this.easeFollowPoint(deltaSeconds);
    const delta = this.followPoint.clone().sub(this.controls.target);
    this.camera.position.add(delta);
    this.controls.target.copy(this.followPoint);
  }

  private readonly handleResize = (): void => {
    const wasPortrait = this.camera.aspect < 1;
    this.camera.aspect = this.aspectRatio();
    this.camera.updateProjectionMatrix();
    // Turning the phone swaps the framing; a plain window resize leaves the
    // viewer's own camera alone.
    if (wasPortrait !== this.camera.aspect < 1 && !this.followingId) {
      this.frameTown();
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  /**
   * Hidden power-user keys, not shown anywhere in the UI: 1, 2, 3 and 4 for
   * the four speeds, space to pause, S, C and R for the weather.
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
    const weather = WEATHER_KEYS[event.code];
    if (weather !== undefined) {
      this.world.setWeather(weather);
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
    this.debugView?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
