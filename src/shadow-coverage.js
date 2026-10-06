import * as THREE from 'three';

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const worldOrigin = new THREE.Vector3(), pointWorld = new THREE.Vector3(), rayDirection = new THREE.Vector3();
const fallbackForward = new THREE.Vector3(), fallbackRight = new THREE.Vector3(), focusPoint = new THREE.Vector3();
const groundPoints = Array.from({ length: 4 }, () => new THREE.Vector3());
const right = new THREE.Vector3(), up = new THREE.Vector3(), origin = new THREE.Vector3(), localPoint = new THREE.Vector3();
const lightDirection = new THREE.Vector3();
const coverage = { left: 0, right: 0, bottom: 0, top: 0, near: 0, far: 0, width: 0, height: 0,
  margin: 0, resolution: 0, centreX: 0, centreY: 0, frustumCorners: 0 };

/** Fit a stabilized directional shadow camera to the camera's ground footprint. */
export function updateShadowCoverage(light, camera, { resolution = light.shadow.mapSize.x, casterHeight = 24, casterMargin = 2 } = {}) {
  const target = light.target;
  light.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  light.shadow.updateMatrices(light);

  const shadowCamera = light.shadow.camera;
  right.setFromMatrixColumn(shadowCamera.matrixWorld, 0).normalize();
  up.setFromMatrixColumn(shadowCamera.matrixWorld, 1).normalize();
  shadowCamera.getWorldPosition(origin);
  const originX = origin.dot(right), originY = origin.dot(up);
  camera.getWorldPosition(worldOrigin);
  let groundCount = 0;
  for (const [x, y] of CORNERS) {
    pointWorld.set(x, y, 0.5).unproject(camera);
    rayDirection.copy(pointWorld).sub(worldOrigin).normalize();
    if (rayDirection.y >= -1e-4) continue;
    const distance = -worldOrigin.y / rayDirection.y;
    if (distance > 0 && Number.isFinite(distance)) groundPoints[groundCount++].copy(worldOrigin).addScaledVector(rayDirection, distance);
  }

  // The normal driving camera sees ground at all four corners. This fallback keeps
  // the light valid if a future camera angle points any corner above the horizon.
  if (groundCount < 2) {
    fallbackForward.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
    fallbackRight.set(fallbackForward.z, 0, -fallbackForward.x);
    camera.getWorldDirection(fallbackForward);
    const distance = Math.max(25, Math.min(camera.far * 0.4, 70));
    focusPoint.copy(worldOrigin).addScaledVector(fallbackForward, distance);
    groundPoints[0].copy(focusPoint).addScaledVector(fallbackRight, -35);
    groundPoints[1].copy(focusPoint).addScaledVector(fallbackRight, 35);
    groundCount = 2;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxDepth = 0;
  for (let i = 0; i < groundCount; i++) {
    const point = groundPoints[i];
    const x = point.dot(right), y = point.dot(up);
    localPoint.copy(point).sub(origin);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    maxDepth = Math.max(maxDepth, -localPoint.z);
  }

  // A caster above the ground can project into the visible footprint from outside
  // it. Cover the maximum city building height along both light-plane axes.
  lightDirection.setFromMatrixColumn(shadowCamera.matrixWorld, 2).normalize();
  const slope = Math.hypot(lightDirection.x, lightDirection.z) / Math.max(0.2, Math.abs(lightDirection.y));
  const margin = casterHeight * slope + casterMargin;
  minX -= margin; maxX += margin; minY -= margin; maxY += margin;

  const width = Math.max(32, Math.ceil((maxX - minX) / 2) * 2);
  const height = Math.max(32, Math.ceil((maxY - minY) / 2) * 2);
  const texelX = width / Math.max(1, resolution), texelY = height / Math.max(1, resolution);
  const centreX = Math.round(((minX + maxX) / 2) / texelX) * texelX;
  const centreY = Math.round(((minY + maxY) / 2) / texelY) * texelY;
  const localX = centreX - originX, localY = centreY - originY;
  shadowCamera.left = localX - width / 2;
  shadowCamera.right = localX + width / 2;
  shadowCamera.bottom = localY - height / 2;
  shadowCamera.top = localY + height / 2;
  shadowCamera.near = 0.1;
  shadowCamera.far = Math.max(80, Math.ceil(maxDepth + casterHeight + 8));
  shadowCamera.updateProjectionMatrix();
  light.shadow.needsUpdate = true;

  Object.assign(coverage, { left: shadowCamera.left, right: shadowCamera.right, bottom: shadowCamera.bottom, top: shadowCamera.top,
    near: shadowCamera.near, far: shadowCamera.far, width, height, margin, resolution,
    centreX, centreY, frustumCorners: groundCount });
  return coverage;
}
