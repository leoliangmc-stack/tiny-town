import {
  AdditiveBlending,
  type Camera,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Vehicle } from '../entities/Vehicle.js';
import { VehicleSystem } from '../simulation/VehicleSystem.js';
import type { World } from '../simulation/World.js';
import { VEHICLE_SIZE } from '../world/Fleet.js';
import { groundHeight } from '../world/Terrain.js';

import type { EnvironmentState } from './Environment.js';
import { glowTexture } from './glow.js';

/** How quickly the drawn position catches up with the simulated one. */
const FOLLOW_SECONDS = 0.1;

const WHEEL_RADIUS = 0.36;
const WHEEL_WIDTH = 0.26;
const HEADLIGHT = 0xfff0c8;
const TAILLIGHT = 0xff5a3c;

/** The parts every vehicle is made of, each one InstancedMesh for the fleet. */
type Part = 'body' | 'cabin' | 'wheel' | 'headlight' | 'taillight' | 'headlightGlow' | 'beam';

interface Drawn {
  vehicle: Vehicle;
  x: number;
  z: number;
  heading: number;
}

/**
 * The eight vehicles as rounded miniature cars (DESIGN.md §8): a body, a
 * cabin, four wheels, two headlights and two taillights, each an instanced
 * part, so the whole fleet is seven draw calls.
 *
 * Lights come on with the street lamps. A parked car is dark; a moving one
 * throws a warm patch of light on the road ahead, which is what makes a car
 * read at night from the god view.
 */
export class VehicleView {
  readonly root = new Group();

  private readonly parts: Record<Part, InstancedMesh>;
  private readonly drawn: Drawn[] = [];
  private readonly lampMaterial: MeshStandardMaterial;
  private readonly tailMaterial: MeshStandardMaterial;
  private readonly glowMaterial: MeshBasicMaterial;
  private readonly beamMaterial: MeshBasicMaterial;
  private readonly scratch = new Vector3();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private lit = 0;

