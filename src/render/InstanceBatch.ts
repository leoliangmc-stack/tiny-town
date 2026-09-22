import {
  type BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';

/**
 * Collects placements of one geometry with one material, then builds a single
 * InstancedMesh for all of them (PHASES.md Phase 3.5).
 *
 * Everything repeated in the town goes through one of these: a window pane, a
 * lamp post, a tree crown, a plain box of trim. The town is built by adding
 * placements while it is laid out; `build` runs once at the end. Colour is
 * per instance, so one geometry and material serve every colour of the same
 * shape.
 */
export interface BatchOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export class InstanceBatch {
  private readonly matrices: Matrix4[] = [];
  private readonly colors: Color[] = [];
  private mesh: InstancedMesh | undefined;

  constructor(
    readonly name: string,
    private readonly geometry: BufferGeometry,
    private readonly material: Material,
    private readonly options: BatchOptions = {},
  ) {}

  /** Adds one instance and returns its index, for later updates. */
  add(matrix: Matrix4, color: Color | number = 0xffffff): number {
    this.matrices.push(matrix.clone());
    this.colors.push(color instanceof Color ? color.clone() : new Color(color));
    return this.matrices.length - 1;
  }

  /** A placement from position, Euler rotation and scale, the common case. */
  place(
    position: { x: number; y: number; z: number },
    rotation: { x?: number; y?: number; z?: number } = {},
    scale: { x?: number; y?: number; z?: number } | number = 1,
    color: Color | number = 0xffffff,
  ): number {
    return this.add(composeMatrix(position, rotation, scale), color);
  }

  get count(): number {
    return this.matrices.length;
  }

  /** Builds the mesh and adds it to `parent`. Empty batches add nothing. */
  build(parent: Group): InstancedMesh | undefined {
    if (this.matrices.length === 0) {
      return undefined;
    }
    const mesh = new InstancedMesh(this.geometry, this.material, this.matrices.length);
    mesh.name = this.name;
    mesh.castShadow = this.options.castShadow ?? false;
    mesh.receiveShadow = this.options.receiveShadow ?? false;
    // The town is one static thing; culling per instance is not worth it.
    mesh.frustumCulled = false;
    this.matrices.forEach((matrix, index) => {
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, this.colors[index]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    parent.add(mesh);
    this.mesh = mesh;
    return mesh;
  }

  /** The built mesh, for batches whose instances change after building. */
  get built(): InstancedMesh {
    if (!this.mesh) {
      throw new Error(`Batch ${this.name} has not been built`);
    }
    return this.mesh;
  }
}

const scratch = new Object3D();

/** A world matrix from position, Euler rotation and scale. */
export function composeMatrix(
  position: { x: number; y: number; z: number },
  rotation: { x?: number; y?: number; z?: number } = {},
  scale: { x?: number; y?: number; z?: number } | number = 1,
): Matrix4 {
  const scaleVector =
    typeof scale === 'number'
      ? new Vector3(scale, scale, scale)
      : new Vector3(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1);
  return new Matrix4().compose(
    new Vector3(position.x, position.y, position.z),
    new Quaternion().setFromEuler(
      scratch.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0),
    ),
    scaleVector,
  );
}
