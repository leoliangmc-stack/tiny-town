import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from 'three';

import { glowTexture } from './glow.js';
import { cylinderBetween, merge, paint, selfLitMaterial } from './shapes.js';

/**
 * The dragons of Mid-Autumn night (SPEC.md 2.15, decision 39): three
 * Chinese dragons, gold, red and jade, circling and weaving over the town,
 * each chasing a glowing pearl.
 *
 * A dragon's head flies a closed path around the town; its body is the same
 * path a moment earlier, so the whole length follows where the head has been,
 * with a travelling wave through it. The body is one tube rebuilt every
 * frame; the spines, the legs and the head are laid along it. Everything
 * glows a little by its own colour, like a festival dragon lantern, so it
 * reads against the night without outshining the windows.
 *
 * Render side only, on real time, at every speed.
 */

/** Rings along the body, and sides round each ring. */
const RINGS = 72;
const SIDES = 10;
/** Length of the body, metres, and how fast the head flies along its path. */
const LENGTH = 44;
const SPEED = 13;
/** Every so many rings a spine stands on the back. */
const SPINE_EVERY = 2;
/** Where along the body the legs are: fore and hind. */
const LEG_AT = [0.13, 0.46];

interface DragonLook {
  back: number;
  belly: number;
  fins: number;
  pearl: number;
}

const LOOKS: readonly DragonLook[] = [
  { back: 0xe0a92c, belly: 0xfff0c2, fins: 0xd9432e, pearl: 0xfff1b8 },
  { back: 0xc62f2a, belly: 0xffd9a0, fins: 0xf2b43a, pearl: 0xffd2a0 },
  { back: 0x2b9c80, belly: 0xe4f3cf, fins: 0xe8c24a, pearl: 0xc8fff0 },
];

/** Each dragon's flight: round the town, at its own height, radius and pace. */
interface Flight {
  centreX: number;
  centreZ: number;
  radius: number;
  height: number;
  /** +1 anticlockwise, -1 clockwise. */
  turn: number;
  phase: number;
}

const FLIGHTS: readonly Flight[] = [
  { centreX: -5, centreZ: 4, radius: 70, height: 46, turn: 1, phase: 0 },
  { centreX: 12, centreZ: -6, radius: 56, height: 36, turn: -1, phase: 2.1 },
  { centreX: -18, centreZ: 10, radius: 84, height: 56, turn: 1, phase: 4.2 },
];

/** How thick the body is along its length, 0 at the neck and 1 at the tail tip. */
function girth(s: number): number {
  if (s < 0.06) {
    return 0.95 + s * 5;
  }
  if (s < 0.35) {
    return 1.25;
  }
  return 1.25 * Math.pow(1 - (s - 0.35) / 0.65, 0.8) + 0.08;
}

class Dragon {
  readonly root = new Group();

  private readonly body: Mesh<BufferGeometry, Material>;
  private readonly spines: InstancedMesh;
  private readonly legs: InstancedMesh;
  private readonly head: Mesh<BufferGeometry, Material>;
  private readonly pearl: Mesh;
  private readonly pearlGlow: Sprite;
  private readonly spineCount: number;
  private readonly centres: Vector3[] = [];
  private readonly forwards: Vector3[] = [];
  private readonly ups: Vector3[] = [];
  private readonly rights: Vector3[] = [];

  constructor(
    look: DragonLook,
    private readonly flight: Flight,
    materials: Material[],
  ) {
    for (let ring = 0; ring < RINGS; ring += 1) {
      this.centres.push(new Vector3());
      this.forwards.push(new Vector3());
      this.ups.push(new Vector3());
      this.rights.push(new Vector3());
    }
    const skin = selfLitMaterial(0.42, true);
    const fins = selfLitMaterial(0.55, true);
    skin.side = DoubleSide;
    fins.side = DoubleSide;
    materials.push(skin, fins);

    this.body = new Mesh(bodyGeometry(look), skin);
    this.body.name = 'dragon-body';
    this.head = new Mesh(headGeometry(look), skin);
    this.spineCount = Math.floor(RINGS / SPINE_EVERY) + 5;
    this.spines = new InstancedMesh(
      paint(new ConeGeometry(0.35, 1.3, 5), look.fins),
      fins,
      this.spineCount,
    );
    this.spines.instanceMatrix.setUsage(DynamicDrawUsage);
    this.legs = new InstancedMesh(legGeometry(look), skin, 4);
    this.legs.instanceMatrix.setUsage(DynamicDrawUsage);

    const pearlMaterial = new MeshBasicMaterial({ color: look.pearl, toneMapped: false });
    this.pearl = new Mesh(new SphereGeometry(0.9, 16, 12), pearlMaterial);
    const glowMaterial = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(look.pearl),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    this.pearlGlow = new Sprite(glowMaterial);
    this.pearlGlow.scale.setScalar(9);
    materials.push(pearlMaterial, glowMaterial);

    for (const node of [this.body, this.head, this.spines, this.legs, this.pearl, this.pearlGlow]) {
      node.frustumCulled = false;
      this.root.add(node);
    }
  }

