// 本地保存：对局存档、已完成战绩、设置。读取时做结构与不变量校验，损坏时明确报告。
import { isValidCard, cardKey } from '../engine/cards';
import { MATCH_SCHEMA, startSeatFor, type MatchState } from '../engine/match';
import { checkInvariants } from '../engine/rules';
import { LEVELS, MAX_ROUNDS, NUM_PLAYERS, TOTAL_GAMES } from '../engine/types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEYS = {
  save: 'sanzhang-duel:save:v1',
  records: 'sanzhang-duel:records:v1',
  settings: 'sanzhang-duel:settings:v1',
} as const;

export type Speed = 'slow' | 'normal' | 'fast';

export interface Settings {
  speed: Speed;
}

export const DEFAULT_SETTINGS: Settings = { speed: 'normal' };

export interface MatchRecord {
  id: string;
  finishedAt: number;
  scores: number[];
  ranks: number[];
  gamesWon: number[];
}

export type LoadResult =
  | { status: 'none' }
  | { status: 'ok'; match: MatchState }
  | { status: 'corrupt'; reason: string };

export function getBrowserStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = '__sanzhang_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const isInt = (x: unknown): x is number => Number.isInteger(x);
const isIntArray = (x: unknown, len: number): x is number[] => Array.isArray(x) && x.length === len && x.every(isInt);

/** 校验存档，返回错误描述；合法返回 null */
export function validateMatch(x: unknown): string | null {
  try {
    if (typeof x !== 'object' || x === null) return '存档不是对象';
    const m = x as MatchState;
    if (m.schema !== MATCH_SCHEMA) return '存档版本不兼容';
    if (typeof m.id !== 'string' || !m.id) return '缺少对战编号';
    if (!isInt(m.firstStartSeat) || m.firstStartSeat < 0 || m.firstStartSeat >= NUM_PLAYERS) return '起始座位非法';
    if (!isIntArray(m.scores, NUM_PLAYERS)) return '本场成绩非法';
    if (!Array.isArray(m.games)) return '局结果列表非法';
    if (typeof m.finished !== 'boolean') return '结束标记非法';

    const g = m.game;
    if (typeof g !== 'object' || g === null) return '缺少当前局';
    if (!isInt(g.gameIndex) || g.gameIndex < 0 || g.gameIndex >= TOTAL_GAMES) return '局序号非法';
    if (g.startSeat !== startSeatFor(m.firstStartSeat, g.gameIndex)) return '本局起始座位与轮换规则不符';
    if (!Array.isArray(g.hands) || g.hands.length !== NUM_PLAYERS) return '手牌数据非法';
    const keys = new Set<string>();
    for (const hand of g.hands) {
      if (!Array.isArray(hand) || hand.length !== 3 || !hand.every(isValidCard)) return '手牌数据非法';
      hand.forEach((c) => keys.add(cardKey(c)));
    }
    if (keys.size !== NUM_PLAYERS * 3) return '存在重复牌';
    if (!Array.isArray(g.players) || g.players.length !== NUM_PLAYERS) return '玩家数据非法';
    for (let i = 0; i < NUM_PLAYERS; i++) {
      const p = g.players[i];
      if (!p || p.seat !== i || !isInt(p.chips) || !isInt(p.invested) || typeof p.seen !== 'boolean') return '玩家数据非法';
      if (!['active', 'folded', 'lost'].includes(p.status)) return '玩家状态非法';
    }
    if (!isInt(g.pot) || g.pot < 0) return '公共积分非法';
    if (!LEVELS.includes(g.level)) return '基础档位非法';
    if (!isInt(g.round) || g.round < 1 || g.round > MAX_ROUNDS) return '轮次非法';
    if (!Array.isArray(g.acted) || g.acted.length !== NUM_PLAYERS || !g.acted.every((a) => typeof a === 'boolean')) return '行动标记非法';
    if (!isInt(g.turnId) || !isInt(g.version)) return '回合标识非法';
    if (g.phase !== 'playing' && g.phase !== 'settled') return '对局阶段非法';
    if (!Array.isArray(g.log)) return '行动记录非法';
    if (g.phase === 'playing' && g.currentSeat !== null && !isInt(g.currentSeat)) return '当前行动者非法';

    const inv = checkInvariants(g);
    if (inv.length) return `当前局数据不一致：${inv[0]}`;

    const expectedGames = g.phase === 'settled' ? g.gameIndex + 1 : g.gameIndex;
    if (m.games.length !== expectedGames) return '已完成局数与当前局不符';
    const sums = new Array<number>(NUM_PLAYERS).fill(0);
    for (let i = 0; i < m.games.length; i++) {
      const s = m.games[i];
      if (!s || s.gameIndex !== i || !isIntArray(s.net, NUM_PLAYERS)) return `第 ${i + 1} 局结果非法`;
      if (s.net.reduce((a, b) => a + b, 0) !== 0) return `第 ${i + 1} 局净得分之和不为 0`;
      if (!Array.isArray(s.winners) || s.winners.length === 0) return `第 ${i + 1} 局缺少获胜者`;
      s.net.forEach((v, k) => (sums[k] += v));
    }
    if (sums.some((v, k) => v !== m.scores[k])) return '本场成绩与各局结果不符';
    if (g.phase === 'settled' && g.result) {
      const last = m.games[m.games.length - 1];
      if (last.net.some((v, k) => v !== g.result!.net[k])) return '最近一局结果与结算不符';
    }
    const shouldFinish = g.phase === 'settled' && g.gameIndex === TOTAL_GAMES - 1;
    if (m.finished !== shouldFinish) return '结束标记与进度不符';
    return null;
  } catch (e) {
    return `存档解析异常：${(e as Error).message}`;
  }
}

