export interface Preferences { music: number; effects: number; fps: boolean }
const key = 'starfall.monster-defense.settings/2';
const previousKey = 'starfall.monster-defense.settings/1';
const defaults: Preferences = { music: 100, effects: 20, fps: false };

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function readPreferences(storage: PreferenceStorage | null): Preferences {
  try {
    const current = storage?.getItem(key);
    const data = JSON.parse(current ?? storage?.getItem(previousKey) ?? '{}');
    const effects = current == null && data.effects === 40 ? defaults.effects : data.effects;
    const volume = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100 ? value : fallback;
    return { music: volume(data.music, defaults.music), effects: volume(effects, defaults.effects), fps: data.fps === true };
  } catch { return { ...defaults }; }
}
export function savePreferences(storage: PreferenceStorage | null, value: Preferences): boolean {
  try { if (storage) { storage.setItem(key, JSON.stringify(value)); return true; } } catch { /* Session settings stay active. */ }
  return false;
}
