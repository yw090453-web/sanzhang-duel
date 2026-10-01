// Room/ready/look/compare flow adapted from dixilin/zjh-backend.
// See vendor/README.md for the original source snapshot and changes.
import { randomInt, randomUUID } from 'node:crypto';
import { compareHands } from '../src/engine/hand';
import type { Card } from '../src/engine/types';
import type { OnlinePlayer, OnlineResult, RoomSummary, RoomView } from '../src/online/types';

export interface Room {
  code: string; ownerId: string; capacity: number;
  phase: RoomView['phase']; players: OnlinePlayer[];
  hands: Map<string, Card[]>; gameNumber: number; turnId: number;
  currentId: string | null; deadline: number | null; round: number; base: number; pot: number;
  acted: Set<string>; log: { id: number; text: string }[]; logSeq: number;
  result: OnlineResult | null; touchedAt: number;
}
export const TURN_MS = 45_000;
export const MAX_ROUNDS = 20;
export function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function nickname(value: unknown): string {
  requireThat(typeof value === 'string', '请填写昵称');
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  requireThat(name.length >= 1 && Array.from(name).length <= 12, '昵称需为 1–12 个字');
  return name;
}
function note(room: Room, text: string) {
  room.log.push({ id: ++room.logSeq, text });
  if (room.log.length > 80) room.log.shift();
  room.touchedAt = Date.now();
}
export function newPlayer(id: string, name: string): OnlinePlayer {
  return { id, name, connected: true, ready: false, seen: false, status: 'active', invested: 0, score: 0 };
}
export function newRoom(code: string, player: OnlinePlayer, capacity: number): Room {
  return { code, ownerId: player.id, capacity, phase: 'waiting', players: [player], hands: new Map(), gameNumber: 0, turnId: 0,
    currentId: null, deadline: null, round: 1, base: 1, pot: 0, acted: new Set(), log: [], logSeq: 0, result: null, touchedAt: Date.now() };
}
function deck(): Card[] {
  const cards: Card[] = [];
  for (const suit of ['S', 'H', 'C', 'D'] as const) for (let rank = 2; rank <= 14; rank++) cards.push({ suit, rank });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function addPlayer(room: Room, player: OnlinePlayer) {
  requireThat(room.phase !== 'playing', '本桌正在对局，请等本局结束再加入');
  requireThat(room.players.length < room.capacity, '房间已满');
  requireThat(!room.players.some(p => p.name === player.name), '本房间已有这个昵称，请换一个');
  room.players.push(player);
  room.players.forEach(p => { p.ready = false; });
  note(room, `${player.name} 入座了`);
}
export function setReady(room: Room, id: string, ready: unknown, turnMs = TURN_MS) {
  requireThat(typeof ready === 'boolean', '准备状态无效');
  requireThat(room.phase !== 'playing', '对局中不能更改准备状态');
  const p = room.players.find(p => p.id === id);
  requireThat(p?.connected, '你不在这个房间');
  p.ready = ready;
  room.touchedAt = Date.now();
  if (room.players.length >= 2 && room.players.every(p => p.ready && p.connected)) start(room, turnMs);
}
function start(room: Room, turnMs: number) {
  const cards = deck();
  room.gameNumber++;
  room.phase = 'playing'; room.base = 1; room.round = 1; room.acted.clear();
  room.pot = room.players.length; room.hands.clear(); room.result = null;
  room.players.forEach((p, i) => {
    p.seen = false; p.invested = 1; p.status = 'active'; p.ready = false;
    room.hands.set(p.id, cards.slice(i * 3, i * 3 + 3));
  });
  room.currentId = room.players[(room.gameNumber - 1) % room.players.length].id;
  room.deadline = Date.now() + turnMs; room.turnId++;
  note(room, `第 ${room.gameNumber} 局开始，每人投入 1 积分`);
}
function settle(room: Room, winners: string[], reason: string) {
  const each = Math.floor(room.pot / winners.length);
  let remainder = room.pot % winners.length;
  const resultPlayers = room.players.map(p => {
    const gain = winners.includes(p.id) ? each + (remainder-- > 0 ? 1 : 0) : 0;
    const net = gain - p.invested;
    p.score += net; p.ready = false;
    return { id: p.id, name: p.name, cards: room.hands.get(p.id) ?? [], net, score: p.score };
  });
  room.result = { winners, reason, pot: room.pot, players: resultPlayers };
  room.phase = 'settled'; room.currentId = null; room.deadline = null; room.turnId++;
  note(room, `${reason} · ${room.players.filter(p => winners.includes(p.id)).map(p => p.name).join('、')} 获胜`);
  room.players = room.players.filter(p => p.status !== 'left');
  if (!room.players.some(p => p.id === room.ownerId)) room.ownerId = room.players[0]?.id ?? '';
}
function showdown(room: Room) {
  const active = room.players.filter(p => p.status === 'active');
  let winners = [active[0].id];
  for (const p of active.slice(1)) {
    const cmp = compareHands(room.hands.get(p.id)!, room.hands.get(winners[0])!);
    if (cmp > 0) winners = [p.id]; else if (cmp === 0) winners.push(p.id);
  }
  settle(room, winners, '达到 20 轮，自动摊牌');
}
function finishOrAdvance(room: Room, actorIndex: number, turnMs: number, advance = true) {
  const active = room.players.filter(p => p.status === 'active');
  if (active.length === 1) { settle(room, [active[0].id], '其余玩家已退出本局'); return; }
  if (active.every(p => room.acted.has(p.id))) { room.round++; room.acted.clear(); }
  if (room.round > MAX_ROUNDS) { showdown(room); return; }
  if (!advance) return;
  let i = actorIndex;
  do {
    i = (i + 1) % room.players.length;
  } while (room.players[i].status !== 'active');
  room.currentId = room.players[i].id; room.turnId++;
  room.deadline = Date.now() + turnMs;
}
export function leave(room: Room, id: string, turnMs = TURN_MS) {
  const idx = room.players.findIndex(p => p.id === id);
  if (idx < 0) return;
  const p = room.players[idx];
  note(room, `${p.name} 离开了房间`);
  if (room.phase === 'playing') {
    p.status = 'left'; p.connected = false;
    finishOrAdvance(room, idx, turnMs, room.currentId === id);
  } else {
    room.players.splice(idx, 1);
    room.players.forEach(p => { p.ready = false; });
  }
  if (room.ownerId === id) room.ownerId = room.players.find(p => p.status !== 'left')?.id ?? '';
}
export function options(room: Room, id: string): RoomView['options'] {
  const p = room.players.find(p => p.id === id);
  const active = room.phase === 'playing' && p?.status === 'active';
  const turn = !!active && room.currentId === id;
  const cost = room.base * (p?.seen ? 2 : 1);
  return { look: !!active && !p?.seen, call: turn, raise: turn && room.base < 5,
    fold: turn, compareTargets: turn && room.round > 1 ? room.players.filter(q => q.id !== id && q.status === 'active').map(q => q.id) : [],
    callCost: cost, raiseCost: (room.base + 1) * (p?.seen ? 2 : 1), compareCost: cost };
}
export function action(room: Room, id: string, kind: string, payload: Record<string, unknown>, turnMs = TURN_MS) {
  requireThat(room.phase === 'playing', '本局尚未开始或已经结束');
  requireThat(payload.gameNumber === room.gameNumber && payload.turnId === room.turnId, '回合已变化，请按当前牌桌重新操作');
  const idx = room.players.findIndex(p => p.id === id);
  const p = room.players[idx];
  requireThat(p?.status === 'active' && p.connected, '你已退出本局');
  const opt = options(room, id);
  if (kind === 'look') {
    requireThat(opt.look, '你已经看过牌'); p.seen = true;
    // Looking changes the cost of subsequent actions: invalidate queued stale requests.
    room.turnId++;
    note(room, `${p.name} 看了牌`); return;
  }
  requireThat(room.currentId === id, '还没轮到你');
  requireThat(room.deadline !== null && Date.now() < room.deadline, '操作超时，正在更新牌桌');
  if (kind === 'fold') {
    p.status = 'folded'; note(room, `${p.name} 弃牌`);
  } else if (kind === 'call' || kind === 'raise') {
    requireThat(kind !== 'raise' || opt.raise, '已达到最高档位');
    if (kind === 'raise') room.base++;
    const cost = room.base * (p.seen ? 2 : 1);
    p.invested += cost; room.pot += cost;
    note(room, `${p.name} ${kind === 'raise' ? '加码' : '跟进'} ${cost} 积分`);
  } else if (kind === 'compare') {
    requireThat(typeof payload.target === 'string' && opt.compareTargets.includes(payload.target), '首轮不能比牌，请选择仍在局内的对手');
    const target = room.players.find(q => q.id === payload.target)!;
    p.invested += opt.compareCost; room.pot += opt.compareCost;
    const loser = compareHands(room.hands.get(id)!, room.hands.get(target.id)!) > 0 ? target : p;
    loser.status = 'lost';
    note(room, `${p.name} 与 ${target.name} 比牌，${loser.name} 出局`);
  } else throw new Error('不支持的操作');
  room.acted.add(id);
  finishOrAdvance(room, idx, turnMs);
}
export function expireTurn(room: Room, turnMs = TURN_MS) {
  if (room.phase !== 'playing' || !room.deadline || room.deadline > Date.now()) return false;
  const idx = room.players.findIndex(p => p.id === room.currentId);
  room.players[idx].status = 'folded';
  room.acted.add(room.players[idx].id);
  note(room, `${room.players[idx].name} 超时，自动弃牌`);
  finishOrAdvance(room, idx, turnMs);
  return true;
}
export function view(room: Room, id: string): RoomView {
  const p = room.players.find(p => p.id === id);
  return { code: room.code, ownerId: room.ownerId, capacity: room.capacity, phase: room.phase,
    players: room.players.map(p => ({ ...p })), gameNumber: room.gameNumber, turnId: room.turnId,
    currentId: room.currentId, deadline: room.deadline, round: room.round, base: room.base, pot: room.pot,
    myCards: p?.seen || room.phase === 'settled' ? room.hands.get(id) ?? null : null,
    log: room.log, result: room.result, options: options(room, id) };
}
export function summary(room: Room): RoomSummary {
  return { code: room.code, owner: room.players.find(p => p.id === room.ownerId)?.name ?? '牌友', count: room.players.filter(p => p.status !== 'left').length, capacity: room.capacity, playing: room.phase === 'playing' };
}
export const playerId = () => randomUUID();
