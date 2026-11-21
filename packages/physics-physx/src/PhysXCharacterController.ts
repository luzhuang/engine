import { ICharacterController, IControllerMoveHits } from "@galacean/engine-design";
import { ControllerClimbingMode, Layer, Vector3 } from "@galacean/engine";
import { PhysXPhysics } from "./PhysXPhysics";
import { PhysXPhysicsMaterial } from "./PhysXPhysicsMaterial";
import { PhysXPhysicsScene } from "./PhysXPhysicsScene";

/**
 * PhysX character controller with settings that persist across scene removal.
 * @remarks The scene’s controller manager creates the native controller on entry and releases it on removal.
 */
export class PhysXCharacterController implements ICharacterController {
  private static _tempVec = new Vector3();

  /** @internal */
  _id: number;
  /** @internal */
  _pxController: any = null;

  private _physXPhysics: PhysXPhysics;
  private _scene: PhysXPhysicsScene | null = null;
  private _pxMaterial: any;
  private _isBox = false;
  private _radius = 0.5;
  private _height = 1;
  private _halfExtents: Vector3;
  private _center = new Vector3();
  private _worldPosition = new Vector3();
  private _contactOffset = 0.02;
  private _collisionLayer = 0;
  private _isSceneQuery = true;
  private _detectCollisions = true;
  private _stepOffset = 0.5;
  private _climbingMode = ControllerClimbingMode.Constrained;
  private _nonWalkableMode = 0;
  private _upDirection = new Vector3(0, 1, 0);
  private _slopeLimit = Math.SQRT1_2;
  private _invisibleWallHeight = 0;
  private _maxJumpHeight = 0;

  constructor(physXPhysics: PhysXPhysics, uniqueID: number, material: PhysXPhysicsMaterial) {
    this._physXPhysics = physXPhysics;
    this._id = uniqueID;
    this._pxMaterial = material._pxMaterial;
  }

  /**
   * {@inheritDoc ICharacterController.setCapsule }
   */
  setCapsule(radius: number, height: number, stepOffset: number): void {
    radius = Math.fround(radius);
    height = Math.fround(height);
    const maxStepOffset = Math.fround(height + 2 * radius);
    const controller = this._syncStepOffset(stepOffset, maxStepOffset, false);
    if (controller) {
      if (radius !== this._radius) controller.setRadius(radius);
      if (height !== this._height) controller.setHeight(height);
    }
    this._isBox = false;
    this._radius = radius;
    this._height = height;
    if (!controller) this._rebuild();
  }

  /**
   * {@inheritDoc ICharacterController.setBox }
   */
  setBox(halfExtents: Vector3, stepOffset: number): void {
    const size = (this._halfExtents ||= new Vector3());
    const x = Math.fround(halfExtents.x);
    const y = Math.fround(halfExtents.y);
    const z = Math.fround(halfExtents.z);
    const controller = this._syncStepOffset(stepOffset, 2 * y, true);
    if (controller) {
      if (y !== size.y) controller.setHalfHeight(y);
      if (x !== size.x) controller.setHalfSideExtent(x);
      if (z !== size.z) controller.setHalfForwardExtent(z);
    }
    this._isBox = true;
    size.set(x, y, z);
    if (!controller) this._rebuild();
  }

  /**
   * {@inheritDoc ICharacterController.setContactOffset }
   */
  setContactOffset(offset: number): void {
    this._contactOffset = offset;
    this._pxController?.setContactOffset(offset);
  }

  /**
   * {@inheritDoc ICharacterController.setMaterial }
   */
  setMaterial(material: PhysXPhysicsMaterial): void {
    const pxMaterial = material._pxMaterial;
    this._pxMaterial = pxMaterial;
    this._pxController?.setMaterial(pxMaterial);
  }

  /**
   * {@inheritDoc ICharacterController.setCollisionLayer }
   */
  setCollisionLayer(layer: number): void {
    this._collisionLayer = layer;
    const controller = this._pxController;
    if (controller) {
      const actor = controller.getActor();
      this._physXPhysics._physX.setGroup(actor, layer);
      actor.delete();
    }
  }

  /**
   * {@inheritDoc ICharacterController.setIsSceneQuery }
   */
  setIsSceneQuery(value: boolean): void {
    this._isSceneQuery = value;
    this._pxController?.setSceneQueryEnabled(value);
  }