  /** Where the head is at time `t` on its path round the town. */
  private path(t: number, out: Vector3): Vector3 {
    const { centreX, centreZ, radius, height, turn, phase } = this.flight;
    const angular = SPEED / radius;
    const angle = turn * angular * t + phase;
    // The loop breathes in and out and rises and dips, so it is never a plain circle.
    const reach = radius * (1 + 0.22 * Math.sin(0.19 * t + phase * 1.3));
    return out.set(
      centreX + Math.cos(angle) * reach,
      height + 9 * Math.sin(0.33 * t + phase) + 4 * Math.sin(0.9 * t + phase * 0.7),
      centreZ + Math.sin(angle) * reach * 0.85,
    );
  }

  update(t: number): void {
    // How far back in time each ring was where the head is now.
    const lag = LENGTH / SPEED;
    const up = new Vector3(0, 1, 0);
    const ahead = new Vector3();
    const behind = new Vector3();
    for (let ring = 0; ring < RINGS; ring += 1) {
      const s = ring / (RINGS - 1);
      const when = t - s * lag;
      const centre = this.path(when, this.centres[ring]);
      this.path(when + 0.05, ahead);
      this.path(when - 0.05, behind);
      const forward = this.forwards[ring].copy(ahead).sub(behind).normalize();
      const right = this.rights[ring].crossVectors(up, forward).normalize();
      const bodyUp = this.ups[ring].crossVectors(forward, right).normalize();
      // A wave runs down the body, up and down and a little side to side.
      const wave = Math.sin(s * Math.PI * 4.2 - t * 3.1) * (0.4 + 1.6 * s);
      const sway = Math.sin(s * Math.PI * 3 - t * 2.3) * 1.2 * s;
      centre.addScaledVector(bodyUp, wave).addScaledVector(right, sway);
    }
    // The wave bends the frames; take the forward again from the bent line.
    for (let ring = 0; ring < RINGS; ring += 1) {
      const a = this.centres[Math.max(0, ring - 1)];
      const b = this.centres[Math.min(RINGS - 1, ring + 1)];
      const forward = this.forwards[ring].copy(a).sub(b).normalize();
      const right = this.rights[ring].crossVectors(up, forward).normalize();
      this.ups[ring].crossVectors(forward, right).normalize();
    }
    this.writeBody();
    this.placeParts(t);
  }

