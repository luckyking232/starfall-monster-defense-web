import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PackageRegistry } from '../../src/fgui/package';
import { layoutList, layoutLoader } from '../../src/fgui/layout';

function load(name: string) {
  return JSON.parse(readFileSync(new URL(`../../public/assets/fgui/${name}.json`, import.meta.url), 'utf8'));
}

describe('original FGUI package data', () => {
  it('resolves the original start window and its cross-package resources', () => {
    const registry = new PackageRegistry([load('ActivityDungeon1017'), load('CommonResource')]);
    const window = registry.component('MiniGame2Window', 'ActivityDungeon1017');
    expect(window.width).toBe(1334);
    expect(window.height).toBe(750);
    const main = window.children!.find((child) => child.name === 'Main')!;
    const start = registry.components['q3oh4o']!.children!.find((child) => child.name === 'StartBtn')!;
    expect(main.src).toBe('q3oh4o');
    expect(start).toMatchObject({ x: 1036, y: 647, objectType: 'Button' });
    expect(registry.componentByUrl('ui://tey9g4p9kszmrlya').name).toBe('BackGround');
    const sprite = registry.sprite('MiniGame1_1000', 'ActivityDungeon1017');
    expect(sprite.atlasFile).toBe('ActivityDungeon1017_atlas0_5.png');
    expect(sprite.originalSize).toEqual([1668, 1004]);
  });

  it('uses the original list layout, not hand-authored stage positions', () => {
    const registry = new PackageRegistry([load('ActivityDungeon1017')]);
    const list = registry.components['q3ohgv']!.children!.find((child) => child.name === 'TipsList')!;
    const layout = layoutList(list, [{ width: 4180, height: 750 }]);
    expect(layout.items).toEqual([{ x: 0, y: 0, width: 4180, height: 750 }]);
    expect(layout.contentWidth).toBe(4180);
    expect(layout.contentHeight).toBe(750);
  });

  it('centers an unscaled original loader image without stretching it', () => {
    const registry = new PackageRegistry([load('CommonResource')]);
    const loader = registry.components['kszmrlya']!.children!.find((child) => child.name === 'BackGroundLoader')!;
    expect(layoutLoader(loader, 1668, 1004)).toEqual({ x: -167, y: -127, width: 1668, height: 1004 });
  });
});
