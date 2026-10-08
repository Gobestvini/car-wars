import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { artQuality } from './art-direction.js';

export const MINIATURE_BLUR = Object.freeze({
  high: Object.freeze(artQuality('high').edgeBlur),
  low: Object.freeze(artQuality('low').edgeBlur),
  focusOffset: 0.38,
  focusRadiusX: 0.45,
  focusRadiusY: 0.43,
  transitionStart: 0.8,
  transitionEnd: 1.3,
});

export function miniatureBlurTargetSize(cssWidth, cssHeight, pixelRatio, quality) {
  if (![cssWidth, cssHeight, pixelRatio].every(Number.isFinite) || cssWidth <= 0 || cssHeight <= 0 || pixelRatio <= 0) {
    return { width: 0, height: 0, blurWidth: 0, blurHeight: 0 };
  }
  const scale = MINIATURE_BLUR[quality === 'low' ? 'low' : 'high'].scale;
  const width = Math.max(1, Math.ceil(cssWidth * pixelRatio));
  const height = Math.max(1, Math.ceil(cssHeight * pixelRatio));
  return { width, height, blurWidth: Math.max(1, Math.ceil(width * scale)),
    blurHeight: Math.max(1, Math.ceil(height * scale)) };
}

export function miniatureBlurFocus(car, ahead) {
  const usable = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  if (!usable(car) || !usable(ahead)) return { x: 0.5, y: 0.5 };
  return { x: THREE.MathUtils.lerp(car.x, ahead.x, MINIATURE_BLUR.focusOffset),
    y: THREE.MathUtils.lerp(car.y, ahead.y, MINIATURE_BLUR.focusOffset) };
}

const fullscreenVertex = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const horizontalFragment = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float h;
  varying vec2 vUv;
  void main() {
    vec4 sum = vec4(0.0);
    sum += texture2D(tDiffuse, vUv + vec2(-4.0*h,0.0))*0.051;
    sum += texture2D(tDiffuse, vUv + vec2(-3.0*h,0.0))*0.0918;
    sum += texture2D(tDiffuse, vUv + vec2(-2.0*h,0.0))*0.12245;
    sum += texture2D(tDiffuse, vUv + vec2(-1.0*h,0.0))*0.1531;
    sum += texture2D(tDiffuse, vUv)*0.1633;
    sum += texture2D(tDiffuse, vUv + vec2(1.0*h,0.0))*0.1531;
    sum += texture2D(tDiffuse, vUv + vec2(2.0*h,0.0))*0.12245;
    sum += texture2D(tDiffuse, vUv + vec2(3.0*h,0.0))*0.0918;
    sum += texture2D(tDiffuse, vUv + vec2(4.0*h,0.0))*0.051;
    gl_FragColor = sum;
  }
`;

const verticalFragment = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float v;
  varying vec2 vUv;
  void main() {
    vec4 sum = vec4(0.0);
    sum += texture2D(tDiffuse, vUv + vec2(0.0,-4.0*v))*0.051;
    sum += texture2D(tDiffuse, vUv + vec2(0.0,-3.0*v))*0.0918;
    sum += texture2D(tDiffuse, vUv + vec2(0.0,-2.0*v))*0.12245;
    sum += texture2D(tDiffuse, vUv + vec2(0.0,-1.0*v))*0.1531;
    sum += texture2D(tDiffuse, vUv)*0.1633;
    sum += texture2D(tDiffuse, vUv + vec2(0.0,1.0*v))*0.1531;
    sum += texture2D(tDiffuse, vUv + vec2(0.0,2.0*v))*0.12245;
    sum += texture2D(tDiffuse, vUv + vec2(0.0,3.0*v))*0.0918;
    sum += texture2D(tDiffuse, vUv + vec2(0.0,4.0*v))*0.051;
    gl_FragColor = sum;
  }
`;

const compositeFragment = /* glsl */`
  uniform sampler2D tSharp;
  uniform sampler2D tBlur;
  uniform vec2 focus;
  uniform vec2 focusRadius;
  uniform vec2 viewport;
  uniform float transitionStart;
  uniform float transitionEnd;
  varying vec2 vUv;
  void main() {
    vec2 delta = (vUv - focus) / focusRadius;
    float edge = length(delta);
    float blurMix = smoothstep(transitionStart, transitionEnd, edge);
    vec4 color = mix(texture2D(tSharp, vUv), texture2D(tBlur, vUv), blurMix);
    gl_FragColor = color;
  }
`;

function makeLinearTarget(width, height, type, depthBuffer) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;
  target.texture.generateMipmaps = false;
  return target;
}

