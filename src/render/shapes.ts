import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type ColorRepresentation,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Small helpers for the Mid-Autumn figures (the Moon Palace, Chang'e and the
 * dragons), which are built like everything else here: primitives painted
 * with vertex colours and merged, so each figure is a handful of draw calls.
 */

/** Paints a whole geometry one colour and returns it, ready to merge. */
export function paint(geometry: BufferGeometry, color: ColorRepresentation): BufferGeometry {
  const shade = new Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = shade.r;
    colors[index * 3 + 1] = shade.g;
    colors[index * 3 + 2] = shade.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Merges painted parts into one geometry, keeping only what they all share. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const prepared = parts.map((geometry) => {
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') {
        geometry.deleteAttribute(name);
      }
    }
    return geometry.index ? geometry : withIndex(geometry);
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) {
    throw new Error('shapes.merge: parts do not share attributes');
  }
  for (const part of prepared) {
    part.dispose();
  }
  return merged;
}

/** Gives a non-indexed geometry a trivial index, so it merges with indexed ones. */
function withIndex(geometry: BufferGeometry): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const index = new Uint32Array(count);
  for (let at = 0; at < count; at += 1) {
    index[at] = at;
  }
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

/** A cylinder from one point to another, for limbs, pillars and whiskers. */
export function cylinderBetween(
  from: Vector3,
  to: Vector3,
  radiusFrom: number,
  radiusTo: number,
  color: ColorRepresentation,
  segments = 8,
): BufferGeometry {
  const length = from.distanceTo(to);
  const geometry = new CylinderGeometry(radiusTo, radiusFrom, length, segments, 1);
  const turn = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    to.clone().sub(from).normalize(),
  );
  geometry.applyQuaternion(turn);
  const middle = from.clone().add(to).multiplyScalar(0.5);
  geometry.translate(middle.x, middle.y, middle.z);
  return paint(geometry, color);
}

/**
 * A Chinese hip roof: a ridge along X, four concave slopes, and the corners
 * of the eaves swept up. `width` and `depth` are the eave outline, `height`
 * the rise to the ridge; the roof's eaves sit at y = 0.
 */
export function hipRoof(
  width: number,
  depth: number,
  height: number,
  curl: number,
  color: ColorRepresentation,
): BufferGeometry {
  const segments = 18;
  const geometry = new PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position') as BufferAttribute;
  const halfW = width / 2;
  const halfD = depth / 2;
  const ridge = Math.max(0, halfW - halfD);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    // How far from the ridge towards the eave, 0 at the ridge, 1 at the edge.
    const along = Math.max(Math.abs(z) / halfD, (Math.abs(x) - ridge) / halfD);
    const t = Math.min(1, Math.max(0, along));
    // Concave slopes: steep near the ridge, flattening to the eave.
    let y = height * Math.pow(1 - t, 1.7);
    // The corners sweep up.
    const corner = Math.pow(Math.abs(x) / halfW, 6) * Math.pow(Math.abs(z) / halfD, 6);
    y += curl * Math.pow(corner, 0.5);
    position.setY(index, y);
  }
  geometry.computeVertexNormals();
  return paint(geometry, color);
}

/**
 * A lit-from-within look without a light: the material glows by its own
 * vertex colour times `emissive`, so a figure far from any lamp still reads
 * at night, in its own colours. Fog is off, for things out in the sky.
 */
export function selfLitMaterial(glow: number, fog = false): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    vertexColors: true,
    emissive: new Color(glow, glow, glow),
    fog,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 totalEmissiveRadiance = emissive;',
      'vec3 totalEmissiveRadiance = emissive * vColor.rgb;',
    );
  };
  return material;
}
