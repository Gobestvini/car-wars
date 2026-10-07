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

/** A tapered scattering volume from the active bulb toward the approaching lane. */
export function signalBeamLayout(approach, color) {
  if (!['red', 'yellow', 'green'].includes(color)) return { visible: false };
  const length = 13;
  const sourceY = color === 'red' ? 3.5 : color === 'yellow' ? 3.05 : 2.6;
  const dirX = -approach.forwardX, dirY = -0.14, dirZ = -approach.forwardZ;
  const dirLength = Math.hypot(dirX, dirY, dirZ);
  const direction = { x: dirX / dirLength, y: dirY / dirLength, z: dirZ / dirLength };
  const source = { x: approach.signalX - approach.forwardX * 0.22, y: sourceY,
    z: approach.signalZ - approach.forwardZ * 0.22 };
  return {
    visible: true, length, radius: 1.8, source, direction,
    x: source.x + direction.x * length / 2,
    y: source.y + direction.y * length / 2,
    z: source.z + direction.z * length / 2,
  };
}

export function createSignalBeam(approaches) {
  const geometry = new THREE.ConeGeometry(1, 1, 20, 6, true);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
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
        float along = smoothstep(0.0, 0.09, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float scatter = 0.9 + 0.1 * sin(vUv.y * 17.0 + sin(vUv.x * 5.0));
        float around = 0.82 + 0.18 * sin(vUv.x * 3.14159265);
        float alpha = along * scatter * around * 0.34;
        gl_FragColor = vec4(vColor * alpha, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, approaches.length);
  mesh.name = 'Signal fog beams'; mesh.renderOrder = 2;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), axis = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const colors = { red: new THREE.Color('#f34f45'), yellow: new THREE.Color('#ffc34a'), green: new THREE.Color('#51d28b') };
  for (let i = 0; i < approaches.length; i++) {
    mesh.setMatrixAt(i, matrix.compose(position.set(0, 0, 0), rotation.identity(), scale.set(0, 0, 0)));
    mesh.setColorAt(i, new THREE.Color('#000000'));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.updateBeam = (index, approach, color) => {
    const beam = signalBeamLayout(approach, color);
    if (!beam.visible) {
      matrix.compose(position.set(0, 0, 0), rotation.identity(), scale.set(0, 0, 0));
      mesh.setColorAt(index, new THREE.Color('#000000'));
    } else {
      direction.set(beam.direction.x, beam.direction.y, beam.direction.z);
      matrix.compose(position.set(beam.x, beam.y, beam.z), rotation.setFromUnitVectors(axis, direction.negate()),
        scale.set(beam.radius, beam.length, beam.radius));
      mesh.setColorAt(index, colors[color]);
    }
    mesh.setMatrixAt(index, matrix);
  };
  return mesh;
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
