import {
  SRGBColorSpace,
  PlaneGeometry,
  MeshBasicMaterial,
  DoubleSide,
  CylinderGeometry,
  ConeGeometry,
  CanvasTexture,
  type Camera,
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D as ThreeObject,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Citizen } from '../entities/Citizen.js';
import { isOutside, isWalking } from '../entities/Citizen.js';
import type { World } from '../simulation/World.js';
import { groundHeight } from '../world/Terrain.js';

/**
 * Body proportions, in metres, for a citizen of height 1. A little small in
 * the body and a little large in the head, as a model figure is (DESIGN.md §5).
 */
const LEG_LENGTH = 0.62;
const LEG_RADIUS = 0.1;
const HIP_HEIGHT = LEG_LENGTH + 0.02;
const TORSO_HEIGHT = 0.6;
const TORSO_WIDTH = 0.46;
const TORSO_DEPTH = 0.28;
const SHOULDER_HEIGHT = HIP_HEIGHT + TORSO_HEIGHT - 0.06;
const ARM_LENGTH = 0.5;
const ARM_RADIUS = 0.075;
const HEAD_RADIUS = 0.24;
const HEAD_CENTRE_Y = HIP_HEIGHT + TORSO_HEIGHT + 0.04 + HEAD_RADIUS;
const BAG_SIZE = 0.3;

/** The walk: radians of stride per metre, and how far the limbs swing. */
const STRIDE_RADIANS_PER_METRE = 3.4;
const LEG_SWING = 0.55;
const ARM_SWING = 0.4;
const BOB_HEIGHT = 0.035;

/** How quickly the drawn position catches up with the simulated one. */
const FOLLOW_SECONDS = 0.12;

/** The parts every citizen is made of, each an instanced mesh. */
type Part =
  | 'head'
  | 'hair'
  | 'torso'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg'
  | 'bag'
  | 'umbrellaStick'
  | 'umbrellaCanopy'
  | 'icon';

/** The umbrella: a stick held in the right hand and a canopy above the head. */
const UMBRELLA_RADIUS = 0.62;
const UMBRELLA_CANOPY_Y = HEAD_CENTRE_Y + HEAD_RADIUS + 0.32;
const UMBRELLA_COLORS = [0xc9705f, 0x3f7fb8, 0xd9a83e, 0x4e8a6a, 0xf5f0e6, 0x2b4c8c];

/** The icon over the head (SPEC.md 2.8): v1 has the umbrella only. */
const ICON_Y = UMBRELLA_CANOPY_Y + 0.75;
const ICON_SIZE = 0.7;

interface Drawn {
  citizen: Citizen;
  x: number;
  z: number;
  heading: number;
  /** A phase offset so idle gestures are not in unison. */
  idleOffset: number;
}

/**
 * The miniature people, drawn as instanced parts: one draw call per body part
 * for the whole population, with a colour per instance (PHASES.md Phase 3).
 *
 * The simulation moves in fixed ticks, so the drawn position eases towards the
 * simulated one instead of snapping (SPEC.md 3.2). Limbs swing with the stride;
 * standing citizens get small gestures by activity so nobody is a statue.
 */
export class CitizenView {
  readonly root = new Group();

  private readonly parts: Record<Part, InstancedMesh>;
  private readonly drawn: Drawn[] = [];
  private readonly scratch = new Object3D();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private readonly iconMaterial: MeshBasicMaterial;
  private readonly cameraQuaternion = new Quaternion();
  private elapsed = 0;
  private raining = false;
  private showIcons = false;

