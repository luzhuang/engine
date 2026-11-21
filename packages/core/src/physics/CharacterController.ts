import { ICharacterController, IControllerMoveHit, IControllerMoveHits } from "@galacean/engine-design";
import { MathUtil, Vector3 } from "@galacean/engine-math";
import { ignoreClone } from "../clone/CloneDecorators";
import { Engine } from "../Engine";
import { Entity } from "../Entity";
import type { Layer } from "../Layer";
import type { Scene } from "../Scene";
import type { Script } from "../Script";
import { Collider } from "./Collider";
import { CharacterControllerGeometry } from "./enums/CharacterControllerGeometry";
import { ControllerClimbingMode } from "./enums/ControllerClimbingMode";
import { ControllerCollisionFlag } from "./enums/ControllerCollisionFlag";
import { ControllerNonWalkableMode } from "./enums/ControllerNonWalkableMode";
import type { PhysicsScene } from "./PhysicsScene";
import { Rigidbody } from "./Rigidbody";

/** Narrows the scene's collision rules for one character controller move. */
export interface ControllerMoveFilter {
  /** Collision layers to test. Defaults to all layers. */
  layerMask?: Layer;
  /** Colliders to ignore during this move, including other character controllers. */
  exclude?: readonly Collider[];
}

/** Borrowed contact data reported by a character controller's move. */
export interface ControllerColliderHit {
  /** The moving controller. */
  readonly controller: CharacterController;
  /** The collider hit by the sweep. */
  readonly collider: Collider;
  /** The contact point in world space. */
  readonly point: Readonly<Vector3>;
  /** The outward contact normal in world space. */
  readonly normal: Readonly<Vector3>;
  /** The world-space direction of the sweep segment that produced this hit. */
  readonly moveDirection: Readonly<Vector3>;
  /** The length of that sweep segment in world units. */
  readonly moveLength: number;
}

/**
 * A capsule or box that moves and slides along obstacles through {@link move}.
 * @remarks The Entity's world scale sizes the shape, and {@link upDirection} orients it. The controller moves
 * independently of Rigidbody ownership and Entity rotation.
 */
export class CharacterController extends Collider {
  private static readonly _movePositions: Vector3[] = [];
  private static readonly _moveHitBatches: ControllerMoveHitBatch[] = [];
  private static readonly _moveExclusionLists: number[][] = [];
  private static readonly _scriptIndexSetter = (script: Script, index: number): void => {
    script._entityScriptsIndex = index;
  };
  private static _tempWorldScale = new Vector3();
  private static _tempExtents = new Vector3();

  private static _validateSlopeWallDistance(value: number, property: string): void {
    if (typeof value !== "number" || !(value >= 0 && Number.isFinite(Math.fround(value)))) {
      throw new RangeError(`CharacterController ${property} must be a nonnegative finite Float32.`);
    }
  }

  private _geometry = CharacterControllerGeometry.Capsule;
  private _radius = 0.5;
  private _height = 2;
  @ignoreClone
  private _size: Vector3;
  private _detectCollisions = true;
  private _stepOffset = 0.5;
  private _climbingMode = ControllerClimbingMode.Constrained;
  private _nonWalkableMode: ControllerNonWalkableMode = ControllerNonWalkableMode.PreventClimbing;
  private _upDirection = new Vector3(0, 1, 0);
  @ignoreClone
  private _lastValidUpDirection?: Vector3;
  private _slopeLimit = 45;
  private _invisibleWallHeight = 0;
  private _maxJumpHeight = 0;

  @ignoreClone
  private _inScene = false;
  @ignoreClone
  private _syncedCenter = new Vector3();
  @ignoreClone
  private _collisionFlags: ControllerCollisionFlag = ControllerCollisionFlag.None;
  @ignoreClone
  private _velocity = new Vector3();

  /**
   * The geometry type of the controller.
   * @defaultValue `CharacterControllerGeometry.Capsule`
   */
  get geometry(): CharacterControllerGeometry {
    return this._geometry;
  }

  set geometry(value: CharacterControllerGeometry) {
    if (this._geometry !== value) {
      this._geometry = value;
      this._setGeometryDirty();
    }
  }

  /**
   * The capsule radius in the Entity's local space. Finite negative values are clamped to 0.
   * @defaultValue 0.5
   * @throws When the value is not finite.
   */
  get radius(): number {
    return this._radius;
  }

