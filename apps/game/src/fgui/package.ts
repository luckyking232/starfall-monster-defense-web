export interface FguiTextFormat {
  font: string;
  fontSize: number;
  color: string;
  align: string;
  verticalAlign: string;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
  lineSpacing: number;
  underline: boolean;
  strikethrough: boolean;
  outline?: number;
  outlineColor?: string;
}

export interface FguiController {
  name: string;
  pages: { id: string; name: string }[];
  autoRadioGroupDepth?: boolean;
  selected?: number;
}

export interface FguiTransitionValue {
  f1?: number;
  f2?: number;
  b1?: boolean;
  b2?: boolean;
  percent?: boolean;
  visible?: boolean;
  text?: string;
  transitionName?: string;
  playTimes?: number;
}

export interface FguiTransitionTween {
  duration: number;
  easeType: string;
  repeat: number;
  yoyo: boolean;
  startValue: FguiTransitionValue;
  endValue: FguiTransitionValue;
  endLabel?: string;
  path?: unknown;
}

export interface FguiTransitionTrack {
  type: string;
  targetIndex: number;
  targetName?: string;
  time: number;
  label?: string;
  tween?: FguiTransitionTween;
  value?: FguiTransitionValue;
}

export interface FguiTransition {
  name: string;
  items: FguiTransitionTrack[];
}

export interface FguiRelation {
  targetName: string;
  relations: { type: string; usePercent: boolean }[];
}

export interface FguiChild {
  id: string | number;
  name: string;
  objectType: string;
  type?: string;
  src?: string;
  packageId?: string | null;
  refName?: string;
  refUrl?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  alpha?: number;
  visible?: boolean;
  touchable?: boolean;
  rotation?: number;
  pivot?: [number, number];
  pivotAsAnchor?: boolean;
  autoSize?: string | boolean;
  fill?: string;
  align?: string;
  verticalAlign?: string;
  shrinkOnly?: boolean;
  text?: string;
  textFormat?: FguiTextFormat;
  ubbEnabled?: boolean;
  singleLine?: boolean;
  defaultItem?: string;
  layout?: string;
  overflow?: string;
  columnGap?: number;
  lineGap?: number;
  lineCount?: number;
  columnCount?: number;
  autoResizeItem?: boolean;
  scroll?: { scrollType?: string; flags?: number; [key: string]: unknown };
  controllers?: FguiController[];
  extension?: Record<string, unknown>;
  transitions?: FguiTransition[];
  maskName?: string;
  reversedMask?: boolean;
  scale?: [number, number];
  clickHandlerCount?: number;
  url?: string | null;
  scale9Grid?: number[];
  tileGridIndice?: number;
  scaleByTile?: boolean;
  graphType?: string;
  fillColor?: string;
  lineColor?: string;
  lineSize?: number;
  grayed?: boolean;
  blendMode?: string;
  data?: unknown;
  relations?: FguiRelation[];
  gears?: unknown[];
  min?: number;
  max?: number;
  value?: number;
  children?: FguiChild[];
}

export interface FguiComponent extends FguiChild {
  width: number;
  height: number;
  children?: FguiChild[];
}

export interface FguiSprite {
  atlasId: string;
  atlasFile: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  originalSize: [number, number];
  offset?: [number, number];
}

export interface FguiBitmapFont {
  size: number;
  lineHeight: number;
  tintable: boolean;
  resizable: boolean;
  glyphs: Record<string, { image: string; x: number; y: number; advance: number }>;
}

export interface FguiItem {
  id: string;
  name: string;
  type: string;
  objectType?: string;
  width: number;
  height: number;
  sprite?: FguiSprite;
  bitmapFont?: FguiBitmapFont;
  scale9Grid?: number[];
  tileGridIndice?: number;
  scaleByTile?: boolean;
}

export interface FguiPackage {
  schema: string;
  package: { id: string; name: string; version: number };
  componentIndex: Record<string, string>;
  components: Record<string, FguiComponent>;
  items: Record<string, FguiItem>;
  atlases: Record<string, { file: string; width: number; height: number; sha256: string }>;
  unsupported?: unknown;
}

