// 电脑的“可观察状态”：只包含该电脑有权知道的信息。
// 策略函数只接收 Observation，永远拿不到 GameState（其中含全部暗牌）。
import { getActionOptions, type ActionOptions } from '../engine/rules';
import { MAX_ROUNDS, type Card, type GameState, type Level, type LogEntry, type PlayerStatus } from '../engine/types';

export interface PublicPlayer {
  seat: number;
  chips: number;
  seen: boolean;
  status: PlayerStatus;
  invested: number;
}

export interface Observation {
  seat: number;
  chips: number;
  seen: boolean;
  /** 自己已看过的手牌；未看牌时必须为 null */
  hand: Card[] | null;
  players: PublicPlayer[];
  pot: number;
  level: Level;
  round: number;
  maxRounds: number;
  startSeat: number;
  history: LogEntry[];
  options: ActionOptions;
}

export function buildObservation(state: GameState, seat: number): Observation {
  const me = state.players[seat];
  const obs: Observation = {
    seat,
    chips: me.chips,
    seen: me.seen,
    hand: me.seen ? state.hands[seat].map((c) => ({ rank: c.rank, suit: c.suit })) : null,
    players: state.players.map((p) => ({
      seat: p.seat,
      chips: p.chips,
      seen: p.seen,
      status: p.status,
      invested: p.invested,
    })),
    pot: state.pot,
    level: state.level,
    round: state.round,
    maxRounds: MAX_ROUNDS,
    startSeat: state.startSeat,
    history: state.log.map((e) => ({ ...e })),
    options: getActionOptions(state, seat),
  };
  // 深拷贝，确保策略函数无法通过引用改写真实状态
  return JSON.parse(JSON.stringify(obs)) as Observation;
}