  private writeBody(): void {
    const geometry = this.body.geometry;
    const position = geometry.getAttribute('position') as BufferAttribute;
    const normal = geometry.getAttribute('normal') as BufferAttribute;
    const offset = new Vector3();
    for (let ring = 0; ring < RINGS; ring += 1) {
      const s = ring / (RINGS - 1);
      const radius = girth(s);
      const centre = this.centres[ring];
      const right = this.rights[ring];
      const bodyUp = this.ups[ring];
      for (let side = 0; side <= SIDES; side += 1) {
        const angle = (side / SIDES) * Math.PI * 2;
        offset.copy(right).multiplyScalar(Math.cos(angle)).addScaledVector(bodyUp, Math.sin(angle));
        const index = ring * (SIDES + 1) + side;
        normal.setXYZ(index, offset.x, offset.y, offset.z);
        // A touch flatter across the belly.
        const flat = Math.sin(angle) < 0 ? 0.85 : 1;
        position.setXYZ(
          index,
          centre.x + offset.x * radius,
          centre.y + offset.y * radius * flat,
          centre.z + offset.z * radius,
        );
      }
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
  }

  private placeParts(t: number): void {
    const matrix = new Matrix4();
    const at = new Vector3();
    const scale = new Vector3();
    const basis = new Matrix4();

    // Spines stand on the back and lean towards the tail.
    let spine = 0;
    for (let ring = 2; ring < RINGS - 2 && spine < this.spineCount - 5; ring += SPINE_EVERY) {
      const s = ring / (RINGS - 1);
      const radius = girth(s);
      at.copy(this.centres[ring]).addScaledVector(this.ups[ring], radius * 0.95);
      basis.makeBasis(this.rights[ring], this.ups[ring], this.forwards[ring]);
      const size = 0.5 + radius * 0.7;
      matrix.copy(basis).multiply(new Matrix4().makeRotationX(-0.55));
      matrix.scale(scale.set(size * 0.6, size, size * 0.6));
      matrix.setPosition(at);
      this.spines.setMatrixAt(spine, matrix);
      spine += 1;
    }
    // The tail ends in a tuft of fins.
    const tail = RINGS - 1;
    for (let tuft = 0; tuft < 5; tuft += 1) {
      const spread = (tuft - 2) * 0.45;
      basis.makeBasis(this.rights[tail], this.ups[tail], this.forwards[tail]);
      matrix
        .copy(basis)
        .multiply(new Matrix4().makeRotationX(-Math.PI / 2 - 0.3 + Math.sin(t * 4 + tuft) * 0.15))
        .multiply(new Matrix4().makeRotationZ(spread));
      matrix.scale(scale.set(1.2, 2.6, 1.2));
      matrix.setPosition(this.centres[tail]);
      this.spines.setMatrixAt(spine, matrix);
      spine += 1;
    }
    this.spines.count = spine;
    this.spines.instanceMatrix.needsUpdate = true;

    // Four legs paddle as it swims through the air.
    let leg = 0;
    for (const where of LEG_AT) {
      const ring = Math.round(where * (RINGS - 1));
      const radius = girth(where);
      for (const side of [-1, 1]) {
        const paddle = Math.sin(t * 2.6 + side * 1.4 + where * 6) * 0.5;
        basis.makeBasis(this.rights[ring], this.ups[ring], this.forwards[ring]);
        matrix
          .copy(basis)
          .multiply(new Matrix4().makeScale(side, 1, 1))
          .multiply(new Matrix4().makeRotationX(paddle));
        at.copy(this.centres[ring])
          .addScaledVector(this.rights[ring], side * radius * 0.75)
          .addScaledVector(this.ups[ring], -radius * 0.35);
        matrix.setPosition(at);
        this.legs.setMatrixAt(leg, matrix);
        leg += 1;
      }
    }
    this.legs.instanceMatrix.needsUpdate = true;

    // The head leads, facing the way it flies.
    basis.makeBasis(this.rights[0], this.ups[0], this.forwards[0]);
    this.head.position.copy(this.centres[0]);
    this.head.quaternion.setFromRotationMatrix(basis);

    // The pearl bobs just out of reach ahead.
    this.path(t + 0.9, at);
    at.y += 2.5 + Math.sin(t * 2.2) * 1.2;
    this.pearl.position.copy(at);
    this.pearlGlow.position.copy(at);
    this.pearlGlow.material.opacity = 0.7 + 0.2 * Math.sin(t * 5);
  }

  dispose(): void {
    for (const mesh of [this.body, this.head, this.spines, this.legs, this.pearl]) {
      mesh.geometry.dispose();
    }
  }
}

export class Dragons {
  readonly root = new Group();

  private readonly dragons: Dragon[] = [];
  private readonly materials: Material[] = [];
  private time = 0;

  constructor() {
    this.root.name = 'dragons';
    this.root.visible = false;
    LOOKS.forEach((look, index) => {
      const dragon = new Dragon(look, FLIGHTS[index], this.materials);
      this.dragons.push(dragon);
      this.root.add(dragon.root);
    });
  }

  get count(): number {
    return this.dragons.length;
  }

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  update(deltaSeconds: number): void {
    if (!this.root.visible) {
      return;
    }
    this.time += Math.min(deltaSeconds, 0.1);
    for (const dragon of this.dragons) {
      dragon.update(this.time);
    }
  }

