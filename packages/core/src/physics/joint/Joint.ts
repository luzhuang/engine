import { DataObject } from "../../base/DataObject";
import { IDynamicCollider, IJoint } from "@galacean/engine-design";
import { Matrix, Quaternion, Vector3 } from "@galacean/engine-math";
import { Component } from "../../Component";
import { DependentMode, dependentComponents } from "../../ComponentsDependencies";
import { Entity } from "../../Entity";
import { Scene } from "../../Scene";
import { TransformModifyFlags } from "../../Transform";
import { ignoreClone } from "../../clone/CloneDecorators";
import type { ICloneHook } from "../../clone/ICloneHook";
import { Rigidbody } from "../Rigidbody";

/**
 * A constraint between the Entity's Rigidbody and another body or the world.
 * @decorator `@dependentComponents(Rigidbody, DependentMode.AutoAdd)`
 */
@dependentComponents(Rigidbody, DependentMode.AutoAdd)
export abstract class Joint extends Component implements ICloneHook<Joint> {
  private static _tempVector3 = new Vector3();
  private static _tempQuat = new Quaternion();
  private static _tempMatrix = new Matrix();

  private _bodyInfo = new JointBodyInfo();
  private _connectedBodyInfo = new JointBodyInfo();
  private _connectedBody: Rigidbody | null = null;
  @ignoreClone
  protected _nativeJoint: IJoint | null = null;
  @ignoreClone
  private _breakEventId = 0;
  private _force = Infinity;
  private _torque = Infinity;
  private _enableCollision = false;
  private _enablePreprocessing = true;
  private _automaticConnectedAnchor = true;
  private _connectedAnchorAuthored = false;
  @ignoreClone
  private _calculatedConnectedAnchor: Vector3 | null = null;

  /**
   * The connected Rigidbody, or null to constrain against the world.
   * @remarks With a connected body, the constraint is active only while both bodies are registered in the same scene.
   * Destroying the connected body clears the connection.
   * @throws When assigned a destroyed body, the joint's own body, or a body from another engine.
   */
  get connectedBody(): Rigidbody | null {
    return this._connectedBody;
  }

  set connectedBody(value: Rigidbody | null) {
    if (value) {
      if (value.destroyed) {
        throw new Error("Joint: connectedBody has been destroyed.");
      } else if (value.engine !== this.engine) {
        throw new Error("Joint: connectedBody belongs to another engine.");
      } else if (value.entity === this.entity) {
        throw new Error("Joint: cannot connect a Rigidbody to itself.");
      }
    }
    const preBody = this._connectedBody;
    if (preBody !== value) {
      preBody?.entity._updateFlagManager.removeListener(this._onConnectedTransformChanged);
      preBody?._detachJoint(this);
      value?.entity._updateFlagManager.addListener(this._onConnectedTransformChanged);
      value?._attachJoint(this);
      if (this._nativeJoint) Joint._wakeBody(preBody);
      this._connectedBody = value;
      this._syncActiveJoint();
    }
  }

  /**
   * The anchor in this Entity's local space.
   */
  get anchor(): Vector3 {
    return this._bodyInfo.anchor;
  }

  set anchor(value: Vector3) {
    const anchor = this._bodyInfo.anchor;
    if (value !== anchor) {
      anchor.copyFrom(value);
    }
  }

  /**
   * The anchor in the connected body's local space, or in world space when {@link connectedBody} is null.
   * @remarks Reads the authored value if one was set, otherwise the last calculated anchor.
   * Simulation uses the calculated anchor while {@link automaticConnectedAnchor} is enabled.
   */
  get connectedAnchor(): Vector3 {
    const anchor = this._connectedBodyInfo.anchor;
    if (!this._connectedAnchorAuthored) {
      // A retained reference can still be edited after switching to automatic mode.
      this._calculatedConnectedAnchor ||= anchor.clone();
    }
    return anchor;
  }

  set connectedAnchor(value: Vector3) {
    const anchor = this.connectedAnchor;
    if (value !== anchor) {
      anchor.copyFrom(value);
    }
  }

  /**
   * Whether the connected anchor automatically matches the world position of {@link anchor}.
   * @remarks Disabling uses the authored connected anchor if available, or keeps the calculated one.
   */
  get automaticConnectedAnchor(): boolean {
    return this._automaticConnectedAnchor;
  }

  set automaticConnectedAnchor(value: boolean) {
    if (value) {
      this._automaticConnectedAnchor = true;
      this._calculateConnectedAnchor();
    } else if (this._automaticConnectedAnchor) {
      this._automaticConnectedAnchor = false;
      if (this._connectedAnchorAuthored) this._updateActualAnchor(AnchorOwner.Connected);
    }
  }

