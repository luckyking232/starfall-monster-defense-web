import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

function revision(ref: string): string | null {
  try { return execFileSync('git',['rev-parse','--verify',ref],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); }
  catch { return null; }
}
export function gameVersion(): Plugin {
  const version = {commit:revision('HEAD'),tree:revision('HEAD^{tree}')};
  return {
    name:'game-version', apply:'build',
    transformIndexHtml() {
      return version.commit ? [{tag:'meta',attrs:{name:'game-build',content:version.commit},injectTo:'head'}] : [];
    },
    generateBundle() {
      this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify(version)});
    },
  };
}
