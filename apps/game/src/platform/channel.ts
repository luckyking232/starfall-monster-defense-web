const TEST_PREFIX = 'starfall.web-test:';

export function isTestSite(): boolean {
  return typeof document !== 'undefined' && document.querySelector('meta[name="game-channel"]')?.getAttribute('content') === 'test';
}

export function localEventKey(key: string | null, testing = isTestSite()): string | null | undefined {
  if (key === null) return null;
  if (testing) return key.startsWith(TEST_PREFIX) ? key.slice(TEST_PREFIX.length) : undefined;
  return key.startsWith(TEST_PREFIX) ? undefined : key;
}

export function scopedStorage(storage: Storage, testing = isTestSite()): Storage {
  if (!testing) return storage;
  const keys = () => {
    const result: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = localEventKey(storage.key(i),true);
      if (typeof key === 'string') result.push(key);
    }
    return result;
  };
  return {
    get length() { return keys().length; },
    key: index => keys()[index] ?? null,
    getItem: key => storage.getItem(TEST_PREFIX + key),
    setItem: (key,value) => storage.setItem(TEST_PREFIX + key,value),
    removeItem: key => storage.removeItem(TEST_PREFIX + key),
    clear: () => { for (const key of keys()) storage.removeItem(TEST_PREFIX + key); },
  };
}