  constructor(world: World) {
    this.root.name = 'vehicles';
    const count = world.vehicles.length;
    const matte = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    const glass = new MeshStandardMaterial({ color: 0x8fa6b8, roughness: 0.5, metalness: 0 });
    const rubber = new MeshStandardMaterial({ color: 0x3f3d3a, roughness: 1, metalness: 0 });
    this.lampMaterial = new MeshStandardMaterial({
      color: 0xe9e2d0,
      emissive: new Color(HEADLIGHT),
      emissiveIntensity: 0,
      roughness: 0.6,
    });
    this.tailMaterial = new MeshStandardMaterial({
      color: 0x7a3a30,
      emissive: new Color(TAILLIGHT),
      emissiveIntensity: 0,
      roughness: 0.6,
    });
    this.glowMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      color: new Color(HEADLIGHT),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    this.beamMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      color: new Color(HEADLIGHT),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });

    const make = (
      geometry: InstancedMesh['geometry'],
      material: MeshStandardMaterial | MeshBasicMaterial,
      instances: number,
      castShadow = true,
    ): InstancedMesh => {
      const mesh = new InstancedMesh(geometry, material, instances);
      mesh.castShadow = castShadow;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };

    const wheel = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 12);
    wheel.rotateZ(Math.PI / 2);
    const beam = new PlaneGeometry(1, 1);
    beam.rotateX(-Math.PI / 2);

    this.parts = {
      body: make(new RoundedBoxGeometry(1, 1, 1, 3, 0.18), matte, count),
      cabin: make(new RoundedBoxGeometry(1, 1, 1, 3, 0.2), glass, count),
      wheel: make(wheel, rubber, count * 4),
      headlight: make(new SphereGeometry(0.14, 8, 6), this.lampMaterial, count * 2, false),
      taillight: make(new SphereGeometry(0.11, 8, 6), this.tailMaterial, count * 2, false),
      headlightGlow: make(new PlaneGeometry(1, 1), this.glowMaterial, count * 2, false),
      beam: make(beam, this.beamMaterial, count, false),
    };

    world.vehicles.forEach((vehicle, index) => {
      this.drawn.push({
        vehicle,
        x: vehicle.position.x,
        z: vehicle.position.z,
        heading: vehicle.heading,
      });
      this.parts.body.setColorAt(index, new Color(vehicle.color));
    });
    if (this.parts.body.instanceColor) {
      this.parts.body.instanceColor.needsUpdate = true;
    }
  }

  update(environment: EnvironmentState, deltaSeconds: number, camera: Camera): void {
    const ease = 1 - Math.exp(-deltaSeconds / FOLLOW_SECONDS);
    this.lit += (environment.lampFactor - this.lit) * ease;
    this.lampMaterial.emissiveIntensity = this.lit * 2.2;
    this.tailMaterial.emissiveIntensity = this.lit * 1.6;
    this.glowMaterial.opacity = this.lit * 0.7;
    this.beamMaterial.opacity = this.lit * 0.42;

    this.drawn.forEach((drawn, index) => {
      const { vehicle } = drawn;
      const target = VehicleSystem.roadPosition(vehicle);
      drawn.x += (target.x - drawn.x) * ease;
      drawn.z += (target.z - drawn.z) * ease;
      drawn.heading = easeAngle(drawn.heading, vehicle.heading, ease);
      this.pose(index, drawn, camera);
    });

    for (const mesh of Object.values(this.parts)) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Writes the matrices of one vehicle's parts for this frame. */
  private pose(index: number, drawn: Drawn, camera: Camera): void {
    const { vehicle } = drawn;
    const size = VEHICLE_SIZE[vehicle.kind];
    const base = new Matrix4()
      .makeRotationY(drawn.heading)
      .setPosition(drawn.x, groundHeight(drawn.x, drawn.z) + WHEEL_RADIUS, drawn.z);
    const place = (
      part: Part,
      slot: number,
      x: number,
      y: number,
      z: number,
      scale: Vector3,
      rotation?: Quaternion,
    ): void => {
      const local = new Matrix4().compose(
        this.scratch.set(x, y, z),
        rotation ?? new Quaternion(),
        scale,
      );
      this.parts[part].setMatrixAt(slot, base.clone().multiply(local));
    };

    // The body sits on the wheels; the cabin sits on the rear two thirds.
    const bodyY = size.height / 2 + 0.1;
    place('body', index, 0, bodyY, 0, new Vector3(size.width, size.height, size.length));
    const cabinHeight = vehicle.kind === 'van' ? 0.55 : 0.7;
    const cabinLength = vehicle.kind === 'van' ? size.length * 0.62 : size.length * 0.5;
    const cabinZ = vehicle.kind === 'van' ? -size.length * 0.12 : -size.length * 0.08;
    place(
      'cabin',
      index,
      0,
      size.height + 0.1 + cabinHeight / 2 - 0.05,
      cabinZ,
      new Vector3(size.width * 0.86, cabinHeight, cabinLength),
    );

    // Wheels turn with the distance driven.
    const spin = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      vehicle.distanceDriven / WHEEL_RADIUS,
    );
    const axleX = size.width / 2 - 0.05;
    const axleZ = size.length * 0.32;
    [
      [-axleX, axleZ],
      [axleX, axleZ],
      [-axleX, -axleZ],
      [axleX, -axleZ],
    ].forEach(([x, z], wheel) => {
      place('wheel', index * 4 + wheel, x, 0, z, new Vector3(1, 1, 1), spin);
    });

    const front = size.length / 2 + 0.02;
    const lampY = bodyY + size.height * 0.15;
    const lampX = size.width * 0.32;
    const on = vehicle.state === 'driving';
    const lampScale = new Vector3(1, 1, 1);
    place('headlight', index * 2, -lampX, lampY, front, lampScale);
    place('headlight', index * 2 + 1, lampX, lampY, front, lampScale);
    place('taillight', index * 2, -lampX, lampY, -front, lampScale);
    place('taillight', index * 2 + 1, lampX, lampY, -front, lampScale);

    if (on) {
      for (const [slot, x] of [
        [index * 2, -lampX],
        [index * 2 + 1, lampX],
      ]) {
        const world = this.scratch.set(x, lampY, front + 0.15).applyMatrix4(base);
        this.parts.headlightGlow.setMatrixAt(
          slot,
          new Matrix4().compose(world, camera.quaternion, new Vector3(2.4, 2.4, 2.4)),
        );
      }
      // A patch of light on the road in front of the car.
      place('beam', index, 0, 0.06 - WHEEL_RADIUS, front + 5.5, new Vector3(5.5, 1, 11));
    } else {
      this.parts.headlightGlow.setMatrixAt(index * 2, this.hidden);
      this.parts.headlightGlow.setMatrixAt(index * 2 + 1, this.hidden);
      this.parts.beam.setMatrixAt(index, this.hidden);
    }
  }
}

/** Eases an angle the short way round the circle. */
function easeAngle(from: number, to: number, ease: number): number {
  let difference = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (difference < -Math.PI) {
    difference += Math.PI * 2;
  }
  return from + difference * ease;
}
