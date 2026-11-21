import type { IHeightFieldColliderShape } from "@galacean/engine-design";
import { Vector3 } from "@galacean/engine-math";
import { assignmentClone } from "../clone/CloneDecorators";
import { Engine } from "../Engine";
import { Collider } from "./Collider";

/** The local grid and elevation samples of a heightfield. */
export interface HeightFieldData {
  /** Number of samples along local X. Must be at least two. */
  readonly rows: number;
  /** Number of samples along local Z. Must be at least two. */
  readonly columns: number;
  /** Signed 16-bit elevations in row-major order. */
  readonly heights: Int16Array | ReadonlyArray<number>;
  /** Distance in local units between rows. Defaults to 1. */
  readonly rowScale?: number;
  /** Distance in local units between columns. Defaults to 1. */
  readonly columnScale?: number;
  /** Height in local units per sample unit. Defaults to 1. */
  readonly heightScale?: number;
}

type HeightFieldSamples = Omit<Required<HeightFieldData>, "heights"> & { readonly heights: Int16Array };

// PhysX enforces these minimum geometry scales on the cooked grid.
const minHorizontalScale = Math.fround(1e-8);
const minHeightScale = Math.fround(0.0001 / 65535);

/**
 * A terrain surface whose grid starts at the Collider's local center.
 * @remarks The surface requires positive world scale and can be static or owned by a kinematic Rigidbody.
 * Heightfields have no trigger mode.
 */
export class HeightFieldCollider extends Collider {
  @assignmentClone
  private _data: HeightFieldSamples | null = null;

  /**
   * Copies a grid for the next physics synchronization.
   * @param data - The heightfield data, or null to remove the surface.
   * @throws When the grid dimensions, sample values, or scales are invalid.
   */
  setHeightField(data: HeightFieldData | null): void {
    if (data) {
      const { rows, columns, heights, rowScale = 1, columnScale = 1, heightScale = 1 } = data;
      const length = rows * columns;
      if (
        !Number.isSafeInteger(rows) ||
        rows < 2 ||
        !Number.isSafeInteger(columns) ||
        columns < 2 ||
        length !== heights.length
      ) {
        throw new RangeError("HeightFieldCollider requires a grid of at least 2 by 2 with one height per sample.");
      }
      if (
        !Collider._isValidPositiveFloat32(rowScale) ||
        !Collider._isValidPositiveFloat32(columnScale) ||
        !Collider._isValidPositiveFloat32(heightScale)
      ) {
        throw new RangeError("HeightFieldCollider scales must be positive and finite.");
      }

      const samples = new Int16Array(length);
      for (let i = 0; i < length; i++) {
        const height = heights[i];
        if (!Number.isInteger(height) || height < -32768 || height > 32767) {
          throw new RangeError("HeightFieldCollider heights must be signed 16-bit integers.");
        }
        samples[i] = height;
      }
      this._data = { rows, columns, heights: samples, rowScale, columnScale, heightScale };
    } else {
      this._data = null;
    }
    this._geometryDirty = true;
    this._markDirty();
  }

  /** @returns -1 because a heightfield surface has no closest-point query. */
  override getClosestPoint(_point: Vector3, _outClosestPoint: Vector3): number {
    return -1;
  }

  /** @internal */
  override _getVolumeDistance(): number {
    return -1;
  }

  /** @internal */
  override _supportsDynamicBody(): boolean {
    return this._data === null;
  }

  /** @internal */
  override _nativeSupportsDynamicBody(): boolean {
    return false;
  }

  protected override _setIsTrigger(value: boolean): void {
    if (value) throw new Error("HeightFieldCollider does not support triggers.");
  }

  protected override _syncNativeShape(scale: Vector3): IHeightFieldColliderShape | null {
    const previous = this._native as IHeightFieldColliderShape | null;
    const data = this._data;
    if (!data) {
      if (previous) this._replaceNativeShape(null);
      return null;
    }

    const x = Math.fround(scale.x * data.rowScale);
    const y = Math.fround(scale.y * data.heightScale);
    const z = Math.fround(scale.z * data.columnScale);
    if (
      x < minHorizontalScale ||
      y < minHeightScale ||
      z < minHorizontalScale ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      return null;
    }
    scale.set(x, y, z);

    if (previous && !this._geometryDirty) {
      if (this._scaleChanged(scale)) {
        previous.setScale(scale);
        this._nativeScale.copyFrom(scale);
      }
      return previous;
    }

    const shape = Engine._nativePhysics.createHeightFieldColliderShape(
      this._id,
      data.heights,
      data.rows,
      data.columns,
      scale,
      this._getNativeMaterial()
    );
    if (!shape) {
      this._replaceNativeShape(null);
      console.error("HeightFieldCollider: failed to cook the heightfield.");
      return null;
    }
    if (!this._replaceNativeShape(this._initializeNativeShape(shape))) return null;
    this._geometryDirty = false;
    this._nativeScale.copyFrom(scale);
    return shape;
  }

  protected override _onDestroy(): void {
    super._onDestroy();
    this._data = null;
  }
}