  dispose(): void {
    for (const dragon of this.dragons) {
      dragon.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }
}

/**
 * The body tube, with room for every ring and the colours laid on: the
 * dragon's colour down the back, pale down the belly, and faint bands of
 * scales along its length.
 */
function bodyGeometry(look: DragonLook): BufferGeometry {
  const count = RINGS * (SIDES + 1);
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(count * 3), 3);
  const normal = new BufferAttribute(new Float32Array(count * 3), 3);
  position.setUsage(DynamicDrawUsage);
  normal.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  const colors = new Float32Array(count * 3);
  const back = new Color(look.back);
  const belly = new Color(look.belly);
  const color = new Color();
  for (let ring = 0; ring < RINGS; ring += 1) {
    const band = 0.88 + 0.12 * Math.sin(ring * 1.9);
    for (let side = 0; side <= SIDES; side += 1) {
      const angle = (side / SIDES) * Math.PI * 2;
      // Belly where the ring faces down.
      const under = Math.max(0, -Math.sin(angle));
      color.copy(back).lerp(belly, Math.pow(under, 0.7)).multiplyScalar(band);
      colors.set([color.r, color.g, color.b], (ring * (SIDES + 1) + side) * 3);
    }
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const indices: number[] = [];
  for (let ring = 0; ring < RINGS - 1; ring += 1) {
    for (let side = 0; side < SIDES; side += 1) {
      const a = ring * (SIDES + 1) + side;
      const b = a + SIDES + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  geometry.setIndex(indices);
  return geometry;
}

/**
 * The head, facing +Z with its top at +Y: a long snout, an open jaw, swept
 * back antlers, a mane, bulging eyes and two long whiskers.
 */
function headGeometry(look: DragonLook): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const skull = new SphereGeometry(1.25, 16, 12);
  skull.scale(1, 0.85, 1.2);
  parts.push(paint(skull, look.back).translate(0, 0.25, 0.9));
  const snout = new SphereGeometry(0.85, 14, 10);
  snout.scale(0.95, 0.6, 1.6);
  parts.push(paint(snout, look.back).translate(0, 0.1, 2.5));
  const nose = new SphereGeometry(0.4, 10, 8);
  parts.push(paint(nose, look.fins).translate(0, 0.4, 3.6));
  const jaw = new SphereGeometry(0.7, 12, 8);
  jaw.scale(0.9, 0.35, 1.7);
  jaw.rotateX(0.35);
  parts.push(paint(jaw, look.belly).translate(0, -0.55, 2.1));
  // Eyes under heavy brows.
  for (const side of [-1, 1]) {
    parts.push(paint(new SphereGeometry(0.28, 10, 8), 0xfff4c0).translate(side * 0.62, 0.72, 1.85));
    parts.push(paint(new SphereGeometry(0.14, 8, 6), 0x1a1010).translate(side * 0.72, 0.76, 2.02));
    const brow = new SphereGeometry(0.3, 8, 6);
    brow.scale(1.4, 0.5, 1);
    parts.push(paint(brow, look.fins).translate(side * 0.6, 1.02, 1.75));
  }
  // Antlers, swept back, with a tine each.
  for (const side of [-1, 1]) {
    const root = new Vector3(side * 0.55, 1.0, 0.6);
    const bend = new Vector3(side * 0.95, 2.1, -0.4);
    const tip = new Vector3(side * 1.15, 2.6, -1.8);
    parts.push(cylinderBetween(root, bend, 0.16, 0.12, 0xf3e3b8, 6));
    parts.push(cylinderBetween(bend, tip, 0.12, 0.04, 0xf3e3b8, 6));
    parts.push(cylinderBetween(bend, new Vector3(side * 1.5, 2.8, -0.2), 0.08, 0.03, 0xf3e3b8, 6));
  }
  // A mane of flames down the back of the head.
  for (let index = 0; index < 7; index += 1) {
    const cone = new ConeGeometry(0.28, 1.8, 5);
    cone.rotateX(-Math.PI / 2 - 0.4);
    const side = index % 2 === 0 ? -1 : 1;
    cone.rotateY(side * 0.35);
    parts.push(
      paint(cone, look.fins).translate(
        side * 0.5 * (index / 7),
        0.4 + (index % 3) * 0.3,
        -0.3 - index * 0.1,
      ),
    );
  }
  // Two long whiskers curling back from the snout.
  for (const side of [-1, 1]) {
    const points = [
      new Vector3(side * 0.55, 0.05, 3.2),
      new Vector3(side * 1.4, -0.2, 3.0),
      new Vector3(side * 2.4, -0.7, 2.0),
      new Vector3(side * 2.9, -1.3, 0.4),
      new Vector3(side * 3.1, -1.1, -1.2),
    ];
    for (let index = 0; index < points.length - 1; index += 1) {
      const width = 0.09 * (1 - index / points.length) + 0.02;
      parts.push(
        cylinderBetween(points[index], points[index + 1], width, width * 0.8, look.fins, 5),
      );
    }
  }
  // A beard under the chin.
  const beard = new ConeGeometry(0.35, 1.4, 6);
  beard.rotateX(Math.PI - 0.5);
  parts.push(paint(beard, look.belly).translate(0, -1.0, 1.6));
  return merge(parts);
}

/** A leg, reaching out along +X and down, with three claws. */
function legGeometry(look: DragonLook): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hip = new Vector3(0, 0, 0);
  const knee = new Vector3(1.1, -0.7, 0.3);
  const foot = new Vector3(1.3, -1.7, 0.9);
  parts.push(cylinderBetween(hip, knee, 0.4, 0.28, look.back, 7));
  parts.push(cylinderBetween(knee, foot, 0.28, 0.2, look.back, 7));
  for (const spread of [-0.35, 0, 0.35]) {
    const tip = foot
      .clone()
      .add(new Vector3(Math.sin(spread) * 0.6, -0.25, Math.cos(spread) * 0.6));
    parts.push(cylinderBetween(foot, tip, 0.1, 0.02, 0xf3e3b8, 5));
  }
  // A flame of fin at the elbow.
  const flame = new ConeGeometry(0.2, 1, 5);
  flame.rotateX(-Math.PI / 2 - 0.3);
  parts.push(paint(flame, look.fins).translate(knee.x, knee.y + 0.1, knee.z - 0.5));
  return merge(parts);
}