  /**
   * The multiplier for the connected body’s inverse mass and inverse inertia during constraint solving.
   * @throws When the value is not a positive, finite Float32.
   */
  get connectedMassScale(): number {
    return this._connectedBodyInfo.massScale;
  }

  set connectedMassScale(value: number) {
    const nativeScale = Math.fround(value);
    if (!(nativeScale > 0 && Number.isFinite(nativeScale))) {
      throw new Error("Joint connectedMassScale must be a positive, finite Float32.");
    }
    if (value !== this._connectedBodyInfo.massScale) {
      this._connectedBodyInfo.massScale = value;
      this._nativeJoint?.setConnectedMassScale(value);
      if (this._nativeJoint) {
        this._wakeBodies();
      }
    }
  }

  /**
   * The multiplier for this body’s inverse mass and inverse inertia during constraint solving.
   * @throws When the value is not a positive, finite Float32.
   */
  get massScale(): number {
    return this._bodyInfo.massScale;
  }

  set massScale(value: number) {
    const nativeScale = Math.fround(value);
    if (!(nativeScale > 0 && Number.isFinite(nativeScale))) {
      throw new Error("Joint massScale must be a positive, finite Float32.");
    }
    if (value !== this._bodyInfo.massScale) {
      this._bodyInfo.massScale = value;
      this._nativeJoint?.setMassScale(value);
      if (this._nativeJoint) {
        this._wakeBodies();
      }
    }
  }

  /**
   * Whether the two connected bodies can collide with each other.
   * @defaultValue false
   */
  get enableCollision(): boolean {
    return this._enableCollision;
  }

  set enableCollision(value: boolean) {
    if (this._enableCollision !== value) {
      this._enableCollision = value;
      if (this._nativeJoint) {
        this._nativeJoint.setEnableCollision(value);
        this._wakeBodies();
      }
    }
  }

  /**
   * Whether the solver preprocesses the constraint.
   * @defaultValue true
   */
  get enablePreprocessing(): boolean {
    return this._enablePreprocessing;
  }

  set enablePreprocessing(value: boolean) {
    if (this._enablePreprocessing !== value) {
      this._enablePreprocessing = value;
      if (this._nativeJoint) {
        this._nativeJoint.setEnablePreprocessing(value);
        this._wakeBodies();
      }
    }
  }

  /**
   * The maximum force the joint can apply before breaking.
   */
  get breakForce(): number {
    return this._force;
  }

  set breakForce(value: number) {
    if (value !== this._force) {
      this._force = value;
      this._nativeJoint?.setBreakForce(value);
    }
  }

  /**
   * The maximum torque the joint can apply before breaking.
   */
  get breakTorque(): number {
    return this._torque;
  }

  set breakTorque(value: number) {
    if (value !== this._torque) {
      this._torque = value;
      this._nativeJoint?.setBreakTorque(value);
    }
  }

  /**
   * Whether the current physics constraint has broken.
   * @remarks Disabling and re-enabling the joint creates a new constraint.
   */
  get isBroken(): boolean {
    return this._nativeJoint?.isBroken() ?? false;
  }

  /**
   * Writes the constraint force and torque from the most recent physics step.
   * @param force - Output vector for force, in newtons
   * @param torque - Output vector for torque, in newton-metres
   * @remarks Both outputs are set to zero while the constraint is inactive.
   */
  getReactionForce(force: Vector3, torque: Vector3): void {
    if (this._nativeJoint) {
      this._nativeJoint.getReactionForce(force, torque);
    } else {
      force.set(0, 0, 0);
      torque.set(0, 0, 0);
    }
  }

  constructor(entity: Entity) {
    super(entity);
    this._onAnchorChanged = this._onAnchorChanged.bind(this);
    this._bodyInfo.anchor._onValueChanged = this._onAnchorChanged;
    this._handleConnectedAnchorChanged = this._handleConnectedAnchorChanged.bind(this);
    this._connectedBodyInfo.anchor._onValueChanged = this._handleConnectedAnchorChanged;

    this._onSelfTransformChanged = this._onSelfTransformChanged.bind(this);
    this._onConnectedTransformChanged = this._onConnectedTransformChanged.bind(this);
    // @ts-ignore
    entity._updateFlagManager.addListener(this._onSelfTransformChanged);
  }

  /**
   * @internal
   */
  override _onEnableInScene(): void {
    this.entity.getComponent(Rigidbody)!._attachJoint(this);
    this._syncActiveJoint();
  }

