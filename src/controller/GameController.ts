// 对局控制器：连接规则引擎、电脑策略、本地保存与计时。与 React 无关，可在测试中用假计时器驱动。
import { buildObservation } from '../ai/observation';
import { decide } from '../ai/strategy';
import { SEATS } from '../config';
import { applyMatchAction, createMatch, gamesWon, ranking, startNextGame, type MatchState } from '../engine/match';
import { createCryptoRandom } from '../engine/random';
import { HUMAN_SEAT, type Action, type RandomSource } from '../engine/types';
import {
  appendRecord,
  clearMatch,
  clearRecords,
  loadMatch,
  loadRecords,
  loadSettings,
  saveMatch,
  saveSettings,
  type MatchRecord,
  type Settings,
  type Speed,
  type StorageLike,
} from '../storage/save';

export const SPEED_DELAY: Record<Speed, number> = { slow: 1500, normal: 950, fast: 450 };
export const FAST_FORWARD_DELAY = 60;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Snapshot {
  match: MatchState | null;
  paused: boolean;
  fastForward: boolean;
  settings: Settings;
  records: MatchRecord[];
  recordsCorrupt: boolean;
  /** 存档损坏的原因；null 表示没有损坏存档 */
  loadError: string | null;
  /** 电脑是否正在“思考”（已安排下一步） */
  aiPending: boolean;
}

export interface ControllerOptions {
  storage: StorageLike | null;
  rng?: RandomSource;
  aiRandom?: () => number;
  timers?: Timers;
  now?: () => number;
  newId?: () => string;
}

export type InitStatus = 'none' | 'resumable' | 'corrupt';

export class GameController {
  private storage: StorageLike | null;
  private rng: RandomSource;
  private aiRandom: () => number;
  private timers: Timers;
  private now: () => number;
  private newId: () => string;

  private match: MatchState | null = null;
  private paused = false;
  private fastForward = false;
  private running = false;
  private settings: Settings;
  private records: MatchRecord[];
  private recordsCorrupt: boolean;
  private loadError: string | null = null;
  private timer: unknown = null;
  /** 已安排的电脑步骤所针对的状态版本，触发时版本不符则作废 */
  private scheduledKey: string | null = null;

  private snap: Snapshot;
  private listeners = new Set<() => void>();

