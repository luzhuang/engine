import { Quaternion, Vector3 } from "@galacean/engine-math";
import { ICharacterController } from "./ICharacterController";
import { ICollider } from "./ICollider";
import type { IContactModification } from "./IContactModification";
import { IPhysicsEvents } from "./IPhysicsEvents";

/** Settings applied when a physics scene is created. */
export interface PhysicsSceneOptions {
  /** Iterative solver. Defaults to projected Gauss–Seidel. */
  solver?: "pgs" | "tgs";
  /** Additional kinematic collider pairs to report. Defaults to "default". Trigger pairs are unaffected. */
  contactPairs?: "default" | "kinematic-kinematic" | "static-kinematic" | "all";
  /** Relative normal speeds below this threshold do not bounce, in world units per second. Defaults to 2. */
  bounceThreshold?: number;
}

/** Native query inputs borrowed for the duration of a query. */
export interface IPhysicsQueryFilter {
  layerMask: number;
  includeTriggers: boolean;
  hitBackfaces: boolean;
  excludedShapeIds: number[];
}

/** Receives one cast hit. Geometry indices are -1 for shapes without an indexed face. */
export type IPhysicsQueryHit = (
  shapeId: number,
  distance: number,
  point: Vector3,
  normal: Vector3,
  triangleIndex: number
) => void;

/**
 * A native simulation scene with scene queries and buffered events.
 * @remarks Hit callbacks receive scratch vectors. Copy them before retaining the values or starting another query.
 */
export interface IPhysicsScene {
  /** Whether character controllers recover from overlaps with static colliders during movement. */
  characterControllerOverlapRecovery: boolean;

  /** Whether character controllers use precise sweeps during movement. */
  characterControllerPreciseSweeps: boolean;

  /** Whether upward character-controller movement can slide along a sloped ceiling. */
  characterControllerSlideOnCeiling: boolean;

  /**
   * Replaces pending overlap corrections for character controllers in this scene.
   * @param elapsedTime - Seconds since the last computation. Zero clears pending corrections.
   */
  computeCharacterControllerInteractions(elapsedTime: number): void;

  /**
   * Set gravity.
   * @param gravity - Physics gravity
   */
  setGravity(gravity: Vector3): void;

  /**
   * Add a native actor and its attached shapes to the scene.
   * @param collider - The native static or dynamic actor
   */
  addCollider(collider: ICollider): void;

  /**
   * Remove a native actor and its attached shapes from the scene.
   * @param collider - The native static or dynamic actor
   */
  removeCollider(collider: ICollider): void;

  /**
   * Add a character controller to the scene.
   * @param characterController - The controller configured for this scene
   */
  addCharacterController(characterController: ICharacterController): void;

  /**
   * Remove a character controller from the scene.
   * @param characterController - The controller to remove
   */
  removeCharacterController(characterController: ICharacterController): void;

  /**
   * Advance the simulation by one step.
   * @param elapsedTime - The step duration in seconds
   */
  update(elapsedTime: number): void;

  /**
   * Enable contact event delivery.
   * @param enabled - Whether collision contact events should be delivered for dispatch.
   */
  setContactEventEnabled(enabled: boolean): void;

  /** Replaces the synchronous solver hook. Null disables contact modification. */
  setContactModifier(modifier: ((batch: IContactModification) => void) | null): void;

  /** Sets native visualization flags and size. Returns false for invalid input or while stepping. */
  setDebugVisualization(flags: number, scale: number): boolean;

  /** Returns borrowed interleaved world-space line vertices from the last step, or null for an empty sample. */
  getDebugLines(): Uint8Array | null;

  /**
   * Collect buffered physics events for the completed step.
   * @remarks Call once per step, after reading the new poses from physics.
   * @returns Borrowed event records for immediate dispatch
   */
  updateEvents(): IPhysicsEvents;

  /**
   * Get whether two collision layers can collide with each other.
   * @param layer1 - The first collision layer
   * @param layer2 - The second collision layer
   * @returns Whether the layers should collide
   */
  getColliderLayerCollision(layer1: number, layer2: number): boolean;

  /**
   * Set whether two collision layers can collide with each other.
   * @param layer1 - The first collision layer
   * @param layer2 - The second collision layer
   * @param isCollide - Whether the layers should collide
   */
  setColliderLayerCollision(layer1: number, layer2: number, isCollide: boolean): void;

  /** Overrides one shape pair's participation in simulation. */
  setPairIgnored(firstId: number, secondId: number, ignored: boolean): void;

  /** Removes all collision ignores for a shape leaving the scene. */
  removeIgnoredPairs(shapeId: number): void;

  /**
   * Casts a ray and reports the nearest hit with a positive distance.
   * @param origin - The world-space ray origin
   * @param direction - The normalized world-space ray direction
   * @param distance - The maximum query distance
   * @param filter - The collision layers, trigger policy, and shape exclusions
   * @param outHitResult - The optional hit callback receiving the hit point and normal
   * @returns Whether an enabled query shape was hit
   */
  raycast(
    origin: Vector3,
    direction: Vector3,
    distance: number,
    filter: IPhysicsQueryFilter,
    outHitResult?: IPhysicsQueryHit
  ): boolean;

