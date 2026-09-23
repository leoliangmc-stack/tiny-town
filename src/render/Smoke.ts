import {
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';

import type { World } from '../simulation/World.js';

import type { EnvironmentState } from './Environment.js';
import type { Chimney } from './TownView.js';

/**
 * Chimney smoke (SPEC.md 2.6): one of the outside signs that somebody is in.
 * The bakery's oven smokes while the bakery is open; a house's chimney while
 * somebody at home is eating.
 *
 * Puffs rise, drift a little downwind, swell and thin out. They run on real
 * time, like the clouds, and only read the world to know which chimneys are
 * going; nothing here feeds back into the simulation. All the puffs in town
 * are one instanced draw call, each with its own opacity.
 */

const PUFFS_PER_CHIMNEY = 7;
/** Real seconds between puffs from a chimney that is going. */
const PUFF_INTERVAL = 0.75;
const PUFF_LIFETIME = 5;
const RISE_SPEED = 0.55;
/** A light breeze off the sea, towards the hills. */
const WIND = new Vector3(0.18, 0, 0.12);

const DAY_SMOKE = new Color(0xe9e6df);
const NIGHT_SMOKE = new Color(0x5d6270);

const VERTEX_SHADER = /* glsl */ `
  #include <fog_pars_vertex>
  attribute float puffAlpha;
  varying float vAlpha;
  varying float vShade;

  void main() {
    vAlpha = puffAlpha;
    // Lighter on top, as the sky lights it.
    vShade = 0.78 + 0.22 * normal.y;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <fog_pars_fragment>
  uniform vec3 smokeColor;
  varying float vAlpha;
  varying float vShade;

  void main() {
    gl_FragColor = vec4(smokeColor * vShade, vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

interface Puff {
  age: number;
  position: Vector3;
  alive: boolean;
}

interface Stack {
  chimney: Chimney;
  puffs: Puff[];
  /** Seconds until the next puff. */
  wait: number;
}

export class Smoke {
  readonly mesh: InstancedMesh;
  private readonly alpha: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private readonly stacks: Stack[];
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  private readonly identity = new Quaternion();

  constructor(chimneys: readonly Chimney[]) {
    this.stacks = chimneys.map((chimney, index) => ({
      chimney,
      puffs: Array.from({ length: PUFFS_PER_CHIMNEY }, () => ({
        age: 0,
        position: new Vector3(),
        alive: false,
      })),
      // Chimneys do not all start on the same beat.
      wait: (index * 0.37) % PUFF_INTERVAL,
    }));

    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { smokeColor: { value: new Color() } }]),
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const count = Math.max(1, chimneys.length * PUFFS_PER_CHIMNEY);
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 1), this.material, count);
    this.mesh.name = 'chimney-smoke';
    this.mesh.frustumCulled = false;
    this.alpha = new InstancedBufferAttribute(new Float32Array(count), 1);
    this.mesh.geometry.setAttribute('puffAlpha', this.alpha);
  }

  /** Which buildings have a fire going right now. */
  private burning(world: World): Set<string> {
    const going = new Set<string>();
    for (const citizen of world.citizens) {
      if (citizen.activity === 'Eat' && citizen.place.kind === 'building') {
        going.add(citizen.place.id);
      }
    }
    if (world.isLit('bakery')) {
      going.add('bakery');
    }
    return going;
  }

  update(world: World, environment: EnvironmentState, deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.1);
    const going = this.burning(world);
    const color = this.material.uniforms.smokeColor.value as Color;
    color.copy(DAY_SMOKE).lerp(NIGHT_SMOKE, environment.lampFactor);

    let slot = 0;
    for (const stack of this.stacks) {
      if (going.has(stack.chimney.buildingId)) {
        stack.wait -= dt;
        if (stack.wait <= 0) {
          stack.wait += PUFF_INTERVAL;
          const free = stack.puffs.find((puff) => !puff.alive);
          if (free) {
            free.alive = true;
            free.age = 0;
            free.position.copy(stack.chimney.position);
          }
        }
      }

      for (const puff of stack.puffs) {
        if (puff.alive) {
          puff.age += dt;
          if (puff.age >= PUFF_LIFETIME) {
            puff.alive = false;
          }
        }
        if (!puff.alive) {
          this.matrix.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(slot, this.matrix);
          this.alpha.setX(slot, 0);
          slot += 1;
          continue;
        }
        const t = puff.age / PUFF_LIFETIME;
        puff.position.y += RISE_SPEED * dt * (1 - 0.5 * t);
        puff.position.addScaledVector(WIND, dt * t);
        this.scale.setScalar(0.3 + 1.1 * t);
        this.matrix.compose(puff.position, this.identity, this.scale);
        this.mesh.setMatrixAt(slot, this.matrix);
        // In quickly, then thin away.
        this.alpha.setX(slot, Math.min(1, t * 6) * (1 - t) * 0.55);
        slot += 1;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
