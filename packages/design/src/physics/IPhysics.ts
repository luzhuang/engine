import { Quaternion, Vector3 } from "@galacean/engine-math";
import { ICharacterController } from "./ICharacterController";
import { ICollider } from "./ICollider";
import { IDynamicCollider } from "./IDynamicCollider";
import { IPhysicsMaterial, IPhysicsMaterialProperties } from "./IPhysicsMaterial";
import { IPhysicsScene, PhysicsSceneOptions } from "./IPhysicsScene";
import { IStaticCollider } from "./IStaticCollider";
import { IConfigurableJoint, IFixedJoint, IHingeJoint, ISpringJoint } from "./joints";
import {
  IBoxColliderShape,
  ICapsuleColliderShape,
  IHeightFieldColliderShape,
  IMeshColliderShape,
  IMeshColliderSource,
  IPlaneColliderShape,
  ISphereColliderShape
} from "./shape";

/**
 * Creates and configures objects for the physics backend.
 */
export interface IPhysics {
  /**
   * Initialize physics.
   * @returns A promise that will resolve when the physics is initialized
   */
  initialize(): Promise<void>;

  /**
   * Create a native simulation scene.
   */
  createPhysicsScene(options?: PhysicsSceneOptions): IPhysicsScene;

  /**
   * Create dynamic collider.
   * @param position - The global position
   * @param rotation - The global rotation
   */
  createDynamicCollider(position: Vector3, rotation: Quaternion): IDynamicCollider;

  /**
   * Create static collider.
   * @param position - The global position
   * @param rotation - The global rotation
   */
  createStaticCollider(position: Vector3, rotation: Quaternion): IStaticCollider;

  /**
   * Create a character controller for later insertion into a scene.
   * @param uniqueID - The collider ID reported by queries and events
   * @param material - The controller material
   */
  createCharacterController(uniqueID: number, material: IPhysicsMaterial): ICharacterController;

  /**
   * Create physics material.
   * @param properties - Physics material properties
   */
  createPhysicsMaterial(properties: IPhysicsMaterialProperties): IPhysicsMaterial;

  /**
   * Create a box collider shape.
   * @param uniqueID - The collider ID reported by queries and events
   * @param halfExtents - Half the size along each box axis, with entity scale applied
   * @param material - The material of this shape
   */
  createBoxColliderShape(uniqueID: number, halfExtents: Vector3, material: IPhysicsMaterial): IBoxColliderShape;

  /**
   * Create a sphere collider shape.
   * @param uniqueID - The collider ID reported by queries and events
   * @param radius - The radius with entity scale applied
   * @param material - The material of this shape
   */
  createSphereColliderShape(uniqueID: number, radius: number, material: IPhysicsMaterial): ISphereColliderShape;

  /**
   * Create a plane collider shape.
   * @param uniqueID - The collider ID reported by queries and events
   * @param material - The material of this shape
   */
  createPlaneColliderShape(uniqueID: number, material: IPhysicsMaterial): IPlaneColliderShape;

  /**
   * Create a capsule collider shape.
   * @param uniqueID - The collider ID reported by queries and events
   * @param radius - The radius with entity scale applied
   * @param halfHeight - Half the cylindrical height, with entity scale applied
   * @param material - The material of this shape
   * @param upAxis - The local up axis
   */
  createCapsuleColliderShape(
    uniqueID: number,
    radius: number,
    halfHeight: number,
    material: IPhysicsMaterial,
    upAxis: number
  ): ICapsuleColliderShape;

  /**
   * Cook source mesh data and create a collider shape.
   * @param uniqueID - The collider ID reported by queries and events
   * @param source - Committed mesh-local positions and optional triangle indices
   * @param isConvex - Whether to create convex mesh (true) or triangle mesh (false)
   * @param material - The material of this shape
   * @param cookingFlags - Cooking flags
   * @param scale - The signed world scale applied to the cooked mesh
   * @returns The shape, or null if mesh cooking or shape creation fails
   */
  createMeshColliderShape(
    uniqueID: number,
    source: IMeshColliderSource,
    isConvex: boolean,
    material: IPhysicsMaterial,
    cookingFlags: number,
    scale: Vector3
  ): IMeshColliderShape | null;

  /** Cooks a row-major grid and creates a shape with X, Y, and Z sample scales. */
  createHeightFieldColliderShape(
    uniqueID: number,
    heights: Int16Array,
    rows: number,
    columns: number,
    scale: Vector3,
    material: IPhysicsMaterial
  ): IHeightFieldColliderShape | null;

  /**
   * Create fixed joint.
   * @param collider - collider of joint
   */
  createFixedJoint(collider: ICollider): IFixedJoint;

  /**
   * Create hinge joint.
   * @param collider - collider of joint
   */
  createHingeJoint(collider: ICollider): IHingeJoint;

  /** Creates a configurable joint for the owning collider. */
  createConfigurableJoint(collider: ICollider): IConfigurableJoint;

  /**
   * Create spring joint
   * @param collider - collider of joint
   */
  createSpringJoint(collider: ICollider): ISpringJoint;

  /**
   * Release the physics backend.
   */
  destroy(): void;
}
