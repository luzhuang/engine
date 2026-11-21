/**
 * Movement response on slopes steeper than the controller's slope limit.
 */
export enum ControllerNonWalkableMode {
  /** Stops character from climbing up non-walkable slopes, but doesn't move it otherwise. */
  PreventClimbing,
  /** Stops character from climbing up non-walkable slopes, and forces it to slide down those slopes. */
  PreventClimbingAndForceSliding
}
