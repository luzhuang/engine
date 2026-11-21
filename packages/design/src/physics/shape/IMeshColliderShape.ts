import { Vector3 } from "@galacean/engine-math";
import { IColliderShape } from "./IColliderShape";

/** Source data and identity borrowed for a mesh cooking request. */
export interface IMeshColliderSource {
  key: object;
  /** Revision of the submitted mesh data. Equal revisions share the same geometry for a given key. */
  version: number;
  /** Discard previously cached versions and variants for this key. */
  refresh: boolean;
  positions: Vector3[];
  indices: Uint8Array | Uint16Array | Uint32Array | null;
}

/**
 * Interface for mesh collider shape.
 */
export interface IMeshColliderShape extends IColliderShape {
  /** Changes whether triangle-mesh queries hit both sides without replacing the mesh. */
  setDoubleSided(value: boolean, scale: Vector3): void;

  /**
   * Update mesh data and scale without changing the geometry type.
   * @param source - Committed mesh-local positions and optional triangle indices
   * @param cookingFlags - Cooking flags
   * @param scale - Signed world scale
   * @returns Whether cooking succeeded. A cooking failure preserves the previous geometry.
   */
  setMeshData(source: IMeshColliderSource, cookingFlags: number, scale: Vector3): boolean;

  /**
   * Change the scale without cooking new mesh data.
   * @param scale - Signed world scale
   */
  setScale(scale: Vector3): void;
}
