import { Quaternion, Vector3 } from "@galacean/engine-math";
import { ICollider } from "../ICollider";

/**
 * Common configuration for native joints.
 */
export interface IJoint {
  /**
   * Connect the joint to a second actor, or to the world if the value is absent.
   */
  setConnectedCollider(value: ICollider | null | undefined): void;

  /**
   * Set the anchor in the connected actor’s frame, or in world space for a world connection.
   */
  setConnectedAnchor(value: Vector3): void;

  /**
   * Set the anchor in the owning actor’s frame.
   */
  setAnchor(value: Vector3): void;

  /**
   * Set the connected actor’s inverse mass and inverse inertia multiplier for this constraint.
   */
  setConnectedMassScale(value: number): void;

  /**
   * Set the joint frame rotation relative to the connected actor, or in world space for a world connection.
   */
  setRotation(value: Quaternion): void;

  /**
   * Set the owning actor’s inverse mass and inverse inertia multiplier for this constraint.
   */
  setMassScale(value: number): void;

  /**
   * Set whether the connected actors can collide.
   */
  setEnableCollision(value: boolean): void;

  /**
   * Set whether the solver preprocesses the constraint.
   */
  setEnablePreprocessing(value: boolean): void;

  /**
   * The maximum force the joint can apply before breaking.
   */
  setBreakForce(value: number): void;

  /**
   * The maximum torque the joint can apply before breaking.
   */
  setBreakTorque(value: number): void;

  /** Assigns the scene-local identifier reported on constraint break. */
  setBreakEventId(id: number): void;

  /** Whether the native constraint has broken. */
  isBroken(): boolean;

  /** Writes the last constraint force and torque into the supplied vectors. */
  getReactionForce(force: Vector3, torque: Vector3): void;

  /**
   * Destroy the joint.
   */
  destroy(): void;
}
