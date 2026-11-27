interface SpriteOrder {
  sortingLayer: number;
  sortingOrder: number;
  sortDepth: number;
}

export function compareSpriteOrder(a: SpriteOrder, b: SpriteOrder): number {
  return a.sortingLayer - b.sortingLayer || a.sortingOrder - b.sortingOrder || b.sortDepth - a.sortDepth;
}

/** Visit contiguous runs in Unity order. Effects arrive sorted by order and depth. */
export function visitWorldLayers(
  sprites: SpriteOrder[], effects: readonly { order: number }[],
  drawSprites: (start: number, end: number) => void, drawEffects: (start: number, end: number) => void,
): void {
  sprites.sort(compareSpriteOrder);
  let sprite = 0;
  for (let start = 0; start < effects.length;) {
    const order = effects[start]!.order;
    const from = sprite;
    while (sprite < sprites.length) {
      const next = sprites[sprite]!;
      if (next.sortingLayer > 0 || (next.sortingLayer === 0 && next.sortingOrder > order)) break;
      sprite++;
    }
    if (sprite > from) drawSprites(from, sprite);
    let end = start + 1;
    while (end < effects.length && effects[end]!.order === order) end++;
    drawEffects(start, end);
    start = end;
  }
  if (sprite < sprites.length) drawSprites(sprite, sprites.length);
}
