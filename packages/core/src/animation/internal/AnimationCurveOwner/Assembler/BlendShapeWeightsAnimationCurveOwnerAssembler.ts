import { SkinnedMeshRenderer } from "../../../../mesh";
import { KeyframeTangentType, KeyframeValueType } from "../../../KeyFrame";
import { AnimationCurveOwner } from "../AnimationCurveOwner";
import { IAnimationCurveOwnerAssembler } from "./IAnimationCurveOwnerAssembler";

/**
 * @internal
 */
export class BlendShapeWeightsAnimationCurveOwnerAssembler implements IAnimationCurveOwnerAssembler<Float32Array> {
  private _skinnedMeshRenderer: SkinnedMeshRenderer;

  initialize(owner: AnimationCurveOwner<KeyframeTangentType, KeyframeValueType>): void {
    this._skinnedMeshRenderer = owner.target.getComponent(SkinnedMeshRenderer);
  }

  getTargetValue(): Float32Array {
    return this._skinnedMeshRenderer.blendShapeWeights;
  }

  setTargetValue(value: Float32Array): void {
    this._skinnedMeshRenderer.blendShapeWeights = value;
  }
}

AnimationCurveOwner._registerAssembler(
  SkinnedMeshRenderer,
  "blendShapeWeights",
  BlendShapeWeightsAnimationCurveOwnerAssembler
);