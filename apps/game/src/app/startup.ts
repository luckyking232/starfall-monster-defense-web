const screen = () => document.getElementById('startup');
export function showStartup(percent: number, phase: string): void {
  const overlay = screen();
  if (!overlay) return;
  const progress = overlay.querySelector('progress')!;
  progress.value = Math.max(progress.value, Math.min(100, Math.floor(percent)));
  overlay.querySelector('#startup-percent')!.textContent = progress.value + '%';
  const label = overlay.querySelector('#startup-phase')!;
  if (label.textContent !== phase) label.textContent = phase;
}
export function finishStartup(): void {
  showStartup(100,'准备就绪');
  screen()?.remove();
}
export function failStartup(reason: unknown): void {
  const overlay = screen();
  if (!overlay) return;
  overlay.querySelector('#startup-phase')!.textContent = '游戏加载失败。' + (reason instanceof Error ? reason.message : String(reason));
  const retry = overlay.querySelector<HTMLButtonElement>('#startup-retry')!;
  retry.hidden = false;
  retry.onclick = () => location.reload();
}
