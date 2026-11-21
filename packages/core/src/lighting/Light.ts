import { Color, MathUtil, Matrix, Vector3 } from "@galacean/engine-math";
import { Component } from "../Component";
import { Layer } from "../Layer";
import { ignoreClone } from "../clone/CloneDecorators";
import { ShadowType } from "../shadow";

/**
 * Light base class.
 */
export abstract class Light extends Component {
  protected static _tempPosition: Vector3;
  private static _tempDirection: Vector3;

  /**
   * Culling mask - which layers the light affect.
   * @remarks Support bit manipulation, corresponding to `Layer`.
   */
  cullingMask = Layer.Everything;

  /** How this light casts shadows. */
  shadowType = ShadowType.None;
  /** Shadow bias.*/
  shadowBias = 1;
  /** Shadow mapping normal-based bias. */
  shadowNormalBias = 1;

  /**
   * @deprecated
   * Please use `shadowNearPlaneOffset` instead.
   */
  shadowNearPlane = 0.1;

  /** @internal */
  @ignoreClone
  _lightIndex = -1;

  private _shadowStrength = 1.0;
  private _color = new Color(1, 1, 1, 1);
  @ignoreClone
  private _viewMat: Matrix;
  @ignoreClone
  private _inverseViewMat: Matrix;

  /** Shadow intensity, the larger the value, the clearer and darker the shadow, range [0,1]. */
  get shadowStrength(): number {
    return this._shadowStrength;
  }

  set shadowStrength(value: number) {
    this._shadowStrength = MathUtil.clamp(value, 0, 1);
  }

  /**
   * Light Color.
   */
  get color(): Color {
    return this._color;
  }

  set color(value: Color) {
    if (this._color !== value) {
      this._color.copyFrom(value);
    }
  }

  /**
   * View matrix.
   */
  get viewMatrix(): Matrix {
    if (!this._viewMat) this._viewMat = new Matrix();
    Matrix.invert(this.entity.transform.worldMatrix, this._viewMat);
    return this._viewMat;
  }

  /**
   * Inverse view matrix.
   */
  get inverseViewMatrix(): Matrix {
    if (!this._inverseViewMat) this._inverseViewMat = new Matrix();
    Matrix.invert(this.viewMatrix, this._inverseViewMat);
    return this._inverseViewMat;
  }

  protected static _matrixForward(
    elements: Float32Array,
    out: Vector3 = (Light._tempDirection ||= new Vector3())
  ): Vector3 {
    return out.set(-elements[8], -elements[9], -elements[10]).normalize();
  }
}
