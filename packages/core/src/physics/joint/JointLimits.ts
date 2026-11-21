import { DataObject } from "../../base/DataObject";
import { UpdateFlagManager } from "../../UpdateFlagManager";

/**
 * The angular limits and spring settings of a hinge.
 */
export class JointLimits extends DataObject {
  /** @internal */
  _updateFlagManager = new UpdateFlagManager();

  private _max = 0;
  private _min = 0;
  private _contactDistance = -1;
  private _stiffness = 0;
  private _damping = 0;

  /**
   * The upper angular limit in radians.
   * @throws When outside the open interval (-2π, 2π).
   */
  get max(): number {
    return this._max;
  }

  set max(value: number) {
    if (this._max !== value) {
      JointLimits._validateAngle(value);
      this._max = value;
      this._updateFlagManager.dispatch();
    }
  }

  /**
   * The lower angular limit in radians.
   * @throws When outside the open interval (-2π, 2π).
   */
  get min(): number {
    return this._min;
  }

  set min(value: number) {
    if (this._min !== value) {
      JointLimits._validateAngle(value);
      this._min = value;
      this._updateFlagManager.dispatch();
    }
  }

  /**
   * How far inside a hard limit the solver starts enforcing it, in radians.
   * @throws When the value is neither -1 nor a finite, non-negative Float32.
   * @remarks Assign -1 to use 49% of the angular range, capped at 0.1 radians.
   */
  get contactDistance(): number {
    if (this._contactDistance === -1) {
      return Math.min(0.1, 0.49 * Math.max(0, this._max - this._min));
    }
    return this._contactDistance;
  }

  set contactDistance(value: number) {
    if (value !== -1 && !(value >= 0 && Number.isFinite(Math.fround(value)))) {
      throw new Error("JointLimits contactDistance must be -1 or a finite, non-negative Float32.");
    }
    if (this._contactDistance !== value) {
      this._contactDistance = value;
      this._updateFlagManager.dispatch();
    }
  }

  /**
   * The stiffness of the soft angular limits.
   */
  get stiffness(): number {
    return this._stiffness;
  }

  set stiffness(value: number) {
    if (this._stiffness !== value) {
      this._stiffness = value;
      this._updateFlagManager.dispatch();
    }
  }

  /**
   * The damping of the soft angular limits.
   */
  get damping(): number {
    return this._damping;
  }

  set damping(value: number) {
    if (this._damping !== value) {
      this._damping = value;
      this._updateFlagManager.dispatch();
    }
  }

  private static _validateAngle(value: number): void {
    if (!(Math.abs(Math.fround(value)) < Math.fround(2 * Math.PI))) {
      throw new Error("JointLimits angles must be strictly between -2π and 2π radians.");
    }
  }
}
