import type { FguiChild } from './package';

export interface LayoutItem {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutLoader(child: FguiChild, sourceWidth: number, sourceHeight: number): LayoutItem {
  let width = sourceWidth;
  let height = sourceHeight;
  let sx = 1;
  let sy = 1;
  if (child.fill && child.fill !== 'None') {
    sx = (child.width ?? 0) / sourceWidth;
    sy = (child.height ?? 0) / sourceHeight;
    if (child.fill === 'ScaleMatchHeight') sx = sy;
    else if (child.fill === 'ScaleMatchWidth') sy = sx;
    else if (child.fill === 'Scale') sx = sy = Math.min(sx, sy);
    else if (child.fill === 'ScaleNoBorder') sx = sy = Math.max(sx, sy);
    if (child.shrinkOnly) sx = sy = Math.min(1, sx, sy);
    width *= sx;
    height *= sy;
  }
  return {
    x: child.align === 'Center' ? ((child.width ?? 0) - width) / 2 : child.align === 'Right' ? (child.width ?? 0) - width : 0,
    y: child.verticalAlign === 'Middle' ? ((child.height ?? 0) - height) / 2 : child.verticalAlign === 'Bottom' ? (child.height ?? 0) - height : 0,
    width,
    height,
  };
}

export function layoutList(list: FguiChild, items: Pick<LayoutItem, 'width' | 'height'>[]): { items: LayoutItem[]; contentWidth: number; contentHeight: number } {
  const viewWidth = list.width ?? 0;
  const viewHeight = list.height ?? 0;
  const lineGap = list.lineGap ?? 0;
  const columnGap = list.columnGap ?? 0;
  const layout = list.layout ?? 'SingleColumn';
  const result: LayoutItem[] = [];
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;
  let rowHeight = 0;
  let columnWidth = 0;
  for (const source of items) {
    const item: LayoutItem = { ...source, x: 0, y: 0 };
    if (layout === 'SingleColumn') {
      if (list.autoResizeItem) item.width = viewWidth;
      item.x = 0;
      item.y = y;
      y += Math.ceil(item.height) + lineGap;
      width = Math.max(width, item.width);
      height = y - lineGap;
    } else if (layout === 'SingleRow') {
      if (list.autoResizeItem) item.height = viewHeight;
      item.x = x;
      item.y = 0;
      x += Math.ceil(item.width) + columnGap;
      width = x - columnGap;
      height = Math.max(height, item.height);
    } else if (layout === 'FlowHorizontal') {
      if (x > 0 && x + item.width > viewWidth) {
        x = 0;
        y += rowHeight + lineGap;
        rowHeight = 0;
      }
      item.x = x;
      item.y = y;
      x += item.width + columnGap;
      rowHeight = Math.max(rowHeight, item.height);
      width = Math.max(width, x - columnGap);
      height = y + rowHeight;
    } else if (layout === 'FlowVertical') {
      if (y > 0 && y + item.height > viewHeight) {
        y = 0;
        x += columnWidth + columnGap;
        columnWidth = 0;
      }
      item.x = x;
      item.y = y;
      y += item.height + lineGap;
      columnWidth = Math.max(columnWidth, item.width);
      width = x + columnWidth;
      height = Math.max(height, y - lineGap);
    } else {
      throw new Error(`未支持的 FGUI 列表布局：${layout}`);
    }
    result.push(item);
  }
  const offsetX = width < viewWidth && list.align === 'Center' ? Math.floor((viewWidth - width) / 2)
    : width < viewWidth && list.align === 'Right' ? viewWidth - width : 0;
  const offsetY = height < viewHeight && list.verticalAlign === 'Middle' ? Math.floor((viewHeight - height) / 2)
    : height < viewHeight && list.verticalAlign === 'Bottom' ? viewHeight - height : 0;
  return {
    items: result.map((item) => ({ ...item, x: item.x + offsetX, y: item.y + offsetY })),
    contentWidth: width,
    contentHeight: height,
  };
}
