import { getStage, STAGES } from '../content/stages';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface ProgressSnapshot {
  clearedStageIds: number[];
  assistedStageIds: number[];
  allUnlocked: boolean;
  unreadable: boolean;
  persistent: boolean;
}

export interface SaveSlot {
  id: string;
  name: string;
}

export interface SaveSlotsSnapshot {
  activeSlotId: string;
  slots: SaveSlot[];
  unreadable: boolean;
  persistent: boolean;
}

const LEGACY_SCHEMA = 'starfall.monster-defense.progress/1';
const LEGACY_REPLICA_SCHEMA = 'starfall.offline-cleared-stage/1';
const LEGACY_REPLICA_RELEASE = '134377281279792758-r6-local-clearance-1';
const SCHEMA = 'starfall.monster-defense.progress/2';
export const SLOT_INDEX_KEY = SCHEMA + '/slots';
const DEFAULT_ID = 'default';
const DEFAULT_SLOT: SaveSlot = { id: DEFAULT_ID, name: '默认存档' };

type ClearSource = 'natural' | 'assisted';
type PendingClears = Record<ClearSource, Set<number>>;
const CLEAR_SOURCES: readonly ClearSource[] = ['natural', 'assisted'];
const slotPrefix = (id: string) => SCHEMA + '/' + id + '/';
const clearKey = (id: string, stageId: number, source: ClearSource) => slotPrefix(id) + (source === 'natural' ? 'clear/' : 'assisted/') + stageId;
const unlockKey = (id: string) => slotPrefix(id) + 'all-unlocked';

function parse(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function readIndex(raw: string): SaveSlotsSnapshot | null {
  const value = parse(raw);
  const slots: unknown = value?.['slots'];
  const activeSlotId: unknown = value?.['activeSlotId'];
  if (value?.['schema'] !== SCHEMA || !Array.isArray(slots) || typeof activeSlotId !== 'string') return null;
  const saves: SaveSlot[] = [];
  const ids = new Set<string>();
  for (const slot of slots) {
    const id: unknown = slot?.id;
    const name: unknown = slot?.name;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id) || ids.has(id) ||
        typeof name !== 'string' || name.trim() !== name || !name || name.length > 40) return null;
    ids.add(id);
    saves.push({ id, name });
  }
  return ids.has(activeSlotId) ? { activeSlotId, slots: saves, unreadable: false, persistent: true } : null;
}

function slotName(input: string): string {
  const name = input.trim();
  if (!name || name.length > 40) throw new Error('存档名称需要填写，且不能超过 40 个字符。');
  return name;
}

function mountUrl(): string | undefined {
  return typeof location === 'undefined' ? undefined : new URL('./', location.href).href;
}

export class ProgressStore {
  // Only unpersisted wins live here. A new read still sees all other tabs' saved wins.
  private readonly pending = new Map<string, PendingClears>();
  private lastIndex = { activeSlotId: DEFAULT_ID, slots: [DEFAULT_SLOT] };
  private readonly replicaPrefix: string | undefined;

  constructor(private readonly storage: StorageLike | null, legacyMountUrl = mountUrl()) {
    if (legacyMountUrl) {
      this.replicaPrefix = 'starfall-monster-defense:' + LEGACY_REPLICA_RELEASE + ':' + legacyMountUrl + ':';
    }
  }

  listSlots(): SaveSlotsSnapshot {
    const fallback = {
      activeSlotId: this.lastIndex.activeSlotId,
      slots: this.lastIndex.slots.map((slot) => ({ ...slot })),
      persistent: false,
      unreadable: false,
    };
    if (!this.storage) return fallback;
    try {
      const raw = this.storage.getItem(SLOT_INDEX_KEY);
      if (raw === null) return { ...fallback, activeSlotId: DEFAULT_ID, slots: [{ ...DEFAULT_SLOT }], persistent: true };
      const index = readIndex(raw);
      if (!index) return { ...fallback, unreadable: true };
      this.lastIndex = { activeSlotId: index.activeSlotId, slots: index.slots.map((slot) => ({ ...slot })) };
      return index;
    } catch {
      return { ...fallback, unreadable: true };
    }
  }

  private saveIndex(index: SaveSlotsSnapshot): void {
    if (!this.storage || !index.persistent) throw new Error('无法访问本地存档。');
    try {
      this.storage.setItem(SLOT_INDEX_KEY, JSON.stringify({
        schema: SCHEMA,
        activeSlotId: index.activeSlotId,
        slots: index.slots,
      }));
      this.lastIndex = { activeSlotId: index.activeSlotId, slots: index.slots };
    } catch {
      throw new Error('本地存档写入失败。');
    }
  }

  createSlot(name: string): string {
    const index = this.listSlots();
    const slot = { id: crypto.randomUUID(), name: slotName(name) };
    this.saveIndex({ ...index, slots: [...index.slots, slot], activeSlotId: slot.id });
    return slot.id;
  }

  renameSlot(id: string, name: string): void {
    const index = this.listSlots();
    const slot = index.slots.find((item) => item.id === id);
    if (!slot) throw new Error('找不到这个存档。');
    slot.name = slotName(name);
    this.saveIndex(index);
  }

  switchSlot(id: string): void {
    const index = this.listSlots();
    if (!index.slots.some((slot) => slot.id === id)) throw new Error('找不到这个存档。');
    this.saveIndex({ ...index, activeSlotId: id });
  }

