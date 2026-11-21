/**
 * Step-climbing behavior for capsule character controllers.
 */
export enum ControllerClimbingMode {
  /** Allows the capsule's rounded shape to step higher than the configured step offset. */
  Easy = 0,
  /** Restricts capsule climbing to the configured step offset. */
  Constrained = 1
}
