import { spawnSync } from 'node:child_process';

const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [
  '-B', '-m', 'unittest', 'discover', '-s', 'tests/content', '-v',
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
