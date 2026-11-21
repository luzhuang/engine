import {
  IDynamicCollider,
  IPhysicsEvents,
  IPhysicsQueryFilter,
  IPhysicsQueryHit,
  IPhysicsScene,
  PhysicsEventState,
  PhysicsSceneOptions
} from "@galacean/engine-design";
import { MathUtil, Ray, Vector3, Quaternion } from "@galacean/engine-math";
import { Engine } from "../Engine";
import type { Entity } from "../Entity";
import { Layer } from "../Layer";
import { Scene } from "../Scene";
import { Script } from "../Script";
import { DisorderedArray } from "../utils/DisorderedArray";
import { Collider } from "./Collider";
import { Collision } from "./Collision";
import { HitResult } from "./HitResult";
import type { Joint } from "./joint/Joint";
import { PhysicsMaterial } from "./PhysicsMaterial";
import { Rigidbody } from "./Rigidbody";

/** Filters one scene query. */
export interface PhysicsQueryFilter {
  /** Collision layers to include. Defaults to all layers. */
  layerMask?: Layer;
  /** Whether to include trigger shapes. Defaults to true. */
  includeTriggers?: boolean;
  /** Whether casts can hit the back faces of mesh triangles. Defaults to false. */
  hitBackfaces?: boolean;
  /** Colliders to exclude before selecting hits. */
  exclude?: ReadonlyArray<Collider>;
}

/**
 * Simulates colliders, rigidbodies, and constraints in a scene.
 * @remarks Pending Rigidbody poses and Collider changes are synchronized before simulation and scene queries.
 * Casts normalize world-space directions internally and only report hits at positive distances.
 * An invalid direction or a non-positive distance is a miss. Single-hit casts clear a supplied {@link HitResult}
 * on a miss.
 */
export class PhysicsScene {
  private static _identityQuaternion = new Quaternion(0, 0, 0, 1);
  private static _tempDirection = new Vector3();
  private static readonly _queryFilter: IPhysicsQueryFilter = {
    layerMask: Layer.Everything,
    includeTriggers: true,
    hitBackfaces: false,
    excludedShapeIds: []
  };
  private static _raycastHitPool: HitResult[] = [];
  private static _raycastSeenHits = new Set<HitResult>();
  private static readonly _bodyPoses: [Vector3, Quaternion][] = [];
  private static readonly _collisionMethods = ["onCollisionEnter", "onCollisionStay", "onCollisionExit"] as const;
  private static readonly _triggerMethods = ["onTriggerEnter", "onTriggerStay", "onTriggerExit"] as const;
  private static _bodyIndexSetter = (body: Rigidbody, index: number) => {
    body._index = index;
  };
  private static _scriptIndexSetter = (element: Script, index: number) => {
    element._entityScriptsIndex = index;
  };

  private _scene: Scene;
  private _restTime: number = 0;
  private _fixedTimeStep: number = 1 / 60;
  private _interpolationFraction = 0;
  private _maxSubSteps = 8;
  private _stepping = false;
  private _autoSimulation = true;

  /**
   * Whether the Engine advances this scene's physics each frame. Defaults to true.
   */
  get autoSimulation(): boolean {
    return this._autoSimulation;
  }

  set autoSimulation(value: boolean) {
    if (this._autoSimulation === value) return;
    this._autoSimulation = value;
    if (!value && this._interpolatedBodies) {
      for (const body of this._interpolatedBodies) body._resetInterpolation();
    }
  }

  /**
   * The blend weight of the current fixed pose when rendering interpolated bodies.
   * @remarks Zero selects the previous pose. The blend weight updates once per Engine update.
   * With manual simulation, this returns one.
   */
  get interpolationFraction(): number {
    return this.autoSimulation ? this._interpolationFraction : 1;
  }

  private _bodies = new DisorderedArray<Rigidbody>();
  private _interpolatedBodies?: Set<Rigidbody>;
  private _bodyOrderDirty = false;
  private _dirtyBodies: Rigidbody[] = [];
  private _dirtyColliders: Collider[] = [];
  private _massDirtyBodies: Rigidbody[] = [];
  private _collision: Collision;
  private readonly _joints = new Map<number, Joint>();
  private _nextJointId = 0;

  private _defaultMaterial: PhysicsMaterial | null = null;
  private _gravity: Vector3 = new Vector3(0, -9.81, 0);
  /** @internal */
  _nativePhysicsScene: IPhysicsScene;

  private _contactEventConsumerCount = 0;

  /**
   * The gravity of physics scene.
   */
  get gravity(): Vector3 {
    return this._gravity;
  }

  set gravity(value: Vector3) {
    const gravity = this._gravity;
    if (gravity !== value) {
      gravity.copyFrom(value);
    }
  }

  /**
   * The material used by colliders without an assigned material. Null selects the built-in material.
   * @defaultValue null
   * @remarks The scene retains the material until it is replaced or the scene is destroyed.
   * @throws When the material has been destroyed, belongs to another Engine, or the scene has been destroyed.
   */
  get defaultMaterial(): PhysicsMaterial | null {
    return this._defaultMaterial;
  }

  set defaultMaterial(value: PhysicsMaterial | null) {
    const previous = this._defaultMaterial;
    if (previous === value) return;

    const scene = this._scene;
    if (value !== null) {
      if (!(value instanceof PhysicsMaterial))
        throw new TypeError("Default physics material must be a PhysicsMaterial.");
      if (value.engine !== scene.engine) throw new Error("The physics material belongs to another engine.");
      if (value.destroyed || scene.destroyed) {
        throw new Error("Cannot assign a default material when the physics material or scene has been destroyed.");
      }
      value._addReferCount(1);
    }
    this._defaultMaterial = value;
    previous?._addReferCount(-1);

    const roots = scene.rootEntities;
    const colliders: Collider[] = [];
    for (let i = 0, n = roots.length; i < n; i++) {
      roots[i].getComponentsIncludeChildren(Collider, colliders);
      for (let j = 0, n = colliders.length; j < n; j++) {
        const collider = colliders[j];
        if (collider._isRegisteredIn(scene)) collider._syncDefaultMaterial();
      }
    }
  }

  /**
   * Whether character controllers recover from overlaps with static colliders during movement.
   * @defaultValue true
   */
  get characterControllerOverlapRecovery(): boolean {
    return this._nativePhysicsScene.characterControllerOverlapRecovery;
  }

  set characterControllerOverlapRecovery(value: boolean) {
    this._nativePhysicsScene.characterControllerOverlapRecovery = value;
  }

  /**
   * Whether character controllers use precise sweeps during movement.
   * @defaultValue true
   */
  get characterControllerPreciseSweeps(): boolean {
    return this._nativePhysicsScene.characterControllerPreciseSweeps;
  }

  set characterControllerPreciseSweeps(value: boolean) {
    this._nativePhysicsScene.characterControllerPreciseSweeps = value;
  }

  /**
   * Whether upward character-controller movement can slide along a sloped ceiling.
   * @defaultValue true
   */
  get characterControllerSlideOnCeiling(): boolean {
    return this._nativePhysicsScene.characterControllerSlideOnCeiling;
  }

