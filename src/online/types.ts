import type { Card } from '../engine/types';

export interface OnlinePlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  seen: boolean;
  status: 'active' | 'folded' | 'lost' | 'left';
  invested: number;
  score: number;
}
export interface OnlineResult {
  winners: string[];
  pot: number;
  reason: string;
  players: { id: string; name: string; cards: Card[]; net: number; score: number }[];
}
export interface RoomView {
  code: string;
  ownerId: string;
  capacity: number;
  phase: 'waiting' | 'playing' | 'settled';
  players: OnlinePlayer[];
  gameNumber: number;
  turnId: number;
  currentId: string | null;
  deadline: number | null;
  round: number;
  base: number;
  pot: number;
  myCards: Card[] | null;
  log: { id: number; text: string }[];
  result: OnlineResult | null;
  options: { look: boolean; call: boolean; raise: boolean; fold: boolean; compareTargets: string[]; callCost: number; raiseCost: number; compareCost: number };
}
export interface RoomSummary { code: string; owner: string; count: number; capacity: number; playing: boolean }
export interface OnlineSnapshot {
  playerId: string;
  room: RoomView | null;
  rooms: RoomSummary[];
  serverTime: number;
}
export type OnlineCommand = 'createRoom' | 'joinRoom' | 'leaveRoom' | 'ready' | 'look' | 'call' | 'raise' | 'compare' | 'fold' | 'sync';
export interface CommandReply { ok: boolean; error?: string }