  constructor(opts: ControllerOptions) {
    this.storage = opts.storage;
    this.rng = opts.rng ?? createCryptoRandom();
    const aiRng = opts.aiRandom ? null : createCryptoRandom();
    this.aiRandom = opts.aiRandom ?? (() => aiRng!.next());
    this.timers = opts.timers ?? {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    this.now = opts.now ?? (() => Date.now());
    // 对战编号不消耗发牌随机源
    let counter = 0;
    this.newId = opts.newId ?? (() => `m${this.now().toString(36)}-${(counter++).toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`);
    this.settings = loadSettings(this.storage);
    const rec = loadRecords(this.storage);
    this.records = rec.records;
    this.recordsCorrupt = rec.corrupt;
    this.snap = this.buildSnapshot();
  }

  // ---- 订阅（供 useSyncExternalStore 使用） ----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snap;

  private buildSnapshot(): Snapshot {
    return {
      match: this.match,
      paused: this.paused,
      fastForward: this.fastForward,
      settings: this.settings,
      records: this.records,
      recordsCorrupt: this.recordsCorrupt,
      loadError: this.loadError,
      aiPending: this.timer !== null,
    };
  }

  private emit(): void {
    this.snap = this.buildSnapshot();
    this.listeners.forEach((fn) => fn());
  }

  // ---- 生命周期 ----

  /** 读取本地存档。已完成的整场会补记战绩后清除存档。 */
  init(): InitStatus {
    const r = loadMatch(this.storage);
    if (r.status === 'corrupt') {
      this.match = null;
      this.loadError = r.reason;
      this.emit();
      return 'corrupt';
    }
    if (r.status === 'none') {
      this.emit();
      return 'none';
    }
    if (r.match.finished) {
      this.recordFinished(r.match);
      clearMatch(this.storage);
      this.emit();
      return 'none';
    }
    this.match = r.match;
    this.emit();
    return 'resumable';
  }

  /** 进入对局页：开始推进电脑行动 */
  enter(): void {
    this.running = true;
    this.schedule();
    this.emit();
  }

  /** 离开对局页（存档保留）：停止推进 */
  leave(): void {
    this.running = false;
    this.cancelTimer();
    this.emit();
  }

  newMatch(): void {
    this.cancelTimer();
    this.loadError = null;
    this.paused = false;
    this.fastForward = false;
    this.match = createMatch(this.rng, this.newId(), this.now());
    saveMatch(this.storage, this.match);
    this.emit();
  }

  /** 丢弃存档（含损坏存档） */
  discardSave(): void {
    this.cancelTimer();
    this.match = null;
    this.loadError = null;
    clearMatch(this.storage);
    this.emit();
  }

  /** 整场结束后返回首页 */
  finishAndClear(): void {
    if (this.match?.finished) {
      this.recordFinished(this.match);
      this.discardSave();
    }
  }

  clearRecords(): void {
    clearRecords(this.storage);
    this.records = [];
    this.recordsCorrupt = false;
    this.emit();
  }

  setSpeed(speed: Speed): void {
    this.settings = { ...this.settings, speed };
    saveSettings(this.storage, this.settings);
    this.reschedule();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.cancelTimer();
    this.emit();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.schedule();
    this.emit();
  }

  /** 真人退出本局后的快进：只缩短等待，不改变任何规则或策略 */
  setFastForward(v: boolean): void {
    this.fastForward = v;
    this.reschedule();
  }

  // ---- 行动 ----

  humanAction(action: Action, expectedTurnId: number): { ok: boolean; error?: string } {
    if (!this.match) return { ok: false, error: '没有进行中的对局' };
    if (this.paused) return { ok: false, error: '已暂停' };
    const r = applyMatchAction(this.match, HUMAN_SEAT, action, expectedTurnId);
    if (!r.ok) return r;
    this.commit(r.match);
    return { ok: true };
  }

  nextGame(): boolean {
    if (!this.match) return false;
    const r = startNextGame(this.match, this.rng);
    if (!r.ok) return false;
    this.fastForward = false;
    this.paused = false;
    this.commit(r.match);
    return true;
  }

  private commit(m: MatchState): void {
    this.match = m;
    saveMatch(this.storage, m);
    if (m.finished) this.recordFinished(m);
    this.schedule();
    this.emit();
  }

  private recordFinished(m: MatchState): void {
    const rows = ranking(m);
    const ranks = m.scores.map((_, seat) => rows.find((r) => r.seat === seat)!.rank);
    this.records = appendRecord(this.storage, {
      id: m.id,
      finishedAt: this.now(),
      scores: m.scores.slice(),
      ranks,
      gamesWon: gamesWon(m.games),
    });
  }

  // ---- 电脑推进 ----

  private stateKey(m: MatchState): string {
    return `${m.id}:${m.game.gameIndex}:${m.game.version}`;
  }

  private delay(): number {
    if (this.fastForward) return FAST_FORWARD_DELAY;
    const base = SPEED_DELAY[this.settings.speed];
    // 电脑刚看过牌时，稍快给出结束动作
    const g = this.match?.game;
    const last = g?.log[g.log.length - 1];
    return last?.kind === 'look' && last.seat === g?.currentSeat ? Math.round(base * 0.6) : base;
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.scheduledKey = null;
  }

  private reschedule(): void {
    this.cancelTimer();
    this.schedule();
    this.emit();
  }

  private schedule(): void {
    const m = this.match;
    if (!m || !this.running || this.paused) return this.cancelTimer();
    const g = m.game;
    if (g.phase !== 'playing' || g.currentSeat === null || g.currentSeat === HUMAN_SEAT) return this.cancelTimer();
    const key = this.stateKey(m);
    if (this.timer !== null && this.scheduledKey === key) return; // 已为当前状态安排，避免重复定时器
    this.cancelTimer();
    this.scheduledKey = key;
    this.timer = this.timers.setTimeout(() => this.step(key), this.delay());
  }

  /** 执行一个电脑决策（看牌，或一个结束回合的动作）。 */
  private step(key: string): void {
    this.timer = null;
    this.scheduledKey = null;
    const m = this.match;
    if (!m || !this.running || this.paused || this.stateKey(m) !== key) return;
    const g = m.game;
    const seat = g.currentSeat;
    if (g.phase !== 'playing' || seat === null || seat === HUMAN_SEAT) return;
    const persona = SEATS[seat].persona!;
    const action = decide(buildObservation(g, seat), persona, this.aiRandom);
    let r = applyMatchAction(m, seat, action, g.turnId);
    if (!r.ok) r = applyMatchAction(m, seat, { type: 'call' }, g.turnId);
    if (!r.ok) r = applyMatchAction(m, seat, { type: 'fold' }, g.turnId);
    if (r.ok) this.commit(r.match);
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
  }
}
