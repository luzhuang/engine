import { DataObject } from "../../base/DataObject";
import { UpdateFlagManager } from "../../UpdateFlagManager";

/**
 * Velocity motor settings for a hinge.
 */
export class JointMotor extends DataObject {
  /** @internal */
  _updateFlagManager = new UpdateFlagManager();

  private _targetVelocity = 0;
  private _forceLimit = Number.MAX_VALUE;
  private _gearRatio = 1.0;
  private _freeSpin = false;

  /**
   * The target angular velocity in radians per second that the motor tries to achieve.
   */
  get targetVelocity(): number {
    return this._targetVelocity;
  }

  set targetVelocity(value: number) {
    if (this._targetVelocity !== value) {
      this._targetVelocity = value;
      this._updateFlagManager.dispatch();
    }
  }

  /**
   * The maximum motor torque, in newton-metres.
   */
  get forceLimit(): number {
    return this._forceLimit;
  }

  set forceLimit(value: number) {
    if (this._forceLimit !== value) {
      this._forceLimit = value;
      this._updateFlagManager.dispatch();
    }
  }

  /**
   * The motor's gear ratio.
   */
  get gearRatio(): number {
    return this._gearRatio;
  }

  set gearRatio(value: number) {
    if (this._gearRatio !== value) {
      this._gearRatio = value;
      this._updateFlagManager.dispatch();
    }
  }

  /**
   * If freeSpin is enabled the motor will only accelerate but never slow down.
   */
  get freeSpin(): boolean {
    return this._freeSpin;
  }

  set freeSpin(value: boolean) {
    if (this._freeSpin !== value) {
      this._freeSpin = value;
      this._updateFlagManager.dispatch();
    }
  }
}
