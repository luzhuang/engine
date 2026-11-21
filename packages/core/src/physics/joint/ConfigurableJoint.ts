import { IConfigurableJoint, IDynamicCollider } from "@galacean/engine-design";
import { Quaternion, Vector3 } from "@galacean/engine-math";
import { deepClone } from "../../clone/CloneDecorators";
import { Engine } from "../../Engine";
import { Joint } from "./Joint";

/** The translation and rotation axes of a configurable joint. */
export enum ConfigurableJointAxis {
  X,
  Y,
  Z,
  Twist,
  SwingY,
  SwingZ
}

/** The motion allowed along or around a configurable joint axis. */
export enum ConfigurableJointMotion {
  Locked,
  Limited,
  Free
}

/** The axis or angular model driven by a configurable joint. */
export enum ConfigurableJointDrive {
  X,
  Y,
  Z,
  Swing,
  Twist,
  Slerp
}

type Limit = [lower: number, upper: number, stiffness: number, damping: number];
type Drive = [stiffness: number, damping: number, forceLimit: number, acceleration: boolean];

/**
 * A joint with independently constrained linear and angular motion.
 * @remarks Axes and drive targets are relative to the owning body's joint frame. All axes are locked by default.
 */
export class ConfigurableJoint extends Joint {
  @deepClone
  private _motions: ConfigurableJointMotion[] = [];
  @deepClone
  private _linearLimits: Limit[] = [];
  @deepClone
  private _twistLimit: Limit | null = null;
  @deepClone
  private _swingLimit: Limit | null = null;
  @deepClone
  private _drives: Drive[] = [];
  private _position = new Vector3();
  private _rotation = new Quaternion();
  private _linearVelocity = new Vector3();
  private _angularVelocity = new Vector3();

  /**
   * Reads the configured motion for one axis.
   * @param axis - The linear or angular axis
   * @returns The configured motion
   */
  getMotion(axis: ConfigurableJointAxis): ConfigurableJointMotion {
    return this._motions[axis] ?? ConfigurableJointMotion.Locked;
  }

  /**
   * Locks, limits, or frees one axis.
   * @param axis - The linear or angular axis
   * @param motion - The motion to allow
   */
  setMotion(axis: ConfigurableJointAxis, motion: ConfigurableJointMotion): void {
    if (!Number.isInteger(axis) || axis < ConfigurableJointAxis.X || axis > ConfigurableJointAxis.SwingZ) {
      throw new Error("Invalid configurable joint axis.");
    }
    if (!Number.isInteger(motion) || motion < ConfigurableJointMotion.Locked || motion > ConfigurableJointMotion.Free) {
      throw new Error("Invalid configurable joint motion.");
    }
    this._motions[axis] = motion;
    if (this._nativeJoint) {
      (<IConfigurableJoint>this._nativeJoint).setMotion(axis, motion);
      this._wakeBodies();
    }
  }

  /**
   * Sets the range of a limited linear axis.
   * @param axis - The X, Y, or Z axis
   * @param lower - Lower displacement in world length units
   * @param upper - Upper displacement in world length units
   * @param stiffness - Limit spring stiffness
   * @param damping - Limit spring damping
   * @remarks Zero stiffness and damping produce a hard limit.
   */
  setLinearLimit(
    axis: ConfigurableJointAxis.X | ConfigurableJointAxis.Y | ConfigurableJointAxis.Z,
    lower: number,
    upper: number,
    stiffness = 0,
    damping = 0
  ): void {
    if (!Number.isInteger(axis) || axis < ConfigurableJointAxis.X || axis > ConfigurableJointAxis.Z) {
      throw new Error("Linear limits require the X, Y, or Z axis.");
    }
    ConfigurableJoint._validateRange(lower, upper, Infinity, stiffness, damping);
    this._linearLimits[axis] = [lower, upper, stiffness, damping];
    if (this._nativeJoint) {
      (<IConfigurableJoint>this._nativeJoint).setLinearLimit(axis, lower, upper, stiffness, damping);
      this._wakeBodies();
    }
  }

  /**
   * Sets the range of rotation around X when twist motion is limited.
   * @param lower - Lower angle in radians, greater than -2π
   * @param upper - Upper angle in radians, less than 2π
   * @param stiffness - Limit spring stiffness
   * @param damping - Limit spring damping
   */
  setTwistLimit(lower: number, upper: number, stiffness = 0, damping = 0): void {
    ConfigurableJoint._validateRange(lower, upper, Math.fround(2 * Math.PI), stiffness, damping);
    this._twistLimit = [lower, upper, stiffness, damping];
    if (this._nativeJoint) {
      (<IConfigurableJoint>this._nativeJoint).setTwistLimit(lower, upper, stiffness, damping);
      this._wakeBodies();
    }
  }

