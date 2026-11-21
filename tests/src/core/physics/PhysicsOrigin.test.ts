import {
  BoxCollider,
  Camera,
  CharacterController,
  Collision,
  Entity,
  HitResult,
  Rigidbody,
  Scene,
  Script,
  SphereCollider,
  WebGLEngine
} from "@galacean/engine";
import { Matrix, Ray, Vector3 } from "@galacean/engine-math";
import { CanvasRenderMode, UICanvas } from "@galacean/engine-ui";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPhysics } from "../../utils/physics";

describe("Physics origin shift", () => {
  let engine: WebGLEngine;
  let scene: Scene;
  const offset = new Vector3(1000, 0, 0);

  beforeAll(async () => {
    engine = await WebGLEngine.create({ canvas: document.createElement("canvas"), physics: createPhysics() });
  });

  beforeEach(() => {
    scene = new Scene(engine, "shifted physics");
    engine.sceneManager.addScene(scene);
    scene.physics.autoSimulation = false;
  });

  afterEach(() => scene.destroy());
  afterAll(() => engine.destroy());

  function rayDown(x: number, z = 0): Ray {
    return new Ray(new Vector3(x, 6, z), new Vector3(0, -1, 0));
  }

  it("rebases scene queries, queued moves, and a controller with a local center", () => {
    const root = scene.createRootEntity("static hierarchy");
    root.transform.position.x = 1002;
    const child = root.createChild("box");
    child.transform.position.x = 2;
    child.addComponent(BoxCollider);
    const matrixRoot = scene.createRootEntity("authored matrix");
    const matrix = new Matrix();
    matrix.elements[4] = 0.25;
    matrix.elements[12] = 1000;
    matrixRoot.transform.localMatrix = matrix;

    const controlled = scene.createRootEntity("controller");
    controlled.transform.setPosition(1008, 2, 0);
    const controller = controlled.addComponent(CharacterController);
    controller.center.set(0.25, 0.2, 0);

    const moving = scene.createRootEntity("kinematic target");
    moving.transform.setPosition(1012, 0.5, 0);
    moving.addComponent(BoxCollider);
    const body = moving.addComponent(Rigidbody);
    body.isKinematic = true;
    const { physics } = scene;
    const hit = new HitResult();
    expect(physics.raycast(rayDown(1004), hit)).toBe(true);
    const distance = hit.distance;
    body.move(new Vector3(1014, 0.5, 0));

    expect(() => physics.shiftOrigin(new Vector3(Infinity, 0, 0))).toThrow(RangeError);
    expect(root.transform.worldPosition.x).toBe(1002);
    physics.shiftOrigin(offset);
    expect(child.transform.position.x).toBe(2);
    expect(matrixRoot.transform.localMatrix.elements[4]).toBe(0.25);
    expect(matrixRoot.transform.localMatrix.elements[12]).toBe(0);
    expect(physics.raycast(rayDown(1004))).toBe(false);
    expect(physics.raycast(rayDown(4), hit)).toBe(true);
    expect(hit.entity).toBe(child);
    expect(hit.distance).toBeCloseTo(distance);
    expect(physics.raycast(rayDown(14), hit)).toBe(true);
    expect(hit.entity).toBe(moving);
    expect(physics.raycast(rayDown(8.25), hit)).toBe(true);
    expect(hit.entity).toBe(controlled);

    controller.move(new Vector3(0.5, 0, 0), 0, 0.25);
    expect(controlled.transform.worldPosition.x).toBeCloseTo(8.5);
    physics.step();
    expect(moving.transform.worldPosition.x).toBeCloseTo(14);
  });

  it("preserves sleeping state and an active contact pair in the shifted coordinates", () => {
    const sleeper = scene.createRootEntity("sleeping");
    sleeper.transform.setPosition(1001, 4, 0);
    sleeper.addComponent(BoxCollider);
    const sleepingBody = sleeper.addComponent(Rigidbody);
    sleepingBody.useGravity = false;
    const floor = scene.createRootEntity("floor");
    floor.transform.setPosition(1005, -0.5, 0);
    floor.addComponent(BoxCollider).size.set(4, 1, 4);
    const ball = scene.createRootEntity("active contact");
    ball.transform.setPosition(1005, 0.46, 0);
    ball.addComponent(SphereCollider);
    ball.addComponent(Rigidbody);
    let enters = 0;
    let exits = 0;
    let contactX: number;
    ball.addComponent(
      class extends Script {
        onCollisionEnter(): void {
          enters++;
        }
        onCollisionStay(collision: Collision): void {
          if (collision.contacts.size()) contactX = collision.contacts.get(0).position.x;
        }
        onCollisionExit(): void {
          exits++;
        }
      }
    );
    const { physics } = scene;
    for (let step = 0; step < 5; step++) physics.step();
    sleepingBody.sleep();
    expect(sleepingBody.isSleeping()).toBe(true);
    expect(enters).toBe(1);
    expect(contactX).toBeCloseTo(1005);

    physics.shiftOrigin(offset);
    expect(sleepingBody.isSleeping()).toBe(true);
    for (let step = 0; step < 3; step++) physics.step();
    expect(sleepingBody.isSleeping()).toBe(true);
    expect(sleeper.transform.worldPosition.x).toBeCloseTo(1);
    expect(enters).toBe(1);
    expect(exits).toBe(0);
    expect(contactX).toBeCloseTo(5);
  });

  it.each([false, true])("moves a screen-camera canvas once with camera-first order=%s", (cameraFirst) => {
    const camera = new Entity(engine, "camera").addComponent(Camera);
    const canvas = new Entity(engine, "canvas").addComponent(UICanvas);
    const first = cameraFirst ? camera : canvas;
    const second = cameraFirst ? canvas : camera;
    scene.addRootEntity(first.entity);
    scene.addRootEntity(second.entity);
    camera.entity.transform.setPosition(1000, 0, 10);
    canvas.renderMode = CanvasRenderMode.ScreenSpaceCamera;
    canvas.renderCamera = camera;
    const before = canvas.entity.transform.worldPosition.clone();

    scene.physics.shiftOrigin(offset);
    const after = canvas.entity.transform.worldPosition;
    expect(after.x).toBeCloseTo(before.x - offset.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.z).toBeCloseTo(before.z);
  });
});
