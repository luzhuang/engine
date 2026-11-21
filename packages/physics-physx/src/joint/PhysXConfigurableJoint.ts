import { IConfigurableJoint } from "@galacean/engine-design";
import { Quaternion, Vector3 } from "@galacean/engine";
import { PhysXCollider } from "../PhysXCollider";
import { PhysXPhysics } from "../PhysXPhysics";
import { PhysXConstraintFlag, PhysXJoint } from "./PhysXJoint";

export class PhysXConfigurableJoint extends PhysXJoint implements IConfigurableJoint {
  constructor(physics: PhysXPhysics, collider: PhysXCollider) {
    super(physics);
    this._collider = collider;
    this._pxJoint = physics._pxPhysics.createD6Joint(
      collider._pxActor,
      PhysXJoint._defaultVec,
      PhysXJoint._defaultQuat,
      null,
      PhysXJoint._defaultVec,
      PhysXJoint._defaultQuat
    );
    this._pxJoint.setConstraintFlag(PhysXConstraintFlag.DriveLimitsAreForces, true);
  }

  setMotion(axis: number, motion: number): void {
    this._pxJoint.setMotion(axis, motion);
  }

  setLinearLimit(axis: number, lower: number, upper: number, stiffness: number, damping: number): void {
    this._pxJoint.setLinearLimit(axis, lower, upper, stiffness, damping);
  }

  setTwistLimit(lower: number, upper: number, stiffness: number, damping: number): void {
    this._pxJoint.setTwistLimit(lower, upper, stiffness, damping);
  }

  setSwingLimit(y: number, z: number, stiffness: number, damping: number): void {
    this._pxJoint.setSwingLimit(y, z, stiffness, damping);
  }

  setDrive(drive: number, stiffness: number, damping: number, forceLimit: number, acceleration: boolean): void {
    this._pxJoint.setDrive(drive, stiffness, damping, forceLimit, acceleration);
  }

  setDrivePosition(position: Vector3, rotation: Quaternion): void {
    this._pxJoint.setDrivePosition(position, rotation);
  }

  setDriveVelocity(linear: Vector3, angular: Vector3): void {
    this._pxJoint.setDriveVelocity(linear, angular);
  }
}
