import { S } from './i18n/demobar';

/**
 * The public demo on a phone has no panels (cinema mode, src/settings.ts), so nothing would tell a visitor what they
 * are looking at. This bar does, and links to the repository. It only exists in builds made with VITE_DEMO_REPO
 * (.github/workflows/demo.yml); a local office never shows it.
 */
export function showDemoBar(repo: string) {
  const bar = document.createElement('aside');
  // a .panel: taps on it do not reach the office, and it fades out while a close-up is open
  bar.className = 'panel demobar';
  bar.innerHTML = `
    <p><b>T3 Office</b> <span>${S.pitch}</span></p>
    <a class="btn" target="_blank" rel="noopener"></a>
    <button class="x" aria-label="${S.close}">×</button>`;
  const link = bar.querySelector('a')!;
  link.href = repo;
  link.textContent = S.run;
  bar.querySelector('.x')!.addEventListener('click', () => bar.remove());
  document.body.append(bar);
}
