import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { artQuality } from './art-direction.js';

export const MINIATURE_BLUR = Object.freeze({
  high: Object.freeze(artQuality('high').edgeBlur),
  low: Object.freeze(artQuality('low').edgeBlur),
  focusY: 0.5,
  focusSize: 0.4,
  minFocusSize: 0.2,
  maxFocusSize: 0.9,
  transitionStart: 0.8,
  transitionEnd: 1.3,
});

export function miniatureBlurTargetSize(cssWidth, cssHeight, pixelRatio, quality) {
  if (![cssWidth, cssHeight, pixelRatio].every(Number.isFinite) || cssWidth <= 0 || cssHeight <= 0 || pixelRatio <= 0) {
    return { width: 0, height: 0, blurWidth: 0, blurHeight: 0 };
  }
  const scale = MINIATURE_BLUR[quality === 'low' ? 'low' : 'high'].scale;
  const width = Math.max(1, Math.floor(cssWidth * pixelRatio));
  const height = Math.max(1, Math.floor(cssHeight * pixelRatio));
  return { width, height, blurWidth: Math.max(1, Math.ceil(width * scale)),
    blurHeight: Math.max(1, Math.ceil(height * scale)) };
}

export function miniatureBlurSamples(quality, maxSamples, supportedSamples = null) {
  if (!Number.isFinite(maxSamples) || maxSamples < 2) return 0;
  const limit = Math.min(quality === 'low' ? 2 : 4, Math.floor(maxSamples));
  const candidates = supportedSamples ?? [4, 2];
  return [...candidates].filter(samples => Number.isInteger(samples) && samples <= limit && samples >= 2)
    .sort((a, b) => b - a)[0] ?? 0;
}

function multisampleCounts(renderer) {
  const gl = renderer.getContext();
  try {
    const color = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.SAMPLES, gl.RGBA16F);
    const depth = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.SAMPLES, gl.DEPTH_COMPONENT24);
    return [...color].filter(samples => depth.includes(samples));
  } catch {
    return null;
  }
}

export function miniatureBlurWeight(y, focusY, radiusY = miniatureBlurFocusRadius(MINIATURE_BLUR.focusSize),
  transitionStart = MINIATURE_BLUR.transitionStart, transitionEnd = MINIATURE_BLUR.transitionEnd) {
  if (![y, focusY, radiusY, transitionStart, transitionEnd].every(Number.isFinite)
    || radiusY <= 0 || transitionEnd <= transitionStart) return 1;
  return THREE.MathUtils.smoothstep(Math.abs(y - focusY) / radiusY, transitionStart, transitionEnd);
}

export function normalizeBlurFocusSize(value) {
  return Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, MINIATURE_BLUR.minFocusSize, MINIATURE_BLUR.maxFocusSize)
    : MINIATURE_BLUR.focusSize;
}

export function miniatureBlurFocusRadius(size) {
  const normalized = normalizeBlurFocusSize(size);
  return normalized / (2 * MINIATURE_BLUR.transitionStart);
}

