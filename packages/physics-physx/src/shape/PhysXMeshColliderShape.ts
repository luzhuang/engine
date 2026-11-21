import { MeshColliderShapeCookingFlag, Vector3 } from "@galacean/engine";
import { IMeshColliderShape, IMeshColliderSource } from "@galacean/engine-design";
import type { PhysXPhysics } from "../PhysXPhysics";
import { PhysXPhysicsMaterial } from "../PhysXPhysicsMaterial";
import { PhysXColliderShape } from "./PhysXColliderShape";

export type PhysXMeshCookCache = WeakMap<object, Map<number, CookedMeshLease>>;

class CookedMeshLease {
  private _users = 1;

  constructor(
    readonly mesh: { release(): void },
    readonly version: number,
    private readonly _variants: Map<number, CookedMeshLease>,
    private readonly _variant: number
  ) {}

  retain(): CookedMeshLease {
    this._users++;
    return this;
  }

  release(): void {
    if (--this._users === 0) {
      if (this._variants.get(this._variant) === this) this._variants.delete(this._variant);
      this.mesh.release();
    }
  }
}

/**
 * Mesh collider shape in PhysX.
 */
export class PhysXMeshColliderShape extends PhysXColliderShape implements IMeshColliderShape {
  private static readonly _tightBoundsFlag = 1; // eTIGHT_BOUNDS = 1 (1<<0)

  private _meshLease!: CookedMeshLease;
  private _doubleSided = false;
  private readonly _isConvex: boolean;

  constructor(
    physXPhysics: PhysXPhysics,
    uniqueID: number,
    source: IMeshColliderSource,
    isConvex: boolean,
    material: PhysXPhysicsMaterial,
    cookingFlags: number,
    scale: Vector3
  ) {
    super(physXPhysics);
    this._isConvex = isConvex;

    const lease = this._acquireMesh(source, cookingFlags, scale);
    if (!lease) return;

    const pxGeometry = this._createGeometry(lease.mesh, scale);
    const pxShape = this._createShape(pxGeometry, material);

    if (!pxShape) {
      pxGeometry.delete();
      lease.release();
      return;
    }

    this._id = uniqueID;
    this._meshLease = lease;
    this._pxGeometry = pxGeometry;
    this._pxShape = pxShape;
    this._pxShape.setUUID(uniqueID);
  }

  /**
   * {@inheritDoc IMeshColliderShape.setMeshData }
   */
  setMeshData(source: IMeshColliderSource, cookingFlags: number, scale: Vector3): boolean {
    const lease = this._acquireMesh(source, cookingFlags, scale);
    if (!lease) return false;

    this._updateGeometry(lease.mesh, scale);
    this._meshLease.release();
    this._meshLease = lease;
    return true;
  }

  /** {@inheritDoc IMeshColliderShape.setDoubleSided } */
  setDoubleSided(value: boolean, scale: Vector3): void {
    this._doubleSided = value;
    this._updateGeometry(this._meshLease.mesh, scale);
  }

  /**
   * {@inheritDoc IMeshColliderShape.setScale }
   */
  setScale(scale: Vector3): void {
    this._updateGeometry(this._meshLease.mesh, scale);
  }

  /**
   * {@inheritDoc IColliderShape.destroy }
   */
  override destroy(): void {
    super.destroy();
    this._meshLease.release();
  }

  private _acquireMesh(source: IMeshColliderSource, cookingFlags: number, scale: Vector3): CookedMeshLease | null {
    const cache = this._physXPhysics._meshCookCache;
    let variants = cache.get(source.key);
    if (source.refresh) variants?.clear();
    // PhysX triangle geometry handles mirrored scale. Convex hulls bake the reflection into vertices.
    const reflection = this._isConvex ? 8 | (scale.x < 0 ? 1 : 0) | (scale.y < 0 ? 2 : 0) | (scale.z < 0 ? 4 : 0) : 0;
    const variant = (cookingFlags << 4) | reflection;
    const cached = variants?.get(variant);
    if (cached?.version === source.version) return cached.retain();

    const mesh = this._cookMesh(source.positions, source.indices, cookingFlags, scale);
    if (!mesh) return null;
    if (!variants) cache.set(source.key, (variants = new Map()));
    const lease = new CookedMeshLease(mesh, source.version, variants, variant);
    variants.set(variant, lease);
    return lease;
  }

