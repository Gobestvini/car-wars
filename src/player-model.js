import * as THREE from 'three';

export const PLAYER_MODEL_URL = 'models/player-sedan.glb';
export const PLAYER_VISUAL_WHEEL_RADIUS = .43;
const wheelUp = new THREE.Vector3();
const wheelDelta = new THREE.Vector3();

// Preserve physical tire forces/contact radius. Fit the smaller render tire to
// the same ground contact and keep its suspension travel inside the wheel well.
export function offsetPlayerWheel(pivot, wheel, car, detached = false) {
  wheelUp.set(0, 1, 0).applyQuaternion(car.quaternion);
  if (detached) {
    pivot.position.y -= wheel.radius - PLAYER_VISUAL_WHEEL_RADIUS;
    return;
  }
  pivot.position.addScaledVector(wheelUp, -(wheel.radius - PLAYER_VISUAL_WHEEL_RADIUS));
  const localY = wheelDelta.copy(pivot.position).sub(car.position).dot(wheelUp);
  if (localY > -.42) pivot.position.addScaledVector(wheelUp, -.42 - localY);
}
export const PLAYER_WHEEL_NAMES = Object.freeze([
  'wheel-front-left', 'wheel-front-right', 'wheel-rear-left', 'wheel-rear-right',
]);

// The authored asset is in simulation metres relative to the chassis COM.
// Bake exporter transforms once, so dents and wheel spin use the same axes as cannon-es.
export function preparePlayerModel(source) {
  const body = source.getObjectByName('body');
  const wheels = PLAYER_WHEEL_NAMES.map(name => source.getObjectByName(name));
  if (!body?.isMesh || wheels.some(wheel => !wheel?.isMesh)) {
    throw new Error('Player sedan requires body and four named wheel meshes');
  }
  source.updateMatrixWorld(true);
  const model = new THREE.Group();
  model.name = 'Player concept sedan';
  for (const node of [body, ...wheels]) {
    const world = node.matrixWorld.clone();
    const origin = node === body ? new THREE.Vector3() : node.getWorldPosition(new THREE.Vector3());
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z).multiply(world));
    node.geometry.dispose();
    node.geometry = geometry;
    node.removeFromParent();
    node.position.copy(origin);
    node.quaternion.identity();
    node.scale.set(1, 1, 1);
    node.castShadow = true;
    node.receiveShadow = true;
    model.add(node);
  }
  model.updateMatrixWorld(true);
  return { model, body, wheels };
}
