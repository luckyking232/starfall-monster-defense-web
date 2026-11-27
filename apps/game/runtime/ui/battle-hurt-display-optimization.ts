import type { UiOp } from './protocol';

const originalStackShift = String.raw`  for i, v in ipairs(bindObject.cachedDisplayHurtTips) do
    v.y = v.y - v.height / 2
  end`;

const batchedStackShift = String.raw`  local stackIds = {}
  for i, v in ipairs(bindObject.cachedDisplayHurtTips) do
    stackIds[i] = v.__id
  end
  __HostCall('battle.hurt.shiftStack', table.concat(stackIds, ','))`;

// Apply to the verified original Lua source before it is required by the host.
export function adaptHurtNumberDisplay(source: string): string {
  const normalized = source.replaceAll('\r\n', '\n');
  if (normalized.split(originalStackShift).length !== 2) return source;
  return normalized.replace(originalStackShift, batchedStackShift);
}

export function shiftHurtNumberStack(
  ids: string,
  getNode: (id: number) => { id: number; y: number; height: number },
  pushOp: (op: UiOp) => void,
): void {
  for (const id of ids.split(',')) {
    const node = getNode(Number(id));
    node.y -= node.height / 2;
    pushOp({ op: 'set', id: node.id, key: 'y', value: node.y });
  }
}

export function bufferedTransition(ops: readonly UiOp[], playId: number) {
  const latest = ops.at(-1);
  if (latest?.op === 'transition-play' && latest.playId === playId) return latest;
  return ops.find(op => op.op === 'transition-play' && op.playId === playId);
}