  set characterControllerSlideOnCeiling(value: boolean) {
    this._nativePhysicsScene.characterControllerSlideOnCeiling = value;
  }

  /**
   * Computes separation for overlapping character controllers that can collide with each other.
   * @remarks Call once before moving the controllers. Each controller applies the result on its next
   * `move()`. Calling again replaces any pending separation using the current poses and collision rules.
   * Move-specific filters apply to the sweep.
   * @param elapsedTime - Seconds since the last computation. Defaults to the fixed timestep. Zero clears pending separation.
   * @throws When elapsedTime is negative or non-finite in Float32.
   */
  computeCharacterControllerInteractions(elapsedTime = this._fixedTimeStep): void {
    if (!(typeof elapsedTime === "number" && elapsedTime >= 0 && Number.isFinite(Math.fround(elapsedTime)))) {
      throw new RangeError("Character controller interaction time must be nonnegative and finite.");
    }
    this._syncColliders();
    this._nativePhysicsScene?.computeCharacterControllerInteractions(elapsedTime);
  }

  /**
   * The fixed time step in seconds at which physics are performed.
   * @throws When the value is not a positive finite Float32.
   */
  get fixedTimeStep(): number {
    return this._fixedTimeStep;
  }

  set fixedTimeStep(value: number) {
    if (!Collider._isValidPositiveFloat32(value)) {
      throw new RangeError("PhysicsScene.fixedTimeStep must be positive and finite.");
    }
    this._fixedTimeStep = value;
  }

  /**
   * Maximum number of fixed physics steps per Engine update. Whole steps above this limit are dropped.
   * @defaultValue 8
   */
  get maxSubSteps(): number {
    return this._maxSubSteps;
  }

