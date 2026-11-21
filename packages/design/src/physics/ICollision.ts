import type { Vector3 } from "@galacean/engine-math";

/** Data buffered for one shape pair during a simulation step. */
export interface ICollision {
  /** The unique IDs of the shapes in the pair. */
  shape0Id: number;
  shape1Id: number;
  /** The number of contact points in this report. */
  contactCount: number;

  /** Writes one contact. A sign of 1 orients normals and impulses from the second shape to the first. */
  getContact(index: number, out: IContactPoint, sign: 1 | -1): void;

  /** Writes the sum of the reported impulses, directed from the second shape to the first. */
  getImpulse(out: Vector3): void;

  /** Writes the second body's pre-solver linear velocity minus the first body's, if available. */
  getRelativeVelocity(out: Vector3): boolean;
}

export interface IContactPoint {
  readonly position: Vector3;
  readonly normal: Vector3;
  readonly impulse: Vector3;
  separation: number;
}
