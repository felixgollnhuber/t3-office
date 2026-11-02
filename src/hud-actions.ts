/** One row of HUD action buttons under the crew box, styled like the other clock-panel controls. Falls back to the body when the HUD is absent. */
export function mountHudAction(button: HTMLButtonElement, order: number): void {
  const clock = document.querySelector<HTMLElement>('#hud .clock');
  if (!clock) { document.body.append(button); return; }
  let row = clock.querySelector<HTMLElement>('.hud-actions');
  if (!row) { row = document.createElement('div'); row.className = 'hud-actions'; clock.append(row); }
  button.classList.add('wx');
  button.style.order = String(order);
  row.append(button);
}