  deleteSlot(id: string): void {
    const index = this.listSlots();
    const slots = index.slots.filter((slot) => slot.id !== id);
    if (slots.length === index.slots.length) throw new Error('找不到这个存档。');
    if (slots.length === 0) slots.push({ id: crypto.randomUUID(), name: DEFAULT_SLOT.name });
    const activeSlotId = index.activeSlotId === id ? slots[0]!.id : index.activeSlotId;
    this.saveIndex({ ...index, activeSlotId, slots });
    this.pending.delete(id);
    // The index is authoritative, so a stale tab cannot restore a deleted slot.
    // Legacy bytes remain available to the older app version.
    try {
      this.storage?.removeItem?.(unlockKey(id));
      for (const stage of STAGES) for (const source of CLEAR_SOURCES) this.storage?.removeItem?.(clearKey(id, stage.id, source));
    } catch {
      // Failure to remove an unreachable per-slot marker cannot roll back deletion.
    }
  }

  load(slotId?: string): ProgressSnapshot {
    const index = this.listSlots();
    const id = slotId ?? index.activeSlotId;
    if (!index.slots.some((slot) => slot.id === id)) {
      return { clearedStageIds: [], assistedStageIds: [], allUnlocked: false, unreadable: index.unreadable, persistent: false };
    }
    const pending = this.pending.get(id);
    const victories: PendingClears = { natural: new Set(pending?.natural), assisted: new Set(pending?.assisted) };
    let unreadable = index.unreadable;
    let persistent = index.persistent;
    let allUnlocked = false;
    if (this.storage) {
      try {
        allUnlocked = this.storage.getItem(unlockKey(id)) === '1';
        for (const stage of STAGES) {
          for (const source of CLEAR_SOURCES) {
            const raw = this.storage.getItem(clearKey(id, stage.id, source));
            if (raw === '1') {
              victories[source].add(stage.id);
              pending?.[source].delete(stage.id);
            } else if (raw !== null) unreadable = true;
          }
          if (id !== DEFAULT_ID) continue;

          const legacy = this.storage.getItem(LEGACY_SCHEMA + '/' + stage.id);
          if (legacy !== null) {
            const record = parse(legacy);
            if (record?.['schema'] === LEGACY_SCHEMA && record['stageId'] === stage.id &&
                record['settlement'] === 'confirmed_natural_win') {
              victories.natural.add(stage.id);
              pending?.natural.delete(stage.id);
            } else unreadable = true;
          }
          if (this.replicaPrefix && !stage.endless) {
            const previous = this.storage.getItem(this.replicaPrefix + stage.id);
            if (previous !== null) {
              const record = parse(previous);
              if (record?.['schema'] === LEGACY_REPLICA_SCHEMA && record['release'] === LEGACY_REPLICA_RELEASE &&
                  record['game'] === 70441022 && record['activity'] === 70060517 && record['stageId'] === stage.id &&
                  record['settlement'] === 'confirmed_natural_win') {
                victories.natural.add(stage.id);
                pending?.natural.delete(stage.id);
              } else unreadable = true;
            }
          }
        }
      } catch {
        persistent = false;
        unreadable = true;
      }
    }
    return {
      clearedStageIds: [...victories.natural].sort((a, b) => a - b),
      assistedStageIds: [...victories.assisted].filter(stageId => !victories.natural.has(stageId)).sort((a, b) => a - b),
      allUnlocked,
      unreadable,
      persistent: persistent && !pending?.natural.size && !pending?.assisted.size,
    };
  }

  commitClear(stageId: number, slotId?: string, source: ClearSource = 'natural'): ProgressSnapshot {
    if (getStage(stageId).endless) return this.load(slotId);
    const index = this.listSlots();
    const id = slotId ?? index.activeSlotId;
    if (!index.slots.some((slot) => slot.id === id)) return this.load(id);
    const pending = this.pending.get(id) ?? { natural: new Set<number>(), assisted: new Set<number>() };
    pending[source].add(stageId);
    this.pending.set(id, pending);
    if (this.storage && index.persistent) {
      for (const kind of CLEAR_SOURCES) for (const earned of pending[kind]) {
        try {
          const key = clearKey(id, earned, kind);
          if (this.storage.getItem(key) === null) this.storage.setItem(key, '1');
        } catch {
          // Keep the win in this session and retry on the next clear.
        }
      }
    }
    return this.load(id);
  }

  unlockAll(slotId?: string): ProgressSnapshot {
    const index = this.listSlots();
    if (!this.storage || !index.persistent) throw new Error('无法访问本地存档。');
    const id = slotId ?? index.activeSlotId;
    if (!index.slots.some(slot => slot.id === id)) throw new Error('这个存档已被删除。');
    try {
      this.storage.setItem(unlockKey(id), '1');
    } catch {
      throw new Error('全关卡解锁写入失败。');
    }
    return this.load(id);
  }
}

export function isProgressStorageEvent(key: string | null, slotId: string): boolean {
  return key === null || key.startsWith(slotPrefix(slotId) + 'clear/') || key.startsWith(slotPrefix(slotId) + 'assisted/') ||
    (slotId === DEFAULT_ID && (key.startsWith(LEGACY_SCHEMA + '/') ||
      key.startsWith('starfall-monster-defense:' + LEGACY_REPLICA_RELEASE + ':')));
}
