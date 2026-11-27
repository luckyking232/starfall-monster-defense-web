import type { createOriginalUiHost } from '../../runtime/ui/host.ts';
import type { UiEvent } from '../../runtime/ui/protocol.ts';
import type { RuleRecord } from './rule-trace-diff.ts';

export function replayRules(options: {
  createHost: typeof createOriginalUiHost;
  publicDir: string;
  stage: number | 'stress';
  lastFrame?: number;
  seed?: number;
  watch?: 'frame' | 'settlement';
  stepBudget?: number;
  extraRandomFrame?: number;
  writeRecord?: (raw: string) => void;
  observeEvent?: (event: UiEvent) => void;
}): Promise<{
  records: (RuleRecord & { events?: unknown[] })[];
  seedCalls: number;
  inputs: Record<string, { storedSha256: string; payloadSha256: string; bytes: number }>;
  summary: Record<string, unknown>;
}>;
