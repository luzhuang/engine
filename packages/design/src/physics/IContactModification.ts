import type { Vector3 } from "@galacean/engine-math";

/** A native contact batch borrowed for a synchronous solver callback. */
export interface IContactModification {
  readonly pairCount: number;
  readonly isCCD: boolean;
  getColliderId(pairIndex: number, shapeIndex: 0 | 1): number;
  getContactCount(pairIndex: number): number;
  getPoint(pairIndex: number, contactIndex: number, out: Vector3): boolean;
  getNormal(pairIndex: number, contactIndex: number, out: Vector3): boolean;
  getSeparation(pairIndex: number, contactIndex: number): number;
  ignoreContact(pairIndex: number, contactIndex: number): void;
  setMaxImpulse(pairIndex: number, contactIndex: number, value: number): void;
  setRestitution(pairIndex: number, contactIndex: number, value: number): void;
  setPoint(pairIndex: number, contactIndex: number, x: number, y: number, z: number): void;
  setNormal(pairIndex: number, contactIndex: number, x: number, y: number, z: number): void;
  setSeparation(pairIndex: number, contactIndex: number, value: number): void;
  setTargetVelocity(pairIndex: number, contactIndex: number, x: number, y: number, z: number): void;
  setStaticFriction(pairIndex: number, contactIndex: number, value: number): void;
  setDynamicFriction(pairIndex: number, contactIndex: number, value: number): void;
  setInverseMassScale(pairIndex: number, shapeIndex: 0 | 1, value: number): void;
  setInverseInertiaScale(pairIndex: number, shapeIndex: 0 | 1, value: number): void;
}