  set maxSubSteps(value: number) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("PhysicsScene.maxSubSteps must be a positive integer.");
    }
    this._maxSubSteps = value;
  }

  constructor(scene: Scene, options?: PhysicsSceneOptions) {
    this._scene = scene;

    this._setGravity = this._setGravity.bind(this);
    //@ts-ignore
    this._gravity._onValueChanged = this._setGravity;

    const engine = scene.engine;
    if (engine._physicsInitialized) {
      this._nativePhysicsScene = Engine._nativePhysics.createPhysicsScene(options);
      this._nativePhysicsScene.setContactEventEnabled(false);
    }
  }

  /**
   * Get whether two colliders can collide with each other.
   * @param layer1 - The first collision layer
   * @param layer2 - The second collision layer
   * @returns Whether the colliders should collide
   */
  getColliderLayerCollision(layer1: Layer, layer2: Layer): boolean {
    return this._nativePhysicsScene.getColliderLayerCollision(
      Collider._getLayerIndex(layer1),
      Collider._getLayerIndex(layer2)
    );
  }

  /**
   * Set whether two colliders can collide with each other.
   * @param layer1 - The first collision layer
   * @param layer2 - The second collision layer
   * @param isCollide - Whether the colliders should collide
   */
  setColliderLayerCollision(layer1: Layer, layer2: Layer, isCollide: boolean): void {
    this._nativePhysicsScene.setColliderLayerCollision(
      Collider._getLayerIndex(layer1),
      Collider._getLayerIndex(layer2),
      isCollide
    );
  }

  /**
   * Disables or restores contact and trigger reporting for one collider pair in this scene.
   * @remarks The override ends when either collider leaves the active scene. Scene queries are unaffected.
   * @param ignored - Whether to ignore this pair. Set to false to restore the usual layer rules.
   */
  setColliderPairIgnored(first: Collider, second: Collider, ignored = true): void {
    const scene = this._scene;
    if (first === second || !first._isRegisteredIn(scene) || !second._isRegisteredIn(scene)) {
      throw new Error("Collision pair requires two distinct active Colliders in this PhysicsScene.");
    }
    this._nativePhysicsScene.setPairIgnored(first._id, second._id, ignored);
  }

  /**
   * Tests whether a world-space ray hits a collider.
   */
  raycast(ray: Ray): boolean;

  /**
   * Tests whether a world-space ray hits a collider.
   * @param outHitResult - Receives the closest hit.
   */
  raycast(ray: Ray, outHitResult: HitResult): boolean;

  /**
   * Tests whether a world-space ray hits a collider.
   * @param distance - Maximum distance in world units.
   */
  raycast(ray: Ray, distance: number): boolean;

  /**
   * Tests whether a world-space ray hits a collider.
   * @param distance - Maximum distance in world units.
   * @param outHitResult - Receives the closest hit.
   */
  raycast(ray: Ray, distance: number, outHitResult: HitResult): boolean;

  /**
   * Tests whether a world-space ray hits a collider.
   * @param distance - Maximum distance in world units.
   * @param layerMask - Collision layers or filters to apply.
   */
  raycast(ray: Ray, distance: number, layerMask: Layer | PhysicsQueryFilter): boolean;

  /**
   * Tests whether a world-space ray hits a collider.
   * @param distance - Maximum distance in world units.
   * @param layerMask - Collision layers or filters to apply.
   * @param outHitResult - Receives the closest hit.
   */
  raycast(ray: Ray, distance: number, layerMask: Layer | PhysicsQueryFilter, outHitResult: HitResult): boolean;

  raycast(
    ray: Ray,
    distanceOrResult?: number | HitResult,
    layerMaskOrResult?: Layer | PhysicsQueryFilter | HitResult,
    outHitResult?: HitResult
  ): boolean {
    let hitResult: HitResult | undefined;

    let distance = Number.MAX_VALUE;
    if (typeof distanceOrResult === "number") {
      distance = distanceOrResult;
    } else if (distanceOrResult != undefined) {
      hitResult = distanceOrResult;
    }

    let layerMask: Layer | PhysicsQueryFilter = Layer.Everything;
    if (layerMaskOrResult instanceof HitResult) {
      hitResult = layerMaskOrResult;
    } else if (layerMaskOrResult !== undefined) {
      layerMask = layerMaskOrResult;
    }

    if (outHitResult) {
      hitResult = outHitResult;
    }

    return this._raycast(ray.origin, ray.direction, distance, layerMask, hitResult);
  }

  /**
   * Tests the world-space line segment from start to end against the scene.
   * @param outHitResult - Receives the closest hit or is cleared on a miss.
   */
  linecast(
    start: Vector3,
    end: Vector3,
    filter: Layer | PhysicsQueryFilter = Layer.Everything,
    outHitResult?: HitResult
  ): boolean {
    const direction = PhysicsScene._tempDirection;
    Vector3.subtract(end, start, direction);
    return this._raycast(start, direction, direction.length(), filter, outHitResult);
  }

  /**
   * Writes ray hits in unspecified order and returns whether any hit was found.
   * @param outHitResults - Reusable array, resized to the hit count. Discard references to recycled entries.
   */
  raycastAll(ray: Ray, outHitResults: HitResult[]): boolean;

  /**
   * Writes ray hits in unspecified order and returns whether any hit was found.
   * @param distance - Maximum distance in world units.
   * @param outHitResults - Reusable array, resized to the hit count. Discard references to recycled entries.
   */
  raycastAll(ray: Ray, distance: number, outHitResults: HitResult[]): boolean;

  /**
   * Tests a world-space ray and optionally writes all hits in unspecified order.
   * @param ray - World-space ray. The direction is normalized internally.
   * @param distance - Maximum distance in world units. Defaults to `Number.MAX_VALUE`.
   * @param layerMask - Collision layers or filters to apply. Defaults to `Layer.Everything`.
   * @param outHitResults - Reusable output array, resized to the hit count. Omit to test for a hit only.
   * @returns Whether any hit was found.
   * @remarks Reuse the array as-is. This call overwrites existing entries and may recycle entries it trims,
   * including caller-supplied objects. Copy hit values to retain them and discard references to recycled entries.
   * Keep result objects in a single output array. Duplicate entries show the last hit written to the shared object.
   * Only positive-distance hits are reported. Invalid directions and non-positive distances empty the output.
   */
  raycastAll(ray: Ray, distance?: number, layerMask?: Layer | PhysicsQueryFilter, outHitResults?: HitResult[]): boolean;

  raycastAll(
    ray: Ray,
    distance: number | HitResult[] = Number.MAX_VALUE,
    layerMask: Layer | PhysicsQueryFilter | HitResult[] = Layer.Everything,
    outHitResults?: HitResult[]
  ): boolean {
    if (Array.isArray(layerMask)) {
      outHitResults ||= layerMask;
      layerMask = Layer.Everything;
    }
    if (typeof distance !== "number") {
      outHitResults ||= distance;
      distance = Number.MAX_VALUE;
    }
    if (!outHitResults) {
      return this.raycast(ray, distance, layerMask);
    }

    let hitCount = 0;
    const normalizedDirection = distance > 0 ? this._syncCastDirection(ray.direction) : null;
    if (normalizedDirection) {
      this._nativePhysicsScene.raycastAll(
        ray.origin,
        normalizedDirection,
        distance,
        PhysicsScene._prepareQueryFilter(layerMask),
        (id, hitDistance, position, normal, triangleIndex) => {
          this._setHitResult(
            PhysicsScene._castHit(outHitResults, hitCount++),
            id,
            hitDistance,
            position,
            normal,
            triangleIndex
          );
        }
      );
    }
    return this._trimCastHits(outHitResults, hitCount);
  }

  /**
   * Tests whether sweeping a box hits a collider.
   * @param halfExtents - Half the box size along each of its axes, in world units.
   */
  boxCast(center: Vector3, halfExtents: Vector3, direction: Vector3): boolean;

  /**
   * Tests whether sweeping a box hits a collider.
   * @param halfExtents - Half the box size along each of its axes, in world units.
   * @param outHitResult - Receives the closest hit.
   */
  boxCast(center: Vector3, halfExtents: Vector3, direction: Vector3, outHitResult: HitResult): boolean;

  /**
   * Tests whether sweeping a box hits a collider.
   * @param halfExtents - Half the box size along each of its axes, in world units.
   * @param distance - Maximum distance in world units.
   */
  boxCast(center: Vector3, halfExtents: Vector3, direction: Vector3, distance: number): boolean;

  /**
   * Tests whether sweeping a box hits a collider.
   * @param halfExtents - Half the box size along each of its axes, in world units.
   * @param distance - Maximum distance in world units.
   * @param outHitResult - Receives the closest hit.
   */
  boxCast(
    center: Vector3,
    halfExtents: Vector3,
    direction: Vector3,
    distance: number,
    outHitResult: HitResult
  ): boolean;

  /**
   * Tests whether sweeping a box hits a collider.
   * @param center - Initial center in world space.
   * @param halfExtents - Half the box size along each of its axes, in world units.
   * @param direction - Sweep direction in world space.
   * @param orientation - Rotation of the box in world space.
   * @param distance - Maximum distance in world units.
   * @param layerMask - Collision layers or filters to apply.
   * @param outHitResult - Receives the closest hit.
   */
  boxCast(
    center: Vector3,
    halfExtents: Vector3,
    direction: Vector3,
    orientation: Quaternion,
    distance: number,
    layerMask: Layer | PhysicsQueryFilter,
    outHitResult?: HitResult
  ): boolean;

  /**
   * Sweeps the shape using its default orientation and filters results by collision layer.
   */
  boxCast(
    center: Vector3,
    halfExtents: Vector3,
    direction: Vector3,
    distance: number,
    layerMask: Layer | PhysicsQueryFilter,
    outHitResult?: HitResult
  ): boolean;

  boxCast(
    center: Vector3,
    halfExtents: Vector3,
    direction: Vector3,
    orientationOrDistanceOrResult?: Quaternion | number | HitResult,
    distanceOrResult?: number | PhysicsQueryFilter | HitResult,
    layerMaskOrResult?: Layer | PhysicsQueryFilter | HitResult,
    outHitResult?: HitResult
  ): boolean {
    let hitResult: HitResult | undefined;
    let orientation = PhysicsScene._identityQuaternion;
    let distance = Number.MAX_VALUE;
    let layerMask: Layer | PhysicsQueryFilter = Layer.Everything;

    if (typeof orientationOrDistanceOrResult === "number") {
      distance = orientationOrDistanceOrResult;
      if (distanceOrResult instanceof HitResult) {
        hitResult = distanceOrResult;
      } else if (distanceOrResult !== undefined) {
        layerMask = distanceOrResult;
        hitResult = layerMaskOrResult instanceof HitResult ? layerMaskOrResult : undefined;
      }
    } else if (orientationOrDistanceOrResult instanceof HitResult) {
      hitResult = orientationOrDistanceOrResult;
    } else if (orientationOrDistanceOrResult instanceof Quaternion) {
      orientation = orientationOrDistanceOrResult;
      if (typeof distanceOrResult === "number") {
        distance = distanceOrResult;
        if (layerMaskOrResult !== undefined && !(layerMaskOrResult instanceof HitResult)) {
          layerMask = layerMaskOrResult;
        }
      }
    }

    if (outHitResult) {
      hitResult = outHitResult;
    }

    const normalizedDirection =
      distance > 0 && PhysicsScene._isValidBoxExtents(halfExtents) ? this._syncCastDirection(direction) : null;

    let result = false;
    if (normalizedDirection) {
      result = this._nativePhysicsScene.boxCast(
        center,
        orientation,
        halfExtents,
        normalizedDirection,
        distance,
        PhysicsScene._prepareQueryFilter(layerMask),
        hitResult ? this._createHitCallback(hitResult) : undefined
      );
    }

    if (!result && hitResult) {
      this._clearHitResult(hitResult);
    }
    return result;
  }

  /**
   * Tests whether sweeping a sphere hits a collider.
   */
  sphereCast(center: Vector3, radius: number, direction: Vector3): boolean;

  /**
   * Tests whether sweeping a sphere hits a collider.
   * @param outHitResult - Receives the closest hit.
   */
  sphereCast(center: Vector3, radius: number, direction: Vector3, outHitResult: HitResult): boolean;

  /**
   * Tests whether sweeping a sphere hits a collider.
   * @param distance - Maximum distance in world units.
   */
  sphereCast(center: Vector3, radius: number, direction: Vector3, distance: number): boolean;

  /**
   * Tests whether sweeping a sphere hits a collider.
   * @param distance - Maximum distance in world units.
   * @param outHitResult - Receives the closest hit.
   */
  sphereCast(center: Vector3, radius: number, direction: Vector3, distance: number, outHitResult: HitResult): boolean;

  /**
   * Tests whether sweeping a sphere hits a collider.
   * @param center - Initial center in world space.
   * @param radius - Radius in world units.
   * @param direction - Sweep direction in world space.
   * @param distance - Maximum distance in world units.
   * @param layerMask - Collision layers or filters to apply.
   * @param outHitResult - Receives the closest hit.
   */
  sphereCast(
    center: Vector3,
    radius: number,
    direction: Vector3,
    distance: number,
    layerMask: Layer | PhysicsQueryFilter,
    outHitResult?: HitResult
  ): boolean;

  sphereCast(
    center: Vector3,
    radius: number,
    direction: Vector3,
    distanceOrResult?: number | HitResult,
    layerMaskOrResult?: Layer | PhysicsQueryFilter | HitResult,
    outHitResult?: HitResult
  ): boolean {
    let hitResult: HitResult | undefined;
    let distance = Number.MAX_VALUE;
    let layerMask: Layer | PhysicsQueryFilter = Layer.Everything;

    if (typeof distanceOrResult === "number") {
      distance = distanceOrResult;
      if (layerMaskOrResult instanceof HitResult) {
        hitResult = layerMaskOrResult;
      } else if (layerMaskOrResult !== undefined) {
        layerMask = layerMaskOrResult;
      }
    } else if (distanceOrResult instanceof HitResult) {
      hitResult = distanceOrResult;
    }

    if (outHitResult) {
      hitResult = outHitResult;
    }

    const normalizedDirection =
      distance > 0 && Collider._isValidPositiveFloat32(radius) ? this._syncCastDirection(direction) : null;

    let result = false;
    if (normalizedDirection) {
      result = this._nativePhysicsScene.sphereCast(
        center,
        radius,
        normalizedDirection,
        distance,
        PhysicsScene._prepareQueryFilter(layerMask),
        hitResult ? this._createHitCallback(hitResult) : undefined
      );
    }

    if (!result && hitResult) {
      this._clearHitResult(hitResult);
    }
    return result;
  }

  /**
   * Tests whether sweeping a capsule hits a collider.
   * @param height - Total height in world units, including both caps. Must exceed twice the radius.
   */
  capsuleCast(center: Vector3, radius: number, height: number, direction: Vector3): boolean;

  /**
   * Tests whether sweeping a capsule hits a collider.
   * @param height - Total height in world units, including both caps. Must exceed twice the radius.
   * @param outHitResult - Receives the closest hit.
   */
  capsuleCast(center: Vector3, radius: number, height: number, direction: Vector3, outHitResult: HitResult): boolean;

  /**
   * Tests whether sweeping a capsule hits a collider.
   * @param height - Total height in world units, including both caps. Must exceed twice the radius.
   * @param distance - Maximum distance in world units.
   */
  capsuleCast(center: Vector3, radius: number, height: number, direction: Vector3, distance: number): boolean;

  /**
   * Tests whether sweeping a capsule hits a collider.
   * @param height - Total height in world units, including both caps. Must exceed twice the radius.
   * @param distance - Maximum distance in world units.
   * @param outHitResult - Receives the closest hit.
   */
  capsuleCast(
    center: Vector3,
    radius: number,
    height: number,
    direction: Vector3,
    distance: number,
    outHitResult: HitResult
  ): boolean;

  /**
   * Tests whether sweeping a capsule hits a collider.
   * @param center - Initial center in world space.
   * @param radius - Radius in world units.
   * @param height - Total height in world units, including both caps. Must exceed twice the radius.
   * @param direction - Sweep direction in world space.
   * @param orientation - World-space rotation of the capsule, whose local long axis is Y.
   * @param distance - Maximum distance in world units.
   * @param layerMask - Collision layers or filters to apply.
   * @param outHitResult - Receives the closest hit.
   */
  capsuleCast(
    center: Vector3,
    radius: number,
    height: number,
    direction: Vector3,
    orientation: Quaternion,
    distance: number,
    layerMask: Layer | PhysicsQueryFilter,
    outHitResult?: HitResult
  ): boolean;

  /**
   * Sweeps the shape using its default orientation and filters results by collision layer.
   */
  capsuleCast(
    center: Vector3,
    radius: number,
    height: number,
    direction: Vector3,
    distance: number,
    layerMask: Layer | PhysicsQueryFilter,
    outHitResult?: HitResult
  ): boolean;

  capsuleCast(
    center: Vector3,
    radius: number,
    height: number,
    direction: Vector3,
    orientationOrDistanceOrResult?: Quaternion | number | HitResult,
    distanceOrResult?: number | PhysicsQueryFilter | HitResult,
    layerMaskOrResult?: Layer | PhysicsQueryFilter | HitResult,
    outHitResult?: HitResult
  ): boolean {
    let hitResult: HitResult | undefined;
    let orientation = PhysicsScene._identityQuaternion;
    let distance = Number.MAX_VALUE;
    let layerMask: Layer | PhysicsQueryFilter = Layer.Everything;

    if (typeof orientationOrDistanceOrResult === "number") {
      distance = orientationOrDistanceOrResult;
      if (distanceOrResult instanceof HitResult) {
        hitResult = distanceOrResult;
      } else if (distanceOrResult !== undefined) {
        layerMask = distanceOrResult;
        hitResult = layerMaskOrResult instanceof HitResult ? layerMaskOrResult : undefined;
      }
    } else if (orientationOrDistanceOrResult instanceof HitResult) {
      hitResult = orientationOrDistanceOrResult;
    } else if (orientationOrDistanceOrResult instanceof Quaternion) {
      orientation = orientationOrDistanceOrResult;
      if (typeof distanceOrResult === "number") {
        distance = distanceOrResult;
        if (layerMaskOrResult !== undefined && !(layerMaskOrResult instanceof HitResult)) {
          layerMask = layerMaskOrResult;
        }
      }
    }

    if (outHitResult) {
      hitResult = outHitResult;
    }

    const cylinderHeight = height - 2 * radius;
    const normalizedDirection =
      distance > 0 && PhysicsScene._isValidCapsuleDimensions(radius, cylinderHeight)
        ? this._syncCastDirection(direction)
        : null;

    let result = false;
    if (normalizedDirection) {
      result = this._nativePhysicsScene.capsuleCast(
        center,
        radius,
        cylinderHeight,
        orientation,
        normalizedDirection,
        distance,
        PhysicsScene._prepareQueryFilter(layerMask),
        hitResult ? this._createHitCallback(hitResult) : undefined
      );
    }

    if (!result && hitResult) {
      this._clearHitResult(hitResult);
    }
    return result;
  }

  /**
   * Writes all positive-distance box sweep hits in unspecified order.
   * @param halfExtents - Half the box size along each local axis, in world units.
   * @param outHits - Reusable output array. Discard references to entries removed by the query.
   */
  boxCastAll(
    center: Vector3,
    halfExtents: Vector3,
    direction: Vector3,
    outHits: HitResult[],
    distance = Number.MAX_VALUE,
    filter: Layer | PhysicsQueryFilter = Layer.Everything,
    orientation = PhysicsScene._identityQuaternion
  ): boolean {
    let count = 0;
    const normalized =
      distance > 0 && PhysicsScene._isValidBoxExtents(halfExtents) && this._syncCastDirection(direction);
    if (normalized) {
      this._nativePhysicsScene.boxCast(
        center,
        orientation,
        halfExtents,
        normalized,
        distance,
        PhysicsScene._prepareQueryFilter(filter),
        (id, d, position, normal, triangleIndex) => {
          this._setHitResult(PhysicsScene._castHit(outHits, count++), id, d, position, normal, triangleIndex);
        },
        true
      );
    }
    return this._trimCastHits(outHits, count);
  }

  /**
   * Writes all positive-distance sphere sweep hits in unspecified order.
   * @param outHits - Reusable output array. Discard references to entries removed by the query.
   */
  sphereCastAll(
    center: Vector3,
    radius: number,
    direction: Vector3,
    outHits: HitResult[],
    distance = Number.MAX_VALUE,
    filter: Layer | PhysicsQueryFilter = Layer.Everything
  ): boolean {
    let count = 0;
    const normalized = distance > 0 && Collider._isValidPositiveFloat32(radius) && this._syncCastDirection(direction);
    if (normalized) {
      this._nativePhysicsScene.sphereCast(
        center,
        radius,
        normalized,
        distance,
        PhysicsScene._prepareQueryFilter(filter),
        (id, d, position, normal, triangleIndex) => {
          this._setHitResult(PhysicsScene._castHit(outHits, count++), id, d, position, normal, triangleIndex);
        },
        true
      );
    }
    return this._trimCastHits(outHits, count);
  }

  /**
   * Writes all positive-distance capsule sweep hits in unspecified order.
   * @param height - Total height including both caps. Must exceed twice the radius.
   * @param outHits - Reusable output array. Discard references to entries removed by the query.
   * @param orientation - Rotation from the capsule's default Y axis.
   */
  capsuleCastAll(
    center: Vector3,
    radius: number,
    height: number,
    direction: Vector3,
    outHits: HitResult[],
    distance = Number.MAX_VALUE,
    filter: Layer | PhysicsQueryFilter = Layer.Everything,
    orientation = PhysicsScene._identityQuaternion
  ): boolean {
    let count = 0;
    const cylinderHeight = height - 2 * radius;
    const normalized =
      distance > 0 &&
      PhysicsScene._isValidCapsuleDimensions(radius, cylinderHeight) &&
      this._syncCastDirection(direction);
    if (normalized) {
      this._nativePhysicsScene.capsuleCast(
        center,
        radius,
        cylinderHeight,
        orientation,
        normalized,
        distance,
        PhysicsScene._prepareQueryFilter(filter),
        (id, d, position, normal, triangleIndex) => {
          this._setHitResult(PhysicsScene._castHit(outHits, count++), id, d, position, normal, triangleIndex);
        },
        true
      );
    }
    return this._trimCastHits(outHits, count);
  }

  /**
   * Tests whether a box overlaps a collider that matches the query filter.
   * @param center - Center in world space.
   * @param halfExtents - Half the box size along each of its axes, in world units.
   * @param orientation - World-space rotation. Defaults to the identity rotation.
   * @param layerMask - Collision layers or filters to apply. Defaults to `Layer.Everything`.
   * @returns Whether any collider overlaps. Invalid dimensions return false.
   */
  checkBox(
    center: Vector3,
    halfExtents: Vector3,
    orientation: Quaternion = PhysicsScene._identityQuaternion,
    layerMask: Layer | PhysicsQueryFilter = Layer.Everything
  ): boolean {
    if (!PhysicsScene._isValidBoxExtents(halfExtents)) return false;

    this._syncColliders();
    return this._nativePhysicsScene.checkBox(
      center,
      orientation,
      halfExtents,
      PhysicsScene._prepareQueryFilter(layerMask)
    );
  }

  /**
   * Tests whether a sphere overlaps a collider that matches the query filter.
   * @param center - Center in world space.
   * @param radius - Radius in world units.
   * @param layerMask - Collision layers or filters to apply. Defaults to `Layer.Everything`.
   * @returns Whether any collider overlaps. Invalid dimensions return false.
   */
  checkSphere(center: Vector3, radius: number, layerMask: Layer | PhysicsQueryFilter = Layer.Everything): boolean {
    if (!Collider._isValidPositiveFloat32(radius)) return false;

    this._syncColliders();
    return this._nativePhysicsScene.checkSphere(center, radius, PhysicsScene._prepareQueryFilter(layerMask));
  }

  /**
   * Tests whether a capsule overlaps a collider that matches the query filter.
   * @param center - Center in world space.
   * @param radius - Radius in world units.
   * @param height - Total height in world units, including both caps. Must exceed twice the radius.
   * @param orientation - World-space rotation of the capsule, whose local long axis is Y. Defaults to the identity rotation.
   * @param layerMask - Collision layers or filters to apply. Defaults to `Layer.Everything`.
   * @returns Whether any collider overlaps. Invalid dimensions return false.
   */
  checkCapsule(
    center: Vector3,
    radius: number,
    height: number,
    orientation: Quaternion = PhysicsScene._identityQuaternion,
    layerMask: Layer | PhysicsQueryFilter = Layer.Everything
  ): boolean {
    const cylinderHeight = height - 2 * radius;
    if (!PhysicsScene._isValidCapsuleDimensions(radius, cylinderHeight)) return false;

    this._syncColliders();
    return this._nativePhysicsScene.checkCapsule(
      center,
      radius,
      cylinderHeight,
      orientation,
      PhysicsScene._prepareQueryFilter(layerMask)
    );
  }

  /**
   * Finds the colliders overlapping a box.
   * @param center - Center in world space.
   * @param halfExtents - Half the box size along each of its axes, in world units.
   * @param orientation - Rotation of the box in world space. Defaults to the identity rotation.
   * @param layerMask - Collision layers or filters to apply. Defaults to `Layer.Everything`.
   * @param colliders - Output array whose contents are replaced. Omit to allocate an array.
   * @returns The output array, emptied when the dimensions are invalid or there are no overlaps.
   */
  overlapBoxAll(
    center: Vector3,
    halfExtents: Vector3,
    orientation: Quaternion = PhysicsScene._identityQuaternion,
    layerMask: Layer | PhysicsQueryFilter = Layer.Everything,
    colliders: Collider[] = []
  ): Collider[] {
    if (!PhysicsScene._isValidBoxExtents(halfExtents)) {
      colliders.length = 0;
      return colliders;
    }
    this._syncColliders();
    const ids = this._nativePhysicsScene.overlapBoxAll(
      center,
      orientation,
      halfExtents,
      PhysicsScene._prepareQueryFilter(layerMask)
    );

    return PhysicsScene._collectColliders(ids, colliders);
  }

  /**
   * Finds the colliders overlapping a sphere.
   * @param center - Center in world space.
   * @param radius - Radius in world units.
   * @param layerMask - Collision layers or filters to apply. Defaults to `Layer.Everything`.
   * @param colliders - Output array whose contents are replaced. Omit to allocate an array.
   * @returns The output array, emptied when the dimensions are invalid or there are no overlaps.
   */
  overlapSphereAll(
    center: Vector3,
    radius: number,
    layerMask: Layer | PhysicsQueryFilter = Layer.Everything,
    colliders: Collider[] = []
  ): Collider[] {
    if (!Collider._isValidPositiveFloat32(radius)) {
      colliders.length = 0;
      return colliders;
    }
    this._syncColliders();
    const ids = this._nativePhysicsScene.overlapSphereAll(center, radius, PhysicsScene._prepareQueryFilter(layerMask));

    return PhysicsScene._collectColliders(ids, colliders);
  }

  /**
   * Finds the colliders overlapping a capsule.
   * @param center - Center in world space.
   * @param radius - Radius in world units.
   * @param height - Total height in world units, including both caps. Must exceed twice the radius.
   * @param orientation - World-space rotation of the capsule, whose local long axis is Y. Defaults to the identity rotation.
   * @param layerMask - Collision layers or filters to apply. Defaults to `Layer.Everything`.
   * @param colliders - Output array whose contents are replaced. Omit to allocate an array.
   * @returns The output array, emptied when the dimensions are invalid or there are no overlaps.
   */
  overlapCapsuleAll(
    center: Vector3,
    radius: number,
    height: number,
    orientation: Quaternion = PhysicsScene._identityQuaternion,
    layerMask: Layer | PhysicsQueryFilter = Layer.Everything,
    colliders: Collider[] = []
  ): Collider[] {
    const cylinderHeight = height - 2 * radius;
    if (!PhysicsScene._isValidCapsuleDimensions(radius, cylinderHeight)) {
      colliders.length = 0;
      return colliders;
    }
    this._syncColliders();
    const ids = this._nativePhysicsScene.overlapCapsuleAll(
      center,
      radius,
      cylinderHeight,
      orientation,
      PhysicsScene._prepareQueryFilter(layerMask)
    );

    return PhysicsScene._collectColliders(ids, colliders);
  }

  /**
   * Advances the simulation by one step when automatic simulation is disabled.
   * @param deltaTime - Duration of the step in seconds. Defaults to the fixed timestep.
   * @throws When automatic simulation is enabled, the scene cannot simulate, or the timestep is invalid.
   */
  step(deltaTime = this._fixedTimeStep): void {
    if (this.autoSimulation || !this._nativePhysicsScene || this._scene.destroyed || !this._scene.isActive) {
      throw new Error("PhysicsScene.step requires an active physics scene with automatic simulation disabled.");
    }
    if (!Collider._isValidPositiveFloat32(deltaTime)) {
      throw new Error("PhysicsScene.step requires a positive finite timestep.");
    }
    this._step(deltaTime, true);
  }

  /**
   * Accumulates elapsed time and runs complete fixed steps.
   * @internal
   */
  _update(deltaTime: number, maxSteps = Infinity): void {
    if (this._stepping) throw new Error("PhysicsScene cannot step while it is already simulating.");
    const fixedTimeStep = this._fixedTimeStep;
    const simulateTime = this._restTime + deltaTime;
    const elapsedSteps = Math.floor(simulateTime / fixedTimeStep);
    this._restTime = simulateTime - elapsedSteps * fixedTimeStep;
    this._interpolationFraction = this._restTime / fixedTimeStep;
    const steps = Math.min(elapsedSteps, maxSteps);
    for (let i = 0; i < steps && !this._scene.destroyed && this._scene.isActive; i++) {
      this._step(fixedTimeStep, false);
    }
  }

  /** @internal */
  _setInterpolation(body: Rigidbody, enabled: boolean): void {
    if (enabled) (this._interpolatedBodies ||= new Set()).add(body);
    else this._interpolatedBodies?.delete(body);
  }

  /** @internal */
  _getRenderPose(entity: Entity): ReturnType<Rigidbody["_getRenderPose"]> {
    return this._getInterpolatedBody(entity)?._getRenderPose(this.interpolationFraction);
  }

  /** @internal */
  _getInterpolatedBody(entity: Entity): Rigidbody | undefined {
    const bodies = this._interpolatedBodies;
    if (!bodies?.size || !this.autoSimulation || this._stepping) return;

    for (let current: Entity | null = entity; current; current = current.parent) {
      const body = current.getComponent(Rigidbody);
      if (body && body._index !== -1) return bodies.has(body) ? body : undefined;
    }
  }

  private _step(deltaTime: number, startScripts: boolean): void {
    if (this._stepping) throw new Error("PhysicsScene cannot step while it is already simulating.");
    this._stepping = true;
    try {
      const scene = this._scene;
      const componentsManager = scene._componentsManager;
      if (startScripts) componentsManager.callScriptOnStart();
      if (scene.destroyed || !scene.isActive) return;
      componentsManager.callScriptOnPhysicsUpdate(deltaTime);
      if (scene.destroyed || !scene.isActive) return;
      const { _nativePhysicsScene: nativePhysicsScene, _bodies: bodies } = this;
      this._syncColliders();
      if (scene.destroyed) return;
      nativePhysicsScene.update(deltaTime);
      if (this._bodyOrderDirty && !bodies.isLopping) {
        this._sortBodies();
      }
      const count = bodies.length;
      if (count > 0) {
        // Keep the pose leased through Transform accessors, which can update another scene.
        const poses = PhysicsScene._bodyPoses;
        const pose: [Vector3, Quaternion] = poses.pop() ?? [new Vector3(), new Quaternion()];
        const elements = bodies._elements;
        bodies._startLoop();
        try {
          const [position, rotation] = pose;
          for (let j = 0; j < count; j++) {
            elements[j]?._writeBack(position, rotation, this._autoSimulation && !startScripts);
          }
        } finally {
          bodies._endLoop(PhysicsScene._bodyIndexSetter);
          poses.push(pose);
        }
      }
      if (!scene.destroyed) this._dispatchEvents(nativePhysicsScene.updateEvents());
    } finally {
      this._stepping = false;
    }
  }

  /**
   * @internal
   * Apply pending component changes to the native scene: Rigidbody poses first, then Collider ownership and poses
   * relative to them, and finally the mass properties that depend on the attached Colliders.
   */
  _syncColliders(): void {
    const dirtyBodies = this._dirtyBodies;
    while (dirtyBodies.length) {
      const body = dirtyBodies.pop()!;
      body._dirtyIndex = -1;
      body._syncPose();
    }
    const dirtyColliders = this._dirtyColliders;
    while (dirtyColliders.length) {
      const collider = dirtyColliders.pop()!;
      collider._dirtyIndex = -1;
      collider._sync();
    }
    const massDirtyBodies = this._massDirtyBodies;
    while (massDirtyBodies.length) {
      const body = massDirtyBodies.pop()!;
      body._massDirtyIndex = -1;
      body._updateMass();
    }
  }

  /**
   * @internal
   */
  _removeCollider(collider: Collider): void {
    PhysicsScene._removeDirty(this._dirtyColliders, collider);
    collider._detach(this);
    this._nativePhysicsScene?.removeIgnoredPairs(collider._id);
  }

  /**
   * @internal
   */
  _markColliderDirty(collider: Collider): void {
    PhysicsScene._addDirty(this._dirtyColliders, collider);
  }

  /**
   * @internal
   */
  _addRigidbody(body: Rigidbody, actor: IDynamicCollider): void {
    this._nativePhysicsScene.addCollider(actor);
    const bodies = this._bodies;
    body._index = bodies.length;
    bodies.add(body);
    if (body.interpolation) this._setInterpolation(body, true);
    this._bodyOrderDirty = true;
    PhysicsScene._addDirty(this._dirtyBodies, body);
    body._markMassDirty();
  }

  /**
   * @internal
   */
  _removeRigidbody(body: Rigidbody): void {
    if (body._index === -1) {
      return;
    }
    PhysicsScene._removeDirty(this._dirtyBodies, body);
    const massIndex = body._massDirtyIndex;
    if (massIndex !== -1) {
      const massDirtyBodies = this._massDirtyBodies;
      const last = massDirtyBodies.pop()!;
      if (last !== body) {
        massDirtyBodies[massIndex] = last;
        last._massDirtyIndex = massIndex;
      }
      body._massDirtyIndex = -1;
    }
    const bodies = this._bodies;
    const moved = bodies.deleteByIndex(body._index);
    if (moved) {
      moved._index = body._index;
    }
    if (moved || bodies.isLopping) {
      this._bodyOrderDirty = true;
    }
    body._index = -1;
    this._interpolatedBodies?.delete(body);
    this._nativePhysicsScene.removeCollider(body._getNativeActor());
  }

  /**
   * @internal
   */
  _markBodyDirty(body: Rigidbody): void {
    PhysicsScene._addDirty(this._dirtyBodies, body);
  }

  /**
   * @internal
   * Reorder the writeback list when reparenting can change the order of registered bodies.
   */
  _invalidateBodyOrder(root: Entity): void {
    if (!this._bodyOrderDirty && this._bodies.length > 1) {
      this._bodyOrderDirty = root._children.length > 0 || (root.getComponent(Rigidbody)?._index ?? -1) !== -1;
    }
  }

  /**
   * @internal
   */
  _queueMassUpdate(body: Rigidbody): void {
    const massDirtyBodies = this._massDirtyBodies;
    body._massDirtyIndex = massDirtyBodies.length;
    massDirtyBodies.push(body);
  }

  /**
   * @internal
   */
  _registerJoint(joint: Joint): number {
    const id = ++this._nextJointId;
    this._joints.set(id, joint);
    return id;
  }

  /** @internal */
  _unregisterJoint(id: number): void {
    this._joints.delete(id);
  }

  /** @internal */
  _addContactEventConsumer(delta: 1 | -1): void {
    const wasEnabled = this._contactEventConsumerCount > 0;
    this._contactEventConsumerCount += delta;
    const enabled = this._contactEventConsumerCount > 0;
    if (wasEnabled !== enabled) {
      this._nativePhysicsScene?.setContactEventEnabled(enabled);
    }
  }

  /**
   * @internal
   */
  _gc(): void {
    this._bodies.garbageCollection();
    PhysicsScene._raycastHitPool.length = 0;
    PhysicsScene._raycastSeenHits.clear();
    this._nativePhysicsScene?.gc();
  }

  /**
   * @internal
   */
  _destroy(): void {
    //@ts-ignore
    this._gravity._onValueChanged = null;
    PhysicsScene._raycastHitPool.length = 0;
    PhysicsScene._raycastSeenHits.clear();
    this._joints.clear();
    this._defaultMaterial?._addReferCount(-1);
    this._defaultMaterial = null;
    this._nativePhysicsScene?.destroy();
    this._nativePhysicsScene = null!;
  }

  private _sortBodies(): void {
    this._bodyOrderDirty = false;
    const { _elements: bodies, length } = this._bodies;
    // Publish ancestors first so each body's world pose is converted against its parent's simulated pose.
    for (let i = 0, n = length - 1; i < n; i++) {
      let body = bodies[i];
      for (let parent = body.entity.parent; parent; parent = parent.parent) {
        const ancestor = parent.getComponent(Rigidbody);
        if (ancestor) {
          const index = ancestor._index;
          if (index === -1) continue;
          if (index < i) break;
          bodies[i] = ancestor;
          bodies[index] = body;
          body._index = index;
          ancestor._index = i;
          body = ancestor;
        }
      }
    }
  }

  private _dispatchEvents(events: IPhysicsEvents): void {
    const physicalObjectsMap = Engine._physicalObjectsMap;
    const { contactEvents, contactEventCount, triggerEvents, brokenJointIds } = events;

    if (contactEventCount > 0) {
      const collision = (this._collision ||= new Collision());
      try {
        for (let i = 0; i < contactEventCount; i++) {
          const event = contactEvents[i];
          const collider0 = physicalObjectsMap[event.shape0Id];
          const collider1 = physicalObjectsMap[event.shape1Id];
          if (!collider0 || !collider1) continue;
          collision._nativeCollision = event;
          const state = event.state;
          PhysicsScene._dispatchScripts(state, collider0, collider1, collision);
          PhysicsScene._dispatchScripts(state, collider1, collider0, collision);
        }
      } finally {
        collision._nativeCollision = null!;
        collision.collider = null!;
        collision.selfCollider = null!;
      }
    }

    for (let i = 0, n = triggerEvents.length; i < n; i++) {
      const event = triggerEvents[i];
      const collider0 = physicalObjectsMap[event.index1];
      const collider1 = physicalObjectsMap[event.index2];
      if (!collider0 || !collider1) continue;
      const state = event.dispatchState;
      PhysicsScene._dispatchScripts(state, collider0, collider1);
      PhysicsScene._dispatchScripts(state, collider1, collider0);
    }

    const joints = this._joints;
    for (let i = 0; i < brokenJointIds.length; i++) {
      const id = brokenJointIds[i];
      const joint = joints.get(id);
      if (!joint) continue;
      const scripts = joint.entity._scripts;
      const count = scripts.length;
      scripts._startLoop();
      try {
        const elements = scripts._elements;
        for (let j = 0; j < count; j++) {
          elements[j]?.onJointBreak(joint);
          if (!joints.has(id)) break;
        }
      } finally {
        scripts._endLoop(PhysicsScene._scriptIndexSetter);
      }
    }
  }

  private static _dispatchScripts(
    state: PhysicsEventState,
    self: Collider,
    other: Collider,
    collision?: Collision
  ): void {
    if (self.destroyed || other.destroyed || (collision && !self.contactEventsEnabled)) return;
    const entity = self.entity;
    const body = self._attachedBody;
    PhysicsScene._dispatchEntityScripts(state, entity, self, other, collision);
    if (body && body.entity !== entity && body._index !== -1 && !self.destroyed && !other.destroyed) {
      PhysicsScene._dispatchEntityScripts(state, body.entity, self, other, collision);
    }
  }

  private static _dispatchEntityScripts(
    state: PhysicsEventState,
    target: Entity,
    self: Collider,
    other: Collider,
    collision?: Collision
  ): void {
    const scripts = target._scripts;
    const count = scripts.length;
    if (count === 0) return;
    scripts._startLoop();
    try {
      const elements = scripts._elements;
      for (let i = 0; i < count; i++) {
        const script = elements[i];
        if (!script) continue;
        if (collision) {
          collision.collider = other;
          collision.selfCollider = self;
          script[PhysicsScene._collisionMethods[state]](collision);
        } else {
          script[PhysicsScene._triggerMethods[state]](other, self);
        }
        if (self.destroyed || other.destroyed) break;
      }
    } finally {
      scripts._endLoop(PhysicsScene._scriptIndexSetter);
    }
  }

  private static _addDirty<T extends { _dirtyIndex: number }>(list: T[], item: T): void {
    if (item._dirtyIndex === -1) {
      item._dirtyIndex = list.length;
      list.push(item);
    }
  }

  private static _removeDirty<T extends { _dirtyIndex: number }>(list: T[], item: T): void {
    const index = item._dirtyIndex;
    if (index !== -1) {
      const last = list.pop()!;
      if (last !== item) {
        list[index] = last;
        last._dirtyIndex = index;
      }
      item._dirtyIndex = -1;
    }
  }

  private static _prepareQueryFilter(options: Layer | PhysicsQueryFilter): IPhysicsQueryFilter {
    const filter = PhysicsScene._queryFilter;
    if (typeof options === "number") {
      filter.layerMask = options;
      filter.includeTriggers = true;
      filter.hitBackfaces = false;
      filter.excludedShapeIds.length = 0;
      return filter;
    }

    // A filter getter can run another query before this one submits its direction and policy.
    const direction = PhysicsScene._tempDirection;
    const { x, y, z } = direction;
    const { layerMask, includeTriggers, hitBackfaces, exclude: excluded } = options;
    const count = excluded?.length ?? 0;
    direction.set(x, y, z);
    filter.layerMask = layerMask ?? Layer.Everything;
    filter.includeTriggers = includeTriggers !== false;
    filter.hitBackfaces = hitBackfaces === true;
    const ids = filter.excludedShapeIds;
    ids.length = count;
    for (let i = 0; i < count; i++) {
      ids[i] = excluded![i]._id;
    }
    return filter;
  }

  private static _collectColliders(ids: ArrayLike<number>, out: Collider[]): Collider[] {
    const physicalObjectsMap = Engine._physicalObjectsMap;
    out.length = 0;
    for (let i = 0, n = ids.length; i < n; i++) {
      out.push(physicalObjectsMap[ids[i]]);
    }
    return out;
  }

  private static _isValidBoxExtents(halfExtents: Vector3): boolean {
    return (
      Collider._isValidPositiveFloat32(halfExtents.x) &&
      Collider._isValidPositiveFloat32(halfExtents.y) &&
      Collider._isValidPositiveFloat32(halfExtents.z)
    );
  }

  private static _isValidCapsuleDimensions(radius: number, cylinderHeight: number): boolean {
    return Collider._isValidPositiveFloat32(radius) && Collider._isValidPositiveFloat32(cylinderHeight * 0.5);
  }

  private _raycast(
    origin: Vector3,
    direction: Vector3,
    distance: number,
    filter: Layer | PhysicsQueryFilter,
    hitResult?: HitResult
  ): boolean {
    const normalizedDirection = distance > 0 ? this._syncCastDirection(direction) : null;

    let result = false;
    if (normalizedDirection) {
      result = this._nativePhysicsScene.raycast(
        origin,
        normalizedDirection,
        distance,
        PhysicsScene._prepareQueryFilter(filter),
        hitResult ? this._createHitCallback(hitResult) : undefined
      );
    }

    if (!result && hitResult) {
      this._clearHitResult(hitResult);
    }
    return result;
  }

  private _syncCastDirection(direction: Vector3): Vector3 | null {
    const { x, y, z } = direction;
    const length = Math.sqrt(x * x + y * y + z * z);
    if (!(length > MathUtil.zeroTolerance && Number.isFinite(length))) return null;
    // Synchronize first so a query made by a Transform getter cannot overwrite this direction.
    this._syncColliders();
    const inverseLength = 1 / length;
    return PhysicsScene._tempDirection.set(x * inverseLength, y * inverseLength, z * inverseLength);
  }

  private static _castHit(hits: HitResult[], index: number): HitResult {
    return (hits[index] ||= PhysicsScene._raycastHitPool.pop() ?? new HitResult());
  }

  private _trimCastHits(outHitResults: HitResult[], hitCount: number): boolean {
    const pool = PhysicsScene._raycastHitPool;
    const length = outHitResults.length;
    if (hitCount < length) {
      // Caller entries can alias retained hits or each other. Recycle only unreferenced objects once.
      const seenHits = PhysicsScene._raycastSeenHits;
      for (let i = 0; i < hitCount; i++) {
        seenHits.add(outHitResults[i]);
      }
      for (let i = hitCount; i < length; i++) {
        const hitResult = outHitResults[i];
        if (hitResult && !seenHits.has(hitResult)) {
          seenHits.add(hitResult);
          this._clearHitResult(hitResult);
          pool.push(hitResult);
        }
      }
      seenHits.clear();
    }
    outHitResults.length = hitCount;
    return hitCount > 0;
  }

  private _setGravity(): void {
    this._nativePhysicsScene.setGravity(this._gravity);
  }

  private _createHitCallback(outHitResult: HitResult): IPhysicsQueryHit {
    return (id, distance, position, normal, triangleIndex) => {
      this._setHitResult(outHitResult, id, distance, position, normal, triangleIndex);
    };
  }

  private _setHitResult(
    outHitResult: HitResult,
    colliderID: number,
    distance: number,
    position: Vector3,
    normal: Vector3,
    triangleIndex: number
  ): void {
    const collider = Engine._physicalObjectsMap[colliderID];
    outHitResult.entity = collider.entity;
    outHitResult.collider = collider;
    outHitResult.distance = distance;
    outHitResult.triangleIndex = triangleIndex;
    outHitResult.point.copyFrom(position);
    outHitResult.normal.copyFrom(normal);
  }

  private _clearHitResult(hitResult: HitResult): void {
    hitResult.entity = null;
    hitResult.collider = null;
    hitResult.distance = 0;
    hitResult.triangleIndex = -1;
    hitResult.point.set(0, 0, 0);
    hitResult.normal.set(0, 0, 0);
  }
}
