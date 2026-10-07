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
    uniforms: { sampleCount: { value: 16 } },
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
      uniform float sampleCount;
      varying vec3 vLocal;
      varying vec3 vRay;
      varying vec3 vColor;
      void main() {
        vec3 ray = normalize(vRay);
        vec3 safeRay = mix(vec3(0.00001), ray, step(vec3(0.00001), abs(ray)));
        vec3 farFace = mix(vec3(-0.5, 0.0, -0.5), vec3(0.5, 1.0, 0.5), step(vec3(0.0), ray));
        vec3 exitDistances = (farFace - vLocal) / safeRay;
        float travel = max(0.0, min(exitDistances.x, min(exitDistances.y, exitDistances.z)));
        float stepSize = travel / sampleCount;
        float light = 0.0;
        for (int i = 0; i < 16; i++) {
          if (float(i) >= sampleCount) break;
          vec3 p = vLocal + ray * (float(i) + 0.5) * stepSize;
          float t = clamp(p.y, 0.0, 1.0);
          vec2 radius = vec2(0.018, 0.065) + vec2(0.482, 0.435) * t;
          vec2 radial = p.xz / radius;
          float r2 = dot(radial, radial);
          float edge = 1.0 - smoothstep(0.35, 1.0, r2);
          // Combine radial/longitudinal attenuation in one exponential; no trig per sample.
          float scattering = exp2(-r2 * 4.328085 - t * 4.039546) * edge;
          float distanceFade = 1.0 - smoothstep(0.55, 1.0, t);
          light += scattering * distanceFade * stepSize;
        }
        float alpha = 1.0 - exp(-light * 7.0);
        gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.04), alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, approaches.length);
  mesh.name = 'Signal scattered light';
  mesh.renderOrder = 2;
  // Per-volume CPU culling below packs only intersecting beams into this one draw call.
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(approaches.length * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const sourceMatrices = new Float32Array(approaches.length * 16);
  const sourceColors = new Float32Array(approaches.length * 3);
  const active = new Uint8Array(approaches.length);
  const bounds = approaches.map(() => new THREE.Sphere());
  const indices = [];
  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
  const worldBounds = new THREE.Sphere();
  let dirty = true;
  const matrix = new THREE.Matrix4(), basis = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const direction = new THREE.Vector3(), across = new THREE.Vector3(), vertical = new THREE.Vector3();
  mesh.userData.updateBeam = (index, approach, color) => {
    const beam = signalBeamLayout(approach, color);
    active[index] = beam.visible ? 1 : 0;
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
      bounds[index].center.set(0, 0.5, 0).applyMatrix4(matrix);
      bounds[index].radius = Math.hypot(beam.width, beam.length, beam.verticalRadius * 2) / 2;
    }
    matrix.toArray(sourceMatrices, index * 16);
    (SIGNAL_COLORS[color] || SIGNAL_COLORS.red).toArray(sourceColors, index * 3);
    dirty = true;
  };
  mesh.userData.prepare = (camera = null, quality = 'high') => {
    material.uniforms.sampleCount.value = quality === 'low' ? 8 : 16;
    if (camera) {
      camera.updateMatrixWorld();
      mesh.updateWorldMatrix(true, false);
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
    }
    let count = 0, changed = dirty;
    for (let i = 0; i < approaches.length; i++) {
      if (!active[i]) continue;
      if (camera && !frustum.intersectsSphere(worldBounds.copy(bounds[i]).applyMatrix4(mesh.matrixWorld))) continue;
      if (indices[count] !== i) changed = true;
      indices[count++] = i;
    }
    if (indices.length !== count) changed = true;
    indices.length = count;
    if (changed) {
      for (let slot = 0; slot < count; slot++) {
        const source = indices[slot];
        for (let j = 0; j < 16; j++) mesh.instanceMatrix.array[slot * 16 + j] = sourceMatrices[source * 16 + j];
        for (let j = 0; j < 3; j++) mesh.instanceColor.array[slot * 3 + j] = sourceColors[source * 3 + j];
      }
      if (count) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, count * 16);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
      dirty = false;
    }
    mesh.count = count;
    mesh.visible = count > 0;
  };
  // Maps packed slots back to stable approach IDs for diagnostics.
  mesh.userData.visibleApproachIndices = indices;
  approaches.forEach((approach, index) => mesh.userData.updateBeam(index, approach, 'priority'));
  mesh.userData.prepare();
  return mesh;
}
