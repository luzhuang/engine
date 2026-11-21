import type { ICollision } from "@galacean/engine-design";
import { Vector3 } from "@galacean/engine-math";
import type { Collider } from "./Collider";
import { ContactPoint } from "./ContactPoint";
import type { Rigidbody } from "./Rigidbody";

/**
 * Contact data reported to a script during a collision callback.
 * @remarks The physics scene reuses this object. Read it during the callback and copy any values needed afterward.
 */
export class Collision {
  /** @internal */
  _nativeCollision: ICollision;

  private readonly _impulse = new Vector3();
  private readonly _relativeVelocity = new Vector3();

  /** The Collider on the other side of this contact pair. */
  collider: Collider;
  /** The receiving Collider. Contact normals and impulses are oriented from {@link collider} toward this Collider. */
  selfCollider: Collider;

  /** The Rigidbody attached to the other Collider, or null for a static Collider. */
  get rigidbody(): Rigidbody | null {
    return this.collider.attachedRigidbody;
  }

  /** The sum of the reported contact impulses in world space, directed toward the receiving Collider. */
  get impulse(): Readonly<Vector3> {
    const out = this._impulse;
    this._nativeCollision.getImpulse(out);
    return out.scale(this._sign);
  }

  /**
   * The other body's world-space linear velocity minus the receiving body's before the contact was solved.
   * @remarks Static bodies contribute zero velocity. Reports from swept CCD and exit events have no sample and return null.
   */
  get relativeVelocity(): Readonly<Vector3> | null {
    const out = this._relativeVelocity;
    return this._nativeCollision.getRelativeVelocity(out) ? out.scale(this._sign) : null;
  }

  /** The number of contact points in this callback. */
  get contactCount(): number {
    return this._nativeCollision.contactCount;
  }

  /**
   * Copies one contact into the supplied object.
   * @param index - A zero-based index less than {@link contactCount}.
   * @param out - The contact to write.
   * @returns The supplied contact.
   * @throws When the index is outside the contact range or is not an integer.
   */
  getContact(index: number, out: ContactPoint): ContactPoint {
    if (!Number.isInteger(index) || index < 0 || index >= this.contactCount) {
      throw new RangeError("Collision contact index out of range.");
    }
    this._nativeCollision.getContact(index, out, this._sign);
    return out;
  }

  /**
   * Copies contact points into the supplied array.
   * @param outContacts - Output array. Existing contact objects are reused, and the array grows as needed.
   * @returns The number of entries written. Entries beyond this count are left unchanged.
   */
  getContacts(outContacts: ContactPoint[]): number {
    const nativeCollision = this._nativeCollision;
    const sign = this._sign;
    const length = nativeCollision.contactCount;
    for (let i = 0; i < length; i++) {
      const contact = (outContacts[i] ||= new ContactPoint());
      nativeCollision.getContact(i, contact, sign);
    }
    return length;
  }

  private get _sign(): 1 | -1 {
    return this.selfCollider._id === this._nativeCollision.shape0Id ? 1 : -1;
  }
}
