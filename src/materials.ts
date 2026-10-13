import * as THREE from 'three';

const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

const cache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: string, opts: { map?: THREE.Texture; emissive?: string; emissiveIntensity?: number } = {}) {
  const key = opts.map || opts.emissive ? '' : color;
  if (key && cache.has(key)) return cache.get(key)!;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient, map: opts.map ?? null });
  if (opts.emissive) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  if (key) cache.set(key, m);
  return m;
}

export function glow(color: string, intensity = 1.6) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
  return m;
}

export function glowMap(map: THREE.Texture, intensity = 1.4) {
  return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(intensity, intensity, intensity) });
}

export function glass(color: string, opacity = 0.18) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}

export function additive(color: string, opacity = 0.5) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(2),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
