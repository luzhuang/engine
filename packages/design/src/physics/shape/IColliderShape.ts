import { Quaternion, Vector3, Vector4 } from "@galacean/engine-math";
import { IPhysicsMaterial } from "../IPhysicsMaterial";

/**
 * A native shape that can be attached to a rigid actor.
 * @remarks Set the shape's local pose before attaching it. New shapes participate in simulation and scene queries by default.
 */
export interface IColliderShape {
  /**
   * Set the pose of the shape relative to its actor.
   * @param position - The actor-relative position, with entity scale applied
   * @param rotation - The actor-relative rotation
   */
  setLocalPose(position: Vector3, rotation: Quaternion): void;

  /**
   * Apply the contact and rest offsets together.
   * @param contactOffset - A positive contact distance in world units
   * @param restOffset - A signed rest distance in world units, strictly below the contact offset in Float32
   */
  setContactOffsets(contactOffset: number, restOffset: number): void;

  /**
   * Set physics material on shape.
   * @param material - The physics material
   */
  setMaterial(material: IPhysicsMaterial): void;

  /**
   * Change the collision layer in place, preserving active pairs still allowed by the collision matrix.
   * @param layer - The collision layer index, from 0 to 31
   */
  setCollisionLayer(layer: number): void;

  /** Sets explicit collision layer inclusions and exclusions. Exclusions have precedence. */
  setLayerOverrides(include: number, exclude: number): void;

  /**
   * Set trigger or not.
   * @param value - True for TriggerShape, false for SimulationShape
   */
  setIsTrigger(value: boolean): void;

  /**
   * Enables this shape for raycasts, shape casts, and overlap queries without changing collision response.
   * @param value - Whether the shape participates in scene queries
   */
  setIsSceneQuery(value: boolean): void;

  /** Sets whether this shape requests contact events. Either shape in a pair can request reporting. */
  setContactEventsEnabled(value: boolean): void;

  /** Allows a scene contact modifier to edit solid contacts involving this collider. */
  setContactModificationEnabled(value: boolean): void;

  /** Writes the exact axis-aligned bounds of the world-space shape. */
  getWorldBounds(outMin: Vector3, outMax: Vector3): void;

  /** Returns the penetration depth and writes the direction to separate this shape from the other. */
  computePenetration(other: IColliderShape, outDirection: Vector3): number;

  /**
   * Query the closest point on the shape.
   * @param point - The point in world space
   * @returns A borrowed vector whose `w` is the squared distance, zero for an interior or surface point, or -1 when unavailable.
   * For a positive distance, `x`, `y`, and `z` give the closest point in world space. Copy the result before retaining it.
   */
  pointDistance(point: Vector3): Vector4;
  /**
   * Decrements the reference count of a shape and releases it if the new reference count is zero.
   */
  destroy(): void;
}
