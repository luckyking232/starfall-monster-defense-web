import { asset, element } from './dom';

interface UiRecord {
  width: number;
  height: number;
  rotated: boolean;
}

interface UiManifest {
  schema: string;
  files: Record<string, UiRecord>;
  byName: Record<string, string | string[]>;
}

export class BattleUiCatalog {
  constructor(private readonly manifest: UiManifest) {}

  image(name: string, className?: string): HTMLSpanElement {
    const file = this.manifest.byName[name];
    if (typeof file !== 'string') throw new Error(`未找到原版界面资源：${name}`);
    const record = this.manifest.files[file];
    if (!record) throw new Error(`界面资源索引不完整：${name}`);
    const frame = element('span', `ui-image${className ? ` ${className}` : ''}`);
    frame.style.aspectRatio = record.rotated ? `${record.height} / ${record.width}` : `${record.width} / ${record.height}`;
    const image = element('img', 'ui-image-content');
    image.src = asset(`ui/battle/${file}`);
    image.alt = '';
    image.draggable = false;
    if (record.rotated) {
      image.style.width = `${record.height / record.width * 100}%`;
      image.style.height = `${record.width / record.height * 100}%`;
      image.style.transform = 'translate(-50%, -50%) rotate(90deg)';
    }
    frame.append(image);
    return frame;
  }
}

export async function loadBattleUi(signal?: AbortSignal): Promise<BattleUiCatalog> {
  const response = await fetch(asset('battle-ui.json'), { signal: signal ?? null });
  if (!response.ok) throw new Error('战斗界面资源加载失败');
  const manifest = await response.json() as UiManifest;
  if (manifest.schema !== 'starfall.monster-defense.battle-ui/1') throw new Error('战斗界面资源版本不兼容');
  return new BattleUiCatalog(manifest);
}