export function saveMatch(storage: StorageLike | null, match: MatchState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(KEYS.save, JSON.stringify({ savedAt: Date.now(), match }));
    return true;
  } catch {
    return false;
  }
}

export function loadMatch(storage: StorageLike | null): LoadResult {
  if (!storage) return { status: 'none' };
  let raw: string | null;
  try {
    raw = storage.getItem(KEYS.save);
  } catch {
    return { status: 'none' };
  }
  if (raw === null) return { status: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: '存档不是有效的 JSON' };
  }
  const match = (parsed as { match?: unknown } | null)?.match;
  const err = validateMatch(match);
  if (err) return { status: 'corrupt', reason: err };
  return { status: 'ok', match: match as MatchState };
}

export function clearMatch(storage: StorageLike | null): void {
  try {
    storage?.removeItem(KEYS.save);
  } catch {
    /* 忽略 */
  }
}

function validRecord(r: unknown): r is MatchRecord {
  const x = r as MatchRecord;
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.id === 'string' &&
    isInt(x.finishedAt) &&
    isIntArray(x.scores, NUM_PLAYERS) &&
    x.scores.reduce((a, b) => a + b, 0) === 0 &&
    isIntArray(x.ranks, NUM_PLAYERS) &&
    isIntArray(x.gamesWon, NUM_PLAYERS)
  );
}

export function loadRecords(storage: StorageLike | null): { records: MatchRecord[]; corrupt: boolean } {
  if (!storage) return { records: [], corrupt: false };
  try {
    const raw = storage.getItem(KEYS.records);
    if (raw === null) return { records: [], corrupt: false };
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return { records: [], corrupt: true };
    const records = arr.filter(validRecord);
    return { records, corrupt: records.length !== arr.length };
  } catch {
    return { records: [], corrupt: true };
  }
}

export const MAX_RECORDS = 50;

/** 追加一条已完成战绩（按 id 去重），返回最新列表 */
export function appendRecord(storage: StorageLike | null, record: MatchRecord): MatchRecord[] {
  const { records } = loadRecords(storage);
  if (records.some((r) => r.id === record.id)) return records;
  const next = [record, ...records].slice(0, MAX_RECORDS);
  try {
    storage?.setItem(KEYS.records, JSON.stringify(next));
  } catch {
    /* 忽略写入失败 */
  }
  return next;
}

export function clearRecords(storage: StorageLike | null): void {
  try {
    storage?.removeItem(KEYS.records);
  } catch {
    /* 忽略 */
  }
}

export function loadSettings(storage: StorageLike | null): Settings {
  try {
    const raw = storage?.getItem(KEYS.settings);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return { speed: s.speed === 'slow' || s.speed === 'fast' || s.speed === 'normal' ? s.speed : DEFAULT_SETTINGS.speed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: StorageLike | null, settings: Settings): void {
  try {
    storage?.setItem(KEYS.settings, JSON.stringify(settings));
  } catch {
    /* 忽略 */
  }
}
