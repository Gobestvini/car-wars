import * as THREE from 'three';

const SIGNAL_COLORS = Object.freeze({
  red: new THREE.Color('#f34f45'),
  yellow: new THREE.Color('#ffc34a'),
  green: new THREE.Color('#51d28b'),
});

/** Short, widening light volume, tilted inward from the sidewalk. */
export function signalBeamLayout(approach, color) {
  if (!SIGNAL_COLORS[color]) return { visible: false };
  const length = 12, width = 10.8, verticalRadius = 1.35;
  const sourceY = color === 'red' ? 3.5 : color === 'yellow' ? 3.05 : 2.6;
  const dirX = -approach.forwardX - approach.rightX * 0.38;
  const dirY = -0.015;
  const dirZ = -approach.forwardZ - approach.rightZ * 0.38;
  const magnitude = Math.hypot(dirX, dirY, dirZ);
  const direction = { x: dirX / magnitude, y: dirY / magnitude, z: dirZ / magnitude };
  const source = {
    x: approach.signalX - approach.forwardX * 0.22,
    y: sourceY,
    z: approach.signalZ - approach.forwardZ * 0.22,
  };
  return { visible: true, length, width, verticalRadius, source, direction };
}

/** Integrate scattered light through a bounded volume; the box itself is invisible. */
export function createSignalBeam(approaches) {
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    toneMapped: false, side: THREE.FrontSide, blending: THREE.NormalBlending,
    vertexShader: `
      varying vec3 vLocal;
      varying vec3 vRay;
      varying vec3 vColor;
      void main() {
        vLocal = position;
        vColor = instanceColor;
        mat4 mv = modelViewMatrix * instanceMatrix;
        vec4 viewPosition = mv * vec4(position, 1.0);
        vec3 viewRay = isOrthographic ? vec3(0.0, 0.0, -1.0) : viewPosition.xyz;
        // Inverse rotation and scale, also valid for our anisotropic bounds.
        vRay = vec3(dot(viewRay, mv[0].xyz) / max(dot(mv[0].xyz, mv[0].xyz), 0.000001),
                    dot(viewRay, mv[1].xyz) / max(dot(mv[1].xyz, mv[1].xyz), 0.000001),
                    dot(viewRay, mv[2].xyz) / max(dot(mv[2].xyz, mv[2].xyz), 0.000001));
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: `
      varying vec3 vLocal;
      varying vec3 vRay;
      varying vec3 vColor;
      void main() {
        vec3 ray = normalize(vRay);
        vec3 safeRay = mix(vec3(0.00001), ray, step(vec3(0.00001), abs(ray)));
        vec3 farFace = mix(vec3(-0.5, 0.0, -0.5), vec3(0.5, 1.0, 0.5), step(vec3(0.0), ray));
        vec3 exitDistances = (farFace - vLocal) / safeRay;
        float travel = max(0.0, min(exitDistances.x, min(exitDistances.y, exitDistances.z)));
        float stepSize = travel / 24.0;
        float light = 0.0;
        for (int i = 0; i < 24; i++) {
          vec3 p = vLocal + ray * (float(i) + 0.5) * stepSize;
          float t = clamp(p.y, 0.0, 1.0);
          vec2 radius = vec2(0.018, 0.065) + vec2(0.482, 0.435) * t;
          vec2 radial = p.xz / radius;
          float r2 = dot(radial, radial);
          float edge = 1.0 - smoothstep(0.35, 1.0, r2);
          float scattering = exp(-r2 * 3.0) * edge;
          float distanceFade = exp(-t * 2.8) * (1.0 - smoothstep(0.55, 1.0, t));
          float wisps = 0.94 + 0.06 * sin(p.x * 18.0 + t * 11.0) * sin(p.z * 13.0 - t * 7.0);
          light += scattering * distanceFade * wisps * stepSize;
        }
        float alpha = 1.0 - exp(-light * 3.5);
        gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.18), alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, approaches.length);
  mesh.name = 'Signal scattered light';
  mesh.renderOrder = 2;
  // Matrices change with the active lamp; no stale bounds from initially hidden instances.
  mesh.frustumCulled = false;
  const matrix = new THREE.Matrix4(), basis = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const direction = new THREE.Vector3(), across = new THREE.Vector3(), vertical = new THREE.Vector3();
  mesh.userData.updateBeam = (index, approach, color) => {
    const beam = signalBeamLayout(approach, color);
    if (!beam.visible) {
      matrix.compose(position.set(0, 0, 0), rotation.identity(), scale.set(0, 0, 0));
    } else {
      direction.set(beam.direction.x, beam.direction.y, beam.direction.z);
      across.set(-direction.z, 0, direction.x).normalize();
      vertical.crossVectors(across, direction).normalize();
      basis.makeBasis(across, direction, vertical);
      rotation.setFromRotationMatrix(basis);
      matrix.compose(position.set(beam.source.x, beam.source.y, beam.source.z), rotation,
        scale.set(beam.width, beam.length, beam.verticalRadius * 2));
    }
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, SIGNAL_COLORS[color] || SIGNAL_COLORS.red);
  };
  approaches.forEach((approach, index) => mesh.userData.updateBeam(index, approach, 'priority'));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
