import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { TickScheduler } from '../simulation/TickScheduler.js';
import type { SpeedLevel } from '../simulation/constants.js';
import { DEFAULT_SPEED } from '../simulation/constants.js';
import { World } from '../simulation/World.js';

/** Half the side length of the ground plane, in world units (metres). */
const GROUND_HALF_SIZE = 60;

/** Camera framing: a slightly tilted god view, as described in SPEC.md 2.9. */
const CAMERA_START_POSITION = new THREE.Vector3(38, 30, 38);
const CAMERA_TARGET = new THREE.Vector3(0, 0, 0);

/**
 * The renderer side of the app: a Three.js scene, a god view camera, and the
 * frame loop that drives the simulation.
 *
 * The simulation never reaches back into here. This class reads the World; the
 * World knows nothing about Three.js (SPEC.md 3.2).
 */
export class App {
  readonly world: World;
  readonly scheduler: TickScheduler;

  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();

  private animationFrame = 0;
  private running = false;

  constructor(container: HTMLElement, world: World = new World()) {
    this.container = container;
    this.world = world;
    this.scheduler = new TickScheduler(DEFAULT_SPEED);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fb6d8);

    this.camera = new THREE.PerspectiveCamera(45, this.aspectRatio(), 0.1, GROUND_HALF_SIZE * 10);
    this.camera.position.copy(CAMERA_START_POSITION);
    this.camera.lookAt(CAMERA_TARGET);

    this.controls = this.createControls();

    this.addPlaceholderLighting();
    this.addGround();

    window.addEventListener('resize', this.handleResize);
  }

  /** Orbit style camera: drag to rotate, wheel or pinch to zoom, two fingers to pan. */
  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.copy(CAMERA_TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = GROUND_HALF_SIZE * 2;
    // Keep the camera above the horizon so it never looks up from under the ground.
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.update();
    return controls;
  }

  /**
   * Neutral light so the empty ground is visible. The day/night lighting that
   * carries the time-lapse arrives in Phase 1.
   */
  private addPlaceholderLighting(): void {
    const sky = new THREE.HemisphereLight(0xbfd8f0, 0x60705c, 1.1);
    this.scene.add(sky);

    const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);
  }

  private addGround(): void {
    const geometry = new THREE.PlaneGeometry(GROUND_HALF_SIZE * 2, GROUND_HALF_SIZE * 2);
    const material = new THREE.MeshStandardMaterial({ color: 0x7c9e64, roughness: 1 });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.name = 'ground';
    this.scene.add(ground);
  }

  private aspectRatio(): number {
    const height = this.container.clientHeight || 1;
    return this.container.clientWidth / height;
  }

  setSpeed(speed: SpeedLevel): void {
    this.scheduler.setSpeed(speed);
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
    const ticks = this.scheduler.ticksForFrame(deltaSeconds);
    this.world.tickMany(ticks);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private readonly handleResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = this.aspectRatio();
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
  };

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
