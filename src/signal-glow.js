import * as THREE from 'three';

/** Centre the pool on the incoming lane, extending away from the signal face. */
export function signalGlowLayout(approach, roadWidth) {
  const length = Math.min(14, Math.max(10, roadWidth * .8));
  const width = Math.min(5, roadWidth / 2 - .6);
  return {
    x: approach.stopX - approach.forwardX * length / 2,
    z: approach.stopZ - approach.forwardZ * length / 2,
    yaw: Math.atan2(approach.forwardX, approach.forwardZ), length, width,
  };
}

export function createSignalGlow(approaches, roadWidth) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv; vColor = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float soft = pow(max(0.0, 1.0 - dot(p, p)), 1.1);
        gl_FragColor = vec4(vColor, soft * 0.68);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, approaches.length);
  mesh.name = 'Signal approach glow';
  mesh.renderOrder = 1;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  approaches.forEach((approach, index) => {
    const layout = signalGlowLayout(approach, roadWidth);
    approach.glow = layout;
    matrix.compose(position.set(layout.x, .054, layout.z), rotation.setFromAxisAngle(up, layout.yaw),
      scale.set(layout.width, 1, layout.length));
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, new THREE.Color('#f34f45'));
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
