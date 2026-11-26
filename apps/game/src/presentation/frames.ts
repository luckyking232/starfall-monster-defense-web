export function unitFrameKeys(prefabPath: string, availableKeys: Iterable<string>): string[] {
  const source = prefabPath.split('/').at(-1)?.replace('.prefab', '');
  if (!source) throw new Error(`角色模型路径无效：${prefabPath}`);
  const keys = [...availableKeys];
  const alternate = source.replace(/^minigamespine_/, 'battlespine_');
  const stem = [source, alternate].find((candidate) => keys.some((key) =>
    key === `units/${candidate}.png` || key.startsWith(`units/${candidate}_`),
  )) ?? source;
  const pattern = new RegExp(`^units/${stem}_(\\d+)\\.png$`);
  return keys
    .filter((key) => key === `units/${stem}.png` || pattern.test(key))
    .sort((a, b) => Number(a.match(pattern)?.[1] ?? -1) - Number(b.match(pattern)?.[1] ?? -1));
}