  /**
   * Casts a ray and reports all hits with a positive distance, in unspecified order.
   * @param origin - The world-space ray origin
   * @param direction - The normalized world-space ray direction
   * @param distance - The maximum query distance
   * @param filter - The collision layers, trigger policy, and shape exclusions
   * @param onHit - The callback invoked for each hit
   */
  raycastAll(
    origin: Vector3,
    direction: Vector3,
    distance: number,
    filter: IPhysicsQueryFilter,
    onHit: IPhysicsQueryHit
  ): void;

  /**
   * Sweeps a box and reports the nearest hit with a positive distance.
   * @param center - The world-space box center
   * @param orientation - The world-space box rotation
   * @param halfExtents - The half size along each box axis
   * @param direction - The normalized world-space sweep direction
   * @param distance - The maximum sweep distance
   * @param filter - The collision layers, trigger policy, and shape exclusions
   * @param outHitResult - The optional hit callback
   * @param all - Whether to report every hit instead of the nearest
   * @returns Whether an enabled query shape was hit
   */
  boxCast(
    center: Vector3,
    orientation: Quaternion,
    halfExtents: Vector3,
    direction: Vector3,
    distance: number,
    filter: IPhysicsQueryFilter,
    outHitResult?: IPhysicsQueryHit,
    all?: boolean
  ): boolean;

  /**
   * Sweeps a sphere and reports the nearest hit with a positive distance.
   * @param center - The world-space sphere center
   * @param radius - The sphere radius
   * @param direction - The normalized world-space sweep direction
   * @param distance - The maximum sweep distance
   * @param filter - The collision layers, trigger policy, and shape exclusions
   * @param outHitResult - The optional hit callback
   * @param all - Whether to report every hit instead of the nearest
   * @returns Whether an enabled query shape was hit
   */
  sphereCast(
    center: Vector3,
    radius: number,
    direction: Vector3,
    distance: number,
    filter: IPhysicsQueryFilter,
    outHitResult?: IPhysicsQueryHit,
    all?: boolean
  ): boolean;

  /**
   * Sweeps a capsule and reports the nearest hit with a positive distance.
   * @param center - The world-space capsule center
   * @param radius - The capsule radius
   * @param height - The height between the capsule's hemisphere centers
   * @param orientation - World-space rotation of the capsule, whose local long axis is Y
   * @param direction - The normalized world-space sweep direction
   * @param distance - The maximum sweep distance
   * @param filter - The collision layers, trigger policy, and shape exclusions
   * @param outHitResult - The optional hit callback
   * @param all - Whether to report every hit instead of the nearest
   * @returns Whether an enabled query shape was hit
   */
  capsuleCast(
    center: Vector3,
    radius: number,
    height: number,
    orientation: Quaternion,
    direction: Vector3,
    distance: number,
    filter: IPhysicsQueryFilter,
    outHitResult?: IPhysicsQueryHit,
    all?: boolean
  ): boolean;

  /** Tests whether a box overlaps a shape that matches the query filter. */
  checkBox(center: Vector3, orientation: Quaternion, halfExtents: Vector3, filter: IPhysicsQueryFilter): boolean;

  /** Tests whether a sphere overlaps a shape that matches the query filter. */
  checkSphere(center: Vector3, radius: number, filter: IPhysicsQueryFilter): boolean;

  /**
   * Tests whether a capsule overlaps a shape that matches the query filter.
   * @param height - The height between the capsule's hemisphere centers.
   * @param orientation - World-space rotation of the capsule, whose local long axis is Y.
   */
  checkCapsule(
    center: Vector3,
    radius: number,
    height: number,
    orientation: Quaternion,
    filter: IPhysicsQueryFilter
  ): boolean;

  /**
   * Finds query shapes overlapping a box, in unspecified order.
   * @param center - The world-space box center
   * @param orientation - The world-space box rotation
   * @param halfExtents - The half size along each box axis
   * @param filter - The collision layers, trigger policy, and shape exclusions
   * @returns Borrowed shape IDs; consume them before the next physics operation
   */
  overlapBoxAll(
    center: Vector3,
    orientation: Quaternion,
    halfExtents: Vector3,
    filter: IPhysicsQueryFilter
  ): ArrayLike<number>;

  /**
   * Finds query shapes overlapping a sphere, in unspecified order.
   * @param center - The world-space sphere center
   * @param radius - The sphere radius
   * @param filter - The collision layers, trigger policy, and shape exclusions
   * @returns Borrowed shape IDs; consume them before the next physics operation
   */
  overlapSphereAll(center: Vector3, radius: number, filter: IPhysicsQueryFilter): ArrayLike<number>;

  /**
   * Finds query shapes overlapping a capsule, in unspecified order.
   * @param center - The world-space capsule center
   * @param radius - The capsule radius
   * @param height - The height between the capsule's hemisphere centers
   * @param orientation - World-space rotation of the capsule, whose local long axis is Y
   * @param filter - The collision layers, trigger policy, and shape exclusions
   * @returns Borrowed shape IDs; consume them before the next physics operation
   */
  overlapCapsuleAll(
    center: Vector3,
    radius: number,
    height: number,
    orientation: Quaternion,
    filter: IPhysicsQueryFilter
  ): ArrayLike<number>;

  /**
   * Trim internal object pools after a GC cycle.
   */
  gc(): void;

  /**
   * Destroy the physics scene.
   */
  destroy(): void;
}
