import type { Persona } from './ai/strategy';

export interface SeatConfig {
  seat: number;
  name: string;
  kind: 'human' | 'computer';
  persona: Persona | null;
  styleLabel: string;
  avatar: string;
}

/** 座位固定：0 为真人（底部），顺时针依次为左、上、右 */
export const SEATS: readonly SeatConfig[] = [
  { seat: 0, name: '你', kind: 'human', persona: null, styleLabel: '玩家', avatar: '你' },
  { seat: 1, name: '电脑·青岚', kind: 'computer', persona: 'cautious', styleLabel: '谨慎型', avatar: '岚' },
  { seat: 2, name: '电脑·石衡', kind: 'computer', persona: 'balanced', styleLabel: '均衡型', avatar: '衡' },
  { seat: 3, name: '电脑·赤焰', kind: 'computer', persona: 'aggressive', styleLabel: '主动型', avatar: '焰' },
];

export const SEAT_NAMES = SEATS.map((s) => s.name);
