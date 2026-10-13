import * as THREE from 'three';

/** Objects on this layer (glass, lasers, haze) are drawn in color but skipped for outline detection. */
export const FX_LAYER = 1;

export interface PostConfig {
  exposure: number;
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  vignette: number;
  bloom: number;
  bloomThreshold: number;
  levels: number;
  dither: number;
  outline: number;
  highlight: number;
}

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 resolution;
uniform float exposure, saturation, contrast, vignette, bloom, bloomThreshold, levels, dither, outline, highlight;
uniform vec3 tint;
varying vec2 vUv;

float depthAt(vec2 uv) { return texture2D(tDepth, uv).r; }
vec3 normalAt(vec2 uv) { return texture2D(tNormal, uv).rgb * 2.0 - 1.0; }

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0;
  m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0 - 0.5; }
  return 0.0;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float edgeDepth(vec2 uv, float d) {
  float diff = depthAt(uv) - d;
  return clamp(diff, 0.0, 1.0);
}

float edgeNormal(vec2 uv, float d, vec3 n) {
  float d2 = depthAt(uv);
  vec3 n2 = normalAt(uv);
  float normalDiff = dot(n - n2, vec3(1.0, 1.0, 1.0));
  float normalIndicator = smoothstep(-0.01, 0.01, normalDiff);
  float depthIndicator = clamp(sign((d2 - d) * 0.25 + 0.0025), 0.0, 1.0);
  return distance(n, n2) * depthIndicator * normalIndicator;
}

void main() {
  vec2 texel = 1.0 / resolution;
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = depthAt(vUv);
  vec3 n = normalAt(vUv);

  float dd = edgeDepth(vUv + vec2(texel.x, 0.0), d)
           + edgeDepth(vUv - vec2(texel.x, 0.0), d)
           + edgeDepth(vUv + vec2(0.0, texel.y), d)
           + edgeDepth(vUv - vec2(0.0, texel.y), d);
  float nd = edgeNormal(vUv + vec2(texel.x, 0.0), d, n)
           + edgeNormal(vUv - vec2(texel.x, 0.0), d, n)
           + edgeNormal(vUv + vec2(0.0, texel.y), d, n)
           + edgeNormal(vUv - vec2(0.0, texel.y), d, n);

  float isDepthEdge = step(0.0035, dd) * step(d, 0.9999);
  float isNormalEdge = step(0.35, nd) * (1.0 - isDepthEdge);
  col *= 1.0 - outline * isDepthEdge;
  col *= 1.0 + highlight * isNormalEdge;

  vec3 glow = vec3(0.0);
  for (int x = -3; x <= 3; x++) {
    for (int y = -3; y <= 3; y++) {
      vec2 o = vec2(float(x), float(y));
      float w = 1.0 - length(o) / 4.3;
      if (w <= 0.0) continue;
      vec3 s = texture2D(tColor, vUv + o * texel * 1.5).rgb;
      float l = max(max(s.r, s.g), s.b);
      glow += s * max(l - bloomThreshold, 0.0) / max(l, 0.001) * w;
    }
  }
  col += glow * bloom / 18.0;

  col *= exposure;
  col = aces(col);
  col *= tint;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, saturation);
  col = (col - 0.5) * contrast + 0.5;
  vec2 vc = vUv - 0.5;
  col *= 1.0 - vignette * dot(vc, vc) * 2.2;
  col = clamp(col, 0.0, 1.0);

  vec3 srgb = pow(col, vec3(1.0 / 2.2));
  srgb += bayer4(gl_FragCoord.xy) * dither / levels;
  srgb = floor(srgb * levels + 0.5) / levels;
  gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
}
`;

export class PixelPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private colorRT: THREE.WebGLRenderTarget;
  private normalRT: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private uniforms: Record<string, THREE.IUniform>;
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement, public pixelSize: number, post: PostConfig) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.colorRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.normalRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });

    this.uniforms = {
      tColor: { value: this.colorRT.texture },
      tDepth: { value: this.colorRT.depthTexture },
      tNormal: { value: this.normalRT.texture },
      resolution: { value: new THREE.Vector2(1, 1) },
      exposure: { value: post.exposure },
      saturation: { value: post.saturation },
      contrast: { value: post.contrast },
      tint: { value: new THREE.Vector3(...post.tint) },
      vignette: { value: post.vignette },
      bloom: { value: post.bloom },
      bloomThreshold: { value: post.bloomThreshold },
      levels: { value: post.levels },
      dither: { value: post.dither },
      outline: { value: post.outline },
      highlight: { value: post.highlight },
    };
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, depthTest: false, depthWrite: false }),
    );
    this.quadScene.add(this.quad);
  }

  setPost(p: Partial<PostConfig>) {
    for (const [k, v] of Object.entries(p)) {
      const u = this.uniforms[k];
      if (!u) continue;
      if (Array.isArray(v)) (u.value as THREE.Vector3).set(v[0], v[1], v[2]);
      else u.value = v;
    }
  }

  /** pixelSize is in device pixels, so every art pixel covers a whole number of screen pixels. */
  setSize(cssWidth: number, cssHeight: number, dpr = 1) {
    this.width = Math.max(1, Math.ceil((cssWidth * dpr) / this.pixelSize));
    this.height = Math.max(1, Math.ceil((cssHeight * dpr) / this.pixelSize));
    this.renderer.setSize(this.width, this.height, false);
    const el = this.renderer.domElement;
    el.style.width = `${(this.width * this.pixelSize) / dpr}px`;
    el.style.height = `${(this.height * this.pixelSize) / dpr}px`;
    this.colorRT.setSize(this.width, this.height);
    this.normalRT.setSize(this.width, this.height);
    (this.uniforms.resolution.value as THREE.Vector2).set(this.width, this.height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    camera.layers.enable(FX_LAYER);
    r.setRenderTarget(this.colorRT);
    r.render(scene, camera);

    const bg = scene.background;
    const fog = scene.fog;
    scene.background = new THREE.Color(0.5, 0.5, 1);
    scene.fog = null;
    scene.overrideMaterial = this.normalMat;
    camera.layers.disable(FX_LAYER);
    r.setRenderTarget(this.normalRT);
    r.render(scene, camera);
    camera.layers.enable(FX_LAYER);
    scene.overrideMaterial = null;
    scene.background = bg;
    scene.fog = fog;

    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
