import type { LevelId } from "../battle/model.ts"

export const PROGRESS_NAMESPACE = "tide-outpost:clear:"

export interface ProgressStore {
  read(): ReadonlySet<LevelId>
  commitClear(levelId: LevelId): { saved: boolean }
}

type StorageAccess = () => Pick<Storage, "getItem" | "setItem">

const CLEAR_MARKER = '{"version":1,"clear":true}'

export class LocalProgress implements ProgressStore {
  readonly #levels: ReadonlySet<LevelId>
  readonly #storage: StorageAccess

  constructor(levels: Iterable<LevelId>, storage: StorageAccess) {
    this.#levels = new Set(levels)
    this.#storage = storage
  }

  read() {
    const cleared = new Set<LevelId>()
    try {
      const store = this.#storage()
      for (const id of this.#levels) {
        if (store.getItem(PROGRESS_NAMESPACE + id) === CLEAR_MARKER) cleared.add(id)
      }
    } catch {
      // Use the records already read in this session.
    }
    return cleared
  }

  commitClear(levelId: LevelId) {
    if (!this.#levels.has(levelId)) return { saved: false }

    try {
      const store = this.#storage()
      const key = PROGRESS_NAMESPACE + levelId
      if (store.getItem(key) !== CLEAR_MARKER) store.setItem(key, CLEAR_MARKER)
      return { saved: true }
    } catch {
      return { saved: false }
    }
  }
}
