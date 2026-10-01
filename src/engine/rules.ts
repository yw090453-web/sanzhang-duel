// 单局规则引擎：纯函数。任何非法调用都返回错误且不修改状态。
import { deal } from './cards';
import { compareHands, compareHandValues, evaluateHand } from './hand';
import { splitPot } from './settle';
import {
  ANTE,
  LEVELS,
  MAX_ROUNDS,
  NUM_PLAYERS,
  START_CHIPS,
  TOTAL_POINTS,
  type Action,
  type Card,
  type GameState,
  type Level,
  type LogEntry,
  type RandomSource,
  type WinMethod,
} from './types';

export interface ActionOption {
  allowed: boolean;
  /** 本次实际费用 */
  cost: number;
  /** 不可用原因（界面直接展示） */
  reason?: string;
}

export interface ActionOptions {
  isTurn: boolean;
  look: ActionOption;
  call: ActionOption;
  raise: ActionOption & { newLevel: Level | null };
  fold: ActionOption;
  compare: ActionOption & { targets: number[] };
}

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };

export const REASON = {
  notTurn: '等待其他玩家行动',
  ended: '本局已结束',
  out: '你已退出本局',
  seen: '已看牌',
  round2: '第2轮开放',
  mustLook: '请先看牌',
  maxLevel: '已到最高档',
  noTarget: '没有可比牌的对象',
  noChips: '积分不足',
  stale: '操作已过期',
} as const;

export function nextLevel(level: Level): Level | null {
  const i = LEVELS.indexOf(level);
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}

/** 跟进费用：未看牌 = 档位，已看牌 = 档位 × 2 */
export function callCost(level: Level, seen: boolean): number {
  return seen ? level * 2 : level;
}

/** 比牌费用：发起者当前跟进费用 × 2（发起者必然已看牌，即档位 × 4） */
export function compareCost(level: Level, seen: boolean): number {
  return callCost(level, seen) * 2;
}

export function activeSeats(state: GameState): number[] {
  return state.players.filter((p) => p.status === 'active').map((p) => p.seat);
}

export function createGame(gameIndex: number, startSeat: number, rng: RandomSource): GameState {
  return createGameWithHands(gameIndex, startSeat, deal(NUM_PLAYERS, rng));
}

/** 用指定手牌开局（测试用；正式对局经由 createGame 随机发牌） */
export function createGameWithHands(gameIndex: number, startSeat: number, hands: Card[][]): GameState {
  const players = Array.from({ length: NUM_PLAYERS }, (_, seat) => ({
    seat,
    chips: START_CHIPS - ANTE,
    seen: false,
    status: 'active' as const,
    invested: ANTE,
  }));
  return {
    gameIndex,
    startSeat,
    hands: hands.map((h) => h.map((c) => ({ ...c }))),
    players,
    pot: ANTE * NUM_PLAYERS,
    level: 10,
    round: 1,
    acted: new Array<boolean>(NUM_PLAYERS).fill(false),
    currentSeat: startSeat,
    turnId: 0,
    version: 0,
    phase: 'playing',
    log: [
      { seq: 0, round: 1, kind: 'ante', seat: null, cost: ANTE, level: 10, amount: ANTE * NUM_PLAYERS },
      { seq: 1, round: 1, kind: 'round', seat: null, cost: 0, level: 10 },
    ],
    result: null,
  };
}

function disabled(reason: string, cost = 0): ActionOption {
  return { allowed: false, cost, reason };
}

