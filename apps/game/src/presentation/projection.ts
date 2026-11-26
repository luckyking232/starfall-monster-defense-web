export interface BattlePosition {
  x: number;
  y: number;
  z: number;
}

export function projectBattlePosition(
  position: BattlePosition,
  width = 1334,
  height = 750,
): { x: number; y: number } {
  const scale = height / 750;
  return {
    x: width / 2 + position.x * scale,
    y: height / 2 - (position.y * 0.5 + position.z * Math.cos(Math.PI / 3)) * scale,
  };
}
