import {
  type Camera,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';

import { Rng } from '../simulation/Rng.js';
import { groundHeight } from '../world/Terrain.js';

/**
 * Rain (SPEC.md 2.8, DESIGN.md §13): a volume of thin streaks that fall
 * around the point the camera looks at and wrap from the top when they reach
 * the ground. One instanced mesh; fewer streaks on a narrow screen. Render
 * side only, on real time, like the clouds and the swell.
 */

const DESKTOP_DROPS = 1600;
const MOBILE_DROPS = 550;

/** The box the rain falls in, centred on the camera target. */
const SPREAD = 120;
const CEILING = 42;

const FALL_SPEED = 26;
const STREAK_LENGTH = 1.1;

interface Drop {
  x: number;
  y: number;
  z: number;
  speed: number;
}

export class Rain {
  readonly root = new Group();

  private readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  private readonly drops: Drop[] = [];
  private readonly centre = new Vector3();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private budget = 1;

  constructor(mobile: boolean) {
    this.root.name = 'rain';
    const count = mobile ? MOBILE_DROPS : DESKTOP_DROPS;
    this.material = new MeshBasicMaterial({
      color: 0xd9e4ee,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(0.035, STREAK_LENGTH), this.material, count);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);

    const rng = new Rng('rain');
    for (let index = 0; index < count; index += 1) {
      this.drops.push({
        x: rng.nextFloat(-SPREAD / 2, SPREAD / 2),
        y: rng.nextFloat(0, CEILING),
        z: rng.nextFloat(-SPREAD / 2, SPREAD / 2),
        speed: FALL_SPEED * rng.nextFloat(0.85, 1.15),
      });
    }
    this.root.visible = false;
  }

  /** How much of the rain a weaker device draws, 0 to 1 (Phase 7 quality tiers). */
  setBudget(fraction: number): void {
    this.budget = Math.min(1, Math.max(0, fraction));
  }

  /**
   * Moves the streaks on by `deltaSeconds`. `amount` is how much rain the
   * picture should show, 0 to 1, eased by the caller over the transition.
   */
  update(deltaSeconds: number, amount: number, camera: Camera, target: Vector3): void {
    this.root.visible = amount > 0.02;
    if (!this.root.visible) {
      return;
    }
    this.material.opacity = amount * 0.5;
    this.centre.copy(target);

    // Streaks face the camera about Y only, so they stay vertical.
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const yaw = Math.atan2(forward.x, forward.z);
    const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3(1, 1, 1);
    const dt = Math.min(deltaSeconds, 0.1);

    this.drops.forEach((drop, index) => {
      drop.y -= drop.speed * dt;
      const worldX = this.centre.x + drop.x;
      const worldZ = this.centre.z + drop.z;
      const floor = groundHeight(worldX, worldZ);
      if (drop.y < floor) {
        drop.y = floor + CEILING + (drop.y - floor);
      }
      // Only the fraction the amount asks for is drawn, from the front.
      if (index > amount * this.budget * this.drops.length) {
        this.mesh.setMatrixAt(index, this.hidden);
        return;
      }
      position.set(worldX, drop.y, worldZ);
      matrix.compose(position, facing, scale);
      this.mesh.setMatrixAt(index, matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