  constructor(world: World) {
    this.root.name = 'citizens';
    const count = world.citizens.length;
    const matte = new MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    const canopy = new MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: DoubleSide });
    this.iconMaterial = new MeshBasicMaterial({
      map: umbrellaIconTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });

    const make = (
      geometry: InstancedMesh['geometry'],
      material: MeshStandardMaterial | MeshBasicMaterial = matte,
      castShadow = true,
    ): InstancedMesh => {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.castShadow = castShadow;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };

    this.parts = {
      head: make(new SphereGeometry(HEAD_RADIUS, 16, 12)),
      hair: make(new SphereGeometry(HEAD_RADIUS + 0.03, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)),
      torso: make(new RoundedBoxGeometry(TORSO_WIDTH, TORSO_HEIGHT, TORSO_DEPTH, 3, 0.1)),
      leftArm: make(limb(ARM_LENGTH, ARM_RADIUS)),
      rightArm: make(limb(ARM_LENGTH, ARM_RADIUS)),
      leftLeg: make(limb(LEG_LENGTH, LEG_RADIUS)),
      rightLeg: make(limb(LEG_LENGTH, LEG_RADIUS)),
      bag: make(new RoundedBoxGeometry(BAG_SIZE, BAG_SIZE * 1.1, 0.14, 2, 0.04)),
      umbrellaStick: make(new CylinderGeometry(0.02, 0.02, 1, 6)),
      umbrellaCanopy: make(new ConeGeometry(UMBRELLA_RADIUS, 0.24, 10, 1, true), canopy),
      icon: make(new PlaneGeometry(ICON_SIZE, ICON_SIZE), this.iconMaterial, false),
    };

    world.citizens.forEach((citizen, index) => {
      this.drawn.push({
        citizen,
        x: citizen.position.x,
        z: citizen.position.z,
        heading: citizen.heading,
        idleOffset: index * 1.7,
      });
      const look = citizen.look;
      this.parts.head.setColorAt(index, new Color(look.skin));
      this.parts.hair.setColorAt(index, new Color(look.hair));
      this.parts.torso.setColorAt(index, new Color(look.shirt));
      this.parts.leftArm.setColorAt(index, new Color(look.shirt));
      this.parts.rightArm.setColorAt(index, new Color(look.shirt));
      this.parts.leftLeg.setColorAt(index, new Color(look.trousers));
      this.parts.rightLeg.setColorAt(index, new Color(look.trousers));
      this.parts.bag.setColorAt(index, new Color(0xd4b483));
      this.parts.umbrellaStick.setColorAt(index, new Color(0x3f3d3a));
      this.parts.umbrellaCanopy.setColorAt(
        index,
        new Color(UMBRELLA_COLORS[index % UMBRELLA_COLORS.length]),
      );
    });
    for (const mesh of Object.values(this.parts)) {
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /**
   * `raining` opens the umbrellas of everyone outside; `showIcons` puts the
   * umbrella icon over their heads too, which the caller turns off at speed.
   */
  update(deltaSeconds: number, camera: Camera, raining = false, showIcons = false): void {
    this.elapsed += deltaSeconds;
    const ease = 1 - Math.exp(-deltaSeconds / FOLLOW_SECONDS);
    this.raining = raining;
    this.showIcons = showIcons && raining;
    this.cameraQuaternion.copy(camera.quaternion);
    this.iconMaterial.opacity = this.showIcons ? 0.92 : 0;

    this.drawn.forEach((drawn, index) => {
      const { citizen } = drawn;
      if (!isOutside(citizen)) {
        // Snap while hidden, so reappearing at the door does not slide.
        drawn.x = citizen.position.x;
        drawn.z = citizen.position.z;
        for (const mesh of Object.values(this.parts)) {
          mesh.setMatrixAt(index, this.hidden);
        }
        return;
      }

      drawn.x += (citizen.position.x - drawn.x) * ease;
      drawn.z += (citizen.position.z - drawn.z) * ease;
      drawn.heading = easeAngle(drawn.heading, citizen.heading, ease);

      this.pose(index, drawn);
    });

    for (const mesh of Object.values(this.parts)) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Writes the matrices of one citizen's parts for this frame. */
  private pose(index: number, drawn: Drawn): void {
    const { citizen } = drawn;
    const scale = citizen.look.height;
    const walking = isWalking(citizen);
    const stride = walking ? citizen.distanceWalked * STRIDE_RADIANS_PER_METRE : 0;
    const swing = Math.sin(stride);
    const idle = this.elapsed + drawn.idleOffset;

    // Small gestures by activity, so a standing figure still looks alive.
    const legSwing = swing * LEG_SWING;
    const armSwing = swing * ARM_SWING;
    let armRaise = 0;
    let headTurn = 0;
    let bob = walking ? Math.abs(Math.cos(stride)) * BOB_HEIGHT : 0;
    let showBag = false;

    switch (citizen.activity) {
      case 'Socialize':
        headTurn = Math.sin(idle * 1.3) * 0.25;
        armRaise = Math.max(0, Math.sin(idle * 2.1)) * 0.5;
        bob = Math.abs(Math.sin(idle * 2.1)) * 0.01;
        break;
      case 'Relax':
        headTurn = Math.sin(idle * 0.5) * 0.4;
        break;
      case 'Shop':
        showBag = true;
        armRaise = 0.15;
        break;
      case 'Eat':
        armRaise = 0.6 + Math.sin(idle * 3) * 0.2;
        break;
      case 'Work':
        armRaise = 0.35 + Math.sin(idle * 1.8) * 0.1;
        break;
      default:
        break;
    }

    const base = new Matrix4()
      .makeRotationY(drawn.heading)
      .setPosition(drawn.x, groundHeight(drawn.x, drawn.z) + bob * scale, drawn.z)
      .multiply(new Matrix4().makeScale(scale, scale, scale));

    const place = (part: Part, x: number, y: number, z: number, rotX = 0, rotY = 0): void => {
      const local = new Matrix4().compose(
        new Vector3(x, y, z),
        new Quaternion().setFromEuler(this.scratch.rotation.set(rotX, rotY, 0)),
        new Vector3(1, 1, 1),
      );
      this.parts[part].setMatrixAt(index, base.clone().multiply(local));
    };

    place('leftLeg', -0.12, HIP_HEIGHT, 0, legSwing);
    place('rightLeg', 0.12, HIP_HEIGHT, 0, -legSwing);
    place('torso', 0, HIP_HEIGHT + TORSO_HEIGHT / 2, 0);
    place(
      'leftArm',
      -(TORSO_WIDTH / 2 + ARM_RADIUS + 0.02),
      SHOULDER_HEIGHT,
      0,
      -armSwing - armRaise,
    );
    place('rightArm', TORSO_WIDTH / 2 + ARM_RADIUS + 0.02, SHOULDER_HEIGHT, 0, armSwing - armRaise);
    place('head', 0, HEAD_CENTRE_Y, 0, 0, headTurn);

    // The hair cap is a sphere segment; its length comes from the look.
    const hair = new Matrix4().compose(
      new Vector3(0, HEAD_CENTRE_Y + 0.01, 0),
      new Quaternion().setFromEuler(this.scratch.rotation.set(0, Math.PI + headTurn, 0)),
      new Vector3(1, citizen.look.hairCut / 0.55, 1),
    );
    this.parts.hair.setMatrixAt(index, base.clone().multiply(hair));

    if (showBag) {
      place('bag', TORSO_WIDTH / 2 + ARM_RADIUS + 0.06, SHOULDER_HEIGHT - ARM_LENGTH - 0.1, 0.02);
    } else {
      this.parts.bag.setMatrixAt(index, this.hidden);
    }

    if (this.raining && citizen.activity !== 'Drive') {
      // Held in the right hand, the arm out and up, the canopy over the head.
      const handX = TORSO_WIDTH / 2 + ARM_RADIUS + 0.02;
      this.parts.rightArm.setMatrixAt(
        index,
        base
          .clone()
          .multiply(
            new Matrix4().compose(
              new Vector3(handX, SHOULDER_HEIGHT, 0),
              new Quaternion().setFromEuler(this.scratch.rotation.set(-2.4, 0, -0.35)),
              new Vector3(1, 1, 1),
            ),
          ),
      );
      const stickHeight = UMBRELLA_CANOPY_Y - (SHOULDER_HEIGHT - 0.2);
      place('umbrellaStick', handX + 0.08, SHOULDER_HEIGHT - 0.2 + stickHeight / 2, 0.16);
      this.parts.umbrellaStick.setMatrixAt(
        index,
        base
          .clone()
          .multiply(
            new Matrix4().compose(
              new Vector3(handX + 0.08, SHOULDER_HEIGHT - 0.2 + stickHeight / 2, 0.16),
              new Quaternion(),
              new Vector3(1, stickHeight, 1),
            ),
          ),
      );
      place('umbrellaCanopy', handX + 0.08, UMBRELLA_CANOPY_Y, 0.16);
    } else {
      this.parts.umbrellaStick.setMatrixAt(index, this.hidden);
      this.parts.umbrellaCanopy.setMatrixAt(index, this.hidden);
    }

    if (this.showIcons && citizen.activity !== 'Drive') {
      // A billboard over the head, in world space so it never tilts with the body.
      const top = new Vector3(0, ICON_Y * scale, 0).applyMatrix4(base);
      this.parts.icon.setMatrixAt(
        index,
        new Matrix4().compose(top, this.cameraQuaternion, new Vector3(1, 1, 1)),
      );
    } else {
      this.parts.icon.setMatrixAt(index, this.hidden);
    }
  }

  /** The drawn object for a citizen, used by camera follow in Phase 6. */
  objectFor(citizenId: string): ThreeObject | undefined {
    const index = this.drawn.findIndex((drawn) => drawn.citizen.id === citizenId);
    if (index === -1) {
      return undefined;
    }
    const anchor = new Object3D();
    const { x, z } = this.drawn[index];
    anchor.position.set(x, groundHeight(x, z), z);
    return anchor;
  }
}

let sharedIconTexture: CanvasTexture | undefined;

/** The umbrella glyph on a dark rounded disc, drawn once on a canvas. */
function umbrellaIconTexture(): CanvasTexture {
  if (sharedIconTexture) {
    return sharedIconTexture;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(46, 48, 62, 0.88)';
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    context.fill();
    // The canopy: a half disc with a scalloped edge, and the handle below.
    context.fillStyle = '#f5f0e6';
    context.beginPath();
    context.arc(size / 2, size * 0.52, size * 0.3, Math.PI, 0);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(46, 48, 62, 0.88)';
    for (const dx of [-0.2, 0, 0.2]) {
      context.beginPath();
      context.arc(size / 2 + dx * size, size * 0.53, size * 0.06, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = '#f5f0e6';
    context.lineWidth = 6;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(size / 2, size * 0.52);
    context.lineTo(size / 2, size * 0.78);
    context.arc(size / 2 - 7, size * 0.78, 7, 0, Math.PI);
    context.stroke();
  }
  sharedIconTexture = new CanvasTexture(canvas);
  sharedIconTexture.colorSpace = SRGBColorSpace;
  return sharedIconTexture;
}

/** A limb hanging from its joint: the geometry is shifted so y=0 is the pivot. */
function limb(length: number, radius: number): CapsuleGeometry {
  const geometry = new CapsuleGeometry(radius, length - radius * 2, 4, 8);
  geometry.translate(0, -length / 2, 0);
  return geometry;
}

/** Eases an angle the short way round the circle. */
function easeAngle(from: number, to: number, ease: number): number {
  let difference = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (difference < -Math.PI) {
    difference += Math.PI * 2;
  }
  return from + difference * ease;
}
