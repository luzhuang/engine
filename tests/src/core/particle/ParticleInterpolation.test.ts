import {
  BoxCollider,
  BoxShape,
  Camera,
  Entity,
  ParticleMaterial,
  ParticleRenderMode,
  ParticleRenderer,
  ParticleSimulationSpace,
  ParticleStopMode,
  Quaternion,
  Rigidbody,
  Vector3,
  WebGLEngine
} from "@galacean/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhysics } from "../../utils/physics";

describe("Particle interpolation", () => {
  const tick = 1 / 64;
  const velocityX = 16;
  const physics = createPhysics();
  let engine: WebGLEngine;
  let camera: Camera;
  let canvas: HTMLCanvasElement;
  let now: number;

  beforeEach(async () => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    engine = await WebGLEngine.create({ canvas, physics, graphicDeviceOptions: { preserveDrawingBuffer: true } });
    const scene = engine.sceneManager.activeScene;
    scene.physics.fixedTimeStep = tick;
    scene.background.solidColor.set(0, 0, 0, 1);
    camera = scene.createRootEntity().addComponent(Camera);
    camera.entity.transform.position.z = 10;
    camera.isOrthographic = true;
    camera.orthographicSize = 4;
    camera.enableHDR = false;
  });

  afterEach(() => {
    engine.destroy();
    vi.restoreAllMocks();
  });

  function emit(entity: Entity, space: ParticleSimulationSpace, feedback: boolean): ParticleRenderer {
    const renderer = entity.addComponent(ParticleRenderer);
    renderer.setMaterial(new ParticleMaterial(engine));
    const { generator } = renderer;
    generator.stop(false, ParticleStopMode.StopEmittingAndClear);
    generator.main.simulationSpace = space;
    generator.main.startSpeed.constant = 0;
    generator.main.startLifetime.constant = 10;
    generator.main.startSize.constant = 0.18;
    const shape = new BoxShape();
    shape.size.set(0, 0, 0);
    shape.position.x = 0.5;
    generator.emission.shape = shape;
    if (space === ParticleSimulationSpace.Local) {
      const velocity = generator.velocityOverLifetime;
      velocity.enabled = true;
      velocity.space = ParticleSimulationSpace.World;
      velocity.velocityX.constant = velocityX;
    }
    if (feedback) {
      generator.noise.strengthX.constant = 0;
      generator.noise.enabled = true;
    }
    generator.emit(1);
    return renderer;
  }

  function red(x: number, y: number): number {
    const point = new Vector3(x, y, 0);
    camera.worldToScreenPoint(point, point);
    const sample = new Uint8Array(4);
    const gl = canvas.getContext("webgl2")!;
    gl.readPixels(
      Math.floor(point.x),
      canvas.height - Math.floor(point.y) - 1,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      sample
    );
    return sample[0];
  }

  it.each([false, true])("interpolates and culls local particles with GPU feedback %s", (feedback) => {
    const bodyEntity = engine.sceneManager.activeScene.createRootEntity();
    bodyEntity.addComponent(BoxCollider);
    const body = bodyEntity.addComponent(Rigidbody);
    body.isKinematic = true;
    body.interpolation = true;
    const local = bodyEntity.createChild();
    local.transform.position.x = 0.5;
    const world = bodyEntity.createChild();
    world.transform.position.y = -1;
    emit(local, ParticleSimulationSpace.Local, feedback);
    emit(world, ParticleSimulationSpace.World, feedback);
    engine.update();
    expect(red(1, 0)).toBeGreaterThan(240);
    expect(red(0.5, -1)).toBeGreaterThan(240);

    body.move(new Vector3(3, 0, 0), new Quaternion().rotationAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
    const elapsed = 1.5 * tick;
    const shift = velocityX * elapsed;
    // Feedback stores world velocity in the simulated local frame before the renderer blends the pose.
    const blendedX = 1.5 + Math.SQRT1_2 + (feedback ? shift * Math.SQRT1_2 : shift);
    const blendedY = (feedback ? 1 - shift : 1) * Math.SQRT1_2;
    camera.entity.transform.setPosition(blendedX, blendedY, 10);
    camera.orthographicSize = 0.1;
    now += elapsed * 1000;
    engine.update();
    expect(local.transform.worldPosition.x).toBeCloseTo(3, 5);
    expect(local.transform.worldPosition.y).toBeCloseTo(0.5, 5);
    expect(red(blendedX, blendedY)).toBeGreaterThan(240);

    camera.entity.transform.setPosition(0, 0, 10);
    camera.orthographicSize = 4;
    body.interpolation = false;
    camera.render();
    expect(red(3 + shift, 1)).toBeGreaterThan(240);
    expect(red(blendedX, blendedY)).toBeLessThan(10);
    expect(red(0.5, -1)).toBeGreaterThan(240);
  });

  it("stretches local feedback particles along the interpolated world velocity", () => {
    const entity = engine.sceneManager.activeScene.createRootEntity();
    entity.addComponent(BoxCollider);
    const body = entity.addComponent(Rigidbody);
    body.isKinematic = true;
    body.interpolation = true;
    const emitter = entity.createChild();
    emitter.transform.position.x = 0.5;
    const renderer = emit(emitter, ParticleSimulationSpace.Local, true);
    renderer.renderMode = ParticleRenderMode.StretchBillboard;
    renderer.lengthScale = 4;
    engine.update();
    expect(red(0.72, 0)).toBeGreaterThan(240);

    body.move(new Vector3(3, 0, 0), new Quaternion().rotationAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
    const elapsed = 1.5 * tick;
    const shift = velocityX * elapsed;
    const x = 1.5 + (1 + shift) * Math.SQRT1_2;
    const y = (1 - shift) * Math.SQRT1_2;
    camera.entity.transform.setPosition(x, y, 10);
    camera.orthographicSize = 0.6;
    now += elapsed * 1000;
    engine.update();
    expect(red(x - 0.28, y + 0.28)).toBeGreaterThan(240);
    expect(red(x - 0.28, y)).toBeLessThan(10);

    body.interpolation = false;
    camera.entity.transform.setPosition(3 + shift, 1, 10);
    camera.render();
    expect(red(3 + shift - 0.28, 1)).toBeGreaterThan(240);
  });
});
