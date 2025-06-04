/**
 * @title PhysX CharacterController Push Box
 * @category Physics
 */
import {
  WebGLEngine,
  BoxColliderShape,
  CapsuleColliderShape,
  CharacterController,
  DynamicCollider,
  Vector3,
  MeshRenderer,
  PointLight,
  PrimitiveMesh,
  Camera,
  Script,
  StaticCollider,
  PlaneColliderShape,
  PBRMaterial,
  AmbientLight,
  AssetType,
  Entity,
  HitResult
} from "@galacean/engine";
import { WireframeManager } from "@galacean/engine-toolkit";
import { PhysXPhysics } from "@galacean/engine-physics-physx";
import { ColliderShapeUpAxis, Collision, ControllerCollisionFlag } from "@galacean/engine-core";
import { Ray } from "@galacean/engine-math";
import { Keys } from "@galacean/engine";

// 创建地面
function createGround(rootEntity: Entity) {
  const groundEntity = rootEntity.createChild("Ground");
  groundEntity.transform.setPosition(0, -1, 0);
  groundEntity.transform.setScale(20, 1, 20);

  const groundMtl = new PBRMaterial(rootEntity.engine);
  const groundRenderer = groundEntity.addComponent(MeshRenderer);
  groundMtl.baseColor.set(0, 0, 0, 1.0);
  groundMtl.roughness = 0.8;
  groundMtl.metallic = 0.1;
  groundRenderer.mesh = PrimitiveMesh.createPlane(rootEntity.engine);
  groundRenderer.setMaterial(groundMtl);

  const groundCollider = groundEntity.addComponent(StaticCollider);
  const planeShape = new PlaneColliderShape();
  groundCollider.addShape(planeShape);

  return groundEntity;
}

// 创建可推动的箱子
function createPushableBox(rootEntity: Entity, x: number, y: number, z: number, size: number = 2) {
  const boxEntity = rootEntity.createChild("PushableBox");
  boxEntity.transform.setPosition(x, y, z);

  const boxMtl = new PBRMaterial(rootEntity.engine);
  // const boxRenderer = boxEntity.addComponent(MeshRenderer);
  // boxMtl.baseColor.set(0.3, 0.8, 1.0, 1.0); // 蓝色
  // boxMtl.roughness = 0.7;
  // boxMtl.metallic = 0.2;
  // boxRenderer.mesh = PrimitiveMesh.createCuboid(rootEntity.engine, size, size, size);
  // boxRenderer.setMaterial(boxMtl);

  const boxCollider = boxEntity.addComponent(DynamicCollider);
  const boxShape = new BoxColliderShape();
  boxShape.size = new Vector3(size, size, size);
  boxShape.material.staticFriction = 0;
  boxShape.material.dynamicFriction = 0;
  boxShape.material.bounciness = 0.3;
  boxCollider.addShape(boxShape);
  boxCollider.mass = 0.1;

  return boxEntity;
}

// 创建角色控制器
function createCharacter(rootEntity: Entity) {
  const characterEntity = rootEntity.createChild("Character");
  characterEntity.transform.setPosition(0, 1, 0);

  const characterMtl = new PBRMaterial(rootEntity.engine);
  const characterRenderer = characterEntity.addComponent(MeshRenderer);
  characterMtl.baseColor.set(1.0, 0.7, 0.3, 1.0); // 橙色
  characterMtl.roughness = 0.5;
  characterMtl.metallic = 0.1;
  characterRenderer.mesh = PrimitiveMesh.createCapsule(rootEntity.engine, 1, 2);
  characterRenderer.setMaterial(characterMtl);

  const controller = characterEntity.addComponent(CharacterController);
  const capsuleShape = new CapsuleColliderShape();
  capsuleShape.radius = 1;
  capsuleShape.height = 5;
  capsuleShape.upAxis = ColliderShapeUpAxis.Z;
  controller.addShape(capsuleShape);
  controller.stepOffset = 0.5;
  controller.slopeLimit = 45;

  return characterEntity;
}

// 角色移动和推动脚本
class CharacterMovementScript extends Script {
  private _controller: CharacterController;
  private _velocity = new Vector3();
  private _isGrounded = false;
  private _moveSpeed = 6;
  private _jumpForce = 10;
  private _gravity: Vector3 = new Vector3(0, -20, 0);
  private _pushForce = 20;

  onAwake() {
    this._controller = this.entity.getComponent(CharacterController);
  }

