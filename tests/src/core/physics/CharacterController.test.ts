import { createPhysics } from "../../utils/physics";
import {
  BoxCollider,
  CharacterController,
  CharacterControllerGeometry,
  ControllerClimbingMode,
  ControllerColliderHit,
  ControllerCollisionFlag,
  ControllerNonWalkableMode,
  Entity,
  HitResult,
  Layer,
  MeshCollider,
  ModelMesh,
  PhysicsScene,
  PlaneCollider,
  Rigidbody,
  Scene,
  Script,
  Transform
} from "@galacean/engine-core";
import { WebGLEngine } from "@galacean/engine";
import { Quaternion, Ray, Vector3 } from "@galacean/engine-math";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("CharacterController", () => {
  let engine: WebGLEngine;
  let root: Entity;
  let role: Entity;
  let controller: CharacterController;
  let physics: PhysicsScene;

  beforeAll(async () => {
    engine = await WebGLEngine.create({ canvas: document.createElement("canvas"), physics: createPhysics() });
    physics = engine.sceneManager.activeScene.physics;
  });

  beforeEach(() => {
    root = engine.sceneManager.activeScene.createRootEntity("controllers");
    role = root.createChild("role");
    controller = role.addComponent(CharacterController);
    controller.geometry = CharacterControllerGeometry.Box;
    addPlane(new Vector3(), new Quaternion());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    physics.autoSimulation = true;
    root.destroy();
    engine.resourceManager.gc();
  });

  afterAll(() => engine.destroy());

  function addPlane(position: Vector3, rotation: Quaternion): Entity {
    const entity = root.createChild("plane");
    entity.transform.position = position;
    entity.transform.rotationQuaternion = rotation;
    entity.addComponent(PlaneCollider);
    return entity;
  }

  function addBox(size: Vector3, position: Vector3): BoxCollider {
    const box = root.createChild("box").addComponent(BoxCollider);
    box.size = size;
    box.entity.transform.position = position;
    return box;
  }

  function move(displacement: Vector3): number {
    return controller.move(displacement, 0.0001, physics.fixedTimeStep);
  }

  function update(count = 1): void {
    for (let i = 0; i < count; i++) physics._update(physics.fixedTimeStep);
  }

  function walkTo(position: Vector3, steps: number): void {
    const displacement = position
      .clone()
      .subtract(role.transform.position)
      .scale(1 / steps);
    let fallingTime = 0;
    for (let i = 0; i < steps; i++) {
      const flags = move(displacement);
      if (flags & ControllerCollisionFlag.Down) fallingTime = 0;
      else {
        fallingTime += physics.fixedTimeStep;
        move(new Vector3(0, -9.8 * physics.fixedTimeStep * fallingTime, 0));
      }
    }
  }

  it("defaults to inline capsule geometry and standard movement settings", () => {
    const capsule = root.createChild("capsule").addComponent(CharacterController);
    expect(capsule.contactOffset).toBe(0.02);
    expect(capsule.geometry).toBe(CharacterControllerGeometry.Capsule);
    expect(capsule.radius).toBe(0.5);
    expect(capsule.height).toBe(2);
    expect(capsule.size.x).toBe(1);
    expect(capsule.size.y).toBe(1);
    expect(capsule.size.z).toBe(1);
    expect(capsule.detectCollisions).toBe(true);
    expect(capsule.stepOffset).toBe(0.5);
    expect(capsule.climbingMode).toBe(ControllerClimbingMode.Constrained);
    expect(capsule.nonWalkableMode).toBe(ControllerNonWalkableMode.PreventClimbing);
    expect(capsule.upDirection.x).toBe(0);
    expect(capsule.upDirection.y).toBe(1);
    expect(capsule.upDirection.z).toBe(0);
    expect(capsule.slopeLimit).toBe(45);
    expect(capsule.invisibleWallHeight).toBe(0);
    expect(capsule.maxJumpHeight).toBe(0);
  });

  it.each([CharacterControllerGeometry.Box, CharacterControllerGeometry.Capsule])(
    "resizes at a fixed foot position and teleports by the foot in world space (geometry=%s)",
    (geometry) => {
      role.transform.setPosition(0, 4, 0);
      role.transform.setScale(1, 2, 1);
      controller.geometry = geometry;
      controller.size.y = 2;
      controller.contactOffset = 0.25;
      const foot = new Vector3();
      expect(controller.getFootPosition(foot)).toBe(true);
      expect(foot.y).toBeCloseTo(1.75);

      expect(controller.resize(3)).toBe(true);
      expect(role.transform.worldPosition.y).toBeCloseTo(5);
      expect(geometry === CharacterControllerGeometry.Box ? controller.size.y : controller.height).toBe(3);
      expect(controller.getFootPosition(foot)).toBe(true);
      expect(foot.y).toBeCloseTo(1.75);
      expect(controller.resize(0)).toBe(false);

      expect(controller.setFootPosition(new Vector3(3, 5, 0))).toBe(true);
      expect(role.transform.worldPosition.y).toBeCloseTo(8.25);
      expect(controller.getFootPosition(foot)).toBe(true);
      expect([foot.x, foot.y, foot.z]).toEqual([3, 5, 0]);
      const hit = new HitResult();
      expect(physics.raycast(new Ray(new Vector3(3, 8.25, -3), new Vector3(0, 0, 1)), 5, hit)).toBe(true);
      expect(hit.collider).toBe(controller);
      expect(physics.raycast(new Ray(new Vector3(0, 5, -3), new Vector3(0, 0, 1)), 5)).toBe(false);

      controller.enabled = false;
      expect(controller.getFootPosition(foot)).toBe(false);
      expect([foot.x, foot.y, foot.z]).toEqual([3, 5, 0]);
    }
  );

  it("applies the ceiling slide setting before controller creation and during movement", () => {
    const scene = new Scene(engine);
    try {
      engine.sceneManager.addScene(scene);
      expect(scene.physics.characterControllerSlideOnCeiling).toBe(true);
      scene.physics.characterControllerSlideOnCeiling = false;
      const ceiling = scene.createRootEntity("Sloped ceiling");
      ceiling.transform.setPosition(0, 6, 0);
      ceiling.transform.setRotation(0, 0, 135);
      ceiling.addComponent(PlaneCollider);

      const character = scene.createRootEntity("Character");
      character.transform.setPosition(0, 3, 0);
      const actor = character.addComponent(CharacterController);
      actor.stepOffset = 0;
      const jump = new Vector3(0, 5, 0);
      expect(actor.move(jump) & ControllerCollisionFlag.Up).toBe(ControllerCollisionFlag.Up);
      expect(character.transform.worldPosition.x).toBeCloseTo(0, 4);

      character.transform.setPosition(0, 3, 0);
      scene.physics.characterControllerSlideOnCeiling = true;
      expect(actor.move(jump) & ControllerCollisionFlag.Up).toBe(ControllerCollisionFlag.Up);
      expect(Math.abs(character.transform.worldPosition.x)).toBeGreaterThan(0.5);
    } finally {
      scene.destroy();
    }
  });

  it("selects the precise box sweep when the scene setting changes", () => {
    const obstacle = addBox(new Vector3(1, 1.7, 1.2), new Vector3(1, 3, 0));
    obstacle.entity.transform.setRotation(0, 0, 30);
    controller.stepOffset = 0;
    controller.contactOffset = 0.1;
    controller.slopeLimit = 90;
    const displacement = new Vector3(7, 0, 0);

    expect(physics.characterControllerPreciseSweeps).toBe(true);
    try {
      role.transform.setPosition(-3, 4, 1);
      expect(move(displacement) & ControllerCollisionFlag.Sides).toBe(ControllerCollisionFlag.Sides);
      expect(role.transform.position.x).toBeLessThan(0);

      physics.characterControllerPreciseSweeps = false;
      role.transform.setPosition(-3, 4, 1);
      expect(move(displacement) & ControllerCollisionFlag.Sides).toBe(ControllerCollisionFlag.Sides);
      expect(role.transform.position.x).toBeGreaterThan(2);
    } finally {
      physics.characterControllerPreciseSweeps = true;
    }
  });

  it("applies the scene overlap recovery setting to character movement", () => {
    controller.geometry = CharacterControllerGeometry.Capsule;
    addBox(new Vector3(2, 10, 10), new Vector3(0, 5, 0));
    const displacement = new Vector3(0.01, 0, 0);
    expect(physics.characterControllerOverlapRecovery).toBe(true);
    try {
      physics.characterControllerOverlapRecovery = false;
      role.transform.setPosition(0.9, 5, 0);
      controller.move(displacement);
      expect(role.transform.worldPosition.x).toBeLessThan(1);

      physics.characterControllerOverlapRecovery = true;
      role.transform.setPosition(0.9, 5, 0);
      controller.move(displacement);
      expect(role.transform.worldPosition.x).toBeGreaterThan(1.49);
    } finally {
      physics.characterControllerOverlapRecovery = true;
    }
  });

  it("changes whether a capsule can climb above its step offset", () => {
    controller.geometry = CharacterControllerGeometry.Capsule;
    controller.stepOffset = 0.05;
    addBox(new Vector3(1, 0.25, 3), new Vector3(0, 0.125, 0));
    const displacement = new Vector3(0.06, -0.02, 0);
    const approachStep = () => {
      role.transform.setPosition(-1.25, 1.02, 0);
      for (let i = 0; i < 24; i++) controller.move(displacement);
      return role.transform.worldPosition.x;
    };

    expect(approachStep()).toBeLessThan(-0.9);
    controller.climbingMode = ControllerClimbingMode.Easy;
    expect(approachStep()).toBeGreaterThan(0);
  });

  it("reports solid sweep contacts with the published position and world-space hit data", () => {
    const wall = addBox(new Vector3(1, 5, 5), new Vector3(2, 5, 0));
    addBox(new Vector3(0.2, 5, 5), new Vector3(0.75, 5, 0)).isTrigger = true;
    role.transform.setPosition(0, 5, 0);
    controller.stepOffset = 0;
    class Recorder extends Script {
      onControllerColliderHit = vi.fn((hit: ControllerColliderHit) => {
        expect(hit.controller).toBe(controller);
        expect(hit.collider).toBe(wall);
        expect(role.transform.worldPosition.x).toBeCloseTo(0.98);
        expect(hit.point.x).toBeCloseTo(1.5);
        expect(hit.normal.x).toBeCloseTo(-1);
        expect(hit.moveDirection.x).toBeCloseTo(1);
        expect(hit.moveLength).toBeGreaterThan(0);
      });
    }
    const recorder = role.addComponent(Recorder);
    expect(controller.move(new Vector3(5, 0, 0)) & ControllerCollisionFlag.Sides).toBeTruthy();
    expect(recorder.onControllerColliderHit).toHaveBeenCalled();
  });

  it("reports other controllers only when their layers collide", () => {
    role.transform.setPosition(0, 5, 0);
    controller.collisionLayer = Layer.Layer1;
    controller.stepOffset = 0;
    const target = root.createChild("target");
    target.transform.setPosition(2, 5, 0);
    const other = target.addComponent(CharacterController);
    other.geometry = CharacterControllerGeometry.Box;
    other.collisionLayer = Layer.Layer2;
    class Recorder extends Script {
      onControllerColliderHit = vi.fn((hit: ControllerColliderHit) => expect(hit.collider).toBe(other));
    }
    const recorder = role.addComponent(Recorder);
    const prior = physics.getColliderLayerCollision(Layer.Layer1, Layer.Layer2);
    const offset = new Vector3(5, 0, 0);
    try {
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, false);
      expect(controller.move(offset)).toBe(ControllerCollisionFlag.None);
      expect(recorder.onControllerColliderHit).not.toHaveBeenCalled();

      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, true);
      role.transform.setPosition(0, 5, 0);
      expect(controller.move(offset) & ControllerCollisionFlag.Sides).toBeTruthy();
      expect(recorder.onControllerColliderHit).toHaveBeenCalled();
    } finally {
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, prior);
    }
  });

  it("keeps the outer hit intact during a nested move and allows destruction in the callback", () => {
    const outerWall = addBox(new Vector3(1, 2, 1), new Vector3(2, 5, 0));
    const innerWall = addBox(new Vector3(1, 2, 1), new Vector3(3, 5, 6));
    role.transform.setPosition(0, 5, 0);
    controller.stepOffset = 0;
    const target = root.createChild("inner");
    target.transform.setPosition(0, 5, 6);
    const inner = target.addComponent(CharacterController);
    inner.stepOffset = 0;
    const offset = new Vector3(5, 0, 0);
    class InnerRecorder extends Script {
      onControllerColliderHit = vi.fn((hit: ControllerColliderHit) => expect(hit.collider).toBe(innerWall));
    }
    const innerRecorder = target.addComponent(InnerRecorder);
    class OuterRecorder extends Script {
      override onControllerColliderHit(hit: ControllerColliderHit): void {
        expect(hit.collider).toBe(outerWall);
        const pointX = hit.point.x;
        inner.move(offset);
        expect(hit.collider).toBe(outerWall);
        expect(hit.point.x).toBe(pointX);
        hit.controller.destroy();
      }
    }
    role.addComponent(OuterRecorder);
    controller.move(offset);
    expect(innerRecorder.onControllerColliderHit).toHaveBeenCalled();
    expect(controller.destroyed).toBe(true);
  });

  it("keeps exclusions separate when reading a displacement triggers another move", () => {
    role.transform.setPosition(0, 5, 0);
    controller.stepOffset = 0;
    const outerWall = addBox(new Vector3(1, 2, 1), new Vector3(2, 5, 0));
    const innerWall = addBox(new Vector3(1, 2, 1), new Vector3(2, 5, 6));
    const target = root.createChild("inner");
    target.transform.setPosition(0, 5, 6);
    const inner = target.addComponent(CharacterController);
    inner.stepOffset = 0;
    const offset = new Vector3(5, 0, 0);
    let nestedFlags: ControllerCollisionFlag | undefined;
    class NestedDisplacement extends Vector3 {
      override get x(): number {
        nestedFlags ??= inner.move(offset, 0, undefined, { exclude: [innerWall] });
        return offset.x;
      }
    }

    const flags = controller.move(new NestedDisplacement(), 0, undefined, { exclude: [outerWall] });
    expect(flags).toBe(ControllerCollisionFlag.None);
    expect(nestedFlags).toBe(ControllerCollisionFlag.None);
    expect(role.transform.worldPosition.x).toBeCloseTo(5);
    expect(target.transform.worldPosition.x).toBeCloseTo(5);
  });

  it("preserves the authored position when a move filter disables the controller", () => {
    role.transform.setPosition(0, 5, 0);
    controller.move(new Vector3());
    const flags = controller.move(new Vector3(5, 0, 0), 0, undefined, {
      get layerMask(): Layer {
        controller.enabled = false;
        role.transform.setPosition(2, 5, 0);
        return Layer.Layer31;
      }
    });

    expect(flags).toBe(ControllerCollisionFlag.None);
    expect(role.transform.worldPosition.x).toBe(2);
  });

  it("blocks its own movement while allowing another controller through after a geometry rebuild", () => {
    role.transform.setPosition(0, 3, 0);
    controller.stepOffset = 0;
    const target = root.createChild("target");
    target.transform.setPosition(3, 3, 0);
    const other = target.addComponent(CharacterController);
    other.stepOffset = 0;
    const left = new Vector3(-5, 0, 0);

    expect(other.move(left) & ControllerCollisionFlag.Sides).toBe(ControllerCollisionFlag.Sides);

    target.transform.setPosition(3, 3, 0);
    controller.detectCollisions = false;
    expect(move(new Vector3(5, 0, 0)) & ControllerCollisionFlag.Sides).toBe(ControllerCollisionFlag.Sides);
    role.transform.setPosition(0, 3, 0);

    controller.geometry = CharacterControllerGeometry.Capsule;
    const hit = new HitResult();
    const ray = new Ray(new Vector3(0, 3, -3), new Vector3(0, 0, 1));
    expect(physics.raycast(ray, hit)).toBe(true);
    expect(hit.collider).toBe(controller);
    expect(other.move(left)).toBe(ControllerCollisionFlag.None);
    expect(target.transform.worldPosition.x).toBeCloseTo(-2);

    controller.enabled = false;
    controller.enabled = true;
    target.transform.setPosition(3, 3, 0);
    expect(other.move(left)).toBe(ControllerCollisionFlag.None);

    controller.detectCollisions = true;
    target.transform.setPosition(3, 3, 0);
    expect(other.move(left) & ControllerCollisionFlag.Sides).toBe(ControllerCollisionFlag.Sides);
  });

  it("allows an incoming dynamic body through when detectCollisions is false", () => {
    role.transform.setPosition(0, 3, 0);
    const falling = addBox(new Vector3(0.5, 0.5, 0.5), new Vector3(0, 5, 0)).entity;
    const body = falling.addComponent(Rigidbody);
    physics.autoSimulation = false;

    for (let i = 0; i < 120; i++) physics.step();
    expect(falling.transform.worldPosition.y).toBeGreaterThan(3);

    controller.detectCollisions = false;
    body.wakeUp();
    for (let i = 0; i < 120; i++) physics.step();
    expect(falling.transform.worldPosition.y).toBeCloseTo(0.25, 1);
  });

  it("starts and ends trigger overlaps when detectCollisions changes", () => {
    role.transform.setPosition(0, 3, 0);
    controller.detectCollisions = false;
    const trigger = addBox(new Vector3(2, 2, 2), new Vector3(0, 3, 0));
    trigger.isTrigger = true;
    class TriggerRecorder extends Script {
      onTriggerEnter = vi.fn();
      onTriggerStay = vi.fn();
      onTriggerExit = vi.fn();
    }
    const recorder = trigger.entity.addComponent(TriggerRecorder);
    physics.autoSimulation = false;

    physics.step();
    expect(recorder.onTriggerEnter).not.toHaveBeenCalled();

    controller.detectCollisions = true;
    physics.step();
    expect(recorder.onTriggerEnter).toHaveBeenCalledExactlyOnceWith(controller, trigger);

    controller.detectCollisions = false;
    recorder.onTriggerStay.mockClear();
    physics.step();
    physics.step();
    expect(recorder.onTriggerExit).toHaveBeenCalledExactlyOnceWith(controller, trigger);
    expect(recorder.onTriggerStay).not.toHaveBeenCalled();
  });

  it("keeps an overlapping trigger active after disabling and re-enabling collisions between steps", () => {
    role.transform.setPosition(0, 3, 0);
    const trigger = addBox(new Vector3(2, 2, 2), new Vector3(0, 3, 0));
    trigger.isTrigger = true;
    class TriggerRecorder extends Script {
      onTriggerStay = vi.fn();
    }
    const recorder = trigger.entity.addComponent(TriggerRecorder);
    physics.autoSimulation = false;

    physics.step();
    physics.step();
    expect(recorder.onTriggerStay).toHaveBeenCalledWith(controller, trigger);

    controller.detectCollisions = false;
    controller.detectCollisions = true;
    physics.step();
    recorder.onTriggerStay.mockClear();
    physics.step();
    expect(recorder.onTriggerStay).toHaveBeenCalledExactlyOnceWith(controller, trigger);
  });

  it("lets a controller-hit script apply an impulse to the contacted Rigidbody", () => {
    const box = addBox(new Vector3(1, 2, 1), new Vector3(2, 5, 0));
    const body = box.entity.addComponent(Rigidbody);
    body.useGravity = false;
    role.transform.setPosition(0, 5, 0);
    controller.stepOffset = 0;
    const impulse = new Vector3(2, 0, 0);
    class PushBox extends Script {
      override onControllerColliderHit(hit: ControllerColliderHit): void {
        hit.collider.attachedRigidbody?.applyImpulseAtPosition(impulse, hit.point);
      }
    }
    role.addComponent(PushBox);
    physics.autoSimulation = false;
    controller.move(new Vector3(5, 0, 0));
    physics.step();
    expect(body.linearVelocity.x).toBeGreaterThan(1);
  });

  it.each([false, true])("follows a moving platform after changing layer rules (another scene=%s)", (otherScene) => {
    const separate = otherScene ? new Scene(engine, "other") : undefined;
    if (separate) engine.sceneManager.addScene(separate);
    const filterScene = separate?.physics ?? physics;
    const platform = addBox(new Vector3(8, 1, 8), new Vector3(0, 4, 0));
    const body = platform.entity.addComponent(Rigidbody);
    body.isKinematic = true;
    controller.geometry = CharacterControllerGeometry.Capsule;
    role.transform.setPosition(2, 5.54, 0);
    controller.stepOffset = 0;
    const downward = new Vector3(0, -0.05, 0);
    physics.autoSimulation = false;
    physics.step();
    controller.move(downward);
    expect(controller.isGrounded).toBe(true);

    body.move(new Vector3(1, 4.5, 0));
    physics.step();
    try {
      filterScene.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, false);
      controller.move(downward);
    } finally {
      filterScene.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, true);
      separate?.destroy();
    }
    expect(role.transform.worldPosition.x).toBeCloseTo(3);
    expect(role.transform.worldPosition.y).toBeCloseTo(6.02);

    const turn = new Quaternion();
    Quaternion.rotationY(Math.PI / 2, turn);
    body.move(turn);
    physics.step();
    controller.move(downward);
    expect(role.transform.worldPosition.x).toBeCloseTo(1);
    expect(role.transform.worldPosition.z).toBeCloseTo(-2);
    expect(role.transform.worldRotationQuaternion.w).toBe(1);
    expect(controller.isGrounded).toBe(true);
  });

  it("follows a moving platform through a wall excluded for one move", () => {
    const platform = addBox(new Vector3(8, 1, 8), new Vector3(0, 4, 0));
    const wall = addBox(new Vector3(1, 3, 3), new Vector3(3.6, 5.8, 0));
    const body = platform.entity.addComponent(Rigidbody);
    body.isKinematic = true;
    controller.geometry = CharacterControllerGeometry.Capsule;
    controller.stepOffset = 0;
    role.transform.setPosition(2, 5.54, 0);
    physics.autoSimulation = false;
    const downward = new Vector3(0, -0.05, 0);

    physics.step();
    controller.move(downward);
    expect(controller.isGrounded).toBe(true);

    body.move(new Vector3(1, 4.5, 0));
    physics.step();
    controller.move(downward, 0, undefined, { exclude: [wall] });
    expect(role.transform.worldPosition.x).toBeCloseTo(3);
    expect(role.transform.worldPosition.y).toBeCloseTo(6.02);
    expect(controller.isGrounded).toBe(true);

    const turn = new Quaternion();
    Quaternion.rotationY(Math.PI / 2, turn);
    body.move(turn);
    physics.step();
    controller.move(downward);
    expect(role.transform.worldPosition.x).toBeCloseTo(1);
    expect(role.transform.worldPosition.z).toBeCloseTo(-2);
    expect(controller.isGrounded).toBe(true);

    body.move(new Vector3(2, 4.5, 0));
    physics.step();
    controller.move(downward, 0, undefined, { exclude: [platform] });
    expect(role.transform.worldPosition.x).toBeCloseTo(1);
    expect(controller.isGrounded).toBe(false);
  });

  it("mirrors the center offset when the controller's scale is negative", () => {
    role.transform.setScale(-1, 1, 1);
    controller.center.set(1, 0, 0);
    const foot = new Vector3();
    expect(controller.getFootPosition(foot)).toBe(true);
    expect(foot.x).toBeCloseTo(-1);
  });

  it("clones authored box size and syncs subsequent mutations on the clone", () => {
    controller.size.set(1, 2, 1);
    const clone = role.clone();
    clone.transform.setPosition(3, 3, 0);
    root.addChild(clone);
    const cloneController = clone.getComponent(CharacterController);
    const ray = new Ray(new Vector3(4, 3, -3), new Vector3(0, 0, 1));
    const hit = new HitResult();

    expect(cloneController.size.y).toBe(2);
    expect(physics.raycast(ray, 6)).toBe(false);
    cloneController.size.x = 3;
    expect(controller.size.x).toBe(1);
    expect(physics.raycast(ray, 6, hit)).toBe(true);
    expect(hit.collider).toBe(cloneController);
  });

  it("keeps the controller center when a Transform getter queries the scene during sync", () => {
    const cast = (x: number, y: number) => physics.raycast(new Ray(new Vector3(x, y, -3), new Vector3(0, 0, 1)), 5);
    let queryDuringSync = false;
    let nestedResult: boolean | undefined;
    class QueryingTransform extends Transform {
      override get worldPosition(): Vector3 {
        if (queryDuringSync) {
          queryDuringSync = false;
          nestedResult = cast(5.1, 20);
        }
        return super.worldPosition;
      }
    }

    const other = root.createChild();
    other.transform.setPosition(0, 20, 0);
    const otherController = other.addComponent(CharacterController);
    otherController.center.x = 5;
    role.addComponent(QueryingTransform).setPosition(0, 3, 0);
    controller.center.x = 2;
    expect(cast(2, 3)).toBe(true);

    otherController.center.x = 5.1;
    controller.center.x = 2.5;
    queryDuringSync = true;

    expect(cast(2.5, 3)).toBe(true);
    expect(nestedResult).toBe(true);
    expect(cast(5.1, 3)).toBe(false);
  });

  it("keeps the moved position when its Transform setter queries the scene and moves another controller", () => {
    const other = root.createChild();
    other.transform.setPosition(0, 20, 0);
    const otherController = other.addComponent(CharacterController);
    otherController.center.x = 5;
    const ray = new Ray(new Vector3(5.1, 20, -3), new Vector3(0, 0, 1));
    const nestedMovement = new Vector3(3, 0, 0);
    let nestedResult: boolean | undefined;

    class QueryingTransform extends Transform {
      override get worldPosition(): Vector3 {
        return super.worldPosition;
      }

      override set worldPosition(value: Vector3) {
        otherController.center.x = 5.1;
        nestedResult = physics.raycast(ray, 5);
        otherController.move(nestedMovement, 0, 1 / 60);
        super.worldPosition = value;
      }
    }

    const transform = role.addComponent(QueryingTransform);
    transform.setPosition(0, 3, 0);
    move(new Vector3(2, 0, 0));

    expect(nestedResult).toBe(true);
    expect(transform.worldPosition.x).toBeCloseTo(2);
    expect(other.transform.worldPosition.x).toBeCloseTo(3);
  });

  it("writes the world position immediately when moved under a transformed parent", () => {
    root.transform.setPosition(10, 20, 30);
    root.transform.setScale(2, 2, 2);
    role.transform.setPosition(1, 5, 2);
    move(new Vector3(0, 0, 1));
    expect(role.transform.worldPosition.x).toBeCloseTo(12);
    expect(role.transform.worldPosition.y).toBeCloseTo(30);
    expect(role.transform.worldPosition.z).toBeCloseTo(35);
    expect(role.transform.position.z).toBeCloseTo(2.5);
    update(2);
    expect(role.transform.worldPosition.z).toBeCloseTo(35);
  });

  it("moves during a real physics script callback", () => {
    role.transform.setPosition(0, 2, 0);
    class Movement extends Script {
      override onPhysicsUpdate(): void {
        this.entity.getComponent(CharacterController).move(new Vector3(0, 0, 0.25), 0.0001, physics.fixedTimeStep);
      }
    }
    role.addComponent(Movement);
    engine.update();
    const start = role.transform.position.z;
    update(4);
    expect(role.transform.position.z).toBeCloseTo(start + 1);
  });

  it.each([true, false])("scene-query participation %s preserves controller collisions", (enabled) => {
    role.transform.setPosition(0, 2, 0);
    const wall = addBox(new Vector3(10, 10, 1), new Vector3(0, 2, 2));
    wall.isSceneQuery = enabled;
    expect(physics.raycastAll(new Ray(new Vector3(0, 5, 0), new Vector3(0, 0, 1)))).toBe(enabled);
    expect(move(new Vector3(0, 0, 4)) & ControllerCollisionFlag.Sides).toBe(ControllerCollisionFlag.Sides);
    expect(role.transform.position.z).toBeCloseTo(0.98, 4);
  });

  it("updates upDirection before and after the first move", () => {
    expect(move(new Vector3(0, 0, 1)) & ControllerCollisionFlag.Down).toBe(ControllerCollisionFlag.Down);
    controller.upDirection = new Vector3(0, -1, 0);
    expect(move(new Vector3(0, 0, 1)) & ControllerCollisionFlag.Up).toBe(ControllerCollisionFlag.Up);
    controller.upDirection.set(0, 1, 0);
    // Move down first so the controller has a ground contact for the sideways probe.
    expect(move(new Vector3(0, -0.1, 0)) & ControllerCollisionFlag.Down).toBe(ControllerCollisionFlag.Down);
  });

  it("applies contactOffset to the collision skin immediately", () => {
    move(new Vector3(0, 0, 0.1));
    move(new Vector3(0, 0, 0.1));
    expect(role.transform.position.y).toBeCloseTo(0.52, 5);
    controller.contactOffset = 1;
    move(new Vector3(0, 0, 0.1));
    move(new Vector3(0, 0, 0.1));
    expect(role.transform.position.y).toBeCloseTo(1.5, 5);
  });

  it("rejects a nonzero rest offset", () => {
    expect(() => (controller.restOffset = 0.01)).toThrow(RangeError);
    controller.restOffset = 0;
    expect(controller.restOffset).toBe(0);
  });

  it.each([false, true])("rejects invalid contactOffset without changing its value (live=%s)", (live) => {
    controller.contactOffset = 0.3;
    if (live) move(new Vector3(0, 0, 0.1));
    for (const value of [-1, 0, NaN, Infinity, -Infinity]) {
      expect(() => (controller.contactOffset = value)).toThrow();
      expect(controller.contactOffset).toBe(0.3);
    }
    move(new Vector3(0, 0, 0.1));
    move(new Vector3(0, 0, 0.1));
    expect(role.transform.position.y).toBeCloseTo(0.8, 5);
  });

  it.each([false, true])("rejects trigger mode before and after synchronization (live=%s)", (live) => {
    if (live) move(new Vector3(0, 0, 1));
    expect(() => (controller.isTrigger = true)).toThrow();
    controller.isTrigger = false;
    expect(controller.isTrigger).toBe(false);
  });

  it("applies the step height limit without removing the controller", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    role.transform.setPosition(0, 2, 0);
    controller.size.set(1, 0.5, 1);
    const hit = new HitResult();
    const ray = new Ray(new Vector3(0, 2, 5), new Vector3(0, 0, -1));
    const canHitController = () => physics.raycast(ray, 10, hit) && hit.collider === controller;

    controller.stepOffset = 0.51;
    expect(canHitController()).toBe(true);
    controller.stepOffset = 10;
    expect(canHitController()).toBe(true);

    controller.enabled = false;
    controller.enabled = true;
    expect(canHitController()).toBe(true);
    expect(controller.stepOffset).toBe(10);
    expect(error).not.toHaveBeenCalled();

    controller.size.y = 0.6;
    expect(canHitController()).toBe(true);
  });

  it("reports unsupported getClosestPoint without changing its output", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const closest = new Vector3(1, 2, 3);
    expect(controller.getClosestPoint(new Vector3(), closest)).toBe(-1);
    expect(errors).toHaveBeenCalledOnce();
    expect(closest.x).toBe(1);
    expect(closest.y).toBe(2);
    expect(closest.z).toBe(3);
  });

  it.each([CharacterControllerGeometry.Box, CharacterControllerGeometry.Capsule])(
    "scales inline geometry and center by world scale (geometry=%s)",
    (geometry) => {
      controller.geometry = geometry;
      controller.size.set(1, 2, 1);
      controller.center = new Vector3(0, 1, 0);
      role.transform.setScale(2, 3, 4);
      role.transform.setPosition(0, 10, 0);
      const flags = move(new Vector3(0, -20, 0));
      expect(flags & ControllerCollisionFlag.Down).toBe(ControllerCollisionFlag.Down);
      expect(role.transform.position.y).toBeCloseTo(0.02, 4);
      controller.center.y = 0;
      role.transform.setPosition(0, 10, 0);
      move(new Vector3(0, -20, 0));
      expect(role.transform.position.y).toBeCloseTo(3.02, 4);
      role.transform.setScale(1, 1, 1);
      role.transform.setPosition(0, 10, 0);
      move(new Vector3(0, -20, 0));
      expect(role.transform.position.y).toBeCloseTo(1.02, 4);
    }
  );

  it("changes capsule radius and total height after creation", () => {
    controller.geometry = CharacterControllerGeometry.Capsule;
    role.transform.setPosition(0, 10, 0);
    move(new Vector3(0, -20, 0));
    expect(role.transform.position.y).toBeCloseTo(1.02, 4);
    controller.radius = 1;
    controller.height = 6;
    role.transform.setPosition(0, 10, 0);
    move(new Vector3(0, -20, 0));
    expect(role.transform.position.y).toBeCloseTo(3.02, 4);
  });

  it("updates box width through assignment and vector mutation", () => {
    controller.size = new Vector3(1, 1, 1);
    role.transform.setPosition(0, 2, 0);
    addBox(new Vector3(1, 10, 10), new Vector3(3, 2, 0));
    move(new Vector3(5, 0, 0));
    expect(role.transform.position.x).toBeCloseTo(1.98, 4);
    controller.size.x = 3;
    role.transform.setPosition(0, 2, 0);
    move(new Vector3(5, 0, 0));
    expect(role.transform.position.x).toBeCloseTo(0.98, 4);
  });

  it("updates box height to block passage under a low ceiling", () => {
    addBox(new Vector3(5, 0.4, 1), new Vector3(0, 1.5, 2));
    controller.stepOffset = 0.1;
    controller.size.set(1, 1, 1);
    role.transform.setPosition(0, 0.52, 0);
    move(new Vector3(0, 0, 3));
    expect(role.transform.position.z).toBeCloseTo(3, 4);
    controller.size.set(1, 2, 1);
    role.transform.setPosition(0, 1.02, 0);
    move(new Vector3(0, 0, 3));
    expect(role.transform.position.z).toBeLessThan(1.1);
  });

  it("switches live geometry in both directions without changing Entity position", () => {
    role.transform.setPosition(4, 5, 6);
    controller.size.set(4, 1, 1);
    const ray = new Ray(new Vector3(5.5, 10, 6), new Vector3(0, -1, 0));
    const hit = new HitResult();
    expect(physics.raycast(ray, hit)).toBe(true);
    expect(hit.collider === controller).toBe(true);
    controller.geometry = CharacterControllerGeometry.Capsule;
    expect(physics.raycast(ray, hit)).toBe(true);
    expect(hit.collider === controller).toBe(false);
    expect(role.transform.position.x).toBe(4);
    expect(role.transform.position.y).toBe(5);
    expect(role.transform.position.z).toBe(6);
    controller.geometry = CharacterControllerGeometry.Box;
    expect(physics.raycast(ray, hit)).toBe(true);
    expect(hit.collider === controller).toBe(true);
    move(new Vector3(0, 0, 1));
    expect(role.transform.position.z).toBe(7);
  });

  it.each([1, 45])("uses slopeLimit %s to control climbing", (limit) => {
    physics.overlapSphereAll(new Vector3(0, 5, 0), 0.1);
    controller.slopeLimit = limit;
    // Keep the slope below the limit to avoid a rounding-dependent result.
    addPlane(new Vector3(0, 0, 2), new Quaternion().rotateX((-40 * Math.PI) / 180));
    walkTo(new Vector3(0, 0, 3), 50);
    if (limit === 45) expect(role.transform.position.z).toBeCloseTo(3, 5);
    else expect(role.transform.position.z).toBeLessThan(2);
  });

  it.each([1, 0])("refreshes live invisible walls and retains jump search after rebuilding (run=%s)", (run) => {
    const mesh = new ModelMesh(engine);
    mesh.setPositions([new Vector3(0, 0, -3), new Vector3(0, 0, 3), new Vector3(run, 2, 3), new Vector3(run, 2, -3)]);
    mesh.setIndices(new Uint16Array([0, 1, 2, 0, 2, 3]));
    root.createChild().addComponent(MeshCollider).mesh = mesh;
    controller.stepOffset = 0;

    const displacement = new Vector3(5, 0, 0);
    const crossSlope = (): number => {
      role.transform.setPosition(-2, 5, 0);
      return move(displacement) & ControllerCollisionFlag.Sides;
    };

    controller.maxJumpHeight = 6;
    expect(crossSlope()).toBe(ControllerCollisionFlag.None);
    expect(role.transform.position.x).toBeCloseTo(3, 4);

    controller.invisibleWallHeight = 8;
    expect(crossSlope()).toBe(ControllerCollisionFlag.Sides);
    expect(role.transform.position.x).toBeLessThan(0);

    controller.maxJumpHeight = 0;
    expect(crossSlope()).toBe(ControllerCollisionFlag.None);

    controller.maxJumpHeight = 6;
    expect(crossSlope()).toBe(ControllerCollisionFlag.Sides);
    controller.slopeLimit = run === 0 ? 90 : 80;
    expect(crossSlope()).toBe(ControllerCollisionFlag.None);

    controller.slopeLimit = 45;
    controller.geometry = CharacterControllerGeometry.Capsule;
    expect(crossSlope()).toBe(ControllerCollisionFlag.Sides);
  });

  it("rejects invalid invisible wall and jump heights", () => {
    expect(() => (controller.invisibleWallHeight = -1)).toThrow(RangeError);
    expect(() => (controller.maxJumpHeight = Number.MAX_VALUE)).toThrow(RangeError);
  });

  it.each([0.5, 1])("uses stepOffset %s to control stepping over an obstacle", (offset) => {
    physics.overlapSphereAll(new Vector3(0, 5, 0), 0.1);
    controller.stepOffset = offset;
    addBox(new Vector3(1, 1, 1), new Vector3(0, 0.5, 3));
    walkTo(new Vector3(0, 0, 3), 2);
    if (offset === 1) {
      expect(role.transform.position.z).toBeCloseTo(3, 5);
      expect(role.transform.position.y).toBeGreaterThan(1);
    } else {
      expect(role.transform.position.z).toBeLessThan(2);
      expect(role.transform.position.y).toBeLessThan(1);
    }
    controller.stepOffset = -1;
    expect(controller.stepOffset).toBe(0);
  });

  it.each([ControllerNonWalkableMode.PreventClimbing, ControllerNonWalkableMode.PreventClimbingAndForceSliding])(
    "applies nonWalkableMode %s on steep slopes",
    (mode) => {
      physics.overlapSphereAll(new Vector3(0, 5, 0), 0.1);
      controller.slopeLimit = 1;
      controller.nonWalkableMode = mode;
      addPlane(new Vector3(0, 0, 2), new Quaternion().rotateX(-Math.PI / 4));
      walkTo(new Vector3(0, 0.02, 3), 50);
      if (mode === ControllerNonWalkableMode.PreventClimbing) expect(role.transform.position.y).toBeGreaterThan(1);
      else expect(role.transform.position.y).toBeLessThan(1);
    }
  );

  it.each(["enabled", "active"])("preserves position and settings after %s re-entry", (state) => {
    controller.contactOffset = 0.3;
    controller.center.set(0, 0.2, 0);
    role.transform.setPosition(0, 2, 3);
    move(new Vector3(0, -3, 0));
    expect(role.transform.position.y).toBeCloseTo(0.6, 4);
    if (state === "enabled") controller.enabled = false;
    else role.isActive = false;
    expect(move(new Vector3(0, 0, 10))).toBe(0);
    expect(role.transform.position.z).toBe(3);
    expect(physics.overlapSphereAll(new Vector3(0, 0.8, 3), 0.1)).toHaveLength(0);
    controller.stepOffset = 0.2;
    controller.slopeLimit = 30;
    controller.nonWalkableMode = ControllerNonWalkableMode.PreventClimbingAndForceSliding;
    if (state === "enabled") controller.enabled = true;
    else role.isActive = true;
    expect(physics.overlapSphereAll(new Vector3(0, 0.8, 3), 0.1)[0]).toBe(controller);
    move(new Vector3(0, 0, 1));
    expect(role.transform.position.z).toBeCloseTo(4);
    expect(role.transform.position.y).toBeCloseTo(0.6, 4);
    expect(controller.contactOffset).toBe(0.3);
    expect(controller.stepOffset).toBe(0.2);
    expect(controller.slopeLimit).toBe(30);
    expect(controller.nonWalkableMode).toBe(ControllerNonWalkableMode.PreventClimbingAndForceSliding);
  });

  it.each([CharacterControllerGeometry.Box, CharacterControllerGeometry.Capsule])(
    "applies geometry edited while disabled on re-entry (geometry=%s)",
    (geometry) => {
      role.transform.setPosition(0, 10, 0);
      move(new Vector3(0, 0, 1));
      controller.enabled = false;
      controller.geometry = geometry;
      controller.size = new Vector3(2, 4, 2);
      controller.radius = 0.2;
      controller.height = 1.4;
      controller.contactOffset = 0.1;
      controller.enabled = true;
      move(new Vector3(0, -20, 0));
      expect(role.transform.position.y).toBeCloseTo(geometry === CharacterControllerGeometry.Box ? 2.1 : 0.8, 4);
      expect(role.transform.position.z).toBeCloseTo(1);
    }
  );

  it.each([CharacterControllerGeometry.Box, CharacterControllerGeometry.Capsule])(
    "clones inline geometry and movement settings independently (geometry=%s)",
    (geometry) => {
      controller.geometry = geometry;
      controller.center.set(0, 0.2, 0);
      controller.contactOffset = 0.1;
      controller.size.set(2, 4, 2);
      controller.radius = 0.2;
      controller.height = 1.4;
      controller.stepOffset = 0.2;
      controller.detectCollisions = false;
      controller.climbingMode = ControllerClimbingMode.Easy;
      controller.slopeLimit = 30;
      controller.nonWalkableMode = ControllerNonWalkableMode.PreventClimbingAndForceSliding;
      const clone = role.clone();
      root.addChild(clone);
      clone.transform.setPosition(10, 10, 0);
      const copy = clone.getComponent(CharacterController);
      expect(copy).not.toBe(controller);
      expect(copy.geometry).toBe(geometry);
      expect(copy.size).not.toBe(controller.size);
      expect(copy.center).not.toBe(controller.center);
      expect(copy.upDirection).not.toBe(controller.upDirection);
      expect(copy.contactOffset).toBe(0.1);
      expect(copy.radius).toBe(0.2);
      expect(copy.height).toBe(1.4);
      expect(copy.stepOffset).toBe(0.2);
      expect(copy.detectCollisions).toBe(false);
      expect(copy.climbingMode).toBe(ControllerClimbingMode.Easy);
      expect(copy.slopeLimit).toBe(30);
      expect(copy.nonWalkableMode).toBe(ControllerNonWalkableMode.PreventClimbingAndForceSliding);
      copy.move(new Vector3(0, -20, 0), 0.0001, physics.fixedTimeStep);
      expect(clone.transform.position.y).toBeCloseTo(geometry === CharacterControllerGeometry.Box ? 1.9 : 0.6, 4);
      copy.center.y = 3;
      copy.size.y = 8;
      expect(controller.center.y).toBe(0.2);
      expect(controller.size.y).toBe(4);
    }
  );

  it.each([Layer.Layer1, Layer.Layer10])("filters controller triggers using collisionLayer %s", (layer) => {
    controller.collisionLayer = layer;
    const trigger = addBox(new Vector3(1, 1, 1), new Vector3(0, 0.6, 2));
    trigger.collisionLayer = Layer.Layer2;
    trigger.isTrigger = true;
    class TriggerRecorder extends Script {
      onTriggerEnter = vi.fn();
      onTriggerExit = vi.fn();
    }
    const recorder = trigger.entity.addComponent(TriggerRecorder);
    move(new Vector3(0, 0, 2));
    // Trigger detection sees the proxy pose on the step after PhysX applies the kinematic target.
    update(2);
    expect(recorder.onTriggerEnter).toHaveBeenCalledOnce();
    role.transform.setPosition(0, 0.6, 0);
    update(2);
    expect(recorder.onTriggerExit).toHaveBeenCalledOnce();
    physics.setColliderLayerCollision(layer, Layer.Layer2, false);
    try {
      move(new Vector3(0, 0, 2));
      update(2);
      expect(recorder.onTriggerEnter).toHaveBeenCalledOnce();
    } finally {
      physics.setColliderLayerCollision(layer, Layer.Layer2, true);
    }
  });

  it("recovers at the updated position after invalid geometry without unrelated setter error spam", () => {
    const entity = root.createChild("recovering-controller");
    entity.transform.setPosition(0, 5, 0);
    const cc = entity.addComponent(CharacterController);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    cc.height = 1;
    physics._update(physics.fixedTimeStep);
    expect(physics.overlapSphereAll(entity.transform.worldPosition, 0.1)).not.toContain(cc);

    cc.collisionLayer = Layer.Layer3;
    cc.isSceneQuery = true;
    expect(errors).not.toHaveBeenCalled();

    entity.transform.setPosition(8, 2, 0);
    cc.height = 2;

    const hit = new HitResult();
    expect(physics.raycast(new Ray(new Vector3(8, 10, 0), new Vector3(0, -1, 0)), 20, Layer.Layer3, hit)).toBe(true);
    expect(hit.collider === cc).toBe(true);
    expect(hit.point.x).toBeCloseTo(8, 3);
    expect(physics.raycast(new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0)), 20, Layer.Layer3)).toBe(false);
  });

  it("normalizes upDirection and retains the default direction when cleared in place", () => {
    controller.upDirection.set(0, 2, 0);
    expect(controller.upDirection.x).toBeCloseTo(0, 5);
    expect(controller.upDirection.y).toBeCloseTo(1, 5);
    expect(controller.upDirection.z).toBeCloseTo(0, 5);

    controller.upDirection.set(0, 0, 0);
    expect(controller.upDirection.y).toBe(1);

    role.transform.setPosition(0, 3, 0);
    const flags = move(new Vector3(0, -5, 0));
    expect(Boolean(flags & ControllerCollisionFlag.Down)).toBe(true);
    expect(role.transform.position.y).toBeCloseTo(0.52, 2);
  });

  it("clamps slopeLimit to [0, 90] and rejects non-finite slopeLimit or stepOffset", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    controller.slopeLimit = 120;
    expect(controller.slopeLimit).toBe(90);
    controller.slopeLimit = -10;
    expect(controller.slopeLimit).toBe(0);
    controller.slopeLimit = 90;

    controller.enabled = false;
    controller.enabled = true;
    expect(errors).not.toHaveBeenCalled();

    role.transform.setPosition(0, 2, 0);
    const flags = move(new Vector3(0, -4, 0));
    expect(Boolean(flags & ControllerCollisionFlag.Down)).toBe(true);

    expect(() => {
      controller.slopeLimit = NaN;
    }).toThrow();
    expect(() => {
      controller.slopeLimit = Infinity;
    }).toThrow();
    expect(() => {
      controller.stepOffset = NaN;
    }).toThrow();
    expect(() => {
      controller.stepOffset = Infinity;
    }).toThrow();
  });

  it("ignores move calls after destroy while the entity stays active", () => {
    controller.destroy();
    expect(controller.destroyed).toBe(true);
    expect(move(new Vector3(1, 0, 0))).toBe(0);
  });

  it("detaches the live size and direction vectors when the controller is destroyed", () => {
    const { size, upDirection } = controller;
    controller.destroy();

    size.x = -1;
    upDirection.y = 2;
    expect(size.x).toBe(-1);
    expect(upDirection.y).toBe(2);
  });

  it("updates scene queries immediately when teleported via entity transform or center", () => {
    role.transform.setPosition(0, 2, 0);
    const hit = new HitResult();
    expect(physics.raycast(new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0)), 20, Layer.Everything, hit)).toBe(
      true
    );
    expect(hit.collider).toBe(controller);

    // Teleport without stepping simulation: queries must immediately reflect the new pose
    role.transform.setPosition(12, 2, 0);
    expect(physics.overlapSphereAll(new Vector3(12, 2, 0), 0.1)).toContain(controller);
    expect(physics.overlapSphereAll(new Vector3(0, 2, 0), 0.1)).not.toContain(controller);

    controller.center = new Vector3(0, 3, 0);
    expect(physics.overlapSphereAll(new Vector3(12, 5, 0), 0.1)).toContain(controller);
    expect(physics.overlapSphereAll(new Vector3(12, 2, 0), 0.1)).not.toContain(controller);
  });

  it("reports the latest contacts and actual velocity using the fixed timestep by default", () => {
    role.transform.setPosition(0, 2, 0);
    const velocity = new Vector3();
    expect(controller.move(new Vector3(0.25, 0, 0))).toBe(ControllerCollisionFlag.None);
    expect(controller.collisionFlags).toBe(ControllerCollisionFlag.None);
    expect(controller.isGrounded).toBe(false);
    expect(controller.getVelocity(velocity)).toBe(velocity);
    expect(velocity.x).toBeCloseTo(0.25 / physics.fixedTimeStep);

    const contacts = controller.move(new Vector3(0, -5, 0));
    expect(contacts & ControllerCollisionFlag.Down).toBe(ControllerCollisionFlag.Down);
    expect(controller.collisionFlags).toBe(contacts);
    expect(controller.isGrounded).toBe(true);
    expect(controller.getVelocity(velocity).y).toBeCloseTo(
      (role.transform.worldPosition.y - 2) / physics.fixedTimeStep
    );

    controller.enabled = false;
    expect(controller.collisionFlags).toBe(ControllerCollisionFlag.None);
    expect(controller.getVelocity(velocity).lengthSquared()).toBe(0);
  });

  it("clamps negative dimensions, rejects non-finite scalars, and detaches cleanly on zero dimensions or scale", () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => (controller.radius = invalid)).toThrow();
      expect(() => (controller.height = invalid)).toThrow();
    }
    controller.radius = -1;
    controller.height = -2;
    expect(controller.radius).toBe(0);
    expect(controller.height).toBe(0);

    controller.size = new Vector3(-1, 2, 1);
    expect(controller.size.x).toBe(0);
    expect(controller.size.y).toBe(2);

    controller.size = new Vector3(1, 1, 1);
    role.transform.setPosition(0, 2, 0);
    expect(physics.overlapSphereAll(new Vector3(0, 2, 0), 0.1)).toContain(controller);

    // Zero scale detaches cleanly (no stale hitbox, move returns 0 without throwing)
    role.transform.setScale(0, 1, 1);
    expect(physics.overlapSphereAll(new Vector3(0, 2, 0), 0.1)).not.toContain(controller);
    expect(move(new Vector3(2, 0, 0))).toBe(0);
    expect(role.transform.position.x).toBe(0);

    role.transform.setScale(1, 1, 1);
    expect(physics.overlapSphereAll(new Vector3(0, 2, 0), 0.1)).toContain(controller);
    move(new Vector3(2, 0, 0));
    expect(role.transform.position.x).toBeCloseTo(2, 4);

    controller.geometry = CharacterControllerGeometry.Capsule;
    controller.radius = 0.5;
    controller.height = 1;
    expect(physics.overlapSphereAll(new Vector3(2, 2, 0), 0.1)).not.toContain(controller);
    expect(move(new Vector3(2, 0, 0))).toBe(0);
    controller.height = 2;
    expect(physics.overlapSphereAll(new Vector3(2, 2, 0), 0.1)).toContain(controller);
    move(new Vector3(1, 0, 0));
    expect(role.transform.position.x).toBeCloseTo(3, 4);
  });

  describe("move() collision layer and matrix filtering", () => {
    afterEach(() => {
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, true);
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer3, true);
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer4, true);
    });

    it("expires temporary exclusions between moves without teleporting", () => {
      role.transform.setPosition(0, 5, 0);
      controller.stepOffset = 0;
      const wall = addBox(new Vector3(1, 4, 4), new Vector3(2, 5, 0));
      wall.isSceneQuery = false;
      expect(move(new Vector3(5, 0, 0)) & ControllerCollisionFlag.Sides).toBeTruthy();
      expect(role.transform.worldPosition.x).toBeCloseTo(0.98);

      expect(controller.move(new Vector3(4, 0, 0), 0, undefined, { exclude: [wall] })).toBe(
        ControllerCollisionFlag.None
      );
      expect(role.transform.worldPosition.x).toBeCloseTo(4.98);

      expect(move(new Vector3(-4, 0, 0)) & ControllerCollisionFlag.Sides).toBeTruthy();
      expect(role.transform.worldPosition.x).toBeCloseTo(3.02);
    });

    it("filters other controllers by ID and Layer31 within the scene collision policy", () => {
      role.transform.setPosition(0, 5, 0);
      controller.collisionLayer = Layer.Layer1;
      controller.stepOffset = 0;
      const target = root.createChild("target");
      target.transform.setPosition(2, 5, 0);
      const other = target.addComponent(CharacterController);
      other.geometry = CharacterControllerGeometry.Box;
      other.collisionLayer = Layer.Layer31;
      const offset = new Vector3(5, 0, 0);

      expect(controller.move(offset, 0, undefined, { layerMask: Layer.Nothing })).toBe(ControllerCollisionFlag.None);
      expect(role.transform.worldPosition.x).toBeCloseTo(5);

      offset.x = -5;
      expect(controller.move(offset, 0, undefined, { layerMask: Layer.Layer31, exclude: [other] })).toBe(
        ControllerCollisionFlag.None
      );
      expect(role.transform.worldPosition.x).toBeCloseTo(0);

      offset.x = 5;
      expect(controller.move(offset, 0, undefined, { layerMask: Layer.Layer31 }) & ControllerCollisionFlag.Sides).toBe(
        ControllerCollisionFlag.Sides
      );
      expect(role.transform.worldPosition.x).toBeLessThan(1.1);

      const previous = physics.getColliderLayerCollision(Layer.Layer1, Layer.Layer31);
      try {
        physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer31, false);
        expect(controller.move(offset, 0, undefined, { layerMask: Layer.Layer31 })).toBe(ControllerCollisionFlag.None);
        expect(role.transform.worldPosition.x).toBeGreaterThan(5);
      } finally {
        physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer31, previous);
      }
    });

    it("filters static and dynamic colliders and invalidates cached obstacles on matrix or layer change", () => {
      controller.collisionLayer = Layer.Layer1;
      role.transform.setPosition(0, 2, 0);

      const staticWall = addBox(new Vector3(1, 4, 4), new Vector3(2, 2, 0));
      staticWall.collisionLayer = Layer.Layer2;
      const dynEntity = root.createChild("dyn-wall");
      dynEntity.transform.setPosition(5, 2, 0);
      const dynWall = dynEntity.addComponent(BoxCollider);
      dynWall.size = new Vector3(1, 4, 4);
      dynWall.collisionLayer = Layer.Layer3;
      dynEntity.addComponent(Rigidbody).isKinematic = true;

      // Initially blocked by static wall at x = 2 (stops near 2 - 0.5 - 0.5 - 0.02 = 0.98)
      const hitStatic = move(new Vector3(4, 0, 0));
      expect(Boolean(hitStatic & ControllerCollisionFlag.Sides)).toBe(true);
      expect(role.transform.position.x).toBeCloseTo(0.98, 2);

      // Disable Layer1 <-> Layer2: must pass through static wall and stop at dynamic wall (x = 5 -> ~3.98)
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, false);
      const hitDyn = move(new Vector3(6, 0, 0));
      expect(Boolean(hitDyn & ControllerCollisionFlag.Sides)).toBe(true);
      expect(role.transform.position.x).toBeCloseTo(3.98, 2);

      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer3, false);
      move(new Vector3(4, 0, 0));
      expect(role.transform.position.x).toBeCloseTo(7.98, 2);

      // Re-enable Layer1 <-> Layer2 and move back: static wall must block again (cache invalidated)
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, true);
      move(new Vector3(-10, 0, 0));
      expect(role.transform.position.x).toBeCloseTo(3.02, 2);
    });

    it("passes through a query-only Rigidbody that still appears in scene queries", () => {
      role.transform.setPosition(0, 4, 0);
      const obstacle = addBox(new Vector3(2, 2, 2), new Vector3(3, 4, 0));
      const body = obstacle.entity.addComponent(Rigidbody);
      body.isKinematic = true;

      const displacement = new Vector3(6, 0, 0);
      expect(move(displacement) & ControllerCollisionFlag.Sides).not.toBe(0);
      body.simulationEnabled = false;
      const ray = new Ray(new Vector3(3, 4, 3), new Vector3(0, 0, -1));
      expect(physics.raycast(ray)).toBe(true);
      expect(move(displacement) & ControllerCollisionFlag.Sides).toBe(0);
      expect(role.transform.worldPosition.x).toBeGreaterThan(5);

      role.transform.position.x = 0;
      body.simulationEnabled = true;
      expect(move(displacement) & ControllerCollisionFlag.Sides).not.toBe(0);
    });

    it("filters compound Rigidbody child colliders independently by layer and never blocks on triggers", () => {
      controller.collisionLayer = Layer.Layer1;
      role.transform.setPosition(0, 2, 0);

      // Enable the layer pair to isolate trigger behavior from layer filtering.
      const triggerWall = addBox(new Vector3(1, 4, 4), new Vector3(1.5, 2, 0));
      triggerWall.collisionLayer = Layer.Layer1;
      triggerWall.isTrigger = true;
      class TriggerRecorder extends Script {
        onTriggerEnter = vi.fn();
      }
      const triggerRecorder = triggerWall.entity.addComponent(TriggerRecorder);

      // Compound kinematic Rigidbody with two child colliders on different layers
      const compound = root.createChild("compound");
      compound.addComponent(Rigidbody).isKinematic = true;
      const firstChild = compound.createChild("passable");
      firstChild.transform.setPosition(3, 2, 0);
      const firstCol = firstChild.addComponent(BoxCollider);
      firstCol.size = new Vector3(1, 4, 4);
      firstCol.collisionLayer = Layer.Layer2;
      const secondChild = compound.createChild("solid");
      secondChild.transform.setPosition(6, 2, 0);
      const secondCol = secondChild.addComponent(BoxCollider);
      secondCol.size = new Vector3(1, 4, 4);
      secondCol.collisionLayer = Layer.Layer3;
      secondCol.isSceneQuery = false; // non-query solid must still block CCT

      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, false);
      const flags = move(new Vector3(10, 0, 0));
      expect(Boolean(flags & ControllerCollisionFlag.Sides)).toBe(true);
      // Passed through trigger at 1.5 and Layer2 child at 3, stopped at Layer3 child at 6 (~4.98)
      expect(role.transform.position.x).toBeCloseTo(4.98, 2);

      // Walk back into trigger to verify triggers still fire events
      role.transform.setPosition(0, 2, 0);
      move(new Vector3(1.5, 0, 0));
      update(2);
      expect(triggerRecorder.onTriggerEnter).toHaveBeenCalled();
    });

    it("filters controller-vs-controller collisions using collisionLayer and the layer matrix", () => {
      controller.collisionLayer = Layer.Layer1;
      role.transform.setPosition(0, 2, 0);

      const otherEntity = root.createChild("other-cct");
      otherEntity.transform.setPosition(3, 2, 0);
      const otherCC = otherEntity.addComponent(CharacterController);
      otherCC.geometry = CharacterControllerGeometry.Box;
      otherCC.collisionLayer = Layer.Layer4;

      otherCC.move(new Vector3(0, 0, 0), 0.0001, physics.fixedTimeStep);

      // Enabled layer pair -> blocked before x = 3 (box half-width 0.5 + 0.5 + contactOffset 0.02 + 0.02)
      const blockedFlags = move(new Vector3(5, 0, 0));
      expect(Boolean(blockedFlags & ControllerCollisionFlag.Sides)).toBe(true);
      expect(role.transform.position.x).toBeLessThan(2.1);

      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer4, false);
      role.transform.setPosition(0, 2, 0);
      move(new Vector3(6, 0, 0));
      expect(role.transform.position.x).toBeCloseTo(6, 2);

      // Re-enable and change otherCC layer to Layer2 with Layer1<->Layer2 disabled -> still passes through
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer4, true);
      physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, false);
      otherCC.collisionLayer = Layer.Layer2;
      role.transform.setPosition(0, 2, 0);
      move(new Vector3(6, 0, 0));
      expect(role.transform.position.x).toBeCloseTo(6, 2);
    });

    it("validates size, upDirection, float32 bounds, negative move args, and clean failed-creation recovery", () => {
      for (const invalid of [new Vector3(NaN, 1, 1), new Vector3(1, Infinity, 1), new Vector3(1, 1, -Infinity)]) {
        expect(() => (controller.size = invalid)).toThrow();
        expect(() => (controller.upDirection = invalid)).toThrow();
      }
      expect(() => (controller.size.x = NaN)).toThrow();
      expect(Number.isFinite(controller.size.x)).toBe(true);
      expect(() => (controller.upDirection.y = NaN)).toThrow();
      expect(controller.upDirection.y).toBeCloseTo(1, 5);

      // A zero assignment keeps the last valid up direction in both the component and PhysX.
      controller.upDirection = new Vector3(0, 1, 0);
      controller.upDirection = new Vector3(0, 0, 0);
      expect(controller.upDirection.y).toBeCloseTo(1, 5);

      controller.height = 1e-40;
      expect(move(new Vector3(1, 0, 0))).toBe(0);
      controller.height = 1e40;
      expect(move(new Vector3(1, 0, 0))).toBe(0);
      controller.height = 2;
      controller.radius = 0.5;
      role.transform.setPosition(0, 2, 0);

      // Invalid move arguments must leave the position unchanged.
      expect(controller.move(new Vector3(1, 0, 0), -0.1, physics.fixedTimeStep)).toBe(0);
      expect(controller.move(new Vector3(1, 0, 0), 0.0001, -1)).toBe(0);

      // Move the Entity before recovery to detect reuse of the stale native pose.
      const recoverEntity = root.createChild("recover-cct");
      recoverEntity.transform.setPosition(0, 5, 0);
      const recoverCC = recoverEntity.addComponent(CharacterController);
      recoverCC.height = 1;

      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      recoverCC.move(new Vector3(0, -0.1, 0), 0.0001, physics.fixedTimeStep);
      expect(errors).not.toHaveBeenCalled();

      recoverEntity.transform.setPosition(7, 4, -2);
      recoverCC.collisionLayer = Layer.Layer3;
      recoverCC.isSceneQuery = true;
      recoverCC.nonWalkableMode = ControllerNonWalkableMode.PreventClimbingAndForceSliding;
      recoverCC.upDirection = new Vector3(0, 1, 0);
      expect(errors).not.toHaveBeenCalled();

      recoverCC.height = 2;
      recoverCC.move(new Vector3(0, 0, 0), 0.0001, physics.fixedTimeStep);
      expect(errors).not.toHaveBeenCalled();
      expect(recoverEntity.transform.position.x).toBeCloseTo(7, 4);
      expect(recoverEntity.transform.position.y).toBeCloseTo(4, 4);
      expect(recoverEntity.transform.position.z).toBeCloseTo(-2, 4);

      const hit = new HitResult();
      expect(physics.raycast(new Ray(new Vector3(7, 8, -2), new Vector3(0, -1, 0)), 10, Layer.Layer3, hit)).toBe(true);
      expect(hit.collider).toBe(recoverCC);
    });

    it("updates proxy actor orientation immediately on live upDirection changes for asymmetric Box CCT", () => {
      const boxEntity = root.createChild("asymmetric-box-cct");
      boxEntity.transform.setPosition(0, 0, 0);
      const boxCC = boxEntity.addComponent(CharacterController);
      boxCC.geometry = CharacterControllerGeometry.Box;
      // Local X = 2 (halfSide=1), Y = 4 (halfHeight=2), Z = 6 (halfForward=3)
      boxCC.size.set(2, 4, 6);
      boxCC.stepOffset = 0.2;
      boxCC.upDirection = new Vector3(0, 1, 0);

      const hit = new HitResult();
      // With up = +Y: Y extent is [-2, 2], X extent is [-1, 1]
      expect(physics.raycast(new Ray(new Vector3(0, 1.5, 5), new Vector3(0, 0, -1)), 10, hit)).toBe(true);
      expect(hit.collider).toBe(boxCC);
      expect(physics.raycast(new Ray(new Vector3(1.5, 0, 5), new Vector3(0, 0, -1)), 10, hit)).toBe(false);

      // Live upDirection change to +X swaps halfHeight (2) onto world X and halfSide (1) onto world Y immediately
      boxCC.upDirection = new Vector3(1, 0, 0);
      expect(physics.raycast(new Ray(new Vector3(1.5, 0, 5), new Vector3(0, 0, -1)), 10, hit)).toBe(true);
      expect(hit.collider).toBe(boxCC);
      expect(physics.raycast(new Ray(new Vector3(0, 1.5, 5), new Vector3(0, 0, -1)), 10, hit)).toBe(false);

      const up = boxCC.upDirection;
      up.set(2, 0, 0);
      expect([up.x, up.y, up.z]).toEqual([1, 0, 0]);
      up.set(0, 0, 0);
      expect([up.x, up.y, up.z]).toEqual([1, 0, 0]);

      // Stepping checks that the queued kinematic target matches the immediate pose.
      physics._update(physics.fixedTimeStep);
      expect(physics.raycast(new Ray(new Vector3(1.5, 0, 5), new Vector3(0, 0, -1)), 10, hit)).toBe(true);
      expect(hit.collider).toBe(boxCC);
      expect(physics.raycast(new Ray(new Vector3(0, 1.5, 5), new Vector3(0, 0, -1)), 10, hit)).toBe(false);

      const clone = boxEntity.clone();
      try {
        const cloneUp = clone.getComponent(CharacterController).upDirection;
        cloneUp.set(0, 0, 0);
        expect([cloneUp.x, cloneUp.y, cloneUp.z]).toEqual([1, 0, 0]);
      } finally {
        clone.destroy();
      }

      // In-place NaN throws and syncs fallback (0, 1, 0) back to native immediately
      expect(() => (boxCC.upDirection.x = NaN)).toThrow();
      expect(boxCC.upDirection.y).toBeCloseTo(1, 5);
      expect(physics.raycast(new Ray(new Vector3(0, 1.5, 5), new Vector3(0, 0, -1)), 10, hit)).toBe(true);
      expect(physics.raycast(new Ray(new Vector3(1.5, 0, 5), new Vector3(0, 0, -1)), 10, hit)).toBe(false);
    });

    it("syncs sub-1e-6 scale, position, and center edits without dropping updates", () => {
      const tinyScaleEntity = root.createChild("tiny-scale-cct");
      tinyScaleEntity.transform.setPosition(0, 10, 0);
      tinyScaleEntity.transform.setScale(1e-6, 1e-6, 1e-6);
      const tinyScaleCC = tinyScaleEntity.addComponent(CharacterController);
      tinyScaleCC.geometry = CharacterControllerGeometry.Box;
      tinyScaleCC.size.set(1e6, 1e6, 1e6);
      tinyScaleCC.contactOffset = 0.01;
      tinyScaleCC.collisionLayer = Layer.Layer5;

      const hit = new HitResult();
      const edgeRay = new Ray(new Vector3(0.6, 10, 5), new Vector3(0, 0, -1));
      expect(physics.raycast(edgeRay, 10, Layer.Layer5, hit)).toBe(false);

      // Delta 5e-7 < 1e-6: world size grows from 1.0 to 1.5
      tinyScaleEntity.transform.setScale(1.5e-6, 1.5e-6, 1.5e-6);
      expect(physics.raycast(edgeRay, 10, Layer.Layer5, hit)).toBe(true);
      expect(hit.collider).toBe(tinyScaleCC);

      // Simultaneous -2^-21 translation + +2^-21 center edit on a narrow box keeps the exact world center
      const shift = 2 ** -21;
      const shiftEntity = root.createChild("sub-eps-shift-cct");
      shiftEntity.transform.setPosition(0, 20, 0);
      const shiftCC = shiftEntity.addComponent(CharacterController);
      shiftCC.geometry = CharacterControllerGeometry.Box;
      shiftCC.size.set(4e-7, 1, 1);
      shiftCC.center.set(1, 0, 0);
      shiftCC.contactOffset = 1e-7;
      shiftCC.collisionLayer = Layer.Layer6;

      const centerRay = new Ray(new Vector3(1, 20, 5), new Vector3(0, 0, -1));
      expect(physics.raycast(centerRay, 10, Layer.Layer6, hit)).toBe(true);
      expect(hit.collider).toBe(shiftCC);

      shiftEntity.transform.setPosition(-shift, 20, 0);
      expect(physics.raycast(centerRay, 10, Layer.Layer6, hit)).toBe(false);

      shiftCC.center.set(1 + shift, 0, 0);
      expect(physics.raycast(centerRay, 10, Layer.Layer6, hit)).toBe(true);
      expect(hit.collider).toBe(shiftCC);
    });

    it("publishes a pose edit that keeps the center unchanged after move, before the next step", () => {
      role.transform.setPosition(0, 2, 0);
      const ray = new Ray(new Vector3(0, 2, 5), new Vector3(0, 0, -1));
      const hit = new HitResult();
      const hitsController = (x: number): boolean => {
        ray.origin.x = x;
        return physics.raycast(ray, hit) && hit.collider === controller;
      };

      expect(hitsController(0)).toBe(true);
      move(new Vector3(4, 0, 0));
      const x = role.transform.worldPosition.x;
      expect(x).toBeCloseTo(4, 5);
      expect(hitsController(x)).toBe(true);
      expect(hitsController(0)).toBe(false);

      role.transform.worldPosition.x = x + 1;
      controller.center.x = -1;

      expect(hitsController(0)).toBe(false);
      expect(hitsController(x)).toBe(true);
    });

    it("uses the authored position and center before composing the native controller pose", () => {
      const entity = engine.sceneManager.activeScene.createRootEntity("offset-controller");
      try {
        const x = 2 ** 23;
        entity.transform.setPosition(x, 10, 0);
        const cc = entity.addComponent(CharacterController);
        cc.geometry = CharacterControllerGeometry.Box;
        cc.size.set(0.1, 1, 0.1);
        cc.stepOffset = 0.05;
        cc.contactOffset = 0.01;
        cc.center.x = -x;
        cc.collisionLayer = Layer.Layer6;
        const hit = new HitResult();
        const hits = (x: number) =>
          physics.raycast(new Ray(new Vector3(x, 10, 5), new Vector3(0, 0, -1)), 10, Layer.Layer6, hit) &&
          hit.collider === cc;

        expect(hits(0)).toBe(true);
        entity.transform.position.x += 0.25;
        expect(hits(0)).toBe(false);
        expect(hits(0.25)).toBe(true);
        cc.center.x += 0.25;
        expect(hits(0.25)).toBe(false);
        expect(hits(0.5)).toBe(true);
      } finally {
        entity.destroy();
      }
    });

    it("keeps the native step offset valid after a Float32-scale edit", () => {
      const entity = engine.sceneManager.activeScene.createRootEntity("controller-rescale");
      try {
        entity.transform.setPosition(0, 10, 0);
        const cc = entity.addComponent(CharacterController);
        cc.geometry = CharacterControllerGeometry.Box;
        cc.size.set(1, 1.5, 1);
        cc.stepOffset = 1.5 + 2 ** -23;
        cc.collisionLayer = Layer.Layer6;
        const hit = new HitResult();
        const ray = new Ray(new Vector3(0, 10, 5), new Vector3(0, 0, -1));
        expect(physics.raycast(ray, 10, Layer.Layer6, hit)).toBe(true);

        entity.transform.scale.y = 1 + 2 ** -24;
        expect(physics.raycast(ray, 10, Layer.Layer6, hit)).toBe(true);
        expect(hit.collider).toBe(cc);
      } finally {
        entity.destroy();
      }
    });
  });

  describe("controller pair separation", () => {
    function createOverlappingPair(): CharacterController {
      controller.geometry = CharacterControllerGeometry.Capsule;
      role.transform.setPosition(0, 5, 0);
      const other = root.createChild("overlapping character").addComponent(CharacterController);
      other.entity.transform.setPosition(0.75, 5, 0);
      return other;
    }

    it("replaces pending separation and consumes it on the next move", () => {
      const other = createOverlappingPair();
      const otherPosition = other.entity.transform.position;
      const elapsedTime = 1 / 60;
      const zero = new Vector3();

      physics.computeCharacterControllerInteractions(elapsedTime);
      physics.computeCharacterControllerInteractions(elapsedTime);
      expect(role.transform.position.x).toBe(0);
      expect(otherPosition.x).toBe(0.75);

      const separation = 1 / 30;
      controller.move(zero);
      other.move(zero);
      expect(role.transform.position.x).toBeCloseTo(-separation, 5);
      expect(otherPosition.x).toBeCloseTo(0.75 + separation, 5);
      controller.move(zero);
      other.move(zero);
      expect(role.transform.position.x).toBeCloseTo(-separation, 5);
      expect(otherPosition.x).toBeCloseTo(0.75 + separation, 5);

      role.transform.position.x = 0;
      otherPosition.x = 0.75;
      physics.computeCharacterControllerInteractions(elapsedTime);
      physics.computeCharacterControllerInteractions(0);
      controller.move(zero);
      other.move(zero);
      expect(role.transform.position.x).toBe(0);
      expect(otherPosition.x).toBe(0.75);

      physics.computeCharacterControllerInteractions(elapsedTime);
      other.entity.destroy();
      physics.computeCharacterControllerInteractions(elapsedTime);
      controller.move(zero);
      expect(role.transform.position.x).toBe(0);
    });

    it("uses persistent layer and pair rules and requires two solid proxies", () => {
      const other = createOverlappingPair();
      controller.collisionLayer = Layer.Layer1;
      other.collisionLayer = Layer.Layer2;
      const previous = physics.getColliderLayerCollision(Layer.Layer1, Layer.Layer2);
      const zero = new Vector3();

      function movePair(): void {
        physics.computeCharacterControllerInteractions();
        controller.move(zero);
        other.move(zero);
      }

      try {
        physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, false);
        movePair();
        expect(role.transform.position.x).toBe(0);

        controller.includeLayers = Layer.Layer2;
        physics.setColliderPairIgnored(controller, other);
        movePair();
        expect(role.transform.position.x).toBe(0);

        physics.setColliderPairIgnored(controller, other, false);
        other.detectCollisions = false;
        movePair();
        expect(role.transform.position.x).toBe(0);
        expect(other.entity.transform.position.x).toBe(0.75);

        other.detectCollisions = true;
        movePair();
        expect(role.transform.position.x).toBeLessThan(0);
        expect(other.entity.transform.position.x).toBeGreaterThan(0.75);
      } finally {
        physics.setColliderLayerCollision(Layer.Layer1, Layer.Layer2, previous);
      }
    });

    it.each([
      ["x", new Vector3(1.2, 5.25, 0), "y"],
      ["y", new Vector3(0, 6.4, 0.25), "z"]
    ] as const)(
      "separates mixed shapes in the movement plane when the penetration normal points along %s",
      (up, position, tangent) => {
        const other = root.createChild("Offset capsule").addComponent(CharacterController);
        const start = new Vector3(0, 5, 0);
        role.transform.setPosition(start.x, start.y, start.z);
        other.entity.transform.setPosition(position.x, position.y, position.z);
        if (up === "x") {
          controller.upDirection.set(1, 0, 0);
          other.upDirection.set(1, 0, 0);
        }

        physics.computeCharacterControllerInteractions();
        const zero = new Vector3();
        controller.move(zero, 0, undefined, { exclude: [other] });
        other.move(zero, 0, undefined, { exclude: [controller] });

        expect(role.transform.position[up]).toBeCloseTo(start[up], 5);
        expect(other.entity.transform.position[up]).toBeCloseTo(position[up], 5);
        expect(role.transform.position[tangent]).toBeLessThan(start[tangent]);
        expect(other.entity.transform.position[tangent]).toBeGreaterThan(position[tangent]);
      }
    );

    it.each([
      ["capsules with X up", CharacterControllerGeometry.Capsule, new Vector3(1, 0, 0), 1.4, 5, 1],
      ["tall boxes", CharacterControllerGeometry.Box, new Vector3(0, 1, 0), 0, 6.4, 4],
      ["boxes with near-opposite X up", CharacterControllerGeometry.Box, new Vector3(-1, 3e-23, 0), 1, 5, 2]
    ] as const)("separates %s before the first move", (_case, geometry, up, otherX, otherY, sizeY) => {
      const other = root.createChild("offset character").addComponent(CharacterController);
      controller.geometry = other.geometry = geometry;
      role.transform.setPosition(0, 5, 0);
      const otherTransform = other.entity.transform;
      otherTransform.setPosition(otherX, otherY, 0.75);
      for (const character of [controller, other]) {
        character.upDirection = up;
        if (geometry === CharacterControllerGeometry.Box) character.size.set(1, sizeY, 1);
      }

      physics.computeCharacterControllerInteractions();
      const zero = new Vector3();
      controller.move(zero, 0, undefined, { exclude: [other] });
      other.move(zero, 0, undefined, { exclude: [controller] });
      expect(role.transform.position.x).toBeCloseTo(0, 5);
      expect(role.transform.position.y).toBeCloseTo(5, 5);
      expect(otherTransform.position.x).toBeCloseTo(otherX, 5);
      expect(otherTransform.position.y).toBeCloseTo(otherY, 5);
      expect(role.transform.position.z).toBeLessThan(0);
      expect(otherTransform.position.z).toBeGreaterThan(0.75);
    });
  });
});