  /** {@inheritDoc ICharacterController.setDetectCollisions} */
  setDetectCollisions(value: boolean): void {
    this._detectCollisions = value;
    this._pxController?.setDetectCollisions(value);
  }

  /**
   * {@inheritDoc ICharacterController.move }
   */
  move(
    disp: Vector3,
    minDist: number,
    elapsedTime: number,
    outHits?: IControllerMoveHits,
    layerMask: number = Layer.Everything,
    excludedShapeIds?: readonly number[]
  ): number {
    const controller = this._pxController;
    const mask = layerMask >>> 0;
    const filtered = mask !== Layer.Everything || excludedShapeIds?.length;
    const collectHits = outHits !== undefined;
    const flags =
      (filtered
        ? controller?.moveWithFilter(disp, minDist, elapsedTime, collectHits, mask, excludedShapeIds)
        : controller?.move(disp, minDist, elapsedTime, collectHits)) ?? 0;
    if (outHits) {
      outHits.count = 0;
      const values: Float64Array | null = controller && this._physXPhysics._physX.getControllerMoveHits();
      if (values) {
        const hits = outHits.hits;
        for (let i = 1, end = values[0]; i < end; i += 11) {
          const index = outHits.count++;
          const hit = (hits[index] ||= {
            colliderId: 0,
            point: new Vector3(),
            normal: new Vector3(),
            moveDirection: new Vector3(),
            moveLength: 0
          });
          hit.colliderId = values[i];
          hit.point.set(values[i + 1], values[i + 2], values[i + 3]);
          hit.normal.set(values[i + 4], values[i + 5], values[i + 6]);
          hit.moveDirection.set(values[i + 7], values[i + 8], values[i + 9]);
          hit.moveLength = values[i + 10];
        }
      }
    }
    return flags;
  }

  /**
   * {@inheritDoc ICharacterController.resize }
   */
  resize(height: number, stepOffset: number): boolean {
    const controller = this._pxController;
    if (!controller) return false;
    height = Math.fround(height);
    const box = this._isBox;
    const maximum = box ? 2 * height : Math.fround(height + 2 * this._radius);
    this._syncStepOffset(stepOffset, maximum, box);
    controller.resize(height);
    if (box) this._halfExtents.y = height;
    else this._height = height;
    this._applyControllerTarget(controller);
    return true;
  }

  /**
   * {@inheritDoc ICharacterController.getFootPosition }
   */
  getFootPosition(out: Vector3): boolean {
    const controller = this._pxController;
    if (!controller) return false;
    controller.getFootPosition(out);
    return true;
  }

  /**
   * {@inheritDoc ICharacterController.setFootPosition }
   */
  setFootPosition(position: Vector3): boolean {
    const controller = this._pxController;
    if (!controller?.setFootPosition(position)) return false;
    this._applyControllerTarget(controller);
    return true;
  }

  /**
   * {@inheritDoc ICharacterController.setWorldPosition }
   */
  setWorldPosition(position: Vector3, center: Vector3): void {
    this._worldPosition.copyFrom(position);
    this._center.copyFrom(center);
    const controller = this._pxController;
    if (controller) {
      const posePosition = PhysXCharacterController._tempVec;
      Vector3.add(position, center, posePosition);
      this._syncControllerPose(controller, posePosition);
    }
  }

  /**
   * {@inheritDoc ICharacterController.getWorldPosition }
   */
  getWorldPosition(position: Vector3): void {
    const pxController = this._pxController;
    if (pxController) {
      this._worldPosition.copyFrom(pxController.getPosition()).subtract(this._center);
    }
    position.copyFrom(this._worldPosition);
  }

  /**
   * {@inheritDoc ICharacterController.setNonWalkableMode }
   */
  setNonWalkableMode(flag: number): void {
    this._nonWalkableMode = flag;
    this._pxController?.setNonWalkableMode(flag);
  }

  /**
   * {@inheritDoc ICharacterController.setClimbingMode }
   */
  setClimbingMode(mode: number): void {
    this._climbingMode = mode;
    if (!this._isBox) this._pxController?.setClimbingMode(mode);
  }

  /**
   * {@inheritDoc ICharacterController.setUpDirection }
   */
  setUpDirection(up: Vector3): void {
    this._upDirection.copyFrom(up);
    const controller = this._pxController;
    if (controller) {
      controller.setUpDirection(up);
      // Changing the up direction leaves the query proxy at its prior orientation.
      this._syncControllerPose(controller, controller.getPosition());
    }
  }