  /**
   * @internal
   */
  override _onDisableInScene(scene: Scene): void {
    this.entity.getComponent(Rigidbody)!._detachJoint(this);
    this._destroyNativeJoint(scene);
  }

  /**
   * @internal
   */
  _onClone(target: Joint): void {
    const targetAnchor = target._bodyInfo.anchor;
    targetAnchor._onValueChanged = null;
    targetAnchor.copyFrom(this._bodyInfo.anchor);
    targetAnchor._onValueChanged = target._onAnchorChanged;

    const targetConnectedAnchor = target._connectedBodyInfo.anchor;
    targetConnectedAnchor._onValueChanged = null;
    targetConnectedAnchor.copyFrom(this._connectedBodyInfo.anchor);
    targetConnectedAnchor._onValueChanged = target._handleConnectedAnchorChanged;

    const connectedBody = target._connectedBody;
    connectedBody?.entity._updateFlagManager.addListener(target._onConnectedTransformChanged);
    connectedBody?._attachJoint(target);
  }

  /**
   * Clears an authored connection when its target is destroyed.
   * @internal
   */
  _onBodyDestroyed(body: Rigidbody): void {
    if (this._connectedBody === body) this.connectedBody = null;
  }

  /**
   * Reconciles the constraint with both bodies' native scene registrations.
   * @internal
   */
  _syncActiveJoint(): void {
    const scene = this._registeredScene;
    if (!scene) return;
    const bodyActor = this.entity.getComponent(Rigidbody)!._getRegisteredActor(scene);
    const connectedBody = this._connectedBody;
    const connectedActor = connectedBody?._getRegisteredActor(scene) ?? null;
    if (!bodyActor || (connectedBody && !connectedActor)) {
      this._destroyNativeJoint(scene);
      return;
    }
    const nativeJoint = this._nativeJoint;
    if (nativeJoint) {
      nativeJoint.setConnectedCollider(connectedActor);
      this._syncConnectedFrame();
    } else {
      const joint = (this._nativeJoint = this._createJoint(bodyActor));
      this._breakEventId = scene.physics._registerJoint(this);
      joint.setBreakEventId(this._breakEventId);
      if (connectedActor) joint.setConnectedCollider(connectedActor);
      this._syncNative();
    }
  }

  protected override _onDestroy(): void {
    this._bodyInfo.anchor._onValueChanged = null;
    this._connectedBodyInfo.anchor._onValueChanged = null;
    super._onDestroy();
    this.entity._updateFlagManager.removeListener(this._onSelfTransformChanged);
    const connectedBody = this._connectedBody;
    if (connectedBody) {
      connectedBody.entity._updateFlagManager.removeListener(this._onConnectedTransformChanged);
      connectedBody._detachJoint(this);
      this._connectedBody = null;
    }
  }

  protected abstract _createJoint(actor: IDynamicCollider): IJoint;

  /** @internal */
  protected _destroyNativeJoint(scene: Scene): void {
    const nativeJoint = this._nativeJoint;
    if (nativeJoint) {
      scene.physics._unregisterJoint(this._breakEventId);
      nativeJoint.destroy();
      this._nativeJoint = null;
      this._wakeBodies();
    }
  }

  protected _syncNative(): void {
    const nativeJoint = this._nativeJoint!;
    this._updateActualAnchor(AnchorOwner.Self);
    this._syncConnectedFrame();
    nativeJoint.setConnectedMassScale(this._connectedBodyInfo.massScale);
    nativeJoint.setMassScale(this._bodyInfo.massScale);
    nativeJoint.setEnableCollision(this._enableCollision);
    nativeJoint.setEnablePreprocessing(this._enablePreprocessing);
    nativeJoint.setBreakForce(this._force);
    nativeJoint.setBreakTorque(this._torque);
  }

  private _syncConnectedFrame(): void {
    if (this._automaticConnectedAnchor) {
      this._calculateConnectedAnchor();
    } else {
      this._updateActualAnchor(AnchorOwner.Connected);
    }
    this._updateRotation();
  }