  onUpdate(deltaTime: number) {
    console.log("onUpdate", this.entity.transform.position);
    const inputManager = this.engine.inputManager;
    // 获取 WASD 键盘输入
    const horizontal = inputManager.isKeyHeldDown(Keys.KeyA) ? 1 : inputManager.isKeyHeldDown(Keys.KeyD) ? -1 : 0; // 交换A和D的方向
    const vertical = inputManager.isKeyHeldDown(Keys.KeyS) ? -1 : inputManager.isKeyHeldDown(Keys.KeyW) ? 1 : 0; // 交换W和S的方向
    const jump = inputManager.isKeyDown(Keys.Space);

    // 计算移动方向
    const moveDirection = new Vector3(horizontal, 0, vertical);
    if (moveDirection.length() > 0) {
      moveDirection.normalize();
    }

    // 应用移动速度
    this._velocity.x = moveDirection.x * this._moveSpeed;
    this._velocity.z = moveDirection.z * this._moveSpeed;

    // 应用重力
    if (!this._isGrounded) {
      this._velocity.y += this._gravity.y * deltaTime;
    }

    // 处理跳跃
    if (this._isGrounded && jump) {
      this._velocity.y = this._jumpForce;
      this._isGrounded = false;
    }

    // 执行移动
    const displacement = new Vector3();
    Vector3.scale(this._velocity, deltaTime, displacement);
    const collisionFlags = this._controller.move(displacement, 0, deltaTime);

    // 更新地面状态
    this._isGrounded = (collisionFlags & ControllerCollisionFlag.Down) !== 0;
    if (this._isGrounded && this._velocity.y < 0) {
      this._velocity.y = 0;
    }

    // 处理碰撞到墙壁时的情况
    if (collisionFlags & ControllerCollisionFlag.Up) {
      this._velocity.y = 0;
    }

    // 检测与box的碰撞并推动
    this.handleBoxPushing(moveDirection);
  }

  onCollisionEnter(other: Collision) {
    console.log("onCollisionEnter", other.shape.collider.entity.name);
  }

  private handleBoxPushing(moveDirection: Vector3) {
    if (moveDirection.length() === 0) return;

    // 从角色位置向前发射射线检测box
    const rayOrigin = this.entity.transform.worldPosition.clone();
    rayOrigin.y += 0.5; // 稍微抬高射线起点
    const rayDirection = moveDirection.clone();
    const rayDistance = 2.0; // 检测距离

    // 创建射线
    const ray = new Ray(rayOrigin, rayDirection);
    const hitResult = new HitResult();

    const isHit = this.scene.physics.raycast(ray, rayDistance, hitResult);
    if (isHit && hitResult.entity) {
      const boxCollider = hitResult.entity.getComponent(DynamicCollider);
      if (boxCollider && hitResult.entity.name.includes("PushableBox")) {
        // 计算推动力的方向和大小
        const pushDirection = rayDirection.clone();
        pushDirection.y = 0; // 只在水平方向推动
        pushDirection.normalize();

        // 应用推动力
        const force = new Vector3();
        Vector3.scale(pushDirection, this._pushForce, force);
        boxCollider.applyForce(force);

        // 视觉反馈：改变box的颜色
        const meshRenderer = hitResult.entity.getComponent(MeshRenderer);
        if (meshRenderer) {
          const material = meshRenderer.getMaterial() as PBRMaterial;
          material.baseColor.set(1, 0.5, 0.5, 1); // 变红表示被推动
        }
      }
    }
  }
}

// 箱子重置脚本
class BoxResetScript extends Script {
  private _originalPosition: Vector3;
  private _originalColor: Vector3;
  private _maxDistance = 15;

  onAwake() {
    this._originalPosition = this.entity.transform.position.clone();
    this._originalColor = new Vector3(0.3, 0.8, 1.0); // 原始蓝色
  }
  onCollisionEnter(other: Collision) {
    console.log("onCollisionEnter", other.shape.collider.entity.name);
  }
  onUpdate() {
    const currentPos = this.entity.transform.position;
    const distance = Vector3.distance(currentPos, this._originalPosition);

    if (distance > this._maxDistance) {
      // 重置位置
      this.entity.transform.position = this._originalPosition.clone();
      const collider = this.entity.getComponent(DynamicCollider);
      if (collider) {
        collider.linearVelocity = new Vector3(0, 0, 0);
        collider.angularVelocity = new Vector3(0, 0, 0);
      }

      // 重置颜色
      const meshRenderer = this.entity.getComponent(MeshRenderer);
      if (meshRenderer) {
        const material = meshRenderer.getMaterial() as PBRMaterial;
        material.baseColor.set(this._originalColor.x, this._originalColor.y, this._originalColor.z, 1);
      }
    }
  }
}

