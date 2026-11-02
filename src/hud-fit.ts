/**
 * Keeps the original HUD panels from overlapping on short or narrow windows.
 * Measures the real panels (theme, language and live content change their size) and picks the
 * lowest compaction level (style.css, body.hud-fit-N) at which no two visible panels intersect.
 */
const PANELS = ['.clock', '.deck', '.receipt', '.pulse', '.ticker'] as const;
const LEVELS = 4;
const GAP = 8;

function visibleBoxes(root: HTMLElement): DOMRect[] {
  const boxes: DOMRect[] = [];
  for (const sel of PANELS) {
    const el = root.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const box = el.getBoundingClientRect();
    if (box.width && box.height) boxes.push(box);
  }
  return boxes;
}

function crowded(root: HTMLElement): boolean {
  const boxes = visibleBoxes(root);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (a.bottom > innerHeight || a.right > innerWidth) return true;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP) return true;
    }
  }
  return false;
}

export function installHudFit(root: HTMLElement): () => void {
  const body = document.body;
  const set = (level: number) => { for (let n = 1; n <= LEVELS; n++) body.classList.toggle(`hud-fit-${n}`, n <= level); };
  let current = -1, queued = 0;
  const fit = () => {
    queued = 0;
    let level = 0;
    set(0);
    while (level < LEVELS && crowded(root)) set(++level);
    if (level !== current) { current = level; body.dataset.hudFit = String(level); }
  };
  const schedule = () => { if (!queued) queued = requestAnimationFrame(fit); };
  const observer = new ResizeObserver(schedule);
  for (const sel of PANELS) { const el = root.querySelector(sel); if (el) observer.observe(el); }
  addEventListener('resize', schedule);
  void document.fonts?.ready.then(schedule);
  fit();
  return schedule;
}
