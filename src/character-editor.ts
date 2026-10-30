import type { AgentSource } from './source';
import type { World } from './workers';
import { WORK_AREAS } from './building-api';
import { readProfiles, saveProfile } from './character-profiles';
import { HAIR_STYLES, OUTFITS, SKIN_COLORS, HAIR_COLORS, SHIRT_COLORS, isCharacterStyle } from './character-style';
import { B } from './i18n/building';
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export class CharacterEditor {
  constructor(private source: AgentSource, private world: World, private onSaved?: () => void) {}
  render(el: HTMLElement, id: string) {
    if (el.querySelector<HTMLFormElement>('form')?.dataset.character === id) return;
    const t = this.source.threads().find((t) => t.id === id); const worker = this.world.workers.get(id);
    if (!t || !worker) { el.textContent = B.noCharacters; return; }
    const saved = readProfiles()[id]; const look = worker.look;
    const select = (name: string, label: string, values: readonly string[], value: string, labels?: readonly string[]) => `<label>${label}<select name="${name}">${values.map((v, i) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(labels?.[i] ?? v)}</option>`).join('')}</select></label>`;
    const palette = (name: string, label: string, values: readonly string[], value: string) => `<fieldset class="character-palette"><legend>${label}</legend>${values.map((v, i) => `<label title="${label} ${i + 1}"><input type="radio" name="${name}" value="${v}" ${v === value || (!values.includes(value) && i === 0) ? 'checked' : ''} aria-label="${label} ${i + 1}"><span style="background:${v}"></span></label>`).join('')}</fieldset>`;
    el.innerHTML = `<form class="character-editor" data-character="${esc(id)}"><p class="editor-hint">${B.directCharacterHint}</p><label>${B.characterName}<input name="name" value="${esc(t.name)}" required maxlength="32" autocomplete="off"></label>${select('area', B.workArea, WORK_AREAS, saved?.area ?? 'general', WORK_AREAS.map((v) => B.areaLabels[v]))}<h3>${B.characterAppearance}</h3>${select('hairStyle', B.hairStyle, HAIR_STYLES, look.hairStyle, B.hairLabels)}${select('outfit', B.outfit, OUTFITS, look.outfit, B.outfitLabels)}${palette('skin', B.skinTone, SKIN_COLORS, look.skin)}${palette('hair', B.hairColor, HAIR_COLORS, look.hair)}${palette('shirt', B.shirtColor, SHIRT_COLORS, look.shirt)}<label class="editor-check"><input type="checkbox" name="glasses" ${look.glasses ? 'checked' : ''}>${B.glasses}</label><button type="submit">${B.saveCharacter}</button><p class="editor-result" role="status" aria-live="polite"></p></form>`;
    const form = el.querySelector<HTMLFormElement>('form')!;
    let styleChanged = false;
    form.addEventListener('input', (e) => { if (!['name', 'area'].includes((e.target as HTMLInputElement).name)) styleChanged = true; });
    form.addEventListener('change', (e) => { if (!['name', 'area'].includes((e.target as HTMLInputElement).name)) styleChanged = true; });
    form.addEventListener('submit', (event) => {
      event.preventDefault(); event.stopPropagation();
      if (!this.source.threads().some((v) => v.id === id)) return;
      const data = Object.fromEntries(new FormData(form)); const name = String(data.name).trim();
      if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) return;
      const area = WORK_AREAS.find((v) => v === data.area); if (!area) return;
      const style = { hairStyle: data.hairStyle, outfit: data.outfit, skin: data.skin, hair: data.hair, shirt: data.shirt, glasses: data.glasses === 'on' };
      const current = readProfiles()[id];
      if (styleChanged && !isCharacterStyle(style)) return;
      saveProfile(id, { name, area, ...(styleChanged && isCharacterStyle(style) ? { style } : current?.style ? { style: current.style } : {}) });
      form.querySelector('.editor-result')!.textContent = B.characterSaved;
      this.onSaved?.();
    });
  }
}