export function normalizeBlurStrength(value) {
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 2) : 1;
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
  uniform sampler2D tBlur0;
  uniform sampler2D tBlur1;
  uniform sampler2D tBlur2;
  uniform float focusY;
  uniform float focusRadiusY;
  uniform float transitionStart;
  uniform float transitionEnd;
  uniform float blurAmount;
  varying vec2 vUv;
  void main() {
    float verticalDistance = abs(vUv.y - focusY) / focusRadiusY;
    float blurMix = smoothstep(transitionStart, transitionEnd, verticalDistance) * blurAmount;
    float level = blurMix * 3.0;
    vec4 color;
    if (level < 1.0) color = mix(texture2D(tSharp, vUv), texture2D(tBlur0, vUv), level);
    else if (level < 2.0) color = mix(texture2D(tBlur0, vUv), texture2D(tBlur1, vUv), level - 1.0);
    else color = mix(texture2D(tBlur1, vUv), texture2D(tBlur2, vUv), min(level - 2.0, 1.0));
    gl_FragColor = color;
    // ShaderMaterial injects the function declarations, not these output calls.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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

/** Reuse one scene-color buffer and three full-screen passes for a vertical miniature blur. */
export function createMiniatureBlur(renderer) {
  let quality = 'high';
  const supported = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const renderbufferSamples = supported ? multisampleCounts(renderer) : [];
  const sharpTarget = supported ? makeLinearTarget(1, 1, THREE.HalfFloatType, true) : null;
  const horizontalTargets = supported ? Array.from({ length: 3 }, () => makeLinearTarget(1, 1, THREE.HalfFloatType, false)) : [];
  const verticalTargets = supported ? Array.from({ length: 3 }, () => makeLinearTarget(1, 1, THREE.HalfFloatType, false)) : [];
  const horizontalMaterials = supported ? Array.from({ length: 3 }, () => material(horizontalFragment,
    { tDiffuse: { value: null }, h: { value: 0 } })) : [];
  const verticalMaterials = supported ? Array.from({ length: 3 }, () => material(verticalFragment,
    { tDiffuse: { value: null }, v: { value: 0 } })) : [];
  const compositeMaterial = supported ? material(compositeFragment, {
    tSharp: { value: null }, tBlur0: { value: null }, tBlur1: { value: null }, tBlur2: { value: null },
    focusY: { value: 0.5 },
    focusRadiusY: { value: miniatureBlurFocusRadius(MINIATURE_BLUR.focusSize) },
    transitionStart: { value: MINIATURE_BLUR.transitionStart },
    transitionEnd: { value: MINIATURE_BLUR.transitionEnd },
    blurAmount: { value: 1 },
  }, { toneMapped: true }) : null;
  const fullscreen = supported ? new FullScreenQuad(horizontalMaterials[0]) : null;
  const warmupScene = supported ? new THREE.Scene() : null;
  const warmupCamera = supported ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4) : null;
  const warmupMesh = supported ? new THREE.Mesh(new THREE.PlaneGeometry(2, 2), horizontalMaterials[0]) : null;
  if (warmupScene) { warmupScene.add(warmupMesh); warmupCamera.position.z = 1; }
  let strength = 1;
  let cssWidth = 0, cssHeight = 0, pixelRatio = 1;
  let enabled = supported;
  let failure = supported ? null : 'half-float-linear-render-target-unsupported';
  let focusY = MINIATURE_BLUR.focusY;
  let focusSize = MINIATURE_BLUR.focusSize;
  let debugFocusY = null;
  let antialiasSamples = miniatureBlurSamples(quality, renderer.capabilities.maxSamples, renderbufferSamples);
  let antialiasFailure = antialiasSamples > 0 ? null : 'multisample-unavailable';
  let antialiasValidated = false;
  if (sharpTarget) sharpTarget.samples = antialiasSamples;
  let debugBypass = false;
  let disposed = false;
  let lastDrawCalls = 0;

  const updateBlurRadii = () => {
    if (!supported) return;
    const radii = MINIATURE_BLUR[quality].radiiCss;
    for (let i = 0; i < radii.length; i++) {
      horizontalMaterials[i].uniforms.h.value = radii[i] * strength / (4 * Math.max(cssWidth, 1));
      verticalMaterials[i].uniforms.v.value = radii[i] * strength / (4 * Math.max(cssHeight, 1));
    }
  };

  const resize = (width = innerWidth, height = innerHeight, ratio = renderer.getPixelRatio()) => {
    if (disposed) return false;
    const next = miniatureBlurTargetSize(width, height, ratio, quality);
    if (next.width === 0 || next.height === 0) return false;
    cssWidth = width; cssHeight = height; pixelRatio = ratio;
    if (!enabled) return false;
    if (sharpTarget.width !== next.width || sharpTarget.height !== next.height) {
      sharpTarget.setSize(next.width, next.height);
      antialiasValidated = false;
    }
    for (const target of [...horizontalTargets, ...verticalTargets]) {
      if (target.width !== next.blurWidth || target.height !== next.blurHeight) target.setSize(next.blurWidth, next.blurHeight);
    }
    updateBlurRadii();
    return true;
  };

  const setQuality = value => {
    const next = value === 'low' ? 'low' : 'high';
    if (quality === next) return false;
    quality = next;
    resize(cssWidth || innerWidth, cssHeight || innerHeight, pixelRatio);
    return true;
  };

  const setFocus = () => {
    focusY = debugFocusY ?? MINIATURE_BLUR.focusY;
    compositeMaterial.uniforms.focusY.value = focusY;
  };

  const drawPipeline = (scene, camera, car, priorTarget) => {
    renderer.setRenderTarget(sharpTarget);
    if (antialiasSamples > 0 && !antialiasValidated) {
      const gl = renderer.getContext();
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('multisample-framebuffer-incomplete');
      }
      antialiasValidated = true;
    }
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    for (let i = 0; i < 3; i++) {
      horizontalMaterials[i].uniforms.tDiffuse.value = sharpTarget.texture;
      fullscreen.material = horizontalMaterials[i];
      renderer.setRenderTarget(horizontalTargets[i]);
      renderer.clear(true, false, false);
      fullscreen.render(renderer);

      verticalMaterials[i].uniforms.tDiffuse.value = horizontalTargets[i].texture;
      fullscreen.material = verticalMaterials[i];
      renderer.setRenderTarget(verticalTargets[i]);
      renderer.clear(true, false, false);
      fullscreen.render(renderer);
    }

    compositeMaterial.uniforms.tSharp.value = sharpTarget.texture;
    compositeMaterial.uniforms.tBlur0.value = verticalTargets[0].texture;
    compositeMaterial.uniforms.tBlur1.value = verticalTargets[1].texture;
    compositeMaterial.uniforms.tBlur2.value = verticalTargets[2].texture;
    setFocus();
    fullscreen.material = compositeMaterial;
    renderer.setRenderTarget(priorTarget);
    if (priorTarget === null) {
      // setViewport applies renderer DPR itself; passing buffer pixels doubles it.
      renderer.setViewport(0, 0, cssWidth, cssHeight);
    }
    renderer.clear(true, false, false);
    fullscreen.render(renderer);
  };

  const render = (scene, camera, { mode = 'follow', car = null } = {}) => {
    if (disposed || !enabled || strength === 0 || debugBypass || mode === 'free') {
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
      try {
        drawPipeline(scene, camera, car, priorTarget);
      } catch (error) {
        if (antialiasSamples === 0 || error?.message !== 'multisample-framebuffer-incomplete') throw error;
        antialiasFailure = error.message;
        antialiasSamples = 0;
        antialiasValidated = false;
        sharpTarget.samples = 0;
        sharpTarget.dispose();
        drawPipeline(scene, camera, car, priorTarget);
      }
      renderer.info.autoReset = priorInfoAutoReset;
      lastDrawCalls = renderer.info.render.calls;
    } catch (error) {
      failed = error;
      enabled = false;
      failure = `render-failed-${error?.name || 'Error'}-${error?.message || 'unknown'}:${error?.stack || ''}`;
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
    const bytesPerPixel = 12 + antialiasSamples * 12; // Resolved RGBA16F/depth plus multisampled RGBA16F/depth.
    const sharpPixels = sharpTarget ? sharpTarget.width * sharpTarget.height : 0;
    const blurPixels = horizontalTargets[0] ? horizontalTargets[0].width * horizontalTargets[0].height : 0;
    const estimatedBytes = sharpPixels * bytesPerPixel + blurPixels * 48;
    return { enabled, failure, antialiasSamples, antialiasing: antialiasSamples ? 'msaa' : 'none',
      antialiasFailure, focusY, focusSize, quality, strength,
      radiiCss: MINIATURE_BLUR[quality].radiiCss.map(radius => radius * strength),
      debugBypass, draws: lastDrawCalls, size: sharpTarget ? [sharpTarget.width, sharpTarget.height] : [0, 0],
      blurSize: horizontalTargets[0] ? [horizontalTargets[0].width, horizontalTargets[0].height] : [0, 0],
      estimatedMiB: Number((estimatedBytes / 1048576).toFixed(2)) };
  };

  const compile = async () => {
    if (!enabled) return;
    for (const effectMaterial of [...horizontalMaterials, ...verticalMaterials, compositeMaterial]) {
      warmupMesh.material = effectMaterial;
      await renderer.compileAsync(warmupScene, warmupCamera);
    }
  };

  return {
    resize,
    setQuality(value) {
      const next = value === 'low' ? 'low' : 'high';
      if (quality === next) return false;
      quality = next;
      antialiasSamples = miniatureBlurSamples(quality, renderer.capabilities.maxSamples, renderbufferSamples);
      antialiasFailure = antialiasSamples > 0 ? null : 'multisample-unavailable';
      antialiasValidated = false;
      if (sharpTarget) {
        sharpTarget.samples = antialiasSamples;
        sharpTarget.dispose();
      }
      resize(cssWidth || innerWidth, cssHeight || innerHeight, pixelRatio);
      return true;
    },
    setDebugAntialiasSamples(value, debug) {
      if (!debug || !Number.isFinite(value)) return false;
      const requested = Math.max(0, Math.floor(value));
      const supported = renderbufferSamples?.includes(requested) ?? [0, 2, 4].includes(requested);
      if (!supported || requested > renderer.capabilities.maxSamples) return false;
      antialiasSamples = requested;
      antialiasFailure = requested > 0 ? null : 'debug-disabled';
      antialiasValidated = false;
      if (sharpTarget) {
        sharpTarget.samples = requested;
        sharpTarget.dispose();
      }
      return true;
    },
    setDebugBlurMask(value, debug) {
      if (!debug || !compositeMaterial) return false;
      compositeMaterial.uniforms.blurAmount.value = value ? 1 : 0;
      return true;
    },
    setDebugFocusY(value, debug) {
      if (!debug || !Number.isFinite(value) || value < 0 || value > 1) return false;
      debugFocusY = value;
      return true;
    },
    setStrength(value) {
      strength = normalizeBlurStrength(value);
      updateBlurRadii();
    },
    setFocusSize(value) {
      focusSize = normalizeBlurFocusSize(value);
      if (compositeMaterial) compositeMaterial.uniforms.focusRadiusY.value = miniatureBlurFocusRadius(focusSize);
    },
    render,
    compile,
    snapshot,
    setDebugBypass(value, debug) { if (!debug) return false; debugBypass = Boolean(value); return true; },
    dispose() {
      if (disposed) return;
      disposed = true;
      fullscreen?.dispose();
      warmupMesh?.geometry.dispose();
      for (const target of [sharpTarget, ...horizontalTargets, ...verticalTargets]) target?.dispose();
      for (const effectMaterial of [...horizontalMaterials, ...verticalMaterials, compositeMaterial]) effectMaterial?.dispose();
    },
  };
}
