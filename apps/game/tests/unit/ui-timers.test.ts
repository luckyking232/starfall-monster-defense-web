import { copyFileSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LuaEngineLike } from '../../runtime/ui/host';
import { UI_TIMERS_LUA } from '../../runtime/ui/timers';

const vendorDir = path.resolve(import.meta.dirname, '../../public/assets/runtime/core-worker/inputs/vendor');

describe('Lua UI timers', () => {
  let temporaryDir: string;
  let factory: { createEngine(options: object): Promise<LuaEngineLike> };
  let lua: LuaEngineLike;

  beforeAll(() => {
    temporaryDir = mkdtempSync(path.join(tmpdir(), 'ui-timers-lua-'));
    const temporaryVendor = path.join(temporaryDir, 'vendor.cjs');
    copyFileSync(path.join(vendorDir, 'index.js'), temporaryVendor);
    const { LuaFactory } = createRequire(import.meta.url)(temporaryVendor) as {
      LuaFactory: new (wasmPath: string) => typeof factory;
    };
    factory = new LuaFactory(path.join(vendorDir, 'glue.wasm'));
  });

  afterAll(() => {
    unlinkSync(path.join(temporaryDir, 'vendor.cjs'));
    rmdirSync(temporaryDir);
  });

  beforeEach(async () => {
    lua = await factory.createEngine({ enableProxy: false, functionTimeout: 5000 });
    await lua.doString(UI_TIMERS_LUA);
  });

  afterEach(() => lua?.global.close());

  it('advances scaled and unscaled values independently and freezes both at zero delta', async () => {
    await lua.doString(`
      scaledValue, unscaledValue, completions = 10, 20, 0
      LeanTween.value(10, 0, 1):setOnUpdate(function(value) scaledValue = value end)
        :setOnComplete(function() completions = completions + 1 end)
      __UiTweenValue(20, 0, 1, function(value) unscaledValue = value end):SetIgnoreEngineTimeScale(true)
      __UiAdvanceTimers(250, 2)
    `);
    expect(lua.global.get('scaledValue')).toBe(5);
    expect(lua.global.get('unscaledValue')).toBe(15);

    await lua.doString('__UiAdvanceTimers(250, 0); __UiAdvanceTimers(0, 2)');
    expect(lua.global.get('scaledValue')).toBe(5);
    expect(lua.global.get('unscaledValue')).toBe(10);

    await lua.doString('__UiAdvanceTimers(500, 1); __UiAdvanceTimers(500, 1)');
    expect(lua.global.get('scaledValue')).toBe(0);
    expect(lua.global.get('unscaledValue')).toBe(0);
    expect(lua.global.get('completions')).toBe(1);
  });

  it('dispatches due callbacks in clock order and gives chained delays the remaining elapsed time', async () => {
    await lua.doString(`
      events = ''
      local function record(name) events = events .. name .. ' ' end
      local cancelled = LeanTween.delayedCall(0.01, function() record('cancelled') end)
      LeanTween.cancel(cancelled.uniqueId)
      LeanTween.delayedCall(0.4, function() record('later') end)
      LeanTween.delayedCall(0.1, function()
        record('first')
        LeanTween.delayedCall(0.05, function() record('chained') end):setIgnoreTimeScale(true)
      end):setIgnoreTimeScale(true)
      LeanTween.delayedCall(0.2, function() record('second') end)
      LeanTween.delayedCall(0, function() record('zero') end)
      __UiAdvanceTimers(300, 2)
    `);
    expect(lua.global.get('events')).toBe('zero first second chained later ');
  });

  it('clears an owner and restores the registration context while dispatching a live timer', async () => {
    await lua.doString(`
      activeOwner, events = 'closed', ''
      __UiSetTimerContext(function() return activeOwner end, function(owner, callback, ...)
        local previous = activeOwner
        activeOwner = owner
        callback(...)
        activeOwner = previous
      end)
      local function record() events = events .. activeOwner .. ' ' end
      LeanTween.delayedCall(0.1, record)
      activeOwner = 'live'
      LeanTween.delayedCall(0.1, function()
        record()
        __UiClearTimers('live')
      end)
      LeanTween.delayedCall(0.1, record)
      activeOwner = 'caller'
      __UiClearTimers('closed')
      __UiAdvanceTimers(200, 1)
    `);
    expect(lua.global.get('events')).toBe('live ');
    expect(lua.global.get('activeOwner')).toBe('caller');
  });

  it('reuses a component tween targeting the same value and replaces it when its target changes', async () => {
    await lua.doString(`
      value, updates = 0, 0
      local function update(step) value, updates = step, updates + 1 end
      local first = __UiTweenValue(0, 100, 1, update, 'progress')
      __UiAdvanceTimers(250, 1)
      reusedTween = first == __UiTweenValue(value, 100, 1, update, 'progress')
      __UiTweenValue(value, 50, 0.25, update, 'progress')
      __UiAdvanceTimers(250, 1)
      __UiAdvanceTimers(500, 1)
    `);
    expect(lua.global.get('reusedTween')).toBe(true);
    expect(lua.global.get('value')).toBe(50);
    expect(lua.global.get('updates')).toBe(2);
  });
});