  /**
   * {@inheritDoc ICharacterController.setSlopeLimit }
   */
  setSlopeLimit(slopeLimit: number): void {
    this._slopeLimit = Math.sin(((90 - slopeLimit) * Math.PI) / 180);
    this._pxController?.setSlopeLimit(this._slopeLimit);
  }

  /** {@inheritDoc ICharacterController.setSlopeWalls } */
  setSlopeWalls(wallHeight: number, maxJumpHeight: number): void {
    this._invisibleWallHeight = wallHeight;
    this._maxJumpHeight = maxJumpHeight;
    this._pxController?.setSlopeWalls(wallHeight, maxJumpHeight);
  }

  /**
   * {@inheritDoc ICharacterController.destroy }
   */
  destroy(): void {
    this._scene?.removeCharacterController(this);
  }

  /**
   * @internal
   */
  _addToScene(scene: PhysXPhysicsScene): void {
    this._scene = scene;
    this._createPXController();
  }

  /**
   * @internal
   */
  _removeFromScene(): void {
    this._destroyPXController();
    this._scene = null;
  }

  private _syncStepOffset(offset: number, maximum: number, box: boolean) {
    // PhysX validates the step against the rounded geometry only at creation.
    offset = Math.fround(Math.min(offset, maximum, 3.4028234663852886e38));
    const controller = this._isBox === box ? this._pxController : null;
    if (offset !== this._stepOffset) {
      this._stepOffset = offset;
      controller?.setStepOffset(offset);
    }
    return controller;
  }

  private _rebuild(): void {
    if (this._scene) {
      this.getWorldPosition(this._worldPosition);
      this._destroyPXController();
      this._createPXController();
    }
  }

  private _createPXController(): void {
    const physX = this._physXPhysics._physX;
    const scene = this._scene!;
    let desc: any;
    if (this._isBox) {
      const halfExtents = this._halfExtents;
      desc = new physX.PxBoxControllerDesc();
      desc.halfHeight = halfExtents.y;
      desc.halfSideExtent = halfExtents.x;
      desc.halfForwardExtent = halfExtents.z;
    } else {
      desc = new physX.PxCapsuleControllerDesc();
      desc.radius = this._radius;
      desc.height = this._height;
      const mode = physX.PxCapsuleClimbingMode;
      desc.climbingMode = this._climbingMode === ControllerClimbingMode.Easy ? mode.eEASY : mode.eCONSTRAINED;
    }
    // Set the initial descriptor position so queries see the correct pose before the first step.
    const position = PhysXCharacterController._tempVec;
    Vector3.add(this._worldPosition, this._center, position);
    desc.position = position;
    desc.upDirection = this._upDirection;
    desc.setMaterial(this._pxMaterial);
    desc.contactOffset = this._contactOffset;
    desc.stepOffset = this._stepOffset;
    desc.slopeLimit = this._slopeLimit;
    desc.invisibleWallHeight = this._invisibleWallHeight;
    desc.maxJumpHeight = this._maxJumpHeight;
    desc.setNonWalkableMode(this._nonWalkableMode);
    const pxController = scene._getControllerManager().createController(desc);
    desc.delete();

    if (!pxController) {
      console.error("CharacterController: failed to create the controller, check its geometry and stepOffset.");
      return;
    }
    this._pxController = pxController;
    pxController.setUUID(this._id);
    pxController.setSceneQueryEnabled(this._isSceneQuery);
    if (!this._detectCollisions) pxController.setDetectCollisions(false);
    const actor = pxController.getActor();
    actor.setRigidBodyFlag(physX.PxRigidBodyFlag.eUSE_KINEMATIC_TARGET_FOR_SCENE_QUERIES, true);
    physX.setGroup(actor, this._collisionLayer);
    actor.delete();
    scene._addColliderShape(this._id);
  }

  private _destroyPXController(): void {
    const pxController = this._pxController;
    if (pxController) {
      this._scene!._removeColliderShape(this._id);
      pxController.release();
      this._pxController = null;
    }
  }

  private _syncControllerPose(controller: any, position: Vector3): void {
    if (!controller.setPosition(position)) return;
    this._applyControllerTarget(controller);
  }

  private _applyControllerTarget(controller: any): void {
    // Teleports and resizes move the actor directly instead of sweeping it to the target during simulation.
    const actor = controller.getActor();
    actor.setGlobalPose(actor.getKinematicTarget(), true);
    actor.delete();
  }
}
