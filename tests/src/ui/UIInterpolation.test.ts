import { Camera, Entity, Rigidbody, Script, Sprite, Texture2D, Vector3, WebGLEngine } from "@galacean/engine";
import { CanvasRenderMode, Image, UICanvas, UITransform } from "@galacean/engine-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhysics } from "../utils/physics";

describe("UI physics interpolation", () => {
  const tick = 1 / 64;
  const physics = createPhysics();
  let now: number;
  let canvas: HTMLCanvasElement;
  let engine: WebGLEngine;
  let camera: Camera;

  beforeEach(async () => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    document.body.append(canvas);
    engine = await WebGLEngine.create({
      canvas,
      physics,
      graphicDeviceOptions: { preserveDrawingBuffer: true }
    });
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
    canvas.remove();
    vi.restoreAllMocks();
  });

  function moveEachTick(entity: Entity): void {
    const body = entity.addComponent(Rigidbody);
    body.useGravity = false;
    body.interpolation = true;
    body.linearVelocity.x = 64;
  }

  function frame(ticks: number): void {
    now += ticks * tick * 1000;
    engine.update();
  }

  function addImage(parent: Entity, size: number, onDown: () => void): void {
    const entity = parent.createChild();
    const texture = new Texture2D(engine, 1, 1);
    texture.setPixelBuffer(new Uint8Array([255, 255, 255, 255]));
    entity.addComponent(Image).sprite = new Sprite(engine, texture);
    (entity.transform as UITransform).size.set(size, size);
    entity.addComponent(
      class extends Script {
        onPointerDown = onDown;
      }
    );
  }

  function red(x: number, y: number): number {
    const pixel = new Uint8Array(4);
    const gl = canvas.getContext("webgl2")!;
    gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[0];
  }

  function press(x: number, y: number, ticks = 0): void {
    const { left, top, width, height } = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        clientX: left + (x * width) / canvas.width,
        clientY: top + (y * height) / canvas.height,
        buttons: 1
      })
    );
    frame(ticks);
  }

  it("draws and picks a world-space canvas at its interpolated position", () => {
    const body = engine.sceneManager.activeScene.createRootEntity();
    const worldCanvas = body.createChild();
    worldCanvas.addComponent(UICanvas);
    const onDown = vi.fn();
    addImage(worldCanvas, 0.25, onDown);
    moveEachTick(body);
    frame(2.5);

    expect(body.transform.worldPosition.x).toBeCloseTo(2, 5);
    const point = new Vector3(1.5, 0, 0);
    camera.worldToScreenPoint(point, point);
    expect(red(point.x, point.y)).toBeGreaterThan(240);
    expect(red(point.x + 8, point.y)).toBeLessThan(10);
    press(point.x, point.y);
    expect(onDown).toHaveBeenCalledOnce();
  });

  it("picks a moving world-space canvas using the same sample as the moving camera", () => {
    const body = engine.sceneManager.activeScene.createRootEntity();
    const worldCanvas = body.createChild();
    worldCanvas.addComponent(UICanvas);
    const onDown = vi.fn();
    addImage(worldCanvas, 0.25, onDown);
    moveEachTick(body);
    moveEachTick(camera.entity);
    frame(2.5);

    expect(red(64, 64)).toBeGreaterThan(240);
    press(64, 64, 1);
    expect(onDown).toHaveBeenCalledOnce();
  });

  it("keeps a screen-space camera canvas and its input aligned during interpolation", () => {
    const canvasEntity = engine.sceneManager.activeScene.createRootEntity();
    const cameraCanvas = canvasEntity.addComponent(UICanvas);
    cameraCanvas.renderMode = CanvasRenderMode.ScreenSpaceCamera;
    cameraCanvas.camera = camera;
    const onDown = vi.fn();
    addImage(canvasEntity, 20, onDown);
    moveEachTick(camera.entity);
    frame(2.5);

    expect(camera.entity.transform.worldPosition.x).toBeCloseTo(2, 5);
    expect(canvasEntity.transform.worldPosition.x).toBeCloseTo(2, 5);
    expect(red(64, 64)).toBeGreaterThan(240);
    expect(red(72, 64)).toBeLessThan(10);
    press(64, 64);
    expect(onDown).toHaveBeenCalledOnce();
  });

  it("draws and picks a nested overlay in the same pixels after shifting the scene", () => {
    const scene = engine.sceneManager.activeScene;
    const canvasEntity = scene.createRootEntity().createChild();
    canvasEntity.addComponent(UICanvas).renderMode = CanvasRenderMode.ScreenSpaceOverlay;
    const onDown = vi.fn();
    addImage(canvasEntity, 20, onDown);
    frame(0);
    expect(red(64, 64)).toBeGreaterThan(240);

    scene.physics.shiftOrigin(new Vector3(1000, 200, -1000));
    press(64, 64);
    expect(red(64, 64)).toBeGreaterThan(240);
    expect(onDown).toHaveBeenCalledOnce();
  });
});
