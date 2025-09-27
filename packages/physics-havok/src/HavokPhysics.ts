import { Quaternion, Vector3 } from "@galacean/engine";
import {
  IBoxColliderShape,
  ICapsuleColliderShape,
  ICharacterController,
  ICollider,
  ICollision,
  IDynamicCollider,
  IFixedJoint,
  IHingeJoint,
  IPhysics,
  IPhysicsManager,
  IPhysicsMaterial,
  IPhysicsScene,
  IPlaneColliderShape,
  ISphereColliderShape,
  ISpringJoint,
  IStaticCollider
} from "@galacean/engine-design";

/**
 * Placeholder implementation of the {@link IPhysics} interface backed by Havok.
 *
 * The actual Havok runtime binding is expected to be provided by host applications.
 * Until that happens every factory method will throw to highlight the missing integration
 * rather than failing silently at runtime.
 */
export class HavokPhysics implements IPhysics {
  private readonly _message =
    "Havok physics runtime has not been integrated yet. Make sure the native bindings are available.";

  /** @inheritdoc */
  async initialize(): Promise<void> {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createPhysicsManager(): IPhysicsManager {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createPhysicsScene(
    _physicsManager: IPhysicsManager,
    _onContactEnter?: (collision: ICollision) => void,
    _onContactExit?: (collision: ICollision) => void,
    _onContactStay?: (collision: ICollision) => void,
    _onTriggerEnter?: (obj1: number, obj2: number) => void,
    _onTriggerExit?: (obj1: number, obj2: number) => void,
    _onTriggerStay?: (obj1: number, obj2: number) => void
  ): IPhysicsScene {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createDynamicCollider(_position: Vector3, _rotation: Quaternion): IDynamicCollider {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createStaticCollider(_position: Vector3, _rotation: Quaternion): IStaticCollider {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createCharacterController(): ICharacterController {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createPhysicsMaterial(
    _staticFriction: number,
    _dynamicFriction: number,
    _bounciness: number,
    _frictionCombine: number,
    _bounceCombine: number
  ): IPhysicsMaterial {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createBoxColliderShape(
    _uniqueID: number,
    _size: Vector3,
    _material: IPhysicsMaterial
  ): IBoxColliderShape {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createSphereColliderShape(
    _uniqueID: number,
    _radius: number,
    _material: IPhysicsMaterial
  ): ISphereColliderShape {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createPlaneColliderShape(_uniqueID: number, _material: IPhysicsMaterial): IPlaneColliderShape {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createCapsuleColliderShape(
    _uniqueID: number,
    _radius: number,
    _height: number,
    _material: IPhysicsMaterial
  ): ICapsuleColliderShape {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createFixedJoint(_collider: ICollider): IFixedJoint {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createHingeJoint(_collider: ICollider): IHingeJoint {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  createSpringJoint(_collider: ICollider): ISpringJoint {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  getColliderLayerCollision(_layer1: number, _layer2: number): boolean {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  setColliderLayerCollision(_layer1: number, _layer2: number, _isCollide: boolean): void {
    throw new Error(this._message);
  }

  /** @inheritdoc */
  destroy(): void {
    // Nothing to clean up for the placeholder implementation.
  }
}
