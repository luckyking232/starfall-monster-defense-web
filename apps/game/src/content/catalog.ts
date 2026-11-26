import { asset } from '../scenes/dom';

export interface SkillDefinition {
  id: number;
  name: string;
  des: string;
  icon: string;
  type: number;
  card_id: number;
  bullet_speed?: number;
}

export interface CardDefinition {
  id: number;
  type: number;
  name: string;
  spd: string;
  spd_scale: number;
  head_icon: string;
  head_icon_ui: string;
  normal_skill?: number;
  special_skill?: number;
  talent_skill?: number;
  attack_sound?: string;
  hit_sound?: string;
}

export interface StageContent {
  id: number;
  card_id: number[];
  level_time: number[];
}

export interface BattleContent {
  skills: ReadonlyMap<number, SkillDefinition>;
  cards: ReadonlyMap<number, CardDefinition>;
  stages: ReadonlyMap<number, StageContent>;
}

export async function loadBattleContent(signal?: AbortSignal): Promise<BattleContent> {
  async function read<T>(path: string, error: string): Promise<T> {
    const response = await fetch(asset(path), { signal: signal ?? null });
    if (!response.ok) throw new Error(error);
    return await response.json() as T;
  }
  const [skills, cards, stages] = await Promise.all([
    read<SkillDefinition[]>('content/skills.json', '技能数据加载失败'),
    read<CardDefinition[]>('content/cards.json', '角色数据加载失败'),
    read<StageContent[]>('content/stages.json', '关卡数据加载失败'),
  ]);
  return {
    skills: new Map(skills.map((skill) => [skill.id, skill])),
    cards: new Map(cards.map((card) => [card.id, card])),
    stages: new Map(stages.map((stage) => [stage.id, stage])),
  };
}
