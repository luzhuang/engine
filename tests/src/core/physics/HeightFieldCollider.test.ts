import {
  AssetType,
  HeightFieldCollider,
  HitResult,
  Ray,
  Rigidbody,
  Scene,
  SphereCollider,
  Vector3,
  WebGLEngine
} from "@galacean/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPhysics } from "../../utils/physics";

describe("HeightFieldCollider", () => {
  let engine: WebGLEngine;

  beforeAll(async () => {
    engine = await WebGLEngine.create({ canvas: document.createElement("canvas"), physics: createPhysics() });
  });

  afterAll(() => engine.destroy());

  it("loads a terrain grid from a serialized component call", async () => {
    const data = {
      version: "2.0",
      refs: [],
      entities: [{ components: [0] }],
      components: [
        {
          type: "HeightFieldCollider",
          calls: [{ method: "setHeightField", args: [{ rows: 2, columns: 2, heights: [3, 3, 3, 3] }] }]
        }
      ],
      scene: { rootEntities: [0], background: { mode: 0, color: [0, 0, 0, 1] } }
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    let scene: Scene | undefined;
    try {
      scene = await engine.resourceManager.load<Scene>({ url, type: AssetType.Scene });
      engine.sceneManager.addScene(scene);
      const hit = new HitResult();
      const ray = new Ray(new Vector3(0.5, 10, 0.5), new Vector3(0, -1, 0));
      expect(scene.physics.raycast(ray, hit)).toBe(true);
      expect(hit.collider).toBeInstanceOf(HeightFieldCollider);
      expect(hit.point.y).toBeCloseTo(3, 3);
    } finally {
      scene?.destroy();
      URL.revokeObjectURL(url);
    }
  });

  it("uses signed elevations, grid axes and world scale through clone and replacement", () => {
    const scene = engine.sceneManager.activeScene;
    const entity = scene.createRootEntity("terrain");
    const collider = entity.addComponent(HeightFieldCollider);
    const hit = new HitResult();
    const ray = new Ray(new Vector3(3, 30, 3), new Vector3(0, -1, 0));
    const heights = new Int16Array([-4, -2, 4, 6, 12, 14]);
    collider.setHeightField({ rows: 3, columns: 2, heights, rowScale: 2, columnScale: 4, heightScale: 0.5 });
    heights.fill(99);
    const clone = entity.clone();
    scene.addRootEntity(clone);
    clone.transform.setPosition(10, 0, 0);
    try {
      expect(scene.physics.raycast(ray, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(4.75, 3);
      expect(hit.collider).toBe(collider);

      entity.transform.setScale(2, 3, 1);
      ray.origin.x = 6;
      expect(scene.physics.raycast(ray, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(14.25, 3);

      expect(() => collider.setHeightField({ rows: 2, columns: 2, heights: [0, 0, 0, 32768] })).toThrow();
      expect(scene.physics.raycast(ray, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(14.25, 3);

      collider.setHeightField({ rows: 2, columns: 2, heights: [-2, -2, -2, -2], rowScale: 4, columnScale: 4 });
      expect(scene.physics.raycast(ray, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(-6, 3);
      collider.setHeightField(null);
      expect(scene.physics.raycast(ray, hit)).toBe(false);

      ray.origin.x = 13;
      expect(scene.physics.raycast(ray, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(4.75, 3);
      expect(hit.collider).toBe(clone.getComponent(HeightFieldCollider));
    } finally {
      clone.destroy();
      entity.destroy();
    }
  });

  it("supports a dynamic sphere from a kinematic terrain body", () => {
    const scene = engine.sceneManager.activeScene;
    const root = scene.createRootEntity("terrain contact");
    const terrain = root.createChild();
    const body = terrain.addComponent(Rigidbody);
    body.isKinematic = true;
    terrain.addComponent(HeightFieldCollider).setHeightField({
      rows: 2,
      columns: 2,
      heights: [-2, -2, -2, -2],
      rowScale: 6,
      columnScale: 6
    });
    const ball = root.createChild();
    ball.transform.setPosition(3, 2, 3);
    ball.addComponent(SphereCollider).radius = 0.5;
    ball.addComponent(Rigidbody);
    try {
      for (let i = 0; i < 90; i++) scene.physics._update(scene.physics.fixedTimeStep);
      expect(ball.transform.worldPosition.y).toBeCloseTo(-1.5, 2);
    } finally {
      root.destroy();
    }
  });
});
