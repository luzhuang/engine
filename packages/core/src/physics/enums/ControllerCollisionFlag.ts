/**
 * Directions of contact reported by a character controller move.
 */
export enum ControllerCollisionFlag {
  /** No contact was reported. */
  None = 0,
  /** Character is colliding to the sides. */
  Sides = 1,
  /** Character has collision above. */
  Up = 2,
  /** Character has collision below. */
  Down = 4
}