  private _cookMesh(
    positions: Vector3[],
    indices: Uint8Array | Uint16Array | Uint32Array | null,
    cookingFlags: number,
    scale: Vector3
  ): any | null {
    const {
      _physX: physX,
      _pxPhysics: physics,
      _pxCooking: cooking,
      _pxCookingParams: cookingParams
    } = this._physXPhysics;

    // The cooking instance is shared, so set its preprocessing flags for each cook.
    let preprocessFlags = 0;
    if (cookingFlags & MeshColliderShapeCookingFlag.VertexWelding) {
      preprocessFlags |= 1; // eWELD_VERTICES
    }
    if (!(cookingFlags & MeshColliderShapeCookingFlag.Cleaning)) {
      preprocessFlags |= 2; // eDISABLE_CLEAN_MESH
    }
    physX.setCookingMeshPreprocessParams(cookingParams, preprocessFlags);
    cooking.setParams(cookingParams);

    const verticesPtr = this._allocatePositions(positions, scale);
    if (!verticesPtr) return null;
    let pxMesh: any;

    if (this._isConvex) {
      pxMesh = cooking.createConvexMesh(verticesPtr, positions.length, physics);
      physX._free(verticesPtr);

      if (!pxMesh) {
        this._logConvexCookingError(physX);
        return null;
      }
    } else {
      const isU32 = indices instanceof Uint32Array;
      const indicesPtr = this._allocateIndices(indices!, isU32);
      pxMesh = cooking.createTriMesh(verticesPtr, positions.length, indicesPtr, indices!.length / 3, !isU32, physics);
      physX._free(verticesPtr);
      physX._free(indicesPtr);

      if (!pxMesh) {
        this._logTriMeshCookingError(physX);
        return null;
      }
    }

    return pxMesh;
  }

  private _logConvexCookingError(physX: any): void {
    switch (physX.getLastConvexCookingResult()) {
      case 1: // eZERO_AREA_TEST_FAILED
        console.error(
          "PhysXMeshColliderShape: Failed to create convex mesh. Could not find 4 vertices that do not form a zero-area triangle."
        );
        break;
      case 2: // ePOLYGONS_LIMIT_REACHED
        console.error(
          "PhysXMeshColliderShape: Failed to create convex mesh within the maximum polygons limit (256). Consider simplifying the mesh."
        );
        break;
      default: // eFAILURE
        console.error("PhysXMeshColliderShape: Failed to create convex mesh. The input geometry may be invalid.");
        break;
    }
  }

  private _logTriMeshCookingError(physX: any): void {
    switch (physX.getLastTriMeshCookingResult()) {
      case 1: // eLARGE_TRIANGLE
        console.error(
          "PhysXMeshColliderShape: Failed to create triangle mesh. One of the triangles is too large. Consider tessellating large triangles."
        );
        break;
      default: // eFAILURE
        console.error("PhysXMeshColliderShape: Failed to create triangle mesh. The input geometry may be invalid.");
        break;
    }
  }

  private _allocatePositions(positions: Vector3[], scale: Vector3): number {
    const physX = this._physXPhysics._physX;
    const length = positions.length;
    const ptr = physX._malloc(length * 3 * 4);
    if (!ptr) {
      console.error("PhysXMeshColliderShape: could not allocate vertex data.");
      return 0;
    }
    const view = new Float32Array(physX.HEAPF32.buffer, ptr, length * 3);
    // Convex meshes only accept positive geometry scales; apply reflections to their cook input.
    const xSign = this._isConvex && scale.x < 0 ? -1 : 1;
    const ySign = this._isConvex && scale.y < 0 ? -1 : 1;
    const zSign = this._isConvex && scale.z < 0 ? -1 : 1;
    let i = 0;
    for (let offset = 0; i < length; i++, offset += 3) {
      const point = positions[i];
      if (!point) break;
      const x = Math.fround(point.x * xSign);
      const y = Math.fround(point.y * ySign);
      const z = Math.fround(point.z * zSign);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) break;
      view[offset] = x;
      view[offset + 1] = y;
      view[offset + 2] = z;
    }
    if (i === length) return ptr;
    physX._free(ptr);
    console.error("PhysXMeshColliderShape: vertex positions must be finite in Float32.");
    return 0;
  }

  private _allocateIndices(indices: Uint8Array | Uint16Array | Uint32Array, isU32: boolean): number {
    const physX = this._physXPhysics._physX;
    // PhysX accepts 16- or 32-bit indices, so widen 8-bit input to 16 bits.
    const TypedArrayCtor = isU32 ? Uint32Array : Uint16Array;
    const ptr = physX._malloc(indices.length * TypedArrayCtor.BYTES_PER_ELEMENT);
    const heap = isU32 ? physX.HEAPU32 : physX.HEAPU16;
    new TypedArrayCtor(heap.buffer, ptr, indices.length).set(indices);
    return ptr;
  }

  private _createGeometry(pxMesh: any, scale: Vector3): any {
    const physX = this._physXPhysics._physX;
    const { x: scaleX, y: scaleY, z: scaleZ } = scale;
    return this._isConvex
      ? physX.createConvexMeshGeometry(
          pxMesh,
          Math.abs(scaleX),
          Math.abs(scaleY),
          Math.abs(scaleZ),
          PhysXMeshColliderShape._tightBoundsFlag
        )
      : physX.createTriMeshGeometry(pxMesh, scaleX, scaleY, scaleZ, this._doubleSided ? 2 : 0);
  }

  private _updateGeometry(pxMesh: any, scale: Vector3): void {
    const newGeometry = this._createGeometry(pxMesh, scale);
    this._pxShape.setGeometry(newGeometry);
    this._pxGeometry.delete();
    this._pxGeometry = newGeometry;
  }
}
