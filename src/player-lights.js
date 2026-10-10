import * as THREE from 'three';

// Tile IDs match the deterministic Blender atlas (4 x 4 cells, from bottom left).
const HEAD = 8, TAIL = 10;
export function createPlayerLights(body) {
  const material = body.material;
  const reverse = { value: 0 };
  material.roughness = .96;
  material.metalness = 0;
  material.onBeforeCompile = shader => {
    shader.uniforms.playerReverse = reverse;
    shader.fragmentShader = 'uniform float playerReverse;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      #ifdef USE_MAP
        float lampTile = floor(vMapUv.x * 4.0) + 4.0 * (3.0 - floor(vMapUv.y * 4.0));
        float headMask = 1.0 - step(0.5, abs(lampTile - 8.0));
        float tailMask = 1.0 - step(0.5, abs(lampTile - 10.0));
        // The rear lens is red in every state. Reversing raises its intensity
        // instead of swapping to a white lens, matching the compact concept.
        // Suppress the lens's blue/green channels under the bright game light
        // so ACES does not wash a glowing red lamp into pink.
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.12, 0.08), tailMask);
        totalEmissiveRadiance += diffuseColor.rgb * headMask * 3.2
          + vec3(1.0, 0.002, 0.001) * tailMask * (0.45 + playerReverse * 1.2);
      #endif
    `);
    // Keep saturated red after the game's ACES highlight desaturation.
    shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `
      #include <tonemapping_fragment>
      #ifdef USE_MAP
        gl_FragColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.025, 0.025), tailMask);
      #endif
    `);
  };
  material.customProgramCacheKey = () => 'car-stars-red-tail-lamps-v3';
  material.needsUpdate = true;

  // Four camera-facing soft halos in one draw call. Centres track deformed
  // lens vertices, so the glow cannot stay behind when a lamp is dented.
  const uv = body.geometry.attributes.uv;
  const positions = body.geometry.attributes.position;
  const lights = [
    { tile: HEAD, side: -1 }, { tile: HEAD, side: 1 },
    { tile: TAIL, side: -1 }, { tile: TAIL, side: 1 },
  ];
  for (const light of lights) {
    light.indices = [];
    for (let i = 0; i < uv.count; i++) {
      const tile = Math.floor(uv.getX(i) * 4) + 4 * (3 - Math.floor(uv.getY(i) * 4));
      if (tile === light.tile && Math.sign(positions.getX(i)) === light.side) light.indices.push(i);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 6 * 3), 3));
  const corners = [], roles = [];
  for (const light of lights) for (const corner of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]]) {
    corners.push(...corner); roles.push(light.tile === TAIL ? 1 : 0);
  }
  geometry.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
  geometry.setAttribute('reverseLamp', new THREE.Float32BufferAttribute(roles, 1));
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: { reverseLight: reverse }, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute vec2 corner; attribute float reverseLamp;
      varying vec2 vCorner; varying float vReverse;
      void main() {
        vCorner = corner; vReverse = reverseLamp;
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        p.xy += corner * 0.23;
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: `uniform float reverseLight; varying vec2 vCorner; varying float vReverse;
      void main() {
        float r = dot(vCorner, vCorner);
        if (r > 1.0) discard;
        float lampStrength = mix(1.0, mix(0.4, 1.0, reverseLight), vReverse);
        float opacity = exp(-r * 5.0) * 0.3 * lampStrength;
        gl_FragColor = vec4(mix(vec3(1.0,0.83,0.42),vec3(1.0,0.008,0.003),vReverse), opacity);
        #include <colorspace_fragment>
      }`,
  });
  const glow = new THREE.Mesh(geometry, glowMaterial);
  glow.name = 'Player lamp halos';
  glow.frustumCulled = false;
  glow.userData.playerLightEffect = true;
  const point = new THREE.Vector3(), center = new THREE.Vector3();
  function update({ signedSpeed = 0, throttle = 0 } = {}) {
    // Reverse request while stopped, or actual rearward travel. Forward braking
    // before selecting reverse does not boost the red lamps prematurely.
    reverse.value = signedSpeed < -.25 || (throttle < -.05 && signedSpeed < .5) ? 1 : 0;
    const target = geometry.attributes.position;
    for (let lightIndex = 0; lightIndex < lights.length; lightIndex++) {
      const light = lights[lightIndex];
      center.set(0,0,0);
      for (const index of light.indices) center.add(point.fromBufferAttribute(positions,index));
      center.divideScalar(Math.max(1,light.indices.length)).applyMatrix4(body.matrix);
      center.z += light.tile === HEAD ? .014 : -.014;
      for (let i = 0; i < 6; i++) target.setXYZ(lightIndex*6+i,center.x,center.y,center.z);
    }
    target.needsUpdate = true;
  }
  update();
  return { glow, update, snapshot: () => ({ headlights: true, tailLights: true, reverse: reverse.value > 0,
    lensVertices: lights.map(light => light.indices.length) }) };
}