export function getActionOptions(state: GameState, seat: number): ActionOptions {
  const p = state.players[seat];
  const level = state.level;
  const seen = p?.seen ?? false;
  const cCost = callCost(level, seen);
  const nl = nextLevel(level);
  const rCost = nl ? callCost(nl, seen) : 0;
  // 发起比牌者必须已看牌，因此比牌费用始终按“已看牌”计算（10/20/40 档 → 40/80/160）
  const cmpCost = compareCost(level, true);

  let blocker: string | null = null;
  if (state.phase !== 'playing') blocker = REASON.ended;
  else if (!p || p.status !== 'active') blocker = REASON.out;
  else if (state.currentSeat !== seat) blocker = REASON.notTurn;

  if (blocker) {
    return {
      isTurn: false,
      look: disabled(seen ? REASON.seen : blocker),
      call: disabled(blocker, cCost),
      raise: { ...disabled(nl ? blocker : REASON.maxLevel, rCost), newLevel: nl },
      fold: disabled(blocker),
      compare: { ...disabled(blocker, cmpCost), targets: [] },
    };
  }

  const targets = activeSeats(state).filter((s) => s !== seat);
  let compareReason: string | undefined;
  if (state.round < 2) compareReason = REASON.round2;
  else if (!seen) compareReason = REASON.mustLook;
  else if (targets.length === 0) compareReason = REASON.noTarget;
  else if (cmpCost > p.chips) compareReason = REASON.noChips;

  let raiseReason: string | undefined;
  if (!nl) raiseReason = REASON.maxLevel;
  else if (rCost > p.chips) raiseReason = REASON.noChips;

  return {
    isTurn: true,
    look: seen ? disabled(REASON.seen) : { allowed: true, cost: 0 },
    call: cCost > p.chips ? disabled(REASON.noChips, cCost) : { allowed: true, cost: cCost },
    raise: raiseReason ? { ...disabled(raiseReason, rCost), newLevel: nl } : { allowed: true, cost: rCost, newLevel: nl },
    fold: { allowed: true, cost: 0 },
    compare: compareReason
      ? { ...disabled(compareReason, cmpCost), targets: [] }
      : { allowed: true, cost: cmpCost, targets },
  };
}

function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p })),
    acted: s.acted.slice(),
    log: s.log.slice(),
    // hands 在整局中不会被修改，可以共享引用
  };
}

function pushLog(s: GameState, entry: Omit<LogEntry, 'seq' | 'round' | 'level'>): void {
  s.log.push({ seq: s.log.length, round: s.round, level: s.level, ...entry });
}

function pay(s: GameState, seat: number, cost: number): void {
  const p = s.players[seat];
  if (cost > p.chips) throw new Error('积分不足（引擎内部错误）');
  p.chips -= cost;
  p.invested += cost;
  s.pot += cost;
}

/** 本轮中下一个应行动的座位：按起始座位顺时针，第一个仍在局内且本轮未行动的人 */
function nextInRound(s: GameState): number | null {
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const seat = (s.startSeat + i) % NUM_PLAYERS;
    if (s.players[seat].status === 'active' && !s.acted[seat]) return seat;
  }
  return null;
}

function finalize(s: GameState, winners: number[], method: WinMethod, showdownSeats: number[]): void {
  const gained = winners.length === 1 ? s.players.map((p) => (p.seat === winners[0] ? s.pot : 0)) : splitPot(s.pot, winners, s.startSeat);
  const amount = s.pot;
  for (const p of s.players) p.chips += gained[p.seat];
  s.pot = 0;
  const finalChips = s.players.map((p) => p.chips);
  s.result = {
    winners: winners.slice(),
    method,
    invested: s.players.map((p) => p.invested),
    gained,
    net: finalChips.map((c) => c - START_CHIPS),
    finalChips,
    showdownSeats,
  };
  s.phase = 'settled';
  s.currentSeat = null;
  pushLog(s, { kind: 'settle', seat: null, cost: 0, winners: winners.slice(), amount, method });
}

function showdown(s: GameState): void {
  const seats = activeSeats(s);
  const values = seats.map((seat) => evaluateHand(s.hands[seat]));
  let best = values[0];
  for (const v of values) if (compareHandValues(v, best) > 0) best = v;
  const winners = seats.filter((_, i) => compareHandValues(values[i], best) === 0);
  finalize(s, winners, 'showdown', seats);
}

/** 结束当前玩家的回合，并推进轮次/检查结束条件 */
function endTurn(s: GameState, seat: number, cause: 'call' | 'raise' | 'fold' | 'compare'): void {
  s.acted[seat] = true;
  s.turnId += 1;
  const active = activeSeats(s);
  if (active.length === 1) {
    finalize(s, active, cause === 'compare' ? 'compare' : 'others_out', []);
    return;
  }
  const next = nextInRound(s);
  if (next !== null) {
    s.currentSeat = next;
    return;
  }
  if (s.round >= MAX_ROUNDS) {
    showdown(s);
    return;
  }
  s.round += 1;
  s.acted = new Array<boolean>(NUM_PLAYERS).fill(false);
  s.currentSeat = nextInRound(s);
  pushLog(s, { kind: 'round', seat: null, cost: 0 });
}

/**
 * 执行一个动作。expectedTurnId 用于防止重复提交：与当前回合标识不符时拒绝。
 * 返回新状态，原状态不被修改。
 */
