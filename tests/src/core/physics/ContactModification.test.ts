import { BoxCollider, Rigidbody, Scene, Script, SphereCollider, WebGLEngine } from "@galacean/engine";
import type { ContactModification } from "@galacean/engine";
import { Ray, Vector3 } from "@galacean/engine-math";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhysics } from "../../utils/physics";

describe("Contact modification", () => {
  let engine: WebGLEngine;
  let backend: ReturnType<typeof createPhysics>;
  let scene: Scene;

  beforeAll(async () => {
    backend = createPhysics();
    engine = await WebGLEngine.create({ canvas: document.createElement("canvas"), physics: backend });
  });

  beforeEach(() => {
    scene = new Scene(engine, "modifiable contacts");
    engine.sceneManager.addScene(scene);
    scene.physics.autoSimulation = false;
    scene.physics.gravity.set(0, 0, 0);
  });

  afterEach(() => scene.destroy());
  afterAll(() => engine.destroy());

  function createPair(ccd = false) {
    const wall = scene.createRootEntity("wall").addComponent(BoxCollider);
    wall.size.set(0.1, 4, 4);

    const projectile = scene.createRootEntity("projectile");
    projectile.transform.setPosition(ccd ? -2.5 : -0.23, 0, 0);
    const sphere = projectile.addComponent(SphereCollider);
    sphere.radius = 0.2;
    const body = projectile.addComponent(Rigidbody);
    body.useCCD = ccd;
    body.linearVelocity.set(ccd ? 300 : 4, 0, 0);
    return { wall, sphere, body };
  }

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true]
  ])("changes the solved impulse for CCD=%s and opt-in=%s", (ccd, enabled) => {
    const { wall, sphere, body } = createPair(ccd);
    wall.contactEventsEnabled = sphere.contactEventsEnabled = false;
    expect(wall.contactModificationEnabled).toBe(false);
    wall.contactModificationEnabled = enabled;
    const point = new Vector3();
    const normal = new Vector3();
    const modifier = vi.fn((batch: ContactModification) => {
      expect(batch.isCCD).toBe(ccd);
      for (let pair = 0; pair < batch.pairCount; pair++) {
        const first = batch.getCollider(pair, 0);
        expect([first, batch.getCollider(pair, 1)]).toEqual(first === wall ? [wall, sphere] : [sphere, wall]);
        const count = batch.getContactCount(pair);
        expect(count).toBeGreaterThan(0);
        for (let contact = 0; contact < count; contact++) {
          expect(Math.abs(batch.getPoint(pair, contact, point).x)).toBeLessThan(0.12);
          expect(batch.getNormal(pair, contact, normal).x).toBeCloseTo(first === wall ? 1 : -1);
          batch.ignoreContact(pair, contact);
        }
      }
    });
    scene.physics.contactModifier = modifier;
    scene.physics.step();

    if (enabled) {
      expect(modifier).toHaveBeenCalled();
      expect(body.linearVelocity.x).toBeGreaterThan(ccd ? 295 : 3.9);
    } else {
      expect(modifier).not.toHaveBeenCalled();
      expect(body.linearVelocity.x).toBeLessThan(0.1);
    }
    if (ccd) expect(sphere.entity.transform.worldPosition.x > 0).toBe(enabled);
  });

  it("switches either collider or the callback without restarting a persistent contact", () => {
    const { wall, sphere } = createPair();
    scene.physics.gravity.set(10, 0, 0);
    const enter = vi.fn();
    const exit = vi.fn();
    sphere.entity.addComponent(
      class extends Script {
        override onCollisionEnter = enter;
        override onCollisionExit = exit;
      }
    );
    const physics = scene.physics;
    const modifier = vi.fn();
    physics.contactModifier = modifier;

    physics.step();
    expect(enter).toHaveBeenCalledTimes(1);
    expect(modifier).not.toHaveBeenCalled();
    wall.contactModificationEnabled = true;
    physics.step();
    expect(modifier).toHaveBeenCalled();

    modifier.mockClear();
    sphere.contactModificationEnabled = true;
    wall.contactModificationEnabled = false;
    physics.step();
    expect(modifier).toHaveBeenCalled();

    modifier.mockClear();
    sphere.contactModificationEnabled = false;
    physics.step();
    expect(modifier).not.toHaveBeenCalled();

    sphere.contactModificationEnabled = true;
    physics.contactModifier = null;
    physics.step();
    expect(modifier).not.toHaveBeenCalled();
    const replacement = vi.fn();
    physics.contactModifier = replacement;
    physics.step();
    expect(replacement).toHaveBeenCalled();
    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("expires the borrowed batch and rethrows an error only after completing the step", () => {
    const { wall, body } = createPair();
    wall.contactModificationEnabled = true;
    const physics = scene.physics;
    const ray = new Ray(new Vector3(-4, 0, 0), new Vector3(1, 0, 0));
    const error = new Error("test modifier");
    let borrowed: ContactModification;
    const enter = vi.fn(() => {
      throw new Error("later collision event");
    });
    body.entity.addComponent(
      class extends Script {
        override onCollisionEnter = enter;
      }
    );
    physics.contactModifier = (batch) => {
      borrowed = batch;
      expect(() => batch.getPoint(0, 0.5, new Vector3())).toThrow(RangeError);
      expect(() => scene.destroy()).toThrow(/unavailable in a contact modifier/);
      expect(() => engine.destroy()).toThrow(/unavailable in a contact modifier/);
      expect(() => backend.destroy()).toThrow(/unavailable in a contact modifier/);
      expect(() => engine.update()).toThrow(/unavailable in a contact modifier/);
      expect(() => wall.destroy()).toThrow(/unavailable in a contact modifier/);
      expect(() => (wall.enabled = false)).toThrow(/unavailable in a contact modifier/);
      expect(() => wall.entity.destroy()).toThrow(/unavailable in a contact modifier/);
      expect(() => (wall.entity.isActive = false)).toThrow(/unavailable in a contact modifier/);
      expect(() => physics.raycast(ray)).toThrow(/unavailable in a contact modifier/);
      expect(() => (physics.contactModifier = null)).toThrow(/unavailable in a contact modifier/);
      throw error;
    };

    expect(() => physics.step()).toThrow(error);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(body.linearVelocity.x).toBeLessThan(0.1);
    expect(() => borrowed.pairCount).toThrow(/only available during its callback/);
    physics.contactModifier = null;
    expect(physics.raycast(ray)).toBe(true);
    expect(() => physics.step()).not.toThrow();
  });
});
