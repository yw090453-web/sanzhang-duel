// 一场（8 局）的管理：起始座位轮换、本场成绩累计、排名。
import { applyAction, createGame, type ApplyResult } from './rules';
import { NUM_PLAYERS, TOTAL_GAMES, type Action, type GameState, type RandomSource, type WinMethod } from './types';

export const MATCH_SCHEMA = 1;

export interface GameSummary {
  gameIndex: number;
  startSeat: number;
  winners: number[];
  method: WinMethod;
  invested: number[];
  gained: number[];
  net: number[];
}

export interface MatchState {
  schema: typeof MATCH_SCHEMA;
  id: string;
  createdAt: number;
  firstStartSeat: number;
  /** 已完成各局的摘要（结算时写入且只写一次） */
  games: GameSummary[];
  /** 本场成绩：已完成各局净得分之和 */
  scores: number[];
  game: GameState;
  finished: boolean;
}

export type MatchResult = { ok: true; match: MatchState } | { ok: false; error: string };

export function startSeatFor(firstStartSeat: number, gameIndex: number): number {
  return (firstStartSeat + gameIndex) % NUM_PLAYERS;
}

export function createMatch(rng: RandomSource, id: string, now: number): MatchState {
  const firstStartSeat = rng.nextInt(NUM_PLAYERS);
  return {
    schema: MATCH_SCHEMA,
    id,
    createdAt: now,
    firstStartSeat,
    games: [],
    scores: new Array<number>(NUM_PLAYERS).fill(0),
    game: createGame(0, firstStartSeat, rng),
    finished: false,
  };
}

/** 若当前局已结算且尚未计入本场成绩，则计入（幂等） */
function recordIfSettled(m: MatchState): MatchState {
  const g = m.game;
  if (g.phase !== 'settled' || !g.result || m.games.length !== g.gameIndex) return m;
  const r = g.result;
  const summary: GameSummary = {
    gameIndex: g.gameIndex,
    startSeat: g.startSeat,
    winners: r.winners.slice(),
    method: r.method,
    invested: r.invested.slice(),
    gained: r.gained.slice(),
    net: r.net.slice(),
  };
  return {
    ...m,
    games: [...m.games, summary],
    scores: m.scores.map((s, i) => s + r.net[i]),
    finished: g.gameIndex >= TOTAL_GAMES - 1,
  };
}

export function applyMatchAction(m: MatchState, seat: number, action: Action, expectedTurnId?: number): MatchResult {
  if (m.finished) return { ok: false, error: '本场已结束' };
  const r: ApplyResult = applyAction(m.game, seat, action, expectedTurnId);
  if (!r.ok) return r;
  return { ok: true, match: recordIfSettled({ ...m, game: r.state }) };
}

export function canStartNextGame(m: MatchState): boolean {
  return !m.finished && m.game.phase === 'settled' && m.games.length === m.game.gameIndex + 1;
}

export function startNextGame(m: MatchState, rng: RandomSource): MatchResult {
  if (!canStartNextGame(m)) return { ok: false, error: '当前不能开始下一局' };
  const gameIndex = m.game.gameIndex + 1;
  return { ok: true, match: { ...m, game: createGame(gameIndex, startSeatFor(m.firstStartSeat, gameIndex), rng) } };
}

export interface RankRow {
  seat: number;
  score: number;
  rank: number;
  gamesWon: number;
}

/** 按本场成绩从高到低；同分并列（1,1,3 式），不以获胜局数作为额外依据 */
export function ranking(m: Pick<MatchState, 'scores' | 'games'>): RankRow[] {
  const won = gamesWon(m.games);
  const rows = m.scores.map((score, seat) => ({
    seat,
    score,
    rank: 1 + m.scores.filter((x) => x > score).length,
    gamesWon: won[seat],
  }));
  return rows.sort((a, b) => a.rank - b.rank || a.seat - b.seat);
}

/** 获胜局数（并列获胜也计为获胜一局），仅用于展示 */
export function gamesWon(games: readonly GameSummary[]): number[] {
  const won = new Array<number>(NUM_PLAYERS).fill(0);
  for (const g of games) for (const w of g.winners) won[w] += 1;
  return won;
}
