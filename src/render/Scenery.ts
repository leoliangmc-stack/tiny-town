import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';

import { Rng } from '../simulation/Rng.js';
import { groundHeight } from '../world/Terrain.js';
import { townBounds } from '../world/Town.js';

import type { EnvironmentState } from './Environment.js';

/**
 * The place around the town (SPEC.md 2.14, DESIGN.md §20): the sea and its
 * beach to the north, a forest of instanced trees around the other sides,
 * a ring of hills and a ring of mountains behind, all under the fog so
 * distance reads as haze. Six draw calls in all, none of which cast shadows.
 *
 * The swell and the glint are render side animation: nothing here is read by
 * the simulation.
 */

/** Where the shore lies: a gentle bay north of the town, z growing more negative seawards. */
export function coastZ(x: number): number {
  return -76 - 7 * Math.sin(x / 38) - 3 * Math.sin(x / 11 + 1.3) - 2 * Math.sin(x / 5.5);
}

/** The beach runs this far inland from the water's edge. */
const BEACH_DEPTH = 13;

/** How far out the sea and the land are drawn; the fog hides the ends. */
const WORLD_REACH = 700;

const SAND = 0xe6d6b4;
const HILL = 0xa9a37c;
const MOUNTAIN = 0x8a93a3;
const FOREST_OLIVE = 0x8e9c7e;
const FOREST_CYPRESS = 0x3f5a3f;
const TRUNK = 0x8b6b4e;

const SEA_VERTEX_SHADER = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

/**
 * Water for a god view: a deep colour that shallows towards the sand, a slow
 * swell of two crossing sine waves, and a band of glint stretched along the
 * line from the viewer towards the sun or moon.
 */