  set radius(value: number) {
    if (!Number.isFinite(value)) {
      throw new Error("CharacterController radius must be finite.");
    }
    value = Math.max(0, value);
    if (this._radius !== value) {
      this._radius = value;
      this._setGeometryDirty();
    }
  }

  /**
   * The total capsule height in local units, including both caps. Finite negative values are clamped to 0.
   * @defaultValue 2
   * @remarks World scale along the Entity's local Y axis scales the total height. The larger scale across
   * local X and Z scales the radius. The scaled height must exceed the scaled diameter for the controller to move.
   * @throws When the value is not finite.
   */
  get height(): number {
    return this._height;
  }

  set height(value: number) {
    if (!Number.isFinite(value)) {
      throw new Error("CharacterController height must be finite.");
    }
    value = Math.max(0, value);
    if (this._height !== value) {
      this._height = value;
      this._setGeometryDirty();
    }
  }

  /**
   * The box size in local units. Finite negative components are clamped to 0.
   * @defaultValue `(1, 1, 1)`
   * @remarks Mutating the returned vector updates the box size.
   * @throws When a component is non-finite.
   */
  get size(): Vector3 {
    let size = this._size;
    if (!size) {
      this._size = size = new Vector3(1, 1, 1);
      size._onValueChanged = this._onSizeChanged.bind(this);
    }
    return size;
  }

