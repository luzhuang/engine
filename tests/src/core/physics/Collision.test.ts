import { createPhysics } from "../../utils/physics";
import { BoxCollider, Collision, ContactPoint, Rigidbody, Entity, Engine, Scene, Script } from "@galacean/engine-core";
import { Vector3 } from "@galacean/engine-math";
import { WebGLEngine } from "@galacean/engine";
import { describe, beforeAll, afterAll, beforeEach, expect, it } from "vitest";

describe("Collision", function () {
  let rootEntity: Entity;
  let engine: Engine;

  function addBox(cubeSize: Vector3, type: typeof Rigidbody | null, pos: Vector3) {
    const boxEntity = rootEntity.createChild("BoxEntity");
    boxEntity.transform.setPosition(pos.x, pos.y, pos.z);

    const physicsBox = boxEntity.addComponent(BoxCollider);
    const material = physicsBox.getInstanceMaterial();
    material.dynamicFriction = 0;
    material.staticFriction = 0;
    physicsBox.size = cubeSize;
    if (type) {
      boxEntity.addComponent(type);
    }
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

  it.each([false, true])(
    "keeps borrowed contacts intact while another scene advances (contacts: %s)",
    (hasContacts) => {
      const outerScene = engine.sceneManager.activeScene;
      const innerScene = new Scene(engine);
      let ranInner = false;
      if (hasContacts) {
        engine.sceneManager.addScene(innerScene);
        const innerBody = innerScene.createRootEntity();
        innerBody.addComponent(BoxCollider);
        innerBody.addComponent(Rigidbody);
        innerBody.addComponent(
          class extends Script {
            override onCollisionEnter(): void {
              ranInner = true;
            }
          }
        );
        const innerBox = innerScene.createRootEntity();
        innerBox.transform.setPosition(0.3, 0, 0);
        innerBox.addComponent(BoxCollider);
      }
      const staticBox = addBox(new Vector3(1, 1, 1), null, new Vector3(0.3, 0, 0)).getComponent(BoxCollider);
      const body = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3());
      let ran = false;
      body.addComponent(
        class extends Script {
          override onCollisionEnter(collision: Collision): void {
            const count = collision.contactCount;
            innerScene.physics._update(innerScene.physics.fixedTimeStep);
            expect(count).toBeGreaterThan(0);
            expect(collision.contactCount).toBe(count);
            expect(collision.collider).toBe(staticBox);
            ran = true;
          }
        }
      );

      try {
        outerScene.physics._update(outerScene.physics.fixedTimeStep);
        expect(ran).toBe(true);
        expect(ranInner).toBe(hasContacts);
      } finally {
        innerScene.destroy();
      }
    }
  );

  it("contacts on the moving body", function () {
    engine.sceneManager.activeScene.physics.gravity = new Vector3(0, 0, 0);
    const box1 = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(-3, 0, 0));
    const box2 = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(0, 0, 0));

    box1.transform.rotate(45, 45, 0);

    return new Promise<void>((done) => {
      box1.addComponent(
        class extends Script {
          onCollisionEnter(other: Collision): void {
            expect(other.collider).toBe(box2.getComponent(BoxCollider));
            expect(other.contactCount).toBe(3);
            expect(other.selfCollider).toBe(this.entity.getComponent(BoxCollider));
            const contacts: ContactPoint[] = [];
            expect(other.getContacts(contacts)).toBe(other.contactCount);
            expect(contacts.length).toBe(3);
            expect(formatValue(contacts[0].position.x)).closeTo(-0.5, 0.1);
            expect(formatValue(contacts[0].separation)).toBe(-0.02022);
            expect(formatValue(contacts[0].normal.x)).toBe(-1);
            expect(formatValue(contacts[0].impulse.x)).toBe(-7.38326);

            done();
          }
        }
      );

      box1.getComponent(Rigidbody).applyForce(new Vector3(1000, 0, 0));
      engine.sceneManager.activeScene.physics._update(1);
    });
  });

  it("contacts on the moving body created second", function () {
    engine.sceneManager.activeScene.physics.gravity = new Vector3(0, 0, 0);
    const box2 = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(0, 0, 0));
    const box1 = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(-3, 0, 0));

    box1.transform.rotate(45, 45, 0);

    return new Promise<void>((done) => {
      box1.addComponent(
        class extends Script {
          onCollisionEnter(other: Collision): void {
            expect(other.collider).toBe(box2.getComponent(BoxCollider));
            expect(other.contactCount).toBe(3);
            expect(other.selfCollider).toBe(this.entity.getComponent(BoxCollider));
            const contacts: ContactPoint[] = [];
            expect(other.getContacts(contacts)).toBe(other.contactCount);
            expect(contacts.length).toBe(3);
            expect(formatValue(contacts[0].position.x)).closeTo(-0.5, 0.1);
            expect(formatValue(contacts[0].separation)).toBe(-0.02022);
            expect(formatValue(contacts[0].normal.x)).toBe(-1);
            expect(formatValue(contacts[0].impulse.x)).toBe(-7.38326);

            done();
          }
        }
      );

      box1.getComponent(Rigidbody).applyForce(new Vector3(1000, 0, 0));
      engine.sceneManager.activeScene.physics._update(1);
    });
  });

  it("contacts on the stationary body", function () {
    engine.sceneManager.activeScene.physics.gravity = new Vector3(0, 0, 0);
    const box1 = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(-3, 0, 0));
    const box2 = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(0, 0, 0));

    box1.transform.rotate(45, 45, 0);

    return new Promise<void>((done) => {
      box2.addComponent(
        class extends Script {
          onCollisionEnter(other: Collision): void {
            expect(other.collider).toBe(box1.getComponent(BoxCollider));
            expect(other.contactCount).toBe(3);
            expect(other.selfCollider).toBe(this.entity.getComponent(BoxCollider));
            const contacts: ContactPoint[] = [];
            expect(other.getContacts(contacts)).toBe(other.contactCount);
            expect(contacts.length).toBe(3);
            expect(formatValue(contacts[0].position.x)).closeTo(-0.5, 0.1);
            expect(formatValue(contacts[0].separation)).toBe(-0.02022);
            expect(formatValue(contacts[0].normal.x)).toBe(1);
            expect(formatValue(contacts[0].impulse.x)).toBe(7.38326);

            done();
          }
        }
      );

      box1.getComponent(Rigidbody).applyForce(new Vector3(1000, 0, 0));
      engine.sceneManager.activeScene.physics._update(1);
    });
  });

  it("contacts on the stationary body created first", function () {
    engine.sceneManager.activeScene.physics.gravity = new Vector3(0, 0, 0);
    const box2 = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(0, 0, 0));
    const box1 = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(-3, 0, 0));

    box1.transform.rotate(45, 45, 0);

    return new Promise<void>((done) => {
      box2.addComponent(
        class extends Script {
          onCollisionEnter(other: Collision): void {
            expect(other.collider).toBe(box1.getComponent(BoxCollider));
            expect(other.contactCount).toBe(3);
            expect(other.selfCollider).toBe(this.entity.getComponent(BoxCollider));
            const contacts: ContactPoint[] = [];
            expect(other.getContacts(contacts)).toBe(other.contactCount);
            expect(contacts.length).toBe(3);
            expect(formatValue(contacts[0].position.x)).closeTo(-0.5, 0.1);
            expect(formatValue(contacts[0].separation)).toBe(-0.02022);
            expect(formatValue(contacts[0].normal.x)).toBe(1);
            expect(formatValue(contacts[0].impulse.x)).toBe(7.38326);

            done();
          }
        }
      );

      box1.getComponent(Rigidbody).applyForce(new Vector3(1000, 0, 0));
      engine.sceneManager.activeScene.physics._update(1);
    });
  });

  it("reports contact normal from the static collider toward the dynamic receiver", function () {
    engine.sceneManager.activeScene.physics.gravity = new Vector3(0, 0, 0);
    const dynamicBox = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(-3, 0, 0));
    const staticBox = addBox(new Vector3(1, 1, 1), null, new Vector3(0, 0, 0));

    return new Promise<void>((done) => {
      dynamicBox.addComponent(
        class extends Script {
          onCollisionEnter(other: Collision): void {
            expect(other.collider).toBe(staticBox.getComponent(BoxCollider));
            expect(other.selfCollider).toBe(this.entity.getComponent(BoxCollider));
            const contacts: ContactPoint[] = [];
            expect(other.getContacts(contacts)).toBe(other.contactCount);
            expect(contacts.length).toBeGreaterThan(0);
            expect(formatValue(contacts[0].normal.x)).toBe(-1);

            done();
          }
        }
      );

      dynamicBox.getComponent(Rigidbody).applyForce(new Vector3(1000, 0, 0));
      engine.sceneManager.activeScene.physics._update(1);
    });
  });

  it("resumes reports for an existing contact without restarting the pair", () => {
    const physics = engine.sceneManager.activeScene.physics;
    addBox(new Vector3(3, 1, 3), null, new Vector3());
    const body = addBox(new Vector3(1, 1, 1), Rigidbody, new Vector3(0, 0.99, 0));
    const events: string[] = [];
    physics._update(physics.fixedTimeStep);
    const script = body.addComponent(
      class extends Script {
        override onCollisionEnter(): void {
          events.push("enter");
        }

        override onCollisionStay(collision: Collision): void {
          expect(collision.relativeVelocity).not.toBeNull();
          events.push("stay");
        }

        override onCollisionExit(): void {
          events.push("exit");
        }
      }
    );
    physics._update(physics.fixedTimeStep);
    script.enabled = false;
    physics._update(physics.fixedTimeStep);
    script.enabled = true;
    physics._update(physics.fixedTimeStep);
    body.transform.position.y = 4;
    physics._update(physics.fixedTimeStep);
    expect(events).toEqual(["stay", "stay", "exit"]);
  });

  it("reports the pre-solver relative velocity and impulses for both sides of compound contacts", () => {
    const physics = engine.sceneManager.activeScene.physics;
    physics.gravity = new Vector3();
    const floor = addBox(new Vector3(10, 1, 10), null, new Vector3());
    const compound = rootEntity.createChild();
    compound.transform.position.y = 1.02;
    const body = compound.addComponent(Rigidbody);
    for (const x of [-1, 1]) {
      const child = compound.createChild();
      child.transform.position.x = x;
      child.addComponent(BoxCollider);
    }
    body.linearVelocity = new Vector3(0, -4, 0);
    const contact = new ContactPoint();
    const contacts: ContactPoint[] = [];
    let floorHits = 0;
    let bodyHits = 0;
    let bodyExits = 0;
    floor.addComponent(
      class extends Script {
        override onCollisionEnter(collision: Collision): void {
          expect(collision.rigidbody).toBe(body);
          expect(collision.relativeVelocity!.y).toBeCloseTo(-4);
          expect(collision.impulse.y).toBeLessThan(0);
          floorHits++;
        }
      }
    );
    compound.addComponent(
      class extends Script {
        override onCollisionEnter(collision: Collision): void {
          expect(collision.rigidbody).toBeNull();
          expect(collision.relativeVelocity!.y).toBeCloseTo(4);
          expect(collision.getContact(0, contact)).toBe(contact);
          expect(collision.getContacts(contacts)).toBe(collision.contactCount);
          expect(contact.position).toEqual(contacts[0].position);
          let impulse = 0;
          for (let i = 0; i < collision.contactCount; i++) impulse += contacts[i].impulse.y;
          expect(collision.impulse.y).toBeCloseTo(impulse);
          expect(() => collision.getContact(collision.contactCount, contact)).toThrow(RangeError);
          bodyHits++;
        }

        override onCollisionExit(collision: Collision): void {
          expect(collision.relativeVelocity).toBeNull();
          bodyExits++;
        }
      }
    );
    physics._update(physics.fixedTimeStep);
    expect(floorHits).toBe(2);
    expect(bodyHits).toBe(2);
    compound.transform.position.y = 4;
    physics._update(physics.fixedTimeStep);
    expect(bodyExits).toBe(2);
  });

  it("reports a swept impact without a pre-solver velocity sample", () => {
    const physics = engine.sceneManager.activeScene.physics;
    physics.gravity = new Vector3();
    addBox(new Vector3(0.05, 2, 2), null, new Vector3());
    const projectile = addBox(new Vector3(0.2, 0.2, 0.2), Rigidbody, new Vector3(-5, 0, 0));
    const body = projectile.getComponent(Rigidbody);
    body.useCCD = true;
    body.linearVelocity = new Vector3(600, 0, 0);
    let hits = 0;
    projectile.addComponent(
      class extends Script {
        override onCollisionEnter(collision: Collision): void {
          expect(collision.relativeVelocity).toBeNull();
          expect(collision.impulse.x).toBeLessThan(0);
          hits++;
        }
      }
    );
    physics._update(physics.fixedTimeStep);
    expect(hits).toBe(1);
  });
});
