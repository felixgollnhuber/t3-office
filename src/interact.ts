import type * as THREE from 'three';

/**
 * Things in the office you can click (pets, the robot vacuum, the gong …). Register one and main.ts does the rest:
 * it raycasts `objects` recursively together with the people and the wall displays (the nearest hit wins), shows
 * `hint` next to the cursor and switches to the pointer cursor.
 *
 *   const off = addClickable({ objects: [dog.root], hint: () => S.petDog, onClick: () => dog.bark() });
 */
export interface Clickable {
  /** roots to hit-test; their children count too */
  objects: THREE.Object3D[];
  /** text next to the cursor; a function is asked on every hover move */
  hint: string | (() => string);
  onClick(): void;
  /** second click of a double-click (`onClick` already ran for the first one) */
  onDouble?(): void;
  onHover?(over: boolean): void;
}

export const clickables: Clickable[] = [];

/** Registers a clickable; the returned function removes it again. */
export function addClickable(c: Clickable): () => void {
  clickables.push(c);
  return () => {
    const i = clickables.indexOf(c);
    if (i >= 0) clickables.splice(i, 1);
  };
}

export const hintOf = (c: Clickable) => (typeof c.hint === 'function' ? c.hint() : c.hint);

/** every ancestor up to the scene is visible */
function shown(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** The registered clickable the ray hits first, with the distance along the ray. */
export function pickClickable(ray: THREE.Raycaster): { c: Clickable; distance: number } | null {
  let best: { c: Clickable; distance: number } | null = null;
  for (const c of clickables) {
    for (const hit of ray.intersectObjects(c.objects, true)) {
      if (best && hit.distance >= best.distance) break;
      if (!shown(hit.object)) continue;
      best = { c, distance: hit.distance };
      break;
    }
  }
  return best;
}
