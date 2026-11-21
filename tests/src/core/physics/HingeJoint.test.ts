import { createPhysics } from "../../utils/physics";
import {
  Component,
  dependentComponents,
  DependentMode,
  HingeJoint,
  JointLimits,
  JointMotor,
  Entity,
  Rigidbody,
  BoxCollider,
  Engine
} from "@galacean/engine-core";
import { WebGLEngine } from "@galacean/engine";
import { MathUtil, Vector3 } from "@galacean/engine-math";
import { describe, beforeAll, afterAll, beforeEach, expect, it } from "vitest";

describe("HingeJoint", function () {
  let rootEntity: Entity;
  let engine: Engine;

  function addBox(cubeSize: Vector3, pos: Vector3) {
    const boxEntity = rootEntity.createChild("BoxEntity");
    boxEntity.transform.setPosition(pos.x, pos.y, pos.z);

    const physicsBox = boxEntity.addComponent(BoxCollider);
    physicsBox.getInstanceMaterial().dynamicFriction = 0;
    physicsBox.getInstanceMaterial().staticFriction = 0;
    physicsBox.size = cubeSize;
    boxEntity.addComponent(Rigidbody);
    return boxEntity;
  }

  function formatValue(value: number) {
    return Math.round(value * 100000) / 100000;
  }

  beforeAll(async function () {
    engine = await WebGLEngine.create({ canvas: document.createElement("canvas"), physics: createPhysics() });

    rootEntity = engine.sceneManager.activeScene.createRootEntity("root");
  });

  afterAll(() => engine.destroy());

  beforeEach(function () {
    while (rootEntity.children.length) {
      rootEntity.children[0].destroy();
    }
    engine.resourceManager.gc();
    engine.sceneManager.activeScene.physics.gravity = new Vector3(0, -9.81, 0);
  });

  it("keeps authored connected anchors separate from automatic anchors and clones them", () => {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const joint = boxEntity.addComponent(HingeJoint);
    const target = rootEntity.createChild();
    const targetBody = target.addComponent(Rigidbody);
    targetBody.isKinematic = true;
    joint.connectedBody = targetBody;

    joint.automaticConnectedAnchor = false;
    const connectedAnchor = joint.connectedAnchor;
    expect(connectedAnchor.y).toBe(5);

    joint.automaticConnectedAnchor = true;
    connectedAnchor.set(4, 7, 8);
    joint.connectedAnchor.z = 9;
    expect(joint.connectedAnchor).toBe(connectedAnchor);
    expect(Vector3.equals(connectedAnchor, new Vector3(4, 7, 9))).toBe(true);
    target.transform.setScale(2, 1, 1);
    engine.sceneManager.activeScene.physics._update(0.2);
    expect(boxEntity.transform.worldPosition.x).toBeCloseTo(0, 2);
    expect(boxEntity.transform.worldPosition.y).toBeCloseTo(5, 2);

    joint.anchor.y = 1;
    expect(connectedAnchor.y).toBe(7);
    const clone = boxEntity.clone();
    rootEntity.addChild(clone);
    const clonedJoint = clone.getComponent(HingeJoint);
    clonedJoint.automaticConnectedAnchor = false;
    expect(Vector3.equals(clonedJoint.connectedAnchor, new Vector3(4, 7, 9))).toBe(true);
    clonedJoint.connectedAnchor.x = 10;
    joint.automaticConnectedAnchor = false;
    expect(Vector3.equals(joint.connectedAnchor, new Vector3(4, 7, 9))).toBe(true);
  });

  it("axis", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(2, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.automaticCenterOfMass = true;
    collider2.automaticCenterOfMass = true;
    collider.automaticInertiaTensor = true;
    collider2.automaticInertiaTensor = true;
    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.automaticConnectedAnchor = true;
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis.set(0, 1, 0);
    expect(formatValue(joint.angle)).eq(0);

    collider2.applyTorque(new Vector3(0, 1000, 0));
    engine.sceneManager.activeScene.physics._update(1 / 60);
    expect(formatValue(joint.velocity)).eq(6.89082);
    expect(joint.angle).toBeCloseTo(MathUtil.degreeToRadian(6.58019), 5);
  });

  it("hardLimit", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(2, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.automaticConnectedAnchor = true;
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis = new Vector3(0, 1, 0);
    joint.useLimits = true;
    const limits = new JointLimits();
    limits.min = -Math.PI / 2;
    limits.max = Math.PI / 2;
    limits.contactDistance = 0.1;
    joint.limits = limits;

    expect(formatValue(joint.angle)).eq(0);

    collider2.applyTorque(new Vector3(0, 1000, 0));
    engine.sceneManager.activeScene.physics._update(1);
    expect(joint.angle).toBeCloseTo(Math.PI / 2, 2);

    collider2.applyTorque(new Vector3(0, -1000, 0));
    engine.sceneManager.activeScene.physics._update(1);
    expect(joint.angle).toBeCloseTo(-Math.PI / 2, 2);
  });

  it("reverses angular velocity at a bouncy hard limit", () => {
    const physics = engine.sceneManager.activeScene.physics;
    const [inelastic, elastic] = [0, 1].map((bounciness) => {
      const entity = addBox(new Vector3(1, 1, 1), new Vector3(0, 3 * bounciness, 0));
      const body = entity.getComponent(Rigidbody);
      body.useGravity = false;
      body.angularDamping = 0;

      const hinge = entity.addComponent(HingeJoint);
      const limits = new JointLimits();
      limits.min = -0.5;
      limits.max = 0.5;
      hinge.limits = limits;
      hinge.useLimits = true;
      limits.bounciness = bounciness;
      body.angularVelocity.set(10, 0, 0);
      return body;
    });

    const fixedTimeStep = physics.fixedTimeStep;
    physics.fixedTimeStep = 1 / 120;
    try {
      for (let i = 0; i < 12; i++) {
        physics._update(physics.fixedTimeStep);
      }
      expect(inelastic.angularVelocity.x).toBeCloseTo(0);
      expect(elastic.angularVelocity.x).toBeLessThan(-5);
    } finally {
      physics.fixedTimeStep = fixedTimeStep;
    }
  });

  it("softLimit", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(2, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.automaticCenterOfMass = true;
    collider2.automaticCenterOfMass = true;
    collider.automaticInertiaTensor = true;
    collider2.automaticInertiaTensor = true;

    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.automaticConnectedAnchor = true;
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis = new Vector3(0, 1, 0);
    joint.useLimits = true;
    joint.useSoftLimits = true;
    const limits = new JointLimits();
    limits.min = MathUtil.degreeToRadian(-90);
    limits.max = MathUtil.degreeToRadian(90);
    limits.stiffness = 1000;
    limits.damping = 30;
    joint.limits = limits;

    expect(formatValue(joint.angle)).eq(0);

    collider2.applyTorque(new Vector3(0, 1000, 0));
    engine.sceneManager.activeScene.physics._update(1);
    expect(joint.angle).toBeCloseTo(MathUtil.degreeToRadian(6.27762), 5);
  });

  it("stiffness", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(2, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.automaticCenterOfMass = true;
    collider2.automaticCenterOfMass = true;
    collider.automaticInertiaTensor = true;
    collider2.automaticInertiaTensor = true;
    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.automaticConnectedAnchor = true;
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis = new Vector3(0, 1, 0);
    joint.useLimits = true;
    joint.useSoftLimits = true;
    const limits = new JointLimits();
    limits.min = MathUtil.degreeToRadian(-90);
    limits.max = MathUtil.degreeToRadian(90);
    limits.stiffness = 2000;
    limits.damping = 30;
    joint.limits = limits;

    expect(formatValue(joint.angle)).eq(0);

    collider2.applyTorque(new Vector3(0, 1000, 0));
    engine.sceneManager.activeScene.physics._update(1);
    expect(joint.angle).toBeCloseTo(MathUtil.degreeToRadian(-12.93617), 5);
  });

  it("damping", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(2, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.automaticCenterOfMass = true;
    collider2.automaticCenterOfMass = true;
    collider.automaticInertiaTensor = true;
    collider2.automaticInertiaTensor = true;
    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.automaticConnectedAnchor = true;
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis = new Vector3(0, 1, 0);
    joint.useLimits = true;
    joint.useSoftLimits = true;
    const limits = new JointLimits();
    limits.min = MathUtil.degreeToRadian(-90);
    limits.max = MathUtil.degreeToRadian(90);
    limits.stiffness = 1000;
    limits.damping = 100;
    joint.limits = limits;

    expect(formatValue(joint.angle)).eq(0);

    collider2.applyTorque(new Vector3(0, 1000, 0));
    engine.sceneManager.activeScene.physics._update(1);
    expect(joint.angle).toBeCloseTo(MathUtil.degreeToRadian(50.06221), 5);
  });

  it("motor", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(0.5, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis = new Vector3(0, 1, 0);
    joint.useMotor = true;
    const motor = new JointMotor();
    motor.targetVelocity = 30;
    joint.motor = motor;

    expect(formatValue(joint.velocity)).eq(0);

    engine.sceneManager.activeScene.physics._update(1);
    expect(formatValue(joint.velocity)).eq(30);
    expect(joint.angle).toBeCloseTo(MathUtil.degreeToRadian(278.87335), 5);
  });

  it.each([1 / 60, 1 / 120])("limits angular acceleration with a maximum torque at timestep %s", (dt) => {
    const physics = engine.sceneManager.activeScene.physics;
    const previousTimestep = physics.fixedTimeStep;
    const box = addBox(new Vector3(1, 1, 1), new Vector3());
    const body = box.getComponent(Rigidbody);
    body.useGravity = false;
    body.angularDamping = 0;
    body.automaticInertiaTensor = false;
    body.inertiaTensor.set(1, 1, 1);
    const hinge = box.addComponent(HingeJoint);
    const motor = new JointMotor();
    motor.targetVelocity = 30;
    motor.forceLimit = 0.5;
    hinge.motor = motor;
    hinge.useMotor = true;

    physics.fixedTimeStep = dt;
    try {
      physics._update(dt);
      expect(Math.abs(body.angularVelocity.x)).toBeCloseTo(motor.forceLimit * dt, 6);
    } finally {
      physics.fixedTimeStep = previousTimestep;
    }
  });

  it("gearRatio", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(0.5, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.automaticCenterOfMass = true;
    collider2.automaticCenterOfMass = true;
    collider.automaticInertiaTensor = true;
    collider2.automaticInertiaTensor = true;
    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis = new Vector3(0, 1, 0);
    joint.useMotor = true;
    const motor = new JointMotor();
    motor.targetVelocity = 30;
    motor.gearRatio = 2;
    joint.motor = motor;

    expect(formatValue(joint.velocity)).eq(0);

    engine.sceneManager.activeScene.physics._update(1);
    expect(formatValue(joint.velocity)).eq(15);
  });

  it("freeSpin", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(0.5, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.automaticCenterOfMass = true;
    collider2.automaticCenterOfMass = true;
    collider.automaticInertiaTensor = true;
    collider2.automaticInertiaTensor = true;
    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis = new Vector3(0, 1, 0);
    joint.useMotor = true;
    const motor = new JointMotor();
    motor.targetVelocity = 30;
    motor.freeSpin = false;
    joint.motor = motor;

    expect(formatValue(joint.velocity)).eq(0);
    collider2.applyTorque(new Vector3(0, 1000, 0));
    engine.sceneManager.activeScene.physics._update(1);
    expect(collider2.angularVelocity.y).toBeCloseTo(30, 5);

    motor.targetVelocity = 30;
    motor.freeSpin = true;
    engine.sceneManager.activeScene.physics._update(1);
    expect(collider2.angularVelocity.y).toBeCloseTo(30, 5);

    collider2.applyTorque(new Vector3(0, 1000, 0));
    engine.sceneManager.activeScene.physics._update(1);
    expect(collider2.angularVelocity.y).toBeCloseTo(95.2, 3);
  });

  it("clone", function () {
    const boxEntity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const boxEntity2 = addBox(new Vector3(1, 1, 1), new Vector3(2, 5, 0));
    const collider = boxEntity.getComponent(Rigidbody);
    const collider2 = boxEntity2.getComponent(Rigidbody);
    collider.automaticCenterOfMass = true;
    collider2.automaticCenterOfMass = true;
    collider.automaticInertiaTensor = true;
    collider2.automaticInertiaTensor = true;
    collider.isKinematic = true;
    const joint = boxEntity.addComponent(HingeJoint);
    joint.automaticConnectedAnchor = true;
    joint.connectedBody = boxEntity2.getComponent(Rigidbody);
    joint.anchor = new Vector3(0.5, 0, 0);
    joint.axis = new Vector3(0, 1, 0);
    joint.limits = new JointLimits();
    joint.motor = new JointMotor();

    const newBox = boxEntity.clone();
    boxEntity.isActive = false;
    rootEntity.addChild(newBox);
    const newJoint = newBox.getComponent(HingeJoint);
    expect(formatValue(newJoint.angle)).eq(0);
    expect(newJoint.limits).not.toBe(joint.limits);
    expect(newJoint.motor).not.toBe(joint.motor);

    newJoint.limits.min = MathUtil.degreeToRadian(-Math.PI);
    expect(joint.limits.min).not.eq(newJoint.limits.min);
    newJoint.motor.targetVelocity = 50;
    expect(joint.motor.targetVelocity).not.eq(newJoint.motor.targetVelocity);

    collider2.applyTorque(new Vector3(0, 1000, 0));
    engine.sceneManager.activeScene.physics._update(1 / 60);
    expect(formatValue(newJoint.velocity)).eq(6.89082);
    expect(newJoint.angle).toBeCloseTo(MathUtil.degreeToRadian(6.58019), 5);
  });

  it("applies changes to a cloned motor independently of the original motor", () => {
    const entity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const joint = entity.addComponent(HingeJoint);
    joint.motor = new JointMotor();
    joint.motor.targetVelocity = 2;
    joint.useMotor = true;
    const clone = entity.clone();
    clone.transform.setPosition(3, 5, 0);
    rootEntity.addChild(clone);
    const cloneJoint = clone.getComponent(HingeJoint);
    const physics = engine.sceneManager.activeScene.physics;
    physics._update(1);
    expect(Math.abs(cloneJoint.velocity)).toBeCloseTo(2, 4);

    cloneJoint.motor.targetVelocity = 5;
    physics._update(1);
    expect(Math.abs(cloneJoint.velocity)).toBeCloseTo(5, 4);
    expect(Math.abs(joint.velocity)).toBeCloseTo(2, 4);
  });

  it("applies inherited and edited rotation limits on a cloned hinge", () => {
    const entity = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const joint = entity.addComponent(HingeJoint);
    joint.limits = new JointLimits();
    joint.limits.min = MathUtil.degreeToRadian(-20);
    joint.limits.max = MathUtil.degreeToRadian(20);
    joint.useLimits = true;
    const clone = entity.clone();
    clone.transform.setPosition(3, 5, 0);
    rootEntity.addChild(clone);
    const cloneJoint = clone.getComponent(HingeJoint);
    const body = clone.getComponent(Rigidbody);
    const physics = engine.sceneManager.activeScene.physics;
    const torque = new Vector3(1000, 0, 0);
    body.applyTorque(torque);
    physics._update(1);
    expect(Math.abs(cloneJoint.angle)).toBeCloseTo(MathUtil.degreeToRadian(20), 2);

    cloneJoint.limits.min = MathUtil.degreeToRadian(-45);
    cloneJoint.limits.max = MathUtil.degreeToRadian(45);
    body.applyTorque(torque);
    physics._update(1);
    expect(Math.abs(cloneJoint.angle)).toBeCloseTo(Math.PI / 4, 2);
    expect(joint.limits.min).toBe(MathUtil.degreeToRadian(-20));
    expect(joint.limits.max).toBe(MathUtil.degreeToRadian(20));
  });

  it("applies motor settings configured while inactive when the Entity enters simulation", function () {
    engine.sceneManager.activeScene.physics.gravity.set(0, 0, 0);
    const box1 = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    box1.isActive = false;
    const hingeJoint = box1.addComponent(HingeJoint);
    hingeJoint.axis = new Vector3(0, 1, 0);
    hingeJoint.useLimits = true;
    hingeJoint.useMotor = true;
    hingeJoint.useSoftLimits = true;
    const limits = new JointLimits();
    limits.min = MathUtil.degreeToRadian(-90);
    limits.max = MathUtil.degreeToRadian(90);
    hingeJoint.limits = limits;
    const motor = new JointMotor();
    motor.targetVelocity = 1;
    hingeJoint.motor = motor;
    box1.isActive = true;
    engine.sceneManager.activeScene.physics._update(1 / 60);
    expect(Math.abs(hingeJoint.velocity)).toBeGreaterThan(0);
    expect(Math.abs(box1.getComponent(Rigidbody).angularVelocity.y)).toBeGreaterThan(0);
    expect(box1.transform.position.y).toBeCloseTo(5, 5);
    hingeJoint.destroy();
    expect(box1.getComponent(HingeJoint)).toBeNull();
  });

  it("handles antiparallel -X axis and transient zero axis without corrupting orientation", function () {
    engine.sceneManager.activeScene.physics.gravity.set(0, 0, 0);

    const posBox = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const posJoint = posBox.addComponent(HingeJoint);
    posJoint.axis = new Vector3(1, 0, 0);
    posJoint.motor = new JointMotor();
    posJoint.motor.targetVelocity = 4;
    posJoint.useMotor = true;

    const negBox = addBox(new Vector3(1, 1, 1), new Vector3(3, 5, 0));
    const negJoint = negBox.addComponent(HingeJoint);
    negJoint.axis = new Vector3(-1, 0, 0);
    negJoint.motor = new JointMotor();
    negJoint.motor.targetVelocity = 4;
    negJoint.useMotor = true;

    engine.sceneManager.activeScene.physics._update(1 / 60);
    const posVelX = posBox.getComponent(Rigidbody).angularVelocity.x;
    const negVelX = negBox.getComponent(Rigidbody).angularVelocity.x;
    expect(posVelX * negVelX).toBeLessThan(0);
    expect(Math.abs(negVelX)).toBeCloseTo(Math.abs(posVelX), 3);

    negJoint.axis.x = 0;
    expect(negJoint.axis.x).toBe(-1);
    negJoint.axis.set(0, 0, 1);
    expect(negJoint.axis.z).toBeCloseTo(1, 5);
    engine.sceneManager.activeScene.physics._update(1 / 60);
    expect(Number.isFinite(negBox.getComponent(Rigidbody).angularVelocity.z)).toBe(true);
  });

  it.each([1, -1])("keeps the authored hinge tilt near %sX", (axisX) => {
    const box = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const body = box.getComponent(Rigidbody);
    body.useGravity = false;
    const joint = box.addComponent(HingeJoint);
    joint.axis = new Vector3(axisX, 0.001, 0);
    const motor = new JointMotor();
    motor.targetVelocity = 4;
    joint.motor = motor;
    joint.useMotor = true;

    const physics = engine.sceneManager.activeScene.physics;
    physics._update(physics.fixedTimeStep);

    const { x, y } = body.angularVelocity;
    expect(Math.abs(x)).toBeCloseTo(4, 3);
    expect(y / x).toBeCloseTo(axisX * 0.001, 4);
  });

  it("computes default JointLimits contactDistance from the authored angular range", function () {
    const limits = new JointLimits();
    limits.min = MathUtil.degreeToRadian(-4);
    limits.max = MathUtil.degreeToRadian(4);
    expect(limits.contactDistance).toBeCloseTo(0.49 * MathUtil.degreeToRadian(8), 6);

    const box = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const joint = box.addComponent(HingeJoint);
    joint.limits = limits;
    joint.useLimits = true;
    box.getComponent(Rigidbody).applyTorque(new Vector3(100, 0, 0));
    engine.sceneManager.activeScene.physics._update(1);
    expect(Math.abs(joint.angle)).toBeLessThanOrEqual(MathUtil.degreeToRadian(4.5));
  });

  it("resets cached angle and velocity on a cloned HingeJoint before simulation", function () {
    engine.sceneManager.activeScene.physics.gravity.set(0, 0, 0);
    const box = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const joint = box.addComponent(HingeJoint);
    joint.motor = new JointMotor();
    joint.motor.targetVelocity = 4;
    joint.useMotor = true;
    engine.sceneManager.activeScene.physics._update(1 / 60);
    expect(Math.abs(joint.angle)).toBeGreaterThan(0);
    expect(Math.abs(joint.velocity)).toBeGreaterThan(0);

    const clone = box.clone();
    const clonedJoint = clone.getComponent(HingeJoint);
    expect(clonedJoint.angle).toBe(0);
    expect(clonedJoint.velocity).toBe(0);
    clone.destroy();
  });

  it("initializes motor and limits to null and allows clearing them back to null", function () {
    const box = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const joint = box.addComponent(HingeJoint);
    expect(joint.motor).toBeNull();
    expect(joint.limits).toBeNull();

    const motor = new JointMotor();
    const limits = new JointLimits();
    joint.motor = motor;
    joint.limits = limits;
    expect(joint.motor).toBe(motor);
    expect(joint.limits).toBe(limits);

    joint.motor = null;
    joint.limits = null;
    expect(joint.motor).toBeNull();
    expect(joint.limits).toBeNull();
    expect(() => {
      motor.targetVelocity = 5;
      limits.max = MathUtil.degreeToRadian(30);
    }).not.toThrow();
  });

  it("disables active drive and limits immediately when motor or limits are cleared to null", function () {
    engine.sceneManager.activeScene.physics.gravity.set(0, 0, 0);

    const motorBox = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const motorBody = motorBox.getComponent(Rigidbody)!;
    motorBody.angularDamping = 0;
    const motorJoint = motorBox.addComponent(HingeJoint);
    const motor = new JointMotor();
    motor.targetVelocity = 6;
    motor.forceLimit = 500;
    motorJoint.motor = motor;
    motorJoint.useMotor = true;

    engine.sceneManager.activeScene.physics._update(0.2);
    expect(motorJoint.velocity).toBeGreaterThan(3);

    motorJoint.motor = null;
    motorBody.angularVelocity.set(0, 0, 0);
    engine.sceneManager.activeScene.physics._update(0.2);
    expect(Math.abs(motorJoint.velocity)).toBeLessThan(0.05);

    motorJoint.enabled = false;
    motorJoint.enabled = true;
    engine.sceneManager.activeScene.physics._update(0.2);
    expect(Math.abs(motorJoint.velocity)).toBeLessThan(0.05);

    motorJoint.motor = motor;
    engine.sceneManager.activeScene.physics._update(0.2);
    expect(motorJoint.velocity).toBeGreaterThan(3);

    const limitBox = addBox(new Vector3(1, 1, 1), new Vector3(4, 5, 0));
    const limitBody = limitBox.getComponent(Rigidbody)!;
    const limitJoint = limitBox.addComponent(HingeJoint);
    const limits = new JointLimits();
    limits.min = MathUtil.degreeToRadian(-10);
    limits.max = MathUtil.degreeToRadian(10);
    limitJoint.limits = limits;
    limitJoint.useLimits = true;
    limitBody.applyTorque(new Vector3(50, 0, 0));
    engine.sceneManager.activeScene.physics._update(0.5);
    expect(Math.abs(limitJoint.angle)).toBeLessThanOrEqual(MathUtil.degreeToRadian(11));

    // Clearing limits to null while useLimits=true lets the body spin past the former limit
    limitJoint.limits = null;
    limitBody.applyTorque(new Vector3(80, 0, 0));
    engine.sceneManager.activeScene.physics._update(0.5);
    expect(Math.abs(limitJoint.angle)).toBeGreaterThan(MathUtil.degreeToRadian(20));
  });

  it("wakes sleeping bodies when active HingeJoint constraint parameters change", function () {
    engine.sceneManager.activeScene.physics.gravity.set(0, 0, 0);
    const box = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const body = box.getComponent(Rigidbody)!;
    const joint = box.addComponent(HingeJoint);
    const motor = new JointMotor();
    motor.targetVelocity = 5;
    motor.forceLimit = 500;
    joint.motor = motor;

    body.sleep();
    expect(body.isSleeping()).toBe(true);

    // Enabling useMotor on a sleeping body wakes it and spins it without manual wakeUp()
    joint.useMotor = true;
    expect(body.isSleeping()).toBe(false);
    engine.sceneManager.activeScene.physics._update(0.2);
    expect(joint.velocity).toBeGreaterThan(2);

    joint.useMotor = false;
    body.angularVelocity.set(0, 0, 0);
    body.sleep();
    expect(body.isSleeping()).toBe(true);

    const limits = new JointLimits();
    limits.min = MathUtil.degreeToRadian(20);
    limits.max = MathUtil.degreeToRadian(40);
    joint.limits = limits;
    joint.useLimits = true;
    expect(body.isSleeping()).toBe(false);

    body.sleep();
    limits.min = MathUtil.degreeToRadian(25);
    expect(body.isSleeping()).toBe(false);

    body.sleep();
    joint.useSoftLimits = true;
    expect(body.isSleeping()).toBe(false);

    body.sleep();
    joint.axis.set(0, 1, 0);
    expect(body.isSleeping()).toBe(false);
  });

  it("keeps motor and limits listeners alive when HingeJoint destroy is rejected by a dependent component", function () {
    @dependentComponents(HingeJoint, DependentMode.CheckOnly)
    class HingeConsumer extends Component {}

    engine.sceneManager.activeScene.physics.gravity.set(0, 0, 0);
    const box = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const joint = box.addComponent(HingeJoint);
    const motor = new JointMotor();
    motor.targetVelocity = 0;
    motor.forceLimit = 500;
    joint.motor = motor;
    joint.useMotor = true;
    const consumer = box.addComponent(HingeConsumer);

    expect(() => joint.destroy()).toThrow();
    expect(joint.destroyed).toBe(false);

    // Motor listener must still work after rejected destroy
    motor.targetVelocity = 6;
    engine.sceneManager.activeScene.physics._update(0.2);
    expect(joint.velocity).toBeGreaterThan(3);

    consumer.destroy();
    expect(() => joint.destroy()).not.toThrow();
  });

  it("validates HingeJoint.axis and keeps rotation sync working after pre-enable zero axis", function () {
    engine.sceneManager.activeScene.physics.gravity.set(0, 0, 0);
    const box = addBox(new Vector3(1, 1, 1), new Vector3(0, 5, 0));
    const joint = box.addComponent(HingeJoint);

    for (const invalid of [new Vector3(NaN, 1, 0), new Vector3(Infinity, 0, 0), new Vector3(0, -Infinity, 0)]) {
      expect(() => (joint.axis = invalid)).toThrow();
    }
    // Zero edits retain the last valid direction.
    joint.axis = new Vector3(0, 1, 0);
    joint.axis = new Vector3(0, 0, 0);
    joint.axis.set(0, 0, 0);
    expect(joint.axis.y).toBeCloseTo(1, 5);

    // Invalid in-place edits leave the component and PhysX in sync even after re-creation.
    const body = box.getComponent(Rigidbody)!;
    const motor = new JointMotor();
    motor.targetVelocity = 5;
    motor.forceLimit = 500;
    joint.motor = motor;
    joint.useMotor = true;
    expect(() => (joint.axis.x = NaN)).toThrow();
    expect(joint.axis).deep.include({ x: 0, y: 1, z: 0 });
    joint.enabled = false;
    joint.enabled = true;
    engine.sceneManager.activeScene.physics._update(0.2);
    expect(Math.abs(body.angularVelocity.x)).toBeLessThan(MathUtil.degreeToRadian(1));
    expect(Math.abs(body.angularVelocity.y)).toBeGreaterThan(MathUtil.degreeToRadian(50));
    expect(Math.abs(body.angularVelocity.z)).toBeLessThan(MathUtil.degreeToRadian(1));

    // Overflow vector throws in setter without mutating existing axis
    expect(() => (joint.axis = new Vector3(1.5e308, 1.5e308, 0))).toThrow();
    expect(joint.axis.y).toBeCloseTo(1, 5);

    // Set the connected pose before enabling to exercise axis recovery during joint creation.
    const anchor = addBox(new Vector3(1, 1, 1), new Vector3(5, 8, 0));
    anchor.transform.setRotation(0, 90, 0);
    anchor.getComponent(Rigidbody)!.isKinematic = true;

    const child = addBox(new Vector3(1, 1, 1), new Vector3(5, 5, 0));
    child.isActive = false;
    const childJoint = child.addComponent(HingeJoint);
    childJoint.axis.set(0, 0, 1);
    childJoint.axis.set(0, 0, 0);
    expect(childJoint.axis.z).toBe(1);
    childJoint.connectedBody = anchor.getComponent(Rigidbody)!;
    child.isActive = true;
    engine.sceneManager.activeScene.physics._update(1 / 60);
    expect(Number.isFinite(childJoint.angle)).toBe(true);
    expect(Math.abs(childJoint.angle)).toBeLessThan(1);
  });
});
