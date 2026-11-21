/** Features drawn by the native physics scene. Combine flags with bitwise OR. */
export enum PhysicsDebugFlags {
  None = 0,
  Shapes = 1 << 0,
  ShapeBounds = 1 << 1,
  ContactPoints = 1 << 2,
  ContactNormals = 1 << 3,
  JointFrames = 1 << 4,
  JointLimits = 1 << 5
}

/** Reusable storage for world-space lines copied from a physics scene. */
export class PhysicsDebugLines {
  /** The number of bytes occupied by one line. */
  static readonly bytesPerLine = 32;
  private static readonly _emptyData = new Uint8Array(0);

  private _data = PhysicsDebugLines._emptyData;
  private _lineCount = 0;

  /** The number of valid lines beginning at byte offset zero. */
  get lineCount(): number {
    return this._lineCount;
  }

  /**
   * Owned byte storage. Each line holds two vertices, each consisting of three Float32 coordinates
   * and one packed Uint32 ARGB color, in little-endian order.
   * @remarks Read only the first `lineCount * bytesPerLine` bytes. Copying a larger sample can replace this array.
   */
  get data(): Uint8Array {
    return this._data;
  }

  /** @internal */
  _copyFrom(source: Uint8Array | null): void {
    const length = source?.byteLength ?? 0;
    if (source) {
      if (length > this._data.length) this._data = new Uint8Array(Math.max(length, this._data.length * 2));
      this._data.set(source);
    }
    this._lineCount = length / PhysicsDebugLines.bytesPerLine;
  }
}
