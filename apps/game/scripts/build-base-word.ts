/** A conservative closure. Any use besides integer literal calls retains the original table. */
export function buildBaseWord(original: string, scripts: readonly string[]) {
  const rowMatches = [...original.matchAll(/^  \[(\d+)\] = \{/gm)];
  const full = { payload: original, mode: 'full', rows: rowMatches.length, missing: [] as number[] };
  const wanted = new Set<number>();
  for (const script of scripts) {
    const unclassified = script.replace(/(?<![\w.])T\s*\(\s*(\d+)\s*(?=[,)])/g, (_, id: string) => {
      wanted.add(Number(id));
      return '';
    });
    if (/\b(?:T|BaseWord_cn)\b/.test(unclassified)) return full;
  }
  const close = original.lastIndexOf('\n}');
  if (close < 0 || !rowMatches.length || !wanted.size) return full;
  const rows = new Map<number, string>();
  for (const [index, match] of rowMatches.entries()) {
    const end = rowMatches[index + 1]?.index ?? close;
    rows.set(Number(match[1]), original.slice(match.index, end).trimEnd().replace(/,$/, ''));
  }
  const selected = [...rows].filter(([id]) => wanted.has(id)).map(([, row]) => row);
  const head = original.slice(0, rowMatches[0]!.index);
  const footer = original.slice(close + 1);
  return {
    payload: head + selected.map(row => row + ',\n').join('') + footer,
    mode: 'literal-closure', rows: selected.length,
    missing: [...wanted].filter(id => !rows.has(id)).sort((a, b) => a - b),
  };
}
