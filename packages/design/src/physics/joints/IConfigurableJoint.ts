import { Quaternion, Vector3 } from "@galacean/engine-math";
import { IJoint } from "./IJoint";

/** Native six-axis joint configuration. */
export interface IConfigurableJoint extends IJoint {
  setMotion(axis: number, motion: number): void;
  setLinearLimit(axis: number, lower: number, upper: number, stiffness: number, damping: number): void;
  setTwistLimit(lower: number, upper: number, stiffness: number, damping: number): void;
  setSwingLimit(y: number, z: number, stiffness: number, damping: number): void;
  setDrive(drive: number, stiffness: number, damping: number, forceLimit: number, acceleration: boolean): void;
  setDrivePosition(position: Vector3, rotation: Quaternion): void;
  setDriveVelocity(linear: Vector3, angular: Vector3): void;
}