export function applyAction(state: GameState, seat: number, action: Action, expectedTurnId?: number): ApplyResult {
  if (state.phase !== 'playing') return { ok: false, error: REASON.ended };
  if (expectedTurnId !== undefined && expectedTurnId !== state.turnId) return { ok: false, error: REASON.stale };
  if (state.currentSeat !== seat) return { ok: false, error: REASON.notTurn };
  const opts = getActionOptions(state, seat);
  const s = cloneState(state);
  const p = s.players[seat];

  switch (action?.type) {
    case 'look': {
      if (!opts.look.allowed) return { ok: false, error: opts.look.reason ?? '不能看牌' };
      p.seen = true;
      pushLog(s, { kind: 'look', seat, cost: 0, seen: true });
      break;
    }
    case 'call': {
      if (!opts.call.allowed) return { ok: false, error: opts.call.reason ?? '不能跟进' };
      pay(s, seat, opts.call.cost);
      pushLog(s, { kind: 'call', seat, cost: opts.call.cost, seen: p.seen });
      endTurn(s, seat, 'call');
      break;
    }
    case 'raise': {
      if (!opts.raise.allowed || !opts.raise.newLevel) return { ok: false, error: opts.raise.reason ?? '不能加码' };
      s.level = opts.raise.newLevel;
      pay(s, seat, opts.raise.cost);
      pushLog(s, { kind: 'raise', seat, cost: opts.raise.cost, seen: p.seen });
      endTurn(s, seat, 'raise');
      break;
    }
    case 'fold': {
      if (!opts.fold.allowed) return { ok: false, error: opts.fold.reason ?? '不能弃牌' };
      p.status = 'folded';
      pushLog(s, { kind: 'fold', seat, cost: 0, seen: p.seen });
      endTurn(s, seat, 'fold');
      break;
    }
    case 'compare': {
      if (!opts.compare.allowed) return { ok: false, error: opts.compare.reason ?? '不能比牌' };
      const target = action.target;
      if (target === seat) return { ok: false, error: '不能与自己比牌' };
      if (!opts.compare.targets.includes(target)) return { ok: false, error: '比牌对象不在局内' };
      pay(s, seat, opts.compare.cost);
      // 主动比牌：牌力完全相同时发起者落败（该规则只属于比牌动作）
      const initiatorWins = compareHands(s.hands[seat], s.hands[target]) > 0;
      const winner = initiatorWins ? seat : target;
      const loser = initiatorWins ? target : seat;
      s.players[loser].status = 'lost';
      pushLog(s, { kind: 'compare', seat, cost: opts.compare.cost, seen: true, target, winner, loser });
      endTurn(s, seat, 'compare');
      break;
    }
    default:
      return { ok: false, error: '未知动作' };
  }
  s.version += 1;
  return { ok: true, state: s };
}

/** 检查不变量，返回违规描述列表（空数组表示正常） */
export function checkInvariants(s: GameState): string[] {
  const errors: string[] = [];
  const sum = s.players.reduce((a, p) => a + p.chips, 0) + s.pot;
  if (sum !== TOTAL_POINTS) errors.push(`积分不守恒：${sum}`);
  for (const p of s.players) {
    if (!Number.isInteger(p.chips) || p.chips < 0) errors.push(`座位${p.seat}积分非法：${p.chips}`);
    if (p.invested + p.chips - (s.result ? s.result.gained[p.seat] : 0) !== START_CHIPS)
      errors.push(`座位${p.seat}投入记录不一致`);
  }
  if (s.phase === 'playing') {
    if (s.currentSeat === null || s.players[s.currentSeat]?.status !== 'active') errors.push('当前行动者无效');
    if (activeSeats(s).length < 2) errors.push('进行中的对局留场人数不足');
    if (s.round < 1 || s.round > MAX_ROUNDS) errors.push('轮次越界');
  } else {
    if (s.pot !== 0) errors.push('结算后公共积分未清零');
    if (!s.result) errors.push('缺少结算结果');
    else if (s.result.net.reduce((a, b) => a + b, 0) !== 0) errors.push('净得分之和不为 0');
    if (s.log.filter((e) => e.kind === 'settle').length !== 1) errors.push('结算次数异常');
  }
  if (!LEVELS.includes(s.level)) errors.push('档位非法');
  return errors;
}
