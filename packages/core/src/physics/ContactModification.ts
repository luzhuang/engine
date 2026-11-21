import type { IContactModification } from "@galacean/engine-design";
import { Vector3 } from "@galacean/engine-math";
import { Engine } from "../Engine";
import type { Collider } from "./Collider";

/**
 * A batch of contacts before the solver applies impulses.
 * @remarks Pair and contact indices are zero-based. The scene reuses this batch, so access it only during its
 * contact modifier callback. Methods marked as discrete-only throw for swept CCD batches.
 * Each discrete solver patch takes its restitution and friction from its first point. Set the value on
 * every point in a pair to apply it uniformly.
 */
export class ContactModification {
  /** @internal */
  _modifier: ((contacts: ContactModification) => void) | null = null;

  private readonly _vector = new Vector3();
  private _batch: IContactModification | null = null;
  private _error?: [unknown];

  /** Whether these contacts were found by a CCD sweep. */
  get isCCD(): boolean {
    return this._activeBatch.isCCD;
  }

  /** The number of collider pairs in this batch. */
  get pairCount(): number {
    return this._activeBatch.pairCount;
  }

  /** Returns the Engine Collider registered for this side's shape ID, if any. */
  getCollider(pairIndex: number, side: 0 | 1): Collider | undefined {
    return Engine._physicalObjectsMap[this._activeBatch.getColliderId(pairIndex, side)];
  }

  /** Returns the number of contacts within the pair. */
  getContactCount(pairIndex: number): number {
    return this._activeBatch.getContactCount(pairIndex);
  }

  /** Writes the world-space contact point to `out` and returns it. */
  getPoint(pairIndex: number, contactIndex: number, out: Vector3): Vector3 {
    const vector = this._vector;
    if (!this._activeBatch.getPoint(pairIndex, contactIndex, vector)) {
      throw new RangeError("Contact modification index out of range.");
    }
    return out.copyFrom(vector);
  }

  /** Writes the world-space unit normal directed from side 1 toward side 0 to `out` and returns it. */
  getNormal(pairIndex: number, contactIndex: number, out: Vector3): Vector3 {
    const vector = this._vector;
    if (!this._activeBatch.getNormal(pairIndex, contactIndex, vector)) {
      throw new RangeError("Contact modification index out of range.");
    }
    return out.copyFrom(vector);
  }

  /** Returns the signed separation in world units. Negative values indicate penetration. Discrete only. */
  getSeparation(pairIndex: number, contactIndex: number): number {
    return this._activeBatch.getSeparation(pairIndex, contactIndex);
  }

  /** Prevents the solver from applying an impulse at this contact. */
  ignoreContact(pairIndex: number, contactIndex: number): void {
    this._activeBatch.ignoreContact(pairIndex, contactIndex);
  }

  /** Caps the impulse magnitude at this contact. The value must be finite and nonnegative. */
  setMaxImpulse(pairIndex: number, contactIndex: number, value: number): void {
    this._activeBatch.setMaxImpulse(pairIndex, contactIndex, value);
  }

  /** Sets the coefficient of restitution in the range [0, 1]. */
  setRestitution(pairIndex: number, contactIndex: number, value: number): void {
    this._activeBatch.setRestitution(pairIndex, contactIndex, value);
  }

  /**
   * Replaces the world-space contact point.
   * @remarks For swept CCD, this changes the reported point without recalculating the time of impact.
   */
  setPoint(pairIndex: number, contactIndex: number, value: Vector3): void {
    this._activeBatch.setPoint(pairIndex, contactIndex, value.x, value.y, value.z);
  }

  /** Replaces the world-space unit normal directed from side 1 toward side 0. */
  setNormal(pairIndex: number, contactIndex: number, value: Vector3): void {
    this._activeBatch.setNormal(pairIndex, contactIndex, value.x, value.y, value.z);
  }

  /** Sets the signed separation in world units. Negative values indicate penetration. Discrete only. */
  setSeparation(pairIndex: number, contactIndex: number, value: number): void {
    this._activeBatch.setSeparation(pairIndex, contactIndex, value);
  }

  /** Sets the relative contact velocity in world units per second. Discrete only. */
  setTargetVelocity(pairIndex: number, contactIndex: number, value: Vector3): void {
    this._activeBatch.setTargetVelocity(pairIndex, contactIndex, value.x, value.y, value.z);
  }

  /** Sets the nonnegative static friction coefficient. Discrete only. */
  setStaticFriction(pairIndex: number, contactIndex: number, value: number): void {
    this._activeBatch.setStaticFriction(pairIndex, contactIndex, value);
  }

  /** Sets the nonnegative dynamic friction coefficient. Discrete only. */
  setDynamicFriction(pairIndex: number, contactIndex: number, value: number): void {
    this._activeBatch.setDynamicFriction(pairIndex, contactIndex, value);
  }

  /** Scales the inverse mass of one side of this pair by a nonnegative value. Discrete only. */
  setInverseMassScale(pairIndex: number, side: 0 | 1, value: number): void {
    this._activeBatch.setInverseMassScale(pairIndex, side, value);
  }

  /** Scales the inverse inertia of one side of this pair by a nonnegative value. Discrete only. */
  setInverseInertiaScale(pairIndex: number, side: 0 | 1, value: number): void {
    this._activeBatch.setInverseInertiaScale(pairIndex, side, value);
  }

  /** @internal */
  _dispatch(batch: IContactModification): void {
    if (this._error) return;
    Engine._modifyingContacts = true;
    this._batch = batch;
    try {
      this._modifier!(this);
    } catch (error) {
      // Let the native solver finish before propagating an application error.
      this._error = [error];
    } finally {
      this._batch = null;
      Engine._modifyingContacts = false;
    }
  }

  /** @internal */
  _takeError(): [unknown] | undefined {
    const error = this._error;
    this._error = undefined;
    return error;
  }

  private get _activeBatch(): IContactModification {
    const batch = this._batch;
    if (!batch) throw new Error("Contact modification is only available during its callback.");
    return batch;
  }
}
