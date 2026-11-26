export function asset(path: string): string {
  return new URL(`assets/${path}`, document.baseURI).href;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function background(path: string, alt = ''): HTMLImageElement {
  const image = element('img', 'screen-background');
  image.src = asset(path);
  image.alt = alt;
  image.draggable = false;
  return image;
}