const SEA_FRAGMENT_SHADER = /* glsl */ `
  #include <fog_pars_fragment>
  uniform vec3 deepColor;
  uniform vec3 shallowColor;
  uniform vec3 glintColor;
  uniform vec3 lightDirection;
  uniform float glintStrength;
  uniform vec3 cameraPos;
  uniform float time;
  varying vec3 vWorldPosition;

  // The same curve as coastZ() below; the two must agree.
  float coastZ(float x) {
    return -76.0 - 7.0 * sin(x / 38.0) - 3.0 * sin(x / 11.0 + 1.3) - 2.0 * sin(x / 5.5);
  }

  void main() {
    vec2 p = vWorldPosition.xz;

    // The swell: two long waves crossing at a slant, and a little chop on top.
    // Kept faint: the water should breathe, not stripe.
    float swell = sin(p.x * 0.09 + p.y * 0.05 + time * 0.5) * sin(p.y * 0.07 - p.x * 0.03 - time * 0.4)
      + 0.5 * sin(p.x * 0.031 - p.y * 0.052 + time * 0.3);
    // Anything finer than the swell fades out with distance, or the far water
    // breaks into moire from the god view.
    float distance = length(vWorldPosition - cameraPos);
    float near = 1.0 - smoothstep(80.0, 260.0, distance);
    float chop = sin(p.x * 0.6 + p.y * 0.4 + time * 1.6) * 0.5 * near;
    float wave = swell * 0.6 + chop * 0.4;

    // Shallower and paler towards the sand.
    float shoreLine = coastZ(p.x);
    float toShore = clamp((shoreLine - vWorldPosition.z) / 26.0, 0.0, 1.0);
    vec3 color = mix(shallowColor, deepColor, smoothstep(0.0, 1.0, toShore));
    color += deepColor * 0.07 * wave;

    // The glint band under the light: points that lie along the line from the
    // viewer towards the light's azimuth, sparkling with the swell.
    vec2 toPoint = normalize(p - cameraPos.xz);
    vec2 toLight = normalize(lightDirection.xz);
    float along = max(dot(toPoint, toLight), 0.0);
    float band = pow(along, 24.0);
    // Fine sparkle close by; a smooth path further out, where pixels are
    // too coarse to carry it.
    float fine = 0.5 + 0.5 * sin(p.x * 1.3 + p.y * 0.9 + time * 2.2) * sin(p.x * 0.4 - p.y * 1.7 - time * 1.5 + wave * 3.0);
    float sparkle = mix(0.4 + 0.15 * wave, fine, near * 0.6);
    float lowLight = 1.0 - smoothstep(0.35, 0.9, lightDirection.y);
    color += glintColor * band * sparkle * glintStrength * (0.3 + 0.5 * lowLight);

    // A thin line of foam at the water's edge, no brighter than the shallows.
    float foam = smoothstep(1.6, 0.0, abs(vWorldPosition.z - shoreLine) - 0.6 * wave);
    vec3 foamColor = shallowColor * 1.35 + vec3(0.04);
    color = mix(color, foamColor, foam * 0.5);

    gl_FragColor = vec4(color, 1.0);
    // Three.js hands the fog colour over in output space and blends it in
    // after tone mapping, so this order matches the lit materials around it.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class Scenery {
  readonly root = new Group();

  private readonly seaMaterial: ShaderMaterial;

  constructor() {
    this.root.name = 'scenery';

    this.seaMaterial = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          deepColor: { value: new Color(0x356a9c) },
          shallowColor: { value: new Color(0x78afcc) },
          glintColor: { value: new Color(0xffffff) },
          lightDirection: { value: new Vector3(0, 1, 0) },
          glintStrength: { value: 1 },
          cameraPos: { value: new Vector3() },
          time: { value: 0 },
        },
      ]),
      vertexShader: SEA_VERTEX_SHADER,
      fragmentShader: SEA_FRAGMENT_SHADER,
      fog: true,
    });

    this.addSeaAndBeach();
    this.addForest();
    this.addRing('hills', 330, 420, 6, 20, HILL, 48, 'land');
    this.addRing('mountains', 470, 580, 30, 85, MOUNTAIN, 40, 'all');
  }

  /** A curved beach along the shore, and the sea beyond it to the horizon. */
  private addSeaAndBeach(): void {
    const steps = 64;
    const xs = Array.from(
      { length: steps + 1 },
      (_, i) => -WORLD_REACH + (2 * WORLD_REACH * i) / steps,
    );

    const sea = new Shape();
    sea.moveTo(-WORLD_REACH, -WORLD_REACH);
    sea.lineTo(WORLD_REACH, -WORLD_REACH);
    for (const x of [...xs].reverse()) {
      sea.lineTo(x, coastZ(x));
    }
    sea.closePath();
    const seaMesh = new Mesh(new ShapeGeometry(sea, 1), this.seaMaterial);
    seaMesh.rotation.x = -Math.PI / 2;
    seaMesh.position.y = 0.05;
    seaMesh.name = 'sea';
    // The shape's y runs the opposite way once laid flat; flip it back.
    seaMesh.scale.y = -1;
    this.root.add(seaMesh);

    const beach = new Shape();
    beach.moveTo(xs[0], coastZ(xs[0]) + BEACH_DEPTH);
    for (const x of xs) {
      beach.lineTo(x, coastZ(x) - 3);
    }
    for (const x of [...xs].reverse()) {
      beach.lineTo(x, coastZ(x) + BEACH_DEPTH + 2.5 * Math.sin(x / 17));
    }
    beach.closePath();
    const beachGeometry = new ShapeGeometry(beach, 1);
    // The sand climbs onto the slope where the shore comes close to the town.
    const sandPositions = beachGeometry.getAttribute('position');
    for (let index = 0; index < sandPositions.count; index += 1) {
      // Shape space: x is world x, y is world z before the mesh is laid flat
      // and flipped, so the height is read at (x, y) and written to z.
      sandPositions.setZ(index, groundHeight(sandPositions.getX(index), sandPositions.getY(index)));
    }
    sandPositions.needsUpdate = true;
    beachGeometry.computeVertexNormals();
    const beachMesh = new Mesh(
      beachGeometry,
      new MeshStandardMaterial({ color: SAND, roughness: 1, metalness: 0, side: DoubleSide }),
    );
    beachMesh.rotation.x = -Math.PI / 2;
    beachMesh.scale.y = -1;
    beachMesh.position.y = 0.04;
    beachMesh.receiveShadow = true;
    beachMesh.name = 'beach';
    this.root.add(beachMesh);
  }

  /**
   * A ring of high ground around the town: a ridge line that wanders in
   * height and in distance, with valleys between the peaks, so the skyline
   * is a range and not a row of teeth. Over the sea the ridge drops away,
   * so the water reaches the horizon between headlands.
   */
  private addRing(
    name: string,
    innerRadius: number,
    outerRadius: number,
    minHeight: number,
    maxHeight: number,
    color: number,
    segments: number,
    where: 'land' | 'all',
  ): void {
    const rng = new Rng(`scenery:${name}`);
    const points = segments * 3;

    // The ridge: a random walk in height with occasional deep valleys, and a
    // radius that wanders so nothing lines up on a circle.
    const ridge: Array<{ angle: number; radius: number; height: number }> = [];
    let height = rng.nextFloat(minHeight, maxHeight);
    let radius = rng.nextFloat(innerRadius, outerRadius);
    for (let i = 0; i < points; i += 1) {
      const angle = ((i + rng.nextFloat(-0.3, 0.3)) / points) * Math.PI * 2;
      const step = rng.nextFloat(-0.45, 0.45) * (maxHeight - minHeight);
      height = Math.min(maxHeight, Math.max(minHeight, height + step));
      if (rng.next() < 0.12) {
        height = minHeight * rng.nextFloat(0.4, 0.9);
      }
      radius = Math.min(
        outerRadius,
        Math.max(innerRadius, radius + rng.nextFloat(-0.3, 0.3) * (outerRadius - innerRadius)),
      );
      const seaward = Math.sin(angle) < -0.25; // north of the town
      const drawn = where === 'land' && seaward ? 0 : height * (seaward ? 0.5 : 1);
      ridge.push({ angle, radius, height: drawn });
    }

    const positions: number[] = [];
    const push = (x: number, y: number, z: number): void => {
      positions.push(x, y, z);
    };
    const base = (angle: number, r: number): { x: number; z: number } => ({
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
    });

    for (let i = 0; i < points; i += 1) {
      const a = ridge[i];
      const b = ridge[(i + 1) % points];
      if (a.height <= 0 && b.height <= 0) {
        continue;
      }
      const frontA = base(a.angle, innerRadius - 30);
      const frontB = base(b.angle, innerRadius - 30);
      const topA = base(a.angle, a.radius);
      const topB = base(b.angle, b.radius);
      const backA = base(a.angle, outerRadius * 1.3);
      const backB = base(b.angle, outerRadius * 1.3);
      // The ridge stands on the ground, which is higher inland.
      const floor = (point: { x: number; z: number }): number => groundHeight(point.x, point.z) - 1;
      const peakA = floor(topA) + a.height;
      const peakB = floor(topB) + b.height;
      // Front slope and back slope, two triangles each.
      push(frontA.x, floor(frontA), frontA.z);
      push(frontB.x, floor(frontB), frontB.z);
      push(topB.x, peakB, topB.z);
      push(frontA.x, floor(frontA), frontA.z);
      push(topB.x, peakB, topB.z);
      push(topA.x, peakA, topA.z);
      push(topA.x, peakA, topA.z);
      push(topB.x, peakB, topB.z);
      push(backB.x, floor(backB), backB.z);
      push(topA.x, peakA, topA.z);
      push(backB.x, floor(backB), backB.z);
      push(backA.x, floor(backA), backA.z);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true }),
    );
    mesh.name = name;
    this.root.add(mesh);
  }

  /**
   * A forest between the town and the hills, on the three landward sides, as
   * three instanced meshes: trunks, round crowns and pine cones. Simple
   * shapes, no shadows: they are read through the haze.
   */
  private addForest(): void {
    const rng = new Rng('scenery:forest');
    const bounds = townBounds();
    const margin = 22;
    const trees: Array<{ x: number; z: number; pine: boolean; height: number }> = [];

    let attempts = 0;
    while (trees.length < 900 && attempts < 8000) {
      attempts += 1;
      const x = rng.nextFloat(-360, 360);
      const z = rng.nextFloat(-40, 360);
      const insideTown =
        x > bounds.minX - margin &&
        x < bounds.maxX + margin &&
        z > bounds.minZ - margin &&
        z < bounds.maxZ + margin;
      const inSea = z < coastZ(x) + BEACH_DEPTH + 6;
      const farOut = Math.hypot(x, z) > 350;
      if (insideTown || inSea || farOut) {
        continue;
      }
      // Denser away from the town, thinning at its edge.
      const nearness = Math.max(0, 1 - (Math.hypot(x, z) - 100) / 200);
      if (rng.next() < nearness * 0.55) {
        continue;
      }
      const pine = rng.next() < 0.4;
      trees.push({ x, z, pine, height: pine ? rng.nextFloat(8, 13) : rng.nextFloat(5, 8) });
    }

    const wood = new MeshStandardMaterial({ color: TRUNK, roughness: 1, metalness: 0 });
    const trunks = new InstancedMesh(new CylinderGeometry(0.3, 0.45, 1, 5), wood, trees.length);
    const crowns = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshStandardMaterial({
        color: FOREST_OLIVE,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
      trees.length,
    );
    const pines = new InstancedMesh(
      new ConeGeometry(1, 1, 6),
      new MeshStandardMaterial({
        color: FOREST_CYPRESS,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
      trees.length,
    );
    const placement = new Object3D();
    const hidden = new Object3D();
    hidden.scale.setScalar(0);
    hidden.updateMatrix();

    trees.forEach((tree, index) => {
      const trunkHeight = tree.height * 0.35;
      const ground = groundHeight(tree.x, tree.z);
      placement.position.set(tree.x, ground + trunkHeight / 2, tree.z);
      placement.rotation.set(0, 0, 0);
      placement.scale.set(1, trunkHeight, 1);
      placement.updateMatrix();
      trunks.setMatrixAt(index, placement.matrix);

      const crownHeight = tree.height - trunkHeight;
      placement.rotation.set(0, rng.nextFloat(0, Math.PI * 2), 0);
      if (tree.pine) {
        placement.position.set(tree.x, ground + trunkHeight + crownHeight / 2, tree.z);
        placement.scale.set(crownHeight * 0.17, crownHeight, crownHeight * 0.17);
        placement.updateMatrix();
        pines.setMatrixAt(index, placement.matrix);
        crowns.setMatrixAt(index, hidden.matrix);
      } else {
        placement.position.set(tree.x, ground + trunkHeight + crownHeight * 0.45, tree.z);
        placement.scale.set(crownHeight * 0.7, crownHeight * 0.42, crownHeight * 0.7);
        placement.updateMatrix();
        crowns.setMatrixAt(index, placement.matrix);
        pines.setMatrixAt(index, hidden.matrix);
      }
      const shade = rng.nextFloat(-0.06, 0.06);
      crowns.setColorAt(index, new Color(FOREST_OLIVE).offsetHSL(0, 0, shade));
      pines.setColorAt(index, new Color(FOREST_CYPRESS).offsetHSL(0, 0, shade));
    });

    for (const mesh of [trunks, crowns, pines]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.frustumCulled = false;
      mesh.name = 'forest';
      this.root.add(mesh);
    }
  }

  /** Moves the water and its glint with the hour. */
  update(environment: EnvironmentState, elapsedSeconds: number, cameraPosition: Vector3): void {
    const uniforms = this.seaMaterial.uniforms;
    (uniforms.deepColor.value as Color).copy(environment.seaDeep);
    (uniforms.shallowColor.value as Color).copy(environment.seaShallow);
    (uniforms.glintColor.value as Color).copy(environment.seaGlint);
    (uniforms.lightDirection.value as Vector3).copy(environment.lightDirection);
    uniforms.glintStrength.value = environment.glintStrength;
    (uniforms.cameraPos.value as Vector3).copy(cameraPosition);
    uniforms.time.value = elapsedSeconds;
  }
}
