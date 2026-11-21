import { Vector3 } from "@galacean/engine-math";
import { IColliderShape } from "./IColliderShape";

/** A native heightfield backed by cooked terrain samples. */
export interface IHeightFieldColliderShape extends IColliderShape {
  /** Applies the world-space sample spacing without recooking the heightfield. */
  setScale(scale: Vector3): void;
}
