import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Stage {
  id: number;
  background_path: string;
  card_id: number[];
  monster_group: number;
}

interface Card {
  id: number;
  spd?: string;
  normal_skill?: number;
  special_skill?: number;
  talent_skill?: number;
  normal_skill_ext?: number[];
  special_skill_ext?: number[];
  talent_skill_ext?: number[];
  summon_list?: number[];
  basic_buff?: number[];
}

interface Skill {
  id: number;
  card_id?: number;
  effect?: string;
  bullet_effect?: string;
  buff_list?: string[];
  active_buff_list?: string[];
}

interface Wave {
  group_id: number;
  monsters: string[];
}

const prefabPattern = /["'](Assets\/[^"'\r\n]+\.prefab)["']/gi;

async function commonScriptPrefabs(root: string): Promise<Set<string>> {
  const worker = join(root, 'public/assets/runtime/core-worker');
  const candidates = [join(root, 'runtime/ui/battle.ts')];
  for (const group of ['inputs/lua', 'combat-prefix/inputs']) {
    const directory = join(worker, group);
    for (const file of await readdir(directory)) {
      if (file.startsWith('MiniGameBattle') && file.endsWith('.lua')) candidates.push(join(directory, file));
    }
  }
  const scripts = await Promise.all(candidates.map(candidate => readFile(candidate, 'utf8')));
  return new Set(scripts.flatMap(script => [...script.matchAll(prefabPattern)].map(match => match[1]!.toLowerCase())));
}

export async function buildStageAssets(root = '.'): Promise<Record<number, string[]>> {
  const read = (path: string) => readFile(join(root, 'public/assets', path), 'utf8');
  const json = async <T,>(path: string) => JSON.parse(await read(path)) as T;
  const [stages, cards, skills, waves, buffs, native, effects, common] = await Promise.all([
    json<Stage[]>('content/stages.json'), json<Card[]>('content/cards.json'),
    json<Skill[]>('content/skills.json'), json<Wave[]>('content/monster-groups.json'),
    read('runtime/core-worker/combat-prefix/inputs/BaseShootSkillBuff.lua'),
    json<{ prefabs: { container: string }[] }>('native/manifest.json'),
    json<{ prefabs: Record<string, unknown>; cameras: Record<string, unknown> }>('effects/mesh-effects.json'),
    commonScriptPrefabs(root),
  ]);
  const known = new Set([
    ...native.prefabs.map(({ container }) => container.toLowerCase()),
    ...Object.keys(effects.prefabs).filter(path => !(path in effects.cameras)),
  ]);
  const cardById = new Map(cards.map(card => [card.id, card]));
  const skillById = new Map(skills.map(skill => [skill.id, skill]));
  const buffById = new Map([...buffs.matchAll(/^  \[(\d+)\] = \{([\s\S]*?)(?=^  \[\d+\] = \{|^})/gm)]
    .map(match => [Number(match[1]), match[2]!]));
  const classified = new Set<string>();
  const result: Record<number, string[]> = {};

  for (const stage of stages) {
    const paths = new Set<string>();
    const visited = new Set<number>();
    let complete = true;
    const add = (path?: string) => {
      if (path && known.has(path.toLowerCase())) paths.add(path.toLowerCase());
    };
    const visit = (id: number): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const card = cardById.get(id);
      if (card) {
        add(card.spd);
        for (const ref of [card.normal_skill, card.special_skill, card.talent_skill,
          ...card.normal_skill_ext ?? [], ...card.special_skill_ext ?? [], ...card.talent_skill_ext ?? [],
          ...card.summon_list ?? [], ...card.basic_buff ?? []]) if (ref) visit(ref);
      } else if (skillById.has(id)) {
        const skill = skillById.get(id)!;
        add(skill.effect);
        add(skill.bullet_effect);
        for (const ref of [...skill.buff_list ?? [], ...skill.active_buff_list ?? []]) visit(Number(ref.split(':')[0]));
      } else if (buffById.has(id)) {
        const row = buffById.get(id)!;
        for (const match of row.matchAll(prefabPattern)) add(match[1]);
        for (const match of row.matchAll(/\b\d{8}\b/g)) {
          const ref = Number(match[0]);
          if (cardById.has(ref) || buffById.has(ref) || skillById.has(ref)) visit(ref);
        }
      } else {
        complete = false;
      }
    };
    const monsters = waves.filter(wave => wave.group_id === stage.monster_group);
    if (!monsters.length || !stage.card_id.length) continue;
    add(stage.background_path);
    for (const id of stage.card_id) visit(id);
    for (const wave of monsters) for (const monster of wave.monsters) visit(Number(monster.split(':')[0]));
    for (const skill of skills) if (skill.card_id && visited.has(skill.card_id)) visit(skill.id);
    // An incomplete table uses the complete renderer catalog for this stage.
    if (!complete || !paths.has(stage.background_path.toLowerCase())) continue;
    for (const path of paths) classified.add(path);
    result[stage.id] = [...paths];
  }

  // Paths called directly by original Lua or otherwise outside the tables stay available in every stage.
  const shared = [...known].filter(path => common.has(path) || !classified.has(path));
  for (const stage of Object.keys(result).map(Number)) result[stage] = [...new Set([...result[stage]!, ...shared])];
  return result;
}
