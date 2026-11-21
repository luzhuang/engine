import { PhysXPhysics, PhysXRuntimeMode } from "@galacean/engine-physics-physx";

export function createPhysics(requestedRuntimeMode?: PhysXRuntimeMode): PhysXPhysics {
  const mode = import.meta.env.VITE_PHYSX_RUNTIME_MODE;
  const runtimeMode =
    requestedRuntimeMode ??
    (mode === "wasm"
      ? PhysXRuntimeMode.WebAssembly
      : mode === "simd"
        ? PhysXRuntimeMode.WebAssemblySIMD
        : PhysXRuntimeMode.Auto);
  return new PhysXPhysics(runtimeMode);
}
