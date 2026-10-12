import * as THREE from 'three';

export const BEACON_PERIOD = .8;
export const BEACON_RADIUS = 3.6;
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export function beaconPulse(seconds, color = 0) {
  if (!Number.isFinite(seconds)) return 0;
  const t = ((seconds - color * .4) % BEACON_PERIOD + BEACON_PERIOD) % BEACON_PERIOD;
  const pulse = start => smooth((t - start) / .012) * (1 - smooth((t - start - .065) / .015));
  return Math.max(pulse(0), pulse(.14));
}

/** Shared volumes owned by the traffic assets, never by individual pool leases. */
export function createPoliceBeaconAssets() {
  const geometry = new THREE.SphereGeometry(1, 20, 12);
  const materials = ['#ff252d', '#2478ff'].map(color => new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, pulse: { value: 0 }, samples: { value: 16 } },
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    vertexShader: `varying vec3 vLocal; varying vec3 vRay; varying vec2 vSourceDepth;
      void main() {
        vLocal = position;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vec3 ray = isOrthographic ? vec3(0.,0.,-1.) : view.xyz;
        vRay = vec3(dot(ray,modelViewMatrix[0].xyz)/dot(modelViewMatrix[0].xyz,modelViewMatrix[0].xyz),
          dot(ray,modelViewMatrix[1].xyz)/dot(modelViewMatrix[1].xyz,modelViewMatrix[1].xyz),
          dot(ray,modelViewMatrix[2].xyz)/dot(modelViewMatrix[2].xyz,modelViewMatrix[2].xyz));
        vec4 source = projectionMatrix * modelViewMatrix * vec4(0.,0.,0.,1.);
        vSourceDepth = source.zw;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `uniform vec3 color; uniform float pulse; uniform float samples;
      varying vec3 vLocal; varying vec3 vRay; varying vec2 vSourceDepth;
      void main() {
        vec3 ray = normalize(vRay);
        float travel = max(0., -2. * dot(vLocal, ray));
        float stepSize = travel / samples;
        float light = 0.;
        for(int i=0;i<16;i++) {
          if(float(i)>=samples) break;
          vec3 p = vLocal + ray * (float(i)+.5)*stepSize;
          float r = length(p);
          float edge = 1. - smoothstep(.65, 1., r);
          // A thin horizontal fan and compact bright core, visible from every side.
          float fan = exp2(-abs(p.y)*22.) * exp2(-r*6.);
          light += (fan + .65*exp2(-dot(p,p)*90.)) * edge * stepSize;
        }
        float alpha = (1.-exp(-light*4.5))*pulse;
        if(alpha<.001) discard;
        // Source-depth occlusion stops the front of a volume peeking through a wall.
        gl_FragDepth = max(gl_FragCoord.z, vSourceDepth.x/vSourceDepth.y*.5+.5);
        gl_FragColor = vec4(mix(color,vec3(1.),.06),alpha);
        #include <colorspace_fragment>
      }`,
  }));
  let disposed = false;
  return {
    attach(group, centers) {
      centers.forEach((center, i) => {
        const mesh = new THREE.Mesh(geometry, materials[i]);
        mesh.name = i ? 'Blue beacon scattering' : 'Red beacon scattering';
        mesh.position.copy(center); mesh.scale.set(BEACON_RADIUS, .8, BEACON_RADIUS);
        mesh.renderOrder = 2; mesh.castShadow = mesh.receiveShadow = false;
        group.add(mesh);
      });
    },
    animate(time, lamps, quality = 'high') {
      materials.forEach((material, i) => {
        const pulse = beaconPulse(time, i);
        material.uniforms.pulse.value = pulse;
        material.uniforms.samples.value = quality === 'low' ? 8 : 16;
        lamps[i].emissiveIntensity = .12 + 5.5 * pulse;
      });
    },
    dispose() { if (disposed) return; disposed = true; geometry.dispose(); materials.forEach(m => m.dispose()); },
  };
}