  /**
   * Sets the symmetric swing limits around Y and Z.
   * @param y - Maximum Y swing in radians, between 0 and π
   * @param z - Maximum Z swing in radians, between 0 and π
   * @param stiffness - Limit spring stiffness
   * @param damping - Limit spring damping
   * @remarks When both swing axes are limited, the angles bound an elliptical cone.
   */
  setSwingLimit(y: number, z: number, stiffness = 0, damping = 0): void {
    if (
      !(
        Math.fround(y) > 0 &&
        Math.fround(y) < Math.fround(Math.PI) &&
        Math.fround(z) > 0 &&
        Math.fround(z) < Math.fround(Math.PI)
      )
    ) {
      throw new Error("Swing limits must be strictly between 0 and π radians.");
    }
    ConfigurableJoint._validateSpring(stiffness, damping);
    this._swingLimit = [y, z, stiffness, damping];
    if (this._nativeJoint) {
      (<IConfigurableJoint>this._nativeJoint).setSwingLimit(y, z, stiffness, damping);
      this._wakeBodies();
    }
  }

  /**
   * Sets a damped spring drive for a linear axis or an angular drive model.
   * @param drive - The axis or angular drive model to configure
   * @param stiffness - Strength of the drive towards the target pose
   * @param damping - Strength of the drive towards the target velocity
   * @param forceLimit - Maximum force or torque the drive can apply
   * @param acceleration - Whether drive strength controls acceleration independently of body mass
   * @remarks A drive has no effect on a locked axis. SLERP requires all three angular axes to be unlocked and takes precedence over swing and twist.
   */
  setDrive(
    drive: ConfigurableJointDrive,
    stiffness: number,
    damping: number,
    forceLimit = Infinity,
    acceleration = false
  ): void {
    if (!Number.isInteger(drive) || drive < ConfigurableJointDrive.X || drive > ConfigurableJointDrive.Slerp) {
      throw new Error("Invalid configurable joint drive.");
    }
    ConfigurableJoint._validateSpring(stiffness, damping);
    if (!(forceLimit >= 0)) {
      throw new Error("Drive force limit must be non-negative.");
    }
    this._drives[drive] = [stiffness, damping, forceLimit, acceleration];
    if (this._nativeJoint) {
      (<IConfigurableJoint>this._nativeJoint).setDrive(drive, stiffness, damping, forceLimit, acceleration);
      this._wakeBodies();
    }
  }

  /**
   * Sets the drive's target pose in the owning body's joint frame.
   * @param position - Target position
   * @param rotation - Target rotation as a normalized quaternion
   */
  setDrivePosition(position: Vector3, rotation: Quaternion): void {
    ConfigurableJoint._validateVector(position);
    if (!(Math.abs(rotation.lengthSquared() - 1) < 0.001)) {
      throw new Error("Joint drive rotation must be a normalized quaternion.");
    }
    this._position.copyFrom(position);
    this._rotation.copyFrom(rotation);
    if (this._nativeJoint) {
      (<IConfigurableJoint>this._nativeJoint).setDrivePosition(position, rotation);
      this._wakeBodies();
    }
  }

  /**
   * Sets the drive's target velocity in the owning body's joint frame.
   * @param linear - Linear velocity in world length units per second
   * @param angular - Angular velocity in radians per second
   */
  setDriveVelocity(linear: Vector3, angular: Vector3): void {
    ConfigurableJoint._validateVector(linear);
    ConfigurableJoint._validateVector(angular);
    this._linearVelocity.copyFrom(linear);
    this._angularVelocity.copyFrom(angular);
    if (this._nativeJoint) {
      (<IConfigurableJoint>this._nativeJoint).setDriveVelocity(linear, angular);
      this._wakeBodies();
    }
  }

  protected override _createJoint(actor: IDynamicCollider): IConfigurableJoint {
    return Engine._nativePhysics.createConfigurableJoint(actor);
  }

  protected override _syncNative(): void {
    super._syncNative();
    const joint = <IConfigurableJoint>this._nativeJoint;
    this._motions.forEach((motion, axis) => joint.setMotion(axis, motion));
    this._linearLimits.forEach((limit, axis) => joint.setLinearLimit(axis, ...limit));
    if (this._twistLimit) joint.setTwistLimit(...this._twistLimit);
    if (this._swingLimit) joint.setSwingLimit(...this._swingLimit);
    this._drives.forEach((drive, axis) => joint.setDrive(axis, ...drive));
    joint.setDrivePosition(this._position, this._rotation);
    joint.setDriveVelocity(this._linearVelocity, this._angularVelocity);
  }

  private static _validateRange(lower: number, upper: number, limit: number, stiffness: number, damping: number): void {
    if (!(lower <= upper && Math.fround(lower) > -limit && Math.fround(upper) < limit)) {
      throw new Error("Invalid configurable joint limit range.");
    }
    ConfigurableJoint._validateSpring(stiffness, damping);
  }

  private static _validateSpring(stiffness: number, damping: number): void {
    if (
      !(
        stiffness >= 0 &&
        damping >= 0 &&
        Number.isFinite(Math.fround(stiffness)) &&
        Number.isFinite(Math.fround(damping))
      )
    ) {
      throw new Error("Joint stiffness and damping must be finite and non-negative.");
    }
  }

  private static _validateVector(vector: Vector3): void {
    if (
      !(
        Number.isFinite(Math.fround(vector.x)) &&
        Number.isFinite(Math.fround(vector.y)) &&
        Number.isFinite(Math.fround(vector.z))
      )
    ) {
      throw new Error("Joint drive vectors must have finite components.");
    }
  }
}