// 摄像机跟随脚本
class CameraFollowScript extends Script {
  private _target: Entity;
  private _offset = new Vector3(0, 8, -12);
  private _lookAtOffset = new Vector3(0, 1, 0);

  init(target: Entity) {
    this._target = target;
  }

  onUpdate() {
    if (!this._target) return;

    // 更新摄像机位置
    const targetPos = this._target.transform.worldPosition;
    const newPos = new Vector3();
    Vector3.add(targetPos, this._offset, newPos);
    this.entity.transform.position = newPos;

    // 让摄像机看向角色
    const lookAtPos = new Vector3();
    Vector3.add(targetPos, this._lookAtOffset, lookAtPos);
    this.entity.transform.lookAt(lookAtPos, new Vector3(0, 1, 0));
  }
}

WebGLEngine.create({ canvas: "canvas", physics: new PhysXPhysics() }).then((engine) => {
  engine.canvas.resizeByClientSize();
  const scene = engine.sceneManager.activeScene;
  const rootEntity = scene.createRootEntity("root");

  // 设置环境光
  scene.ambientLight.diffuseSolidColor.set(1, 1, 1, 1);
  scene.ambientLight.diffuseIntensity = 0.8;

  // 创建摄像机
  const cameraEntity = rootEntity.createChild("camera");
  const camera = cameraEntity.addComponent(Camera);
  const cameraFollow = cameraEntity.addComponent(CameraFollowScript);

  // 创建点光源
  const light = rootEntity.createChild("light");
  light.transform.setPosition(0, 10, 0);
  const pointLight = light.addComponent(PointLight);
  pointLight.color.set(2.0, 2.0, 2.0, 1.0); // 使用颜色强度来控制亮度
  pointLight.distance = 50;

  // 创建地面
  const ground = createGround(rootEntity);

  // 创建角色控制器
  const character = createCharacter(rootEntity);
  character.addComponent(CharacterMovementScript);
  cameraFollow.init(character);

  // 创建多个可推动的箱子
  const box1 = createPushableBox(rootEntity, 5, 1, 0);
  box1.addComponent(BoxResetScript);

  const box2 = createPushableBox(rootEntity, -3, 1, 4);
  box2.addComponent(BoxResetScript);

  const box3 = createPushableBox(rootEntity, 8, 1, -5);
  box3.addComponent(BoxResetScript);

  const box4 = createPushableBox(rootEntity, -6, 1, -2);
  box4.addComponent(BoxResetScript);

  // 添加线框调试渲染器
  rootEntity.addComponent(MeshRenderer);
  const wireframe = rootEntity.addComponent(WireframeManager);
  wireframe.addEntityWireframe(character);
  wireframe.addEntityWireframe(box1);
  wireframe.addEntityWireframe(box2);
  wireframe.addEntityWireframe(box3);
  wireframe.addEntityWireframe(box4);
  wireframe.addEntityWireframe(ground);

  // 设置物理重力
  scene.physics.gravity = new Vector3(0, -20, 0);

  // 添加操作说明到页面
  const instructions = document.createElement("div");
  instructions.innerHTML = `
    <div style="position: absolute; top: 10px; left: 10px; color: white; font-family: Arial; font-size: 14px; background: rgba(0,0,0,0.8); padding: 15px; border-radius: 8px; line-height: 1.4;">
      <h3 style="margin: 0 0 10px 0; color: #ffcc00;">PhysX CharacterController 推箱子演示</h3>
      <p style="margin: 0;"><strong>W</strong> - 向前移动</p>
      <p style="margin: 0;"><strong>S</strong> - 向后移动</p>
      <p style="margin: 0;"><strong>A</strong> - 向左移动</p>
      <p style="margin: 0;"><strong>D</strong> - 向右移动</p>
      <p style="margin: 0;"><strong>空格</strong> - 跳跃</p>
      <p style="margin: 5px 0 0 0; font-size: 12px; color: #ccc;">走向蓝色箱子自动推动，箱子被推远会自动重置</p>
    </div>
  `;
  document.body.appendChild(instructions);

  engine.resourceManager
    .load<AmbientLight>({
      type: AssetType.Env,
      url: "https://gw.alipayobjects.com/os/bmw-prod/89c54544-1184-45a1-b0f5-c0b17e5c3e68.bin"
    })
    .then((ambientLight) => {
      scene.ambientLight = ambientLight;
      engine.run();
      // updateForE2E(engine, 100, 20);
      // initScreenshot(engine, camera);
    });
});
