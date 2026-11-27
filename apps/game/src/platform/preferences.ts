export interface Preferences { music: number; effects: number; fps: boolean; economy: boolean }
const key = 'starfall.monster-defense.settings/3';
const previousKey = 'starfall.monster-defense.settings/2';
const originalKey = 'starfall.monster-defense.settings/1';
const defaults: Preferences = { music: 100, effects: 100, fps: false, economy: false };

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function readPreferences(storage: PreferenceStorage | null): Preferences {
  try {
    const current = storage?.getItem(key);
    const data = JSON.parse(current ?? storage?.getItem(previousKey) ?? storage?.getItem(originalKey) ?? '{}');
    const volume = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100 ? value : fallback;
    const effects = volume(data.effects, defaults.effects);
    // Both previous sliders mapped 0–100 to a gain of 0–1. The new maximum is 0.10.
    return { music: volume(data.music, defaults.music), effects: current == null ? Math.min(100, effects * 10) : effects,
      fps: data.fps === true, economy: data.economy === true };
  } catch { return { ...defaults }; }
}
export function savePreferences(storage: PreferenceStorage | null, value: Preferences): boolean {
  try { if (storage) { storage.setItem(key, JSON.stringify(value)); return true; } } catch { /* Session settings stay active. */ }
  return false;
}
