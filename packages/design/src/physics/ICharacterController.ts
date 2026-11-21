import { Vector3 } from "@galacean/engine-math";
import { IPhysicsMaterial } from "./IPhysicsMaterial";

/** One contact reported during a controller sweep. */
export interface IControllerMoveHit {
  colliderId: number;
  point: Vector3;
  normal: Vector3;
  moveDirection: Vector3;
  moveLength: number;
}

/** Reusable storage for the contacts produced by one move. */
export interface IControllerMoveHits {
  readonly hits: IControllerMoveHit[];
  count: number;
}

/**
 * Native character controller with its own geometry.
 * @remarks The caller applies entity scale to geometry dimensions and the center offset before passing them in.
 */
export interface ICharacterController {
  /**
   * Use a capsule along the up direction.
   * @param radius - The capsule radius
   * @param height - The height of the cylindrical part, excluding both caps
   * @param stepOffset - The requested step height in world units
   */
  setCapsule(radius: number, height: number, stepOffset: number): void;

  /**
   * Use a box aligned to the controller’s up direction.
   * @param halfExtents - The half side extent, half height along up, and half forward extent in x, y, and z
   * @param stepOffset - The requested step height in world units
   */
  setBox(halfExtents: Vector3, stepOffset: number): void;

  /**
   * Set the contact offset.
   * @param offset - A positive contact offset in world units
   */
  setContactOffset(offset: number): void;

  /**
   * Set the physics material.
   * @param material - The physics material
   */
  setMaterial(material: IPhysicsMaterial): void;

  /**
   * Set the collision layer.
   * @param layer - The collision layer index, from 0 to 31
   */
  setCollisionLayer(layer: number): void;

  /** Sets explicit collision layer inclusions and exclusions. Exclusions have precedence. */
  setLayerOverrides(include: number, exclude: number): void;

  /**
   * Control whether scene queries can hit the controller.
   * @param value - Whether the controller participates in scene queries
   */
  setIsSceneQuery(value: boolean): void;

  /** Sets whether this controller's shape requests contact events. The other shape can still request reporting. */
  setContactEventsEnabled(value: boolean): void;

  /** Allows a scene contact modifier to edit solid contacts involving this collider. */
  setContactModificationEnabled(value: boolean): void;

  /** Sets whether other bodies can collide with the controller and triggers can detect it. */
  setDetectCollisions(value: boolean): void;

  /**
   * Moves the character using a "collide-and-slide" algorithm.
   * @param disp - World-space displacement
   * @param minDist - The remaining distance threshold for stopping the move
   * @param elapsedTime - Time in seconds since the last call
   * @param outHits - Optional storage for contacts from this move
   * @param layerMask - Collision layers to test in this move
   * @param excludedShapeIds - IDs of shapes to ignore in this move
   * @returns The collision flags, or zero if the native controller is unavailable
   */
  move(
    disp: Vector3,
    minDist: number,
    elapsedTime: number,
    outHits?: IControllerMoveHits,
    layerMask?: number,
    excludedShapeIds?: readonly number[]
  ): number;

  /**
   * Change the controller's height while preserving its foot.
   * @param height - The box half-height or the capsule's cylindrical height in world units
   * @param stepOffset - The requested step height
   * @returns Whether the controller was resized
   */
  resize(height: number, stepOffset: number): boolean;

  /**
   * Writes the foot position in world space, including the contact offset.
   * @param out - Receives the foot position if the controller is available
   * @returns Whether the output was written
   */
  getFootPosition(out: Vector3): boolean;

  /**
   * Teleport the controller's foot to a world-space position.
   * @param position - The position of the foot including the contact offset
   * @returns Whether the position was applied
   */
  setFootPosition(position: Vector3): boolean;

  /**
   * Place the controller's geometry at the sum of the world position and the center offset.
   * @param position - The world position before applying the offset
   * @param center - The world-space geometry offset
   */
  setWorldPosition(position: Vector3, center: Vector3): void;

  /**
   * Write the world position with the center offset subtracted.
   * @param position - Receives the world position
   */
  getWorldPosition(position: Vector3): void;

  /**
   * Set the non-walkable mode.
   * @param flag - The non-walkable mode
   */
  setNonWalkableMode(flag: number): void;

  /**
   * Set how capsule geometry climbs over steps.
   * @param mode - The capsule climbing mode
   */
  setClimbingMode(mode: number): void;

  /**
   * Set the up direction.
   * @param up - The normalized up direction
   */
  setUpDirection(up: Vector3): void;

  /**
   * Set the slope limit.
   * @param slopeLimit - The slope limit in degrees
   */
  setSlopeLimit(slopeLimit: number): void;

  /**
   * Sets wall height and downward search distance for non-walkable triangles.
   * @param wallHeight - Wall height in world units. Zero disables walls.
   * @param maxJumpHeight - Extra downward search distance in world units when walls are enabled.
   */
  setSlopeWalls(wallHeight: number, maxJumpHeight: number): void;

  /**
   * Release the controller.
   */
  destroy(): void;
}
