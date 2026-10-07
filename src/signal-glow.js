import * as THREE from 'three';

const SIGNAL_COLORS = Object.freeze({
  red: new THREE.Color('#f34f45'),
  yellow: new THREE.Color('#ffc34a'),
  green: new THREE.Color('#51d28b'),
});
const PUFF_COUNT = 7;

/** Layout for a broad, short fog bank aimed ahead and slightly inward over the road. */
export function signalBeamLayout(approach, color) {
  if (!SIGNAL_COLORS[color]) return { visible: false };
  const length = 12;
  const width = 10.8;
  const verticalRadius = 1.35;
  const sourceY = color === 'red' ? 3.5 : color === 'yellow' ? 3.05 : 2.6;
  // Signals sit on the right sidewalk; turn the cloud bank inward toward the asphalt.
  const dirX = -approach.forwardX - approach.rightX * 0.38;
  const dirY = -0.015;
  const dirZ = -approach.forwardZ - approach.rightZ * 0.38;
  const dirLength = Math.hypot(dirX, dirY, dirZ);
  const direction = { x: dirX / dirLength, y: dirY / dirLength, z: dirZ / dirLength };
  const source = {
    x: approach.signalX - approach.forwardX * 0.22,
    y: sourceY,
    z: approach.signalZ - approach.forwardZ * 0.22,
  };
  return { visible: true, length, width, verticalRadius, puffCount: PUFF_COUNT, source, direction };
}

/**
 * Overlapping soft ellipsoids create a stylized fog bank without painting the road.
 * All puffs share one instanced draw call regardless of city signal count.
 */
export function createSignalBeam(approaches) {
  const geometry = new THREE.SphereGeometry(1, 12, 10);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      varying vec3 vLocal;
      varying vec3 vColor;
      void main() {
        vLocal = position;
        vColor = instanceColor;
        vec3 instanceScale = vec3(length(instanceMatrix[0].xyz),
          length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec3 correctedNormal = normal / max(instanceScale * instanceScale, vec3(0.0001));
        vViewNormal = normalize(normalMatrix * mat3(instanceMatrix) * correctedNormal);
        vec4 viewPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: `
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      varying vec3 vLocal;
      varying vec3 vColor;
      void main() {
        float facing = max(0.0, dot(normalize(vViewNormal), normalize(-vViewPosition)));
        float softEdge = smoothstep(0.02, 0.5, facing);
        float cloudA = sin(vLocal.x * 7.0 + vLocal.y * 3.0) * sin(vLocal.z * 8.0 - vLocal.y * 4.0);
        float cloudB = sin(vLocal.x * 4.0 - vLocal.z * 6.0 + vLocal.y * 5.0);
        float density = 0.76 + 0.18 * cloudA + 0.06 * cloudB;
        float alpha = softEdge * density * 0.17;
        gl_FragColor = vec4(vColor * alpha, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, approaches.length * PUFF_COUNT);
  mesh.name = 'Signal fog puffs';
  mesh.renderOrder = 2;

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const across = new THREE.Vector3();
  const vertical = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    matrix.compose(position.set(0, 0, 0), rotation.identity(), scale.set(0, 0, 0));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, SIGNAL_COLORS.red);
  }
  mesh.instanceMatrix.needsUpdate = true;

  mesh.userData.updateBeam = (index, approach, color) => {
    const beam = signalBeamLayout(approach, color);
    if (beam.visible) {
      direction.set(beam.direction.x, beam.direction.y, beam.direction.z);
      across.set(-direction.z, 0, direction.x).normalize();
      vertical.crossVectors(across, direction).normalize();
      basis.makeBasis(across, direction, vertical);
      rotation.setFromRotationMatrix(basis);
    }
    for (let puff = 0; puff < PUFF_COUNT; puff++) {
      const instance = index * PUFF_COUNT + puff;
      if (!beam.visible) {
        matrix.compose(position.set(0, 0, 0), rotation.identity(), scale.set(0, 0, 0));
        mesh.setColorAt(instance, SIGNAL_COLORS.red);
      } else {
        const t = (puff + 0.5) / PUFF_COUNT;
        const radius = 0.65 + (beam.width / 2 - 0.65) * t;
        matrix.compose(
          position.set(
            beam.source.x + beam.direction.x * beam.length * t,
            beam.source.y + beam.direction.y * beam.length * t,
            beam.source.z + beam.direction.z * beam.length * t,
          ),
          rotation,
          scale.set(radius, beam.length / PUFF_COUNT * 0.95, 0.55 + (beam.verticalRadius - 0.55) * t),
        );
        mesh.setColorAt(instance, SIGNAL_COLORS[color]);
      }
      mesh.setMatrixAt(instance, matrix);
    }
  };
  return mesh;
}