  private _calculateConnectedAnchor(): void {
    if (!this._nativeJoint) return;
    const bodyInfo = this._bodyInfo;
    const authored = this._connectedAnchorAuthored;
    const connectedAnchor = authored
      ? (this._calculatedConnectedAnchor ||= new Vector3())
      : this._connectedBodyInfo.anchor;
    const connectedBody = this._connectedBody;

    connectedAnchor._onValueChanged = null;
    if (connectedBody) {
      const tempVector3 = Joint._tempVector3;
      const tempMatrix = Joint._tempMatrix;
      Vector3.transformCoordinate(bodyInfo.anchor, this.entity.transform.worldMatrix, tempVector3);
      Matrix.invert(connectedBody.entity.transform.worldMatrix, tempMatrix);
      Vector3.transformCoordinate(tempVector3, tempMatrix, connectedAnchor);
    } else {
      Vector3.transformCoordinate(bodyInfo.anchor, this.entity.transform.worldMatrix, connectedAnchor);
    }
    if (!authored) {
      connectedAnchor._onValueChanged = this._handleConnectedAnchorChanged;
      this._calculatedConnectedAnchor?.copyFrom(connectedAnchor);
    }
    this._updateActualAnchor(AnchorOwner.Connected);
  }

  @ignoreClone
  private _onAnchorChanged(): void {
    this._updateActualAnchor(AnchorOwner.Self);
    this._automaticConnectedAnchor && this._calculateConnectedAnchor();
  }

  @ignoreClone
  private _handleConnectedAnchorChanged(): void {
    this._connectedAnchorAuthored = true;
    if (!this._automaticConnectedAnchor) this._updateActualAnchor(AnchorOwner.Connected);
  }

  @ignoreClone
  private _onSelfTransformChanged(type: TransformModifyFlags): void {
    if (type & TransformModifyFlags.WorldScale) {
      this._updateActualAnchor(AnchorOwner.Self);
    }
  }

  @ignoreClone
  private _onConnectedTransformChanged(type: TransformModifyFlags): void {
    if (type & TransformModifyFlags.WorldScale) {
      this._updateActualAnchor(AnchorOwner.Connected);
    }
  }

  private _updateRotation(): void {
    let rotation = this.entity.transform.worldRotationQuaternion;
    const connectedBody = this._connectedBody;
    if (connectedBody) {
      const relativeRotation = Joint._tempQuat;
      Quaternion.invert(connectedBody.entity.transform.worldRotationQuaternion, relativeRotation);
      Quaternion.multiply(relativeRotation, rotation, relativeRotation);
      rotation = relativeRotation;
    }
    this._nativeJoint?.setRotation(rotation);
  }

  private _updateActualAnchor(flag: AnchorOwner): void {
    const nativeJoint = this._nativeJoint;
    if (!nativeJoint) return;

    if (flag & AnchorOwner.Self) {
      const worldScale = this.entity.transform.lossyWorldScale;
      const selfBodyInfo = this._bodyInfo;
      Vector3.multiply(selfBodyInfo.anchor, worldScale, selfBodyInfo.actualAnchor);
      nativeJoint.setAnchor(selfBodyInfo.actualAnchor);
    }
    if (flag & AnchorOwner.Connected) {
      const connectedBodyInfo = this._connectedBodyInfo;
      const anchor = (this._automaticConnectedAnchor && this._calculatedConnectedAnchor) || connectedBodyInfo.anchor;
      const connectedBody = this._connectedBody;
      if (connectedBody) {
        const worldScale = connectedBody.entity.transform.lossyWorldScale;
        Vector3.multiply(anchor, worldScale, connectedBodyInfo.actualAnchor);
      } else {
        connectedBodyInfo.actualAnchor.copyFrom(anchor);
      }
      nativeJoint.setConnectedAnchor(connectedBodyInfo.actualAnchor);
    }
    this._wakeBodies();
  }

  protected _wakeBodies(): void {
    Joint._wakeBody(this.entity.getComponent(Rigidbody));
    const body = this._connectedBody;
    if (body?.scene === this.scene) Joint._wakeBody(body);
  }

  /** @internal Wake the other endpoint after the constraint enters or leaves simulation. */
  _wakeOtherBody(body: Rigidbody): void {
    if (this._nativeJoint && !this._nativeJoint.isBroken()) {
      const connectedBody = this._connectedBody;
      Joint._wakeBody(body === connectedBody ? this.entity.getComponent(Rigidbody) : connectedBody);
    }
  }

  private static _wakeBody(body: Rigidbody | null | undefined): void {
    if (body && !body.destroyed && body._index !== -1 && !body.isKinematic) {
      body.wakeUp();
    }
  }
}

/**
 * @internal
 */
enum AnchorOwner {
  Self = 0x1,
  Connected = 0x2
}

/**
 * @internal
 */
class JointBodyInfo extends DataObject {
  @ignoreClone
  anchor = new Vector3();
  @ignoreClone
  actualAnchor = new Vector3();
  massScale: number = 1;
}
