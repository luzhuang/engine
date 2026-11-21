import { Vector3 } from "@galacean/engine";
import type { IHeightFieldColliderShape } from "@galacean/engine-design";
import { PhysXPhysics } from "../PhysXPhysics";
import { PhysXPhysicsMaterial } from "../PhysXPhysicsMaterial";
import { PhysXColliderShape } from "./PhysXColliderShape";

/** @internal */
export class PhysXHeightFieldColliderShape extends PhysXColliderShape implements IHeightFieldColliderShape {
  private _heightField: any;

  constructor(
    physXPhysics: PhysXPhysics,
    id: number,
    heights: Int16Array,
    rows: number,
    columns: number,
    scale: Vector3,
    material: PhysXPhysicsMaterial
  ) {
    super(physXPhysics);
    const { _physX: physX, _pxCooking: cooking, _pxPhysics: physics } = physXPhysics;
    const count = heights.length;
    const pointer = physX._malloc(count * 4);
    if (!pointer) return;

    let heightField: any;
    try {
      // Each PxHeightFieldSample has one signed height and two material/tessellation bytes.
      const samples = new Uint16Array(physX.HEAPU16.buffer, pointer, count * 2);
      for (let i = 0, offset = 0; i < count; i++, offset += 2) {
        samples[offset] = heights[i];
        samples[offset + 1] = 0;
      }
      heightField = cooking.createHeightField(pointer, rows, columns, 0, physics);
    } finally {
      physX._free(pointer);
    }
    if (!heightField) return;

    this._heightField = heightField;
    const geometry = this._createGeometry(scale);
    const shape = this._createShape(geometry, material);
    if (!shape) {
      geometry.delete();
      heightField.release();
      return;
    }
    this._id = id;
    this._pxShape = shape;
    this._pxGeometry = geometry;
    shape.setUUID(id);
  }

  /** {@inheritDoc IHeightFieldColliderShape.setScale} */
  setScale(scale: Vector3): void {
    const previous = this._pxGeometry;
    const geometry = this._createGeometry(scale);
    this._pxShape.setGeometry(geometry);
    this._pxGeometry = geometry;
    previous.delete();
  }

  /** {@inheritDoc IColliderShape.destroy} */
  override destroy(): void {
    super.destroy();
    this._heightField.release();
  }

  private _createGeometry(scale: Vector3): any {
    const physX = this._physXPhysics._physX;
    const flags = new physX.PxMeshGeometryFlags(0);
    const geometry = new physX.PxHeightFieldGeometry(this._heightField, flags, scale.y, scale.x, scale.z);
    flags.delete();
    return geometry;
  }
}
