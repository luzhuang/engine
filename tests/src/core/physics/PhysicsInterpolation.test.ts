import {
  BoxCollider,
  Camera,
  Entity,
  HitResult,
  MeshRenderer,
  PrimitiveMesh,
  Quaternion,
  Ray,
  Rigidbody,
  Scene,
  Script,
  UnlitMaterial,
  Vector2,
  Vector3,
  WebGLEngine
} from "@galacean/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhysics } from "../../utils/physics";

describe("Rigidbody interpolation", () => {
  const tick = 1 / 64;
  const size = 0.25;
  const physics = createPhysics();
  let canvas: HTMLCanvasElement;
  let engine: WebGLEngine;
  let scene: Scene;
  let camera: Camera;
  let now: number;

  beforeEach(async () => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    engine = await WebGLEngine.create({
      canvas,
      physics,
      graphicDeviceOptions: { preserveDrawingBuffer: true }
    });
    scene = engine.sceneManager.activeScene;
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
    canvas.remove();
    vi.restoreAllMocks();
  });

  function frame(ticks: number): void {
    now += ticks * tick * 1000;
    engine.update();
  }

  function addBody(entity: Entity, speed: number): Rigidbody {
    const body = entity.addComponent(Rigidbody);
    body.useGravity = false;
    body.automaticCenterOfMass = false;
    body.automaticInertiaTensor = false;
    body.linearVelocity.x = speed;
    return body;
  }

  function addBox(entity: Entity): void {
    const collider = entity.addComponent(BoxCollider);
    collider.size.set(size, size, size);
    const renderer = entity.addComponent(MeshRenderer);
    renderer.mesh = PrimitiveMesh.createCuboid(engine, size, size, size);
    renderer.setMaterial(new UnlitMaterial(engine));
  }

  function red(x: number, y = 0): number {
    const point = new Vector3(x, y, 0);
    camera.worldToScreenPoint(point, point);
    return screenRed(point.x, point.y);
  }

  function screenRed(x: number, y: number): number {
    const gl = canvas.getContext("webgl2")!;
    const sample = new Uint8Array(4);
    gl.readPixels(Math.floor(x), canvas.height - Math.floor(y) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
    return sample[0];
  }

  function rayAt(x: number): Ray {
    return new Ray(new Vector3(x, 0, 10), new Vector3(0, 0, -1));
  }

  it("smooths opted-in descendants between ticks while queries hit their simulated positions", () => {
    const entity = scene.createRootEntity();
    entity.transform.position.x = -3;
    const body = addBody(entity, 64);
    const visual = entity.createChild();
    visual.transform.position.x = 0.5;
    addBox(visual);

    frame(2.5);
    expect(red(-0.5)).toBeGreaterThan(240);
    expect(body.interpolation).toBe(false);

    body.interpolation = true;
    frame(2);
    expect(scene.physics.interpolationFraction).toBe(0.5);
    expect(visual.transform.worldPosition.x).toBeCloseTo(1.5, 5);
    expect(red(1)).toBeGreaterThan(240);
    expect(red(1.5)).toBeLessThan(10);
    const hit = new HitResult();
    expect(scene.physics.raycast(rayAt(1.5), hit)).toBe(true);
    expect(hit.entity).toBe(visual);
    expect(scene.physics.raycast(rayAt(1))).toBe(false);

    frame(0.25);
    expect(scene.physics.interpolationFraction).toBe(0.75);
    expect(visual.transform.worldPosition.x).toBeCloseTo(1.5, 5);
    expect(red(1.25)).toBeGreaterThan(240);
    expect(red(1)).toBeLessThan(10);

    scene.physics.fixedTimeStep /= 2;
    expect(scene.physics.interpolationFraction).toBe(0.75);
    scene.physics.fixedTimeStep *= 2;
    scene.physics.autoSimulation = false;
    frame(0);
    expect(red(1.5)).toBeGreaterThan(240);
    scene.physics.autoSimulation = true;
    frame(0);
    expect(red(1.5)).toBeGreaterThan(240);

    body.interpolation = false;
    frame(0);
    expect(red(1.5)).toBeGreaterThan(240);
    body.interpolation = true;
    frame(0);
    expect(red(1.5)).toBeGreaterThan(240);

    frame(2.5);
    expect(visual.transform.worldPosition.x).toBeCloseTo(4.5, 5);
    expect(red(3.75)).toBeGreaterThan(240);
  });

  it("interpolates rotation around the nearest active body in a nested hierarchy", () => {
    const outer = scene.createRootEntity();
    outer.transform.setPosition(-2, -1.5, 0);
    addBox(outer);
    addBody(outer, 64).interpolation = true;

    const inner = outer.createChild();
    inner.transform.position.y = 3;
    const body = addBody(inner, 0);
    body.angularVelocity.z = 64;
    body.interpolation = true;
    const visual = inner.createChild();
    visual.transform.position.x = 2;
    addBox(visual);

    frame(1);
    const previousRotation = inner.transform.worldRotationQuaternion.clone();
    frame(1.5);
    const rotation = new Quaternion();
    Quaternion.slerp(previousRotation, inner.transform.worldRotationQuaternion, 0.5, rotation);
    const rendered = visual.transform.position.clone().transformByQuat(rotation).add(inner.transform.worldPosition);
    const simulated = visual.transform.worldPosition;

    expect(red(rendered.x, rendered.y)).toBeGreaterThan(240);
    expect(red(rendered.x - 0.5, rendered.y)).toBeLessThan(10);
    expect(red(simulated.x, simulated.y)).toBeLessThan(10);

    body.interpolation = false;
    frame(0);
    expect(red(simulated.x, simulated.y)).toBeGreaterThan(240);
    expect(red(simulated.x - 0.5, simulated.y)).toBeLessThan(10);
  });

  it("interpolates kinematic movement and applies teleports and manual steps immediately", () => {
    const entity = scene.createRootEntity();
    entity.transform.position.x = -3;
    addBox(entity);
    const body = addBody(entity, 0);
    body.isKinematic = true;
    body.interpolation = true;

    body.move(new Vector3(-2, 0, 0));
    frame(1);
    body.move(new Vector3(-1, 0, 0));
    expect(entity.transform.worldPosition.x).toBeCloseTo(-2, 5);
    expect(scene.physics.raycast(rayAt(-1))).toBe(true);
    frame(1.5);
    expect(red(-1.5)).toBeGreaterThan(240);

    entity.transform.worldPosition.x = 2;
    frame(0);
    expect(red(2)).toBeGreaterThan(240);
    expect(red(-1.5)).toBeLessThan(10);
    expect(scene.physics.raycast(rayAt(2))).toBe(true);

    scene.physics.autoSimulation = false;
    body.move(new Vector3(3, 0, 0));
    scene.physics.step();
    frame(0);
    expect(scene.physics.interpolationFraction).toBe(1);
    expect(entity.transform.worldPosition.x).toBeCloseTo(3, 5);
    expect(red(3)).toBeGreaterThan(240);
    expect(red(2)).toBeLessThan(10);
  });

  it("picks through the presented camera and keeps the pressed object as the drag target", () => {
    document.body.append(canvas);
    camera.entity.transform.position.x = 1.5;
    const body = addBody(camera.entity, 0);
    body.interpolation = true;
    const target = scene.createRootEntity();
    target.transform.position.x = 1.5;
    addBox(target);
    const events: string[] = [];
    target.addComponent(
      class extends Script {
        onPointerDown(): void {
          events.push("down");
        }

        onPointerDrag(): void {
          events.push("drag");
        }
      }
    );

    frame(0);
    expect(screenRed(64, 64)).toBeGreaterThan(240);

    const { left, top, width, height } = canvas.getBoundingClientRect();
    const pointer = { pointerId: 1, clientX: left + width / 2, clientY: top + height / 2, buttons: 1 };
    body.linearVelocity.x = 64;
    canvas.dispatchEvent(new PointerEvent("pointerdown", pointer));
    frame(1.25);
    expect(events).toEqual(["down"]);
    expect(screenRed(60, 64)).toBeGreaterThan(240);
    const publicRay = camera.screenPointToRay(new Vector2(64, 64), new Ray());
    expect(publicRay.origin.x).toBeCloseTo(2.5, 5);
    expect(scene.physics.raycast(publicRay)).toBe(false);

    canvas.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: left + width * 0.75 }));
    frame(0);
    expect(events).toEqual(["down", "drag"]);
  });

  it("picks inside the viewport of the displayed frame", () => {
    document.body.append(canvas);
    addBody(camera.entity, 0).interpolation = true;
    const target = scene.createRootEntity();
    addBox(target);
    let pressed = false;
    target.addComponent(
      class extends Script {
        onPointerDown(): void {
          pressed = true;
        }
      }
    );

    frame(0);
    expect(screenRed(64, 64)).toBeGreaterThan(240);
    camera.viewport.set(0.75, 0, 0.25, 1);
    const { left, top, width, height } = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        clientX: left + width / 2,
        clientY: top + height / 2,
        buttons: 1
      })
    );
    frame(0);
    expect(pressed).toBe(true);
  });

  it("keeps the displayed camera and interpolated body aligned after an origin shift", () => {
    document.body.append(canvas);
    camera.entity.transform.position.x = 1000;
    addBody(camera.entity, 0).interpolation = true;
    const target = scene.createRootEntity();
    target.transform.position.x = 1000;
    addBox(target);
    let pressed = false;
    target.addComponent(
      class extends Script {
        onPointerDown(): void {
          pressed = true;
        }
      }
    );
    const moving = scene.createRootEntity();
    moving.transform.setPosition(997, 1.5, 0);
    addBody(moving, 64).interpolation = true;
    addBox(moving);
    frame(2.5);
    expect(red(998.5, 1.5)).toBeGreaterThan(240);

    scene.physics.shiftOrigin(new Vector3(1000, 0, 0));
    expect(scene.physics.interpolationFraction).toBeCloseTo(0.5);
    const { left, top, width, height } = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        clientX: left + width / 2,
        clientY: top + height / 2,
        buttons: 1
      })
    );
    frame(0);
    expect(pressed).toBe(true);
    expect(red(-1.5, 1.5)).toBeGreaterThan(240);
    expect(red(-1, 1.5)).toBeLessThan(10);
  });

  it("keeps a distant body's pivot fixed while interpolating its rotation", () => {
    const x = 1e8;
    camera.entity.transform.position.x = x;
    const entity = scene.createRootEntity();
    entity.transform.position.x = x;
    const body = addBody(entity, 0);
    body.isKinematic = true;
    body.interpolation = true;
    const renderer = entity.addComponent(MeshRenderer);
    renderer.mesh = PrimitiveMesh.createCuboid(engine, 1, 1, 1);
    renderer.setMaterial(new UnlitMaterial(engine));

    frame(0);
    expect(screenRed(64, 64)).toBeGreaterThan(240);
    body.move(new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2));
    frame(1.5);
    expect(entity.transform.worldRotationQuaternion.z).toBeCloseTo(Math.SQRT1_2);
    expect(screenRed(64, 64)).toBeGreaterThan(240);
  });

  it("does not invent interpolation motion when shifting recovers a child offset", () => {
    const position = 2 ** 24;
    camera.entity.transform.position.x = position;
    const root = scene.createRootEntity();
    root.transform.position.x = position;
    const child = root.createChild();
    child.transform.position.x = 0.25;
    addBody(child, 0).interpolation = true;
    addBox(child);
    frame(1.5);
    expect(child.transform.worldPosition.x).toBe(position);

    scene.physics.shiftOrigin(new Vector3(position, 0, 0));
    expect(child.transform.worldPosition.x).toBe(0.25);
    frame(0);
    expect(red(0.29)).toBeGreaterThan(240);
  });
});
