// 核心类型与常量。规则引擎只依赖这里的数据结构，不依赖任何界面代码。

export type Suit = 'S' | 'H' | 'D' | 'C';

/** 点数：2..14，其中 11=J，12=Q，13=K，14=A */
export interface Card {
  rank: number;
  suit: Suit;
}

export type Level = 10 | 20 | 40;
export const LEVELS: readonly Level[] = [10, 20, 40];

export const NUM_PLAYERS = 4;
export const START_CHIPS = 1000;
export const ANTE = 10;
export const MAX_ROUNDS = 6;
export const TOTAL_GAMES = 8;
export const HUMAN_SEAT = 0;
/** 每局进行中：四人余额 + 公共积分池 恒等于此值 */
export const TOTAL_POINTS = NUM_PLAYERS * START_CHIPS;

/** active=仍在局内；folded=弃牌；lost=比牌落败 */
export type PlayerStatus = 'active' | 'folded' | 'lost';

export interface PlayerState {
  seat: number;
  /** 局内积分（余额） */
  chips: number;
  seen: boolean;
  status: PlayerStatus;
  /** 本局已投入（含底分） */
  invested: number;
}

export type Action =
  | { type: 'look' }
  | { type: 'call' }
  | { type: 'raise' }
  | { type: 'fold' }
  | { type: 'compare'; target: number };

export type ActionType = Action['type'];

export type LogKind = 'ante' | 'round' | 'look' | 'call' | 'raise' | 'fold' | 'compare' | 'settle';

/** 公开行动记录：只包含所有人都能看到的信息，绝不包含牌面。 */
export interface LogEntry {
  seq: number;
  round: number;
  kind: LogKind;
  seat: number | null;
  /** 本次行动实际支付的积分 */
  cost: number;
  /** 行动完成后的基础档位 */
  level: Level;
  /** 行动时是否已看牌（用于复盘展示“闷跟/看跟”） */
  seen?: boolean;
  target?: number;
  winner?: number;
  loser?: number;
  winners?: number[];
  amount?: number;
  method?: WinMethod;
}

/** others_out=其余玩家弃牌退出；compare=主动比牌后仅剩一人；showdown=最终摊牌 */
export type WinMethod = 'others_out' | 'compare' | 'showdown';

export interface GameResult {
  winners: number[];
  method: WinMethod;
  invested: number[];
  gained: number[];
  net: number[];
  finalChips: number[];
  /** 参与最终摊牌的座位（非摊牌结束时为空） */
  showdownSeats: number[];
}

export interface GameState {
  gameIndex: number;
  startSeat: number;
  /** 暗牌。只能由规则引擎在比牌/摊牌时读取，电脑策略永远拿不到这个字段。 */
  hands: Card[][];
  players: PlayerState[];
  pot: number;
  level: Level;
  round: number;
  /** 本轮是否已执行过结束回合的动作 */
  acted: boolean[];
  currentSeat: number | null;
  /** 回合标识：每次结束回合的动作后递增，用于拒绝过期/重复提交 */
  turnId: number;
  /** 状态版本：每次有效动作（含看牌）后递增 */
  version: number;
  phase: 'playing' | 'settled';
  log: LogEntry[];
  result: GameResult | null;
}

export interface RandomSource {
  /** 返回 [0, n) 的均匀整数 */
  nextInt(n: number): number;
  /** 返回 [0, 1) 的浮点数 */
  next(): number;
}
