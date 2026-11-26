import Phaser from 'phaser';

interface ColorSpan {
  start: number;
  end: number;
  color: string;
}

interface ColoredText {
  text: string;
  spans: ColorSpan[];
}

export function wrapFguiText(value: string, object: Phaser.GameObjects.Text): string[] {
  const lines: string[] = [];
  const width = (object.style.wordWrapWidth ?? object.width) - object.style.strokeThickness;
  for (const paragraph of value.split(/\r\n|\r|\n/)) {
    let line = '';
    // Treat the number and percent sign as one unit when it fits on a line.
    const segments = (paragraph.match(/\d+(?:\.\d+)?%|[\s\S]/gu) ?? []).flatMap((segment) =>
      segment.endsWith('%') && object.context.measureText(segment).width > width ? [...segment] : [segment]);
    for (const segment of segments) {
      const next = line + segment;
      if (line && object.context.measureText(next).width > width) {
        // FairyGUI reflows a short Latin word following a space as a unit and otherwise breaks between glyphs.
        const word = /\s([a-z\d."'’]{1,19})$/i.exec(next);
        if (word && word.index > 0) {
          lines.push(next.slice(0, word.index + 1));
          line = word[1]!;
        } else {
          lines.push(line);
          line = segment;
        }
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function parseUbbColors(value: string): ColoredText | null {
  const spans: ColorSpan[] = [];
  const colors: string[] = [];
  let start = 0;
  let text = '';
  const append = (part: string) => {
    if (!part) return;
    const color = colors.at(-1);
    if (color) spans.push({ start: text.length, end: text.length + part.length, color });
    text += part;
  };
  for (const token of value.matchAll(/\\\[|\[\/color\]|\[color=(#[a-f\d]{6})\]/gi)) {
    append(value.slice(start, token.index));
    if (token[0] === '\\[') append('[');
    else if (token[1]) colors.push(token[1]);
    else if (colors.length) colors.pop();
    else append(token[0]);
    start = token.index + token[0].length;
  }
  if (start === 0) return null;
  append(value.slice(start));
  return { text, spans };
}

export function paintUbbColors(object: Phaser.GameObjects.Text, value: ColoredText, verticalAlign: string): void {
  if (!value.spans.length) return;
  const { canvas, context, style, padding } = object;
  const { left = 0, right = 0, top: padTop = 0, bottom = 0 } = padding;
  const lines = object.getWrappedText();
  const metrics = object.getTextMetrics();
  const size = Phaser.GameObjects.GetTextSize(object, metrics, lines);
  const width = Math.max(size.width, object.width - left - right);
  const spareHeight = Math.max(0, object.height - padTop - bottom - size.height);
  const top = verticalAlign === 'Middle' ? spareHeight / 2 : verticalAlign === 'Bottom' ? spareHeight : 0;
  const originalColor = style.color;
  const stroke = style.strokeThickness;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(style.resolution, style.resolution);
  context.translate(left, padTop);
  style.syncStyle(canvas, context);
  let offset = 0;
  for (let index = 0; index < size.lines; index++) {
    const line = lines[index]!.trimEnd();
    const start = value.text.indexOf(line, offset);
    const remaining = width - size.lineWidths[index]!;
    const indent = style.align === 'center' ? remaining / 2 : style.align === 'right' ? remaining : 0;
    const x = Math.round(stroke / 2 + indent);
    const y = Math.round(stroke / 2 + metrics.ascent + top + index * (size.lineHeight + size.lineSpacing));
    if (stroke) context.strokeText(line, x, y);
    let cursor = 0;
    const draw = (end: number, color: typeof originalColor) => {
      if (end <= cursor) return;
      context.fillStyle = color;
      context.fillText(line.slice(cursor, end), x + context.measureText(line.slice(0, cursor)).width, y);
      cursor = end;
    };
    if (start !== -1) {
      offset = start + line.length;
      for (const span of value.spans) {
        if (span.end <= start || span.start >= offset) continue;
        draw(Math.max(0, span.start - start), originalColor);
        draw(Math.min(line.length, span.end - start), span.color);
      }
    }
    draw(line.length, originalColor);
  }
  context.restore();
  object.frame.source.update();
}