export class PackageRegistry {
  private readonly byName = new Map<string, FguiPackage>();
  private readonly byId = new Map<string, FguiPackage>();
  readonly components: Record<string, FguiComponent> = {};

  constructor(packages: FguiPackage[]) {
    for (const pkg of packages) {
      if (pkg.schema !== 'starfall-fgui-package/1') throw new Error(`不支持的 FGUI 数据版本：${pkg.package.name}`);
      this.byName.set(pkg.package.name, pkg);
      this.byId.set(pkg.package.id, pkg);
      Object.assign(this.components, pkg.components);
    }
  }

  static async load(): Promise<PackageRegistry> {
    const manifestResponse = await fetch(new URL('assets/fgui/fgui-manifest.json', document.baseURI));
    if (!manifestResponse.ok) throw new Error('FGUI 索引加载失败');
    const manifest = await manifestResponse.json() as { packages: { name: string; json: string; jsonSha256: string }[] };
    const packages = await Promise.all(manifest.packages.map(async (entry) => {
      const response = await fetch(new URL(`assets/fgui/${entry.json}`, document.baseURI));
      if (!response.ok) throw new Error(`FGUI 包加载失败：${entry.name}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('');
      if (digest !== entry.jsonSha256) throw new Error(`FGUI 包校验失败：${entry.name}`);
      return JSON.parse(new TextDecoder().decode(bytes)) as FguiPackage;
    }));
    return new PackageRegistry(packages);
  }

  package(name: string): FguiPackage {
    const pkg = this.byName.get(name);
    if (!pkg) throw new Error(`未加载 FGUI 包：${name}`);
    return pkg;
  }

  component(name: string, packageName: string): FguiComponent {
    const pkg = this.package(packageName);
    const id = pkg.componentIndex[name];
    if (!id) throw new Error(`原窗口组件不存在：${packageName}/${name}`);
    return this.components[id]!;
  }

  componentByUrl(url: string): FguiComponent {
    if (!url.startsWith('ui://') || url.length < 10) throw new Error(`无效的 FGUI 资源地址：${url}`);
    const pkg = this.byId.get(url.slice(5, 13));
    if (!pkg) throw new Error(`未加载 FGUI 依赖包：${url}`);
    const component = pkg.components[url.slice(13)];
    if (!component) throw new Error(`FGUI 组件引用不存在：${url}`);
    return component;
  }

  item(name: string, packageName: string): FguiItem {
    const item = Object.values(this.package(packageName).items).find((candidate) => candidate.name === name);
    if (!item) throw new Error(`FGUI 资源不存在：${packageName}/${name}`);
    return item;
  }

  sprite(name: string, packageName: string): FguiSprite {
    const sprite = this.item(name, packageName).sprite;
    if (!sprite) throw new Error(`FGUI 图片缺少图集信息：${packageName}/${name}`);
    return sprite;
  }

  packageById(id: string): FguiPackage {
    const pkg = this.byId.get(id);
    if (!pkg) throw new Error(`未加载 FGUI 依赖包：${id}`);
    return pkg;
  }

  itemByUrl(url: string): { pkg: FguiPackage; item: FguiItem } {
    if (!url.startsWith('ui://') || url.length < 10) throw new Error(`资源地址无效：${url}`);
    const pkg = this.packageById(url.slice(5, 13));
    const id = url.slice(13);
    const item = pkg.items[id];
    if (!item) throw new Error(`FGUI 资源引用不存在：${url}`);
    return { pkg, item };
  }

  atlasEntries(): { key: string; url: string }[] {
    const files = new Set<string>();
    for (const pkg of this.byName.values()) {
      for (const atlas of Object.values(pkg.atlases)) files.add(atlas.file);
    }
    return [...files].map((file) => ({ key: `fgui:${file}`, url: new URL(`assets/fgui/${file}`, document.baseURI).href }));
  }
}
