import { STAGES } from '../content/stages';
import { isEndlessRecord, ProgressStore, SLOT_INDEX_KEY, type EndlessRecord } from './progress';

const FORMAT = 'starfall.monster-defense.backup/1';
const normalStages = new Set(STAGES.filter(stage => !stage.endless).map(stage => stage.id));
export const MAX_BACKUP_BYTES = 1024 * 1024;
const invalid = () => new Error('存档文件格式或内容无效。');

export async function editSaveIndex<T>(action: () => T): Promise<T> {
  return navigator.locks ? navigator.locks.request(SLOT_INDEX_KEY,action) : action();
}

interface SlotData {
  name: string;
  cleared: number[];
  assisted: number[];
  allUnlocked: boolean;
  endless?: EndlessRecord[];
}

function stageList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(id => normalStages.has(id)) && new Set(value).size === value.length;
}
function validSlot(value: unknown): value is SlotData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<SlotData>;
  return typeof data.name === 'string' && data.name.trim() === data.name && data.name.length > 0 && data.name.length <= 40 &&
    typeof data.allUnlocked === 'boolean' && stageList(data.cleared) && stageList(data.assisted) &&
    data.assisted.every(id => !data.cleared!.includes(id)) &&
    (data.endless === undefined || (Array.isArray(data.endless) && data.endless.length <= 2 &&
      data.endless.every(isEndlessRecord) && new Set(data.endless.map(item => item.source)).size === data.endless.length &&
      new Set(data.endless.map(item => item.runId)).size === data.endless.length));
}
export function exportSaves(store: ProgressStore): string {
  const index = store.listSlots();
  if (!index.persistent || index.unreadable) throw new Error('无法读取完整存档。');
  const slots = index.slots.map(({id,name}) => {
    const data = store.load(id);
    const scores = store.loadEndless(id);
    if (data.unreadable || !data.persistent || scores.unreadable || !scores.persistent) throw new Error('部分进度无法读取，请重试。');
    const endless = [scores.natural,scores.practice].filter(score => score !== null);
    return {name, cleared:data.clearedStageIds, assisted:data.assistedStageIds, allUnlocked:data.allUnlocked, endless};
  });
  return JSON.stringify({format:FORMAT, active:index.slots.findIndex(slot => slot.id === index.activeSlotId), slots},null,2);
}

export function importSaves(storage: Storage, json: string): void {
  if (new Blob([json]).size > MAX_BACKUP_BYTES) throw invalid();
  let file;
  try { file = JSON.parse(json); } catch { throw invalid(); }
  if (file?.format !== FORMAT || !Array.isArray(file.slots) || !file.slots.length ||
      !file.slots.every(validSlot) || !Number.isInteger(file.active) || file.active < 0 || file.active >= file.slots.length) throw invalid();
  const existing = new ProgressStore(storage).listSlots();
  if (existing.unreadable || !existing.persistent) throw new Error('无法安全读取现有存档。');
  // Write only fresh UUID markers. The index becomes visible in one final synchronous write.
  const writes = new Map<string,string>();
  const staged = new ProgressStore({
    get length() { return writes.size; }, key:i => [...writes.keys()][i] ?? null,
    getItem:k => writes.get(k) ?? null, setItem:(k,v) => { writes.set(k,v); }, removeItem:k => { writes.delete(k); },
  });
  const slots = (file.slots as SlotData[]).map(slot => {
    const id = staged.createSlot(slot.name);
    for (const stage of slot.cleared) staged.commitClear(stage,id);
    for (const stage of slot.assisted) staged.commitClear(stage,id,'assisted');
    if (slot.allUnlocked) staged.unlockAll(id);
    for (const record of slot.endless ?? []) staged.commitEndless(record,id);
    return {id,name:slot.name};
  });
  const index = JSON.parse(writes.get(SLOT_INDEX_KEY)!);
  index.activeSlotId = slots[file.active]!.id;
  writes.delete(SLOT_INDEX_KEY);
  const written: string[] = [];
  try {
    for (const [key,value] of writes) {
      storage.setItem(key,value);
      written.push(key);
    }
    // Older tabs may still be running versions without a Web Lock.
    const latest = new ProgressStore(storage).listSlots();
    if (!latest.persistent || latest.unreadable) throw new Error('无法读取存档列表。');
    index.slots = [...latest.slots,...slots];
    storage.setItem(SLOT_INDEX_KEY,JSON.stringify(index));
  } catch {
    for (const key of written) { try { storage.removeItem(key); } catch { /* Unindexed slots stay invisible. */ } }
    throw new Error('导入写入失败，请检查浏览器存储空间。');
  }
}