  set size(value: Vector3) {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
      throw new Error("CharacterController size must be finite.");
    }
    const size = this.size;
    if (size !== value) {
      size.copyFrom(value);
    }
  }

  /**
   * Character controllers cannot be triggers.
   * @throws When set to true.
   */
  override get isTrigger(): boolean {
    return false;
  }

  override set isTrigger(value: boolean) {
    if (value) {
      throw new Error("CharacterController cannot be a trigger.");
    }
  }

  /**
   * Whether other rigidbodies and character controllers can collide with this controller.
   * @defaultValue true
   * @remarks Disabling incoming collisions also disables trigger interactions. The controller's own
   * {@link move} still detects collisions, and {@link Collider.isSceneQuery} controls query visibility independently.
   */
  get detectCollisions(): boolean {
    return this._detectCollisions;
  }

  set detectCollisions(value: boolean) {
    if (this._detectCollisions !== value) {
      this._detectCollisions = value;
      (<ICharacterController>this._native)?.setDetectCollisions(value);
    }
  }

  /**
   * The step height used when climbing obstacles, in world units. Finite negative values are clamped to 0.
   * @defaultValue 0.5
   * @remarks PhysX limits the effective step to the scaled controller height. The property retains the requested value.
   * @throws When the value is non-finite.
   */
  get stepOffset(): number {
    return this._stepOffset;
  }

  set stepOffset(value: number) {
    if (!Number.isFinite(value)) {
      throw new Error("CharacterController stepOffset must be finite.");
    }
    value = Math.max(0, value);
    if (this._stepOffset !== value) {
      this._stepOffset = value;
      this._setGeometryDirty();
    }
  }

  /**
   * How capsule geometry steps over obstacles.
   * @defaultValue `ControllerClimbingMode.Constrained`
   * @remarks Box geometry ignores this setting.
   */
  get climbingMode(): ControllerClimbingMode {
    return this._climbingMode;
  }

  set climbingMode(value: ControllerClimbingMode) {
    if (value !== ControllerClimbingMode.Easy && value !== ControllerClimbingMode.Constrained) {
      throw new Error("CharacterController climbingMode must be Easy or Constrained.");
    }
    if (this._climbingMode !== value) {
      this._climbingMode = value;
      (<ICharacterController>this._native)?.setClimbingMode(value);
    }
  }

  /**
   * How the controller behaves on slopes steeper than {@link slopeLimit}.
   */
  get nonWalkableMode(): ControllerNonWalkableMode {
    return this._nonWalkableMode;
  }

  set nonWalkableMode(value: ControllerNonWalkableMode) {
    if (this._nonWalkableMode !== value) {
      this._nonWalkableMode = value;
      (<ICharacterController>this._native)?.setNonWalkableMode(value);
    }
  }

  /**
   * The mutable up direction in world space.
   * @defaultValue `(0, 1, 0)`
   * @remarks Assigning or mutating the vector normalizes nonzero values. A zero value retains the previous direction.
   * @throws When the vector length is non-finite.
   */
  get upDirection(): Vector3 {
    return this._upDirection;
  }

  set upDirection(value: Vector3) {
    if (this._upDirection === value) return;
    const { x, y, z } = value;
    const len = Math.hypot(x, y, z);
    if (!Number.isFinite(len)) {
      throw new Error("CharacterController upDirection must be finite.");
    }
    if (len > 0) this._applyUpDirection(x / len, y / len, z / len);
  }

  /**
   * The slope limit in degrees, clamped to the range 0 to 90.
   * @defaultValue 45
   * @throws When the value is non-finite.
   */
  get slopeLimit(): number {
    return this._slopeLimit;
  }

  set slopeLimit(value: number) {
    if (!Number.isFinite(value)) {
      throw new Error("CharacterController slopeLimit must be finite.");
    }
    value = MathUtil.clamp(value, 0, 90);
    if (this._slopeLimit !== value) {
      this._slopeLimit = value;
      (<ICharacterController>this._native)?.setSlopeLimit(value);
    }
  }

  /**
   * The height of invisible walls around non-walkable mesh and heightfield triangles, in world units.
   * @defaultValue 0
   * @remarks A height of zero disables wall generation.
   * @throws When the value is negative or non-finite as a Float32.
   */
  get invisibleWallHeight(): number {
    return this._invisibleWallHeight;
  }

  set invisibleWallHeight(value: number) {
    CharacterController._validateSlopeWallDistance(value, "invisibleWallHeight");
    if (this._invisibleWallHeight !== value) {
      this._invisibleWallHeight = value;
      (<ICharacterController>this._native)?.setSlopeWalls(value, this._maxJumpHeight);
    }
  }

  /**
   * The extra downward search distance for non-walkable triangles while jumping, in world units.
   * @defaultValue 0
   * @remarks Extends the sweep search along the direction opposite {@link upDirection} when {@link invisibleWallHeight} is positive.
   * @throws When the value is negative or non-finite as a Float32.
   */
  get maxJumpHeight(): number {
    return this._maxJumpHeight;
  }

  set maxJumpHeight(value: number) {
    CharacterController._validateSlopeWallDistance(value, "maxJumpHeight");
    if (this._maxJumpHeight !== value) {
      this._maxJumpHeight = value;
      (<ICharacterController>this._native)?.setSlopeWalls(this._invisibleWallHeight, value);
    }
  }

  /**
   * The contact directions from the most recent {@link move}.
   */
  get collisionFlags(): ControllerCollisionFlag {
    return this._collisionFlags;
  }

  /**
   * Whether the most recent {@link move} contacted the ground.
   */
  get isGrounded(): boolean {
    return (this._collisionFlags & ControllerCollisionFlag.Down) !== 0;
  }

  /**
   * @internal
   */
  constructor(entity: Entity) {
    super(entity);
    this._setUpDirection = this._setUpDirection.bind(this);
    this._upDirection._onValueChanged = this._setUpDirection;
  }

  /** @internal */
  override _onClone(target: CharacterController): void {
    super._onClone(target);
    const size = this._size;
    if (size) target.size = size;
  }

  /**
   * Writes the world-space velocity from the most recent {@link move}, in world units per second.
   * @param out - Receives zero if the duration was zero or the controller is detached.
   * @returns The output vector.
   */
  getVelocity(out: Vector3): Vector3 {
    return out.copyFrom(this._velocity);
  }

  /**
   * Writes the controller's foot position, including its contact offset, in world space.
   * @param out - Receives the foot position.
   * @returns Whether an active controller supplied a position. On failure, the output is unchanged.
   */
  getFootPosition(out: Vector3): boolean {
    return this._getSyncedNative()?.getFootPosition(out) ?? false;
  }

  /**
   * Teleports the controller by moving its foot to a world-space position.
   * @remarks The teleport does not sweep the controller through the scene.
   * @param position - The requested foot position, including the contact offset.
   * @returns Whether the active controller was moved.
   */
  setFootPosition(position: Vector3): boolean {
    const controller = this._getSyncedNative();
    if (!controller?.setFootPosition(position)) return false;
    this._collisionFlags = ControllerCollisionFlag.None;
    this._writeBackPosition(controller, 0);
    return true;
  }

  /**
   * Changes the controller's height while keeping its foot fixed.
   * @remarks Check for overhead clearance before increasing the height.
   * @param height - The new total height in local units, including both caps for a capsule.
   * @returns Whether an active controller accepted the requested geometry.
   */
  resize(height: number): boolean {
    const controller = this._getSyncedNative();
    if (!controller) return false;
    const scale = this._nativeScale;
    const box = this._geometry === CharacterControllerGeometry.Box;
    const worldHeight = height * scale.y;
    const nativeHeight = box ? worldHeight * 0.5 : worldHeight - 2 * this._radius * Math.max(scale.x, scale.z);
    if (!Collider._isValidPositiveFloat32(nativeHeight) || !controller.resize(nativeHeight, this._stepOffset)) {
      return false;
    }
    if (box) this.size.y = height;
    else this.height = height;
    this._collisionFlags = ControllerCollisionFlag.None;
    this._writeBackPosition(controller, 0);
    return true;
  }

  /**
   * Moves the controller and immediately updates the Entity's world position.
   * @remarks Scene queries see the new pose immediately. The moving Entity's controller-hit callbacks run before
   * this method returns. Trigger callbacks are dispatched by simulation steps.
   * @param disp - Requested displacement in world space.
   * @param minDist - Remaining distance at which the sweep stops, in world units. Defaults to 0.
   * @param elapsedTime - Time since the previous move, in seconds. Defaults to the scene's fixed timestep.
   * @param filter - Optional collision layers and colliders to filter for this move only.
   * @returns The contact directions, or `ControllerCollisionFlag.None` if inactive or no collision is reported.
   */
  move(disp: Vector3, minDist = 0, elapsedTime?: number, filter?: ControllerMoveFilter): ControllerCollisionFlag {
    // Resolve caller accessors before syncing or marshaling the displacement into the backend.
    const { x, y, z } = disp;
    const layerMask = filter?.layerMask;
    const excluded = filter?.exclude;
    const count = excluded?.length ?? 0;
    const excludedIds = count > 0 ? (CharacterController._moveExclusionLists.pop() ?? []) : undefined;
    let hits: ControllerMoveHitBatch | undefined;
    let displacement: Vector3 | undefined;
    try {
      if (excludedIds) {
        excludedIds.length = count;
        for (let i = 0; i < count; i++) excludedIds[i] = excluded![i]._id;
      }
      const controller = this._getSyncedNative();
      if (!controller) return ControllerCollisionFlag.None;
      const scene = this._registeredScene!;
      elapsedTime ??= scene.physics.fixedTimeStep;
      hits = this._borrowMoveHitBatch();
      displacement = CharacterController._movePositions.pop() ?? new Vector3();
      const flags = controller.move(displacement.set(x, y, z), minDist, elapsedTime, hits, layerMask, excludedIds);
      this._collisionFlags = flags;
      this._writeBackPosition(controller, elapsedTime, displacement);
      if (hits?.count) this._dispatchMoveHits(hits, scene);
      return flags;
    } finally {
      if (displacement) CharacterController._movePositions.push(displacement);
      if (excludedIds) CharacterController._moveExclusionLists.push(excludedIds);
      if (hits) CharacterController._moveHitBatches.push(hits);
    }
  }

  /**
   * Not supported by character controllers.
   * @returns -1
   */
  override getClosestPoint(point: Vector3, outClosestPoint: Vector3): number {
    console.error("CharacterController does not support getClosestPoint.");
    return -1;
  }

  /**
   * @internal
   */
  override _getVolumeDistance(): number {
    return -1;
  }

  /**
   * @internal
   */
  override _sync(): void {
    const scene = this._registeredScene!;
    const transform = this.entity.transform;
    // Reading the world matrix re-arms transform change notifications that are only sent from a clean state
    transform.worldMatrix;
    const lossyScale = transform.lossyWorldScale;
    const position = transform.worldPosition;
    const colliderCenter = this.center;
    if (this._registeredScene !== scene) return;
    const scale = CharacterController._tempWorldScale.set(
      Math.abs(lossyScale.x),
      Math.abs(lossyScale.y),
      Math.abs(lossyScale.z)
    );
    const force = !this._inScene;
    const syncGeometry = force || this._geometryDirty || this._scaleChanged(scale);
    const box = this._geometry === CharacterControllerGeometry.Box;
    const dimensions = CharacterController._tempExtents;
    if (syncGeometry) {
      if (box) {
        const size = this._size;
        dimensions.set((size?.x ?? 1) * scale.x * 0.5, (size?.y ?? 1) * scale.y * 0.5, (size?.z ?? 1) * scale.z * 0.5);
      } else {
        const radius = this._radius * Math.max(scale.x, scale.z);
        dimensions.set(radius, this._height * scale.y - 2 * radius, 0);
      }
      if (
        !Collider._isValidPositiveFloat32(dimensions.x) ||
        !Collider._isValidPositiveFloat32(dimensions.y) ||
        (box && !Collider._isValidPositiveFloat32(dimensions.z))
      ) {
        this._detach();
        return;
      }
    }

    const controller = <ICharacterController>(this._native ||= this._createNative());
    const centerX = colliderCenter.x * lossyScale.x;
    const centerY = colliderCenter.y * lossyScale.y;
    const centerZ = colliderCenter.z * lossyScale.z;
    const syncedCenter = this._syncedCenter;
    const nativePosition = this._nativePosition;
    if (
      force ||
      centerX !== syncedCenter.x ||
      centerY !== syncedCenter.y ||
      centerZ !== syncedCenter.z ||
      position.x !== nativePosition.x ||
      position.y !== nativePosition.y ||
      position.z !== nativePosition.z
    ) {
      syncedCenter.set(centerX, centerY, centerZ);
      nativePosition.copyFrom(position);
      controller.setWorldPosition(position, syncedCenter);
    }
    if (syncGeometry) {
      this._geometryDirty = false;
      this._nativeScale.copyFrom(scale);
      const stepOffset = this._stepOffset;
      if (box) {
        controller.setBox(dimensions, stepOffset);
      } else {
        controller.setCapsule(dimensions.x, dimensions.y, stepOffset);
      }
    }
    if (force) {
      scene.physics._nativePhysicsScene.addCharacterController(controller);
      this._inScene = true;
    }
  }

  /**
   * @internal
   */
  override _detach(physicsScene?: PhysicsScene): void {
    if (this._inScene) {
      (physicsScene ?? this._registeredScene!.physics)._nativePhysicsScene.removeCharacterController(
        <ICharacterController>this._native
      );
      this._inScene = false;
      this._collisionFlags = ControllerCollisionFlag.None;
      this._velocity.set(0, 0, 0);
    }
  }

  private _createNative(): ICharacterController {
    const controller = Engine._nativePhysics.createCharacterController(this._id, this._getNativeMaterial());
    controller.setContactOffset(this.contactOffset);
    controller.setCollisionLayer(this._collisionLayerIndex);
    if (this._includeLayers || this._excludeLayers) {
      controller.setLayerOverrides(this._includeLayers, this._excludeLayers);
    }
    controller.setIsSceneQuery(this.isSceneQuery);
    if (!this._detectCollisions) controller.setDetectCollisions(false);
    controller.setClimbingMode(this._climbingMode);
    controller.setNonWalkableMode(this._nonWalkableMode);
    controller.setUpDirection(this._upDirection);
    controller.setSlopeLimit(this._slopeLimit);
    if (this._invisibleWallHeight || this._maxJumpHeight) {
      controller.setSlopeWalls(this._invisibleWallHeight, this._maxJumpHeight);
    }
    return controller;
  }

  private _getSyncedNative(): ICharacterController | null {
    this._registeredScene?.physics._syncColliders();
    return this._inScene ? <ICharacterController>this._native : null;
  }

  private _borrowMoveHitBatch(): ControllerMoveHitBatch | undefined {
    const { _elements: scripts, length } = this.entity._scripts;
    for (let i = 0; i < length; i++) {
      if (scripts[i]?.onControllerColliderHit) {
        return CharacterController._moveHitBatches.pop() ?? new ControllerMoveHitBatch();
      }
    }
  }

  private _dispatchMoveHits(batch: ControllerMoveHitBatch, scene: Scene): void {
    const scripts = this.entity._scripts;
    const { _elements: listeners, length } = scripts;
    const { event, hits, count } = batch;
    event.controller = this;
    scripts._startLoop();
    try {
      for (let i = 0; i < count && this._registeredScene === scene; i++) {
        const hit = hits[i];
        const collider = Engine._physicalObjectsMap[hit.colliderId];
        if (!collider || collider.destroyed || collider.scene !== scene) continue;
        event.collider = collider;
        event.point = hit.point;
        event.normal = hit.normal;
        event.moveDirection = hit.moveDirection;
        event.moveLength = hit.moveLength;
        for (let j = 0; j < length; j++) {
          listeners[j]?.onControllerColliderHit?.(event);
          if (this._registeredScene !== scene || collider.destroyed || collider.scene !== scene) break;
        }
      }
    } finally {
      scripts._endLoop(CharacterController._scriptIndexSetter);
      event.controller = event.collider = null!;
    }
  }

  private _writeBackPosition(controller: ICharacterController, elapsedTime: number, scratch?: Vector3): void {
    const positions = CharacterController._movePositions;
    const position = scratch ?? positions.pop() ?? new Vector3();
    try {
      controller.getWorldPosition(position);
      const velocity = this._velocity;
      const previous = this._nativePosition;
      const inverseDuration = elapsedTime > 0 ? 1 / elapsedTime : 0;
      velocity.set(
        (position.x - previous.x) * inverseDuration,
        (position.y - previous.y) * inverseDuration,
        (position.z - previous.z) * inverseDuration
      );
      const transform = this.entity.transform;
      transform.worldPosition = position;
      // Cache the published position so the next sync does not teleport over a rounding difference.
      this._nativePosition.copyFrom(transform.worldPosition);
    } finally {
      // A custom Transform setter can move another controller before consuming this position.
      if (!scratch) positions.push(position);
    }
  }

  protected override _onContactOffsetChanged(value: number): void {
    super._onContactOffsetChanged(value);
    this._setGeometryDirty();
  }

  /** @internal */
  override _findRigidbody(): Rigidbody | null {
    return null;
  }

  /** @internal */
  protected override _onDestroy(): void {
    this._upDirection._onValueChanged = null;
    const size = this._size;
    if (size) size._onValueChanged = null;
    super._onDestroy();
  }

  private _onSizeChanged(): void {
    const finite = CharacterController._clampBoxSize(this._size);
    this._setGeometryDirty();
    if (!finite) throw new Error("CharacterController size must be finite.");
  }

  private _setGeometryDirty(): void {
    this._geometryDirty = true;
    this._markDirty();
  }

  @ignoreClone
  private _setUpDirection(): void {
    const up = this._upDirection;
    const { x, y, z } = up;
    const len = Math.hypot(x, y, z);
    if (!Number.isFinite(len)) {
      this._applyUpDirection(0, 1, 0);
      throw new Error("CharacterController upDirection must be finite.");
    }
    if (len === 0) {
      const previous = this._lastValidUpDirection;
      this._writeUpDirection(previous?.x ?? 0, previous?.y ?? 1, previous?.z ?? 0);
      return;
    }
    this._applyUpDirection(x / len, y / len, z / len);
  }

  private _applyUpDirection(x: number, y: number, z: number): void {
    const previous = this._lastValidUpDirection;
    this._writeUpDirection(x, y, z);
    if (x !== (previous?.x ?? 0) || y !== (previous?.y ?? 1) || z !== (previous?.z ?? 0)) {
      (this._lastValidUpDirection ||= new Vector3()).set(x, y, z);
      (<ICharacterController>this._native)?.setUpDirection(this._upDirection);
    }
  }

  private _writeUpDirection(x: number, y: number, z: number): void {
    const up = this._upDirection;
    if (x === up.x && y === up.y && z === up.z) return;
    const listener = up._onValueChanged;
    up._onValueChanged = null;
    up.set(x, y, z);
    up._onValueChanged = listener;
  }
}

class ControllerMoveHitBatch implements IControllerMoveHits {
  readonly hits: IControllerMoveHit[] = [];
  count = 0;
  readonly event = {
    controller: null! as CharacterController,
    collider: null! as Collider,
    point: null! as Vector3,
    normal: null! as Vector3,
    moveDirection: null! as Vector3,
    moveLength: 0
  };
}
