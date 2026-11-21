import {
  BoxCollider,
  HingeJoint,
  JointLimits,
  PhysicsDebugFlags,
  PhysicsDebugLines,
  Rigidbody,
  Scene,
  SphereCollider,
  WebGLEngine
} from "@galacean/engine";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPhysics } from "../../utils/physics";

function xBounds(lines: PhysicsDebugLines): [number, number] {
  const data = new DataView(lines.data.buffer);
  let min = Infinity;
  let max = -Infinity;
  for (let vertex = 0, count = lines.lineCount * 2; vertex < count; vertex++) {
    const x = data.getFloat32(vertex * (PhysicsDebugLines.bytesPerLine / 2), true);
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  return [min, max];
}

describe("Physics debug lines", () => {
  let engine: WebGLEngine;
  let scene: Scene;

  beforeAll(async () => {
    engine = await WebGLEngine.create({ canvas: document.createElement("canvas"), physics: createPhysics() });
  });

  beforeEach(() => {
    scene = new Scene(engine, "physics debug lines");
    engine.sceneManager.addScene(scene);
    scene.physics.autoSimulation = false;
  });

  afterEach(() => scene.destroy());
  afterAll(() => engine.destroy());

  it("copies colored native shapes from the last step and reuses the owned buffer", () => {
    const entity = scene.createRootEntity("box");
    entity.transform.setPosition(10, 0, 0);
    entity.addComponent(BoxCollider).size.set(2, 2, 2);
    const { physics } = scene;
    const lines = new PhysicsDebugLines();

    physics.step();
    physics.getDebugLines(lines);
    expect(lines.lineCount).toBe(0);

    physics.setDebugVisualization(PhysicsDebugFlags.Shapes);
    physics.step();
    physics.getDebugLines(lines);
    expect(lines.lineCount).toBeGreaterThan(0);
    expect(xBounds(lines)).toEqual([9, 11]);
    const storage = lines.data;
    expect(new DataView(storage.buffer).getUint32(12, true)).not.toBe(0);

    entity.transform.setPosition(30, 0, 0);
    physics.getDebugLines(lines);
    expect(xBounds(lines)).toEqual([9, 11]);
    physics.step();
    expect(xBounds(lines)).toEqual([9, 11]);
    physics.getDebugLines(lines);
    expect(xBounds(lines)).toEqual([29, 31]);
    expect(lines.data).toBe(storage);

    physics.setDebugVisualization(PhysicsDebugFlags.None);
    physics.setDebugVisualization(PhysicsDebugFlags.Shapes);
    physics.getDebugLines(lines);
    expect(lines.lineCount).toBe(0);
    expect(lines.data).toBe(storage);
    expect(() => physics.setDebugVisualization(64 as PhysicsDebugFlags)).toThrow(RangeError);
    expect(() => physics.setDebugVisualization(PhysicsDebugFlags.Shapes, Infinity)).toThrow(RangeError);
    physics.step();
    physics.getDebugLines(lines);
    expect(xBounds(lines)).toEqual([29, 31]);
  });

  it("collects ordinary contact geometry independently of reports and other scenes", () => {
    const floor = scene.createRootEntity("floor");
    floor.transform.setPosition(0, -0.5, 0);
    floor.addComponent(BoxCollider).size.set(10, 1, 10);
    const ball = scene.createRootEntity("ball");
    ball.transform.setPosition(0, 0.42, 0);
    ball.addComponent(SphereCollider);
    ball.addComponent(Rigidbody);
    const { physics } = scene;
    const flags = PhysicsDebugFlags.ContactPoints | PhysicsDebugFlags.ContactNormals;
    const lines = new PhysicsDebugLines();

    physics.setDebugVisualization(flags);
    for (let step = 0; step < 4; step++) physics.step();
    physics.getDebugLines(lines);
    expect(lines.lineCount).toBeGreaterThan(0);

    engine.sceneManager.activeScene.physics.getDebugLines(lines);
    expect(lines.lineCount).toBe(0);

    physics.setDebugVisualization(flags, 0);
    physics.step();
    physics.getDebugLines(lines);
    expect(lines.lineCount).toBe(0);
    physics.setDebugVisualization(flags);
    for (let step = 0; step < 4; step++) physics.step();
    physics.getDebugLines(lines);
    expect(lines.lineCount).toBeGreaterThan(0);
  });

  it("draws a hinge's native limit and frames", () => {
    const entity = scene.createRootEntity("hinge");
    entity.addComponent(BoxCollider);
    entity.addComponent(Rigidbody).useGravity = false;
    const hinge = entity.addComponent(HingeJoint);
    const limits = new JointLimits();
    limits.min = -0.2;
    limits.max = 0.4;
    hinge.limits = limits;
    hinge.useLimits = true;
    const lines = new PhysicsDebugLines();

    for (const category of [PhysicsDebugFlags.JointFrames, PhysicsDebugFlags.JointLimits]) {
      scene.physics.setDebugVisualization(category);
      scene.physics.step();
      scene.physics.getDebugLines(lines);
      expect(lines.lineCount).toBeGreaterThan(0);
    }
  });
});