function material(fragmentShader, uniforms, { toneMapped = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: fullscreenVertex,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped,
    blending: THREE.NoBlending,
  });
}

/** Reuse one scene-color buffer and three full-screen passes for a peripheral miniature blur. */
export function createMiniatureBlur(renderer) {
  const supported = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const sharpTarget = supported ? makeLinearTarget(1, 1, THREE.HalfFloatType, true) : null;
  const horizontalTarget = supported ? makeLinearTarget(1, 1, THREE.HalfFloatType, false) : null;
  const verticalTarget = supported ? makeLinearTarget(1, 1, THREE.HalfFloatType, false) : null;
  const horizontalMaterial = supported ? material(horizontalFragment,
    { tDiffuse: { value: null }, h: { value: 0 } }) : null;
  const verticalMaterial = supported ? material(verticalFragment,
    { tDiffuse: { value: null }, v: { value: 0 } }) : null;
  const compositeMaterial = supported ? material(compositeFragment, {
    tSharp: { value: null }, tBlur: { value: null },
    focus: { value: new THREE.Vector2(0.5, 0.5) },
    focusRadius: { value: new THREE.Vector2(MINIATURE_BLUR.focusRadiusX, MINIATURE_BLUR.focusRadiusY) },
    transitionStart: { value: MINIATURE_BLUR.transitionStart },
    transitionEnd: { value: MINIATURE_BLUR.transitionEnd },
  }, { toneMapped: true }) : null;
  const fullscreen = supported ? new FullScreenQuad(horizontalMaterial) : null;
  const warmupScene = supported ? new THREE.Scene() : null;
  const warmupCamera = supported ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4) : null;
  const warmupMesh = supported ? new THREE.Mesh(new THREE.PlaneGeometry(2, 2), horizontalMaterial) : null;
  if (warmupScene) { warmupScene.add(warmupMesh); warmupCamera.position.z = 1; }
  let quality = 'high';
  let cssWidth = 0, cssHeight = 0, pixelRatio = 1;
  let enabled = supported;
  let failure = supported ? null : 'half-float-linear-render-target-unsupported';
  let debugBypass = false;
  let disposed = false;
  let lastDrawCalls = 0;

  const resize = (width = innerWidth, height = innerHeight, ratio = renderer.getPixelRatio()) => {
    if (disposed) return false;
    const next = miniatureBlurTargetSize(width, height, ratio, quality);
    if (next.width === 0 || next.height === 0) return false;
    cssWidth = width; cssHeight = height; pixelRatio = ratio;
    if (!enabled) return false;
    if (sharpTarget.width !== next.width || sharpTarget.height !== next.height) {
      sharpTarget.setSize(next.width, next.height);
    }
    if (horizontalTarget.width !== next.blurWidth || horizontalTarget.height !== next.blurHeight) {
      horizontalTarget.setSize(next.blurWidth, next.blurHeight);
      verticalTarget.setSize(next.blurWidth, next.blurHeight);
    }
    horizontalMaterial.uniforms.h.value = MINIATURE_BLUR[quality].radiusCss / (4 * cssWidth);
    verticalMaterial.uniforms.v.value = MINIATURE_BLUR[quality].radiusCss / (4 * cssHeight);
    return true;
  };

  const setQuality = value => {
    const next = value === 'low' ? 'low' : 'high';
    if (quality === next) return false;
    quality = next;
    horizontalMaterial?.uniforms.h && (horizontalMaterial.uniforms.h.value = MINIATURE_BLUR[quality].radiusCss / (4 * Math.max(cssWidth, 1)));
    verticalMaterial?.uniforms.v && (verticalMaterial.uniforms.v.value = MINIATURE_BLUR[quality].radiusCss / (4 * Math.max(cssHeight, 1)));
    resize(cssWidth || innerWidth, cssHeight || innerHeight, pixelRatio);
    return true;
  };

  const setFocus = (car, camera) => {
    const point = car.position.clone();
    point.y += 0.8;
    const projectedCar = point.project(camera);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion).normalize();
    point.copy(car.position).addScaledVector(forward, 8);
    point.y += 0.15;
    const projectedAhead = point.project(camera);
    const focus = miniatureBlurFocus(
      { x: projectedCar.x * 0.5 + 0.5, y: projectedCar.y * 0.5 + 0.5 },
      { x: projectedAhead.x * 0.5 + 0.5, y: projectedAhead.y * 0.5 + 0.5 },
    );
    compositeMaterial.uniforms.focus.value.set(focus.x, focus.y);
  };

  const render = (scene, camera, { mode = 'follow', car = null } = {}) => {
    if (disposed || !enabled || debugBypass || mode === 'free') {
      lastDrawCalls = 0;
      renderer.render(scene, camera);
      return;
    }
    if (!(cssWidth > 0 && cssHeight > 0 && car)) {
      lastDrawCalls = 0;
      renderer.render(scene, camera);
      return;
    }

    const priorTarget = renderer.getRenderTarget();
    const priorViewport = renderer.getViewport(new THREE.Vector4());
    const priorScissor = renderer.getScissor(new THREE.Vector4());
    const priorScissorTest = renderer.getScissorTest();
    const priorClearColor = renderer.getClearColor(new THREE.Color());
    const priorClearAlpha = renderer.getClearAlpha();
    const priorAutoClear = renderer.autoClear;
    const priorInfoAutoReset = renderer.info.autoReset;
    const priorToneMapping = renderer.toneMapping;
    const priorOutputColorSpace = renderer.outputColorSpace;
    let failed = null;

    try {
      renderer.info.reset();
      renderer.info.autoReset = false;
      renderer.setScissorTest(false);
      renderer.autoClear = true;
      renderer.setRenderTarget(sharpTarget);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      horizontalMaterial.uniforms.tDiffuse.value = sharpTarget.texture;
      fullscreen.material = horizontalMaterial;
      renderer.setRenderTarget(horizontalTarget);
      renderer.clear(true, false, false);
      fullscreen.render(renderer);

      verticalMaterial.uniforms.tDiffuse.value = horizontalTarget.texture;
      fullscreen.material = verticalMaterial;
      renderer.setRenderTarget(verticalTarget);
      renderer.clear(true, false, false);
      fullscreen.render(renderer);

      compositeMaterial.uniforms.tSharp.value = sharpTarget.texture;
      compositeMaterial.uniforms.tBlur.value = verticalTarget.texture;
      setFocus(car, camera);
      fullscreen.material = compositeMaterial;
      renderer.setRenderTarget(priorTarget);
      if (priorTarget === null) {
        renderer.setViewport(0, 0, cssWidth * pixelRatio, cssHeight * pixelRatio);
      }
      renderer.clear(true, false, false);
      fullscreen.render(renderer);
      renderer.info.autoReset = priorInfoAutoReset;
      lastDrawCalls = renderer.info.render.calls;
    } catch (error) {
      failed = error;
      enabled = false;
      failure = `render-failed-${error?.name || 'Error'}`;
    } finally {
      renderer.setRenderTarget(priorTarget);
      renderer.setViewport(priorViewport);
      renderer.setScissor(priorScissor);
      renderer.setScissorTest(priorScissorTest);
      renderer.setClearColor(priorClearColor, priorClearAlpha);
      renderer.autoClear = priorAutoClear;
      renderer.toneMapping = priorToneMapping;
      renderer.outputColorSpace = priorOutputColorSpace;
      renderer.info.autoReset = priorInfoAutoReset;
    }

    if (failed) {
      lastDrawCalls = 0;
      renderer.render(scene, camera);
    }
  };

  const snapshot = () => {
    const bytesPerPixel = 12; // RGBA16F color plus a 24/32-bit depth attachment.
    const sharpPixels = sharpTarget ? sharpTarget.width * sharpTarget.height : 0;
    const blurPixels = horizontalTarget ? horizontalTarget.width * horizontalTarget.height : 0;
    const estimatedBytes = sharpPixels * bytesPerPixel + blurPixels * 16;
    return { enabled, failure, quality, radiusCss: MINIATURE_BLUR[quality].radiusCss,
      debugBypass, draws: lastDrawCalls, size: sharpTarget ? [sharpTarget.width, sharpTarget.height] : [0, 0],
      blurSize: horizontalTarget ? [horizontalTarget.width, horizontalTarget.height] : [0, 0],
      estimatedMiB: Number((estimatedBytes / 1048576).toFixed(2)) };
  };

  const compile = async () => {
    if (!enabled) return;
    for (const effectMaterial of [horizontalMaterial, verticalMaterial, compositeMaterial]) {
      warmupMesh.material = effectMaterial;
      await renderer.compileAsync(warmupScene, warmupCamera);
    }
  };

  return {
    resize,
    setQuality,
    render,
    compile,
    snapshot,
    setDebugBypass(value, debug) { if (!debug) return false; debugBypass = Boolean(value); return true; },
    dispose() {
      if (disposed) return;
      disposed = true;
      fullscreen?.dispose();
      warmupMesh?.geometry.dispose();
      for (const target of [sharpTarget, horizontalTarget, verticalTarget]) target?.dispose();
      for (const effectMaterial of [horizontalMaterial, verticalMaterial, compositeMaterial]) effectMaterial?.dispose();
    },
  };
}
