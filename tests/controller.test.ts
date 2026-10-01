import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameController, SPEED_DELAY } from '../src/controller/GameController';
import { createSeededRandom } from '../src/engine/random';
import { KEYS, loadMatch } from '../src/storage/save';
import { HUMAN_SEAT } from '../src/engine/types';
import { MemoryStorage } from './helpers';

const DELAY = SPEED_DELAY.normal;

function makeController(storage: MemoryStorage, seed: number) {
  const aiRng = createSeededRandom(seed * 7 + 1);
  let t = 1_000_000;
  return new GameController({
    storage,
    rng: createSeededRandom(seed),
    aiRandom: () => aiRng.next(),
    now: () => (t += 1000),
  });
}

/** 找一个第一局起始座位是电脑的种子 */
function seedWithAiStart(): number {
  for (let s = 1; s < 100; s++) if (createSeededRandom(s).nextInt(4) !== HUMAN_SEAT) return s;
  throw new Error('no seed');
}

function seedWithHumanStart(): number {
  for (let s = 1; s < 100; s++) if (createSeededRandom(s).nextInt(4) === HUMAN_SEAT) return s;
  throw new Error('no seed');
}

/** 真人一直跟进，其余由电脑推进，直到当前局结算 */
function playOutGame(c: GameController): void {
  for (let guard = 0; guard < 500; guard++) {
    const m = c.getSnapshot().match!;
    if (m.game.phase === 'settled') return;
    if (m.game.currentSeat === HUMAN_SEAT) {
      expect(c.humanAction({ type: 'call' }, m.game.turnId).ok).toBe(true);
    } else {
      vi.advanceTimersByTime(DELAY + 10);
    }
  }
  throw new Error('game did not finish');
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('控制器：电脑推进、暂停与重复操作', () => {
  it('暂停期间电脑不行动，恢复后每个间隔只行动一次', () => {
    const c = makeController(new MemoryStorage(), seedWithAiStart());
    c.newMatch();
    c.enter();
    const v0 = c.getSnapshot().match!.game.version;
    c.pause();
    vi.advanceTimersByTime(20_000);
    expect(c.getSnapshot().match!.game.version).toBe(v0);
    c.resume();
    c.resume(); // 重复恢复不产生额外定时器
    vi.advanceTimersByTime(DELAY - 50);
    expect(c.getSnapshot().match!.game.version).toBe(v0);
    vi.advanceTimersByTime(60);
    expect(c.getSnapshot().match!.game.version).toBe(v0 + 1);
  });

  it('重复 enter / 重复安排不会产生多个定时器', () => {
    const c = makeController(new MemoryStorage(), seedWithAiStart());
    c.newMatch();
    c.enter();
    c.enter();
    c.enter();
    const v0 = c.getSnapshot().match!.game.version;
    vi.advanceTimersByTime(DELAY + 5);
    expect(c.getSnapshot().match!.game.version).toBe(v0 + 1);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  });

  it('离开对局页后电脑停止推进', () => {
    const c = makeController(new MemoryStorage(), seedWithAiStart());
    c.newMatch();
    c.enter();
    const v0 = c.getSnapshot().match!.game.version;
    c.leave();
    vi.advanceTimersByTime(20_000);
    expect(c.getSnapshot().match!.game.version).toBe(v0);
  });

  it('真人连续点击只生效一次', () => {
    const c = makeController(new MemoryStorage(), seedWithHumanStart());
    c.newMatch();
    c.enter();
    const g = c.getSnapshot().match!.game;
    expect(g.currentSeat).toBe(HUMAN_SEAT);
    const turn = g.turnId;
    expect(c.humanAction({ type: 'call' }, turn).ok).toBe(true);
    expect(c.humanAction({ type: 'call' }, turn).ok).toBe(false);
    expect(c.humanAction({ type: 'raise' }, turn).ok).toBe(false);
    const after = c.getSnapshot().match!.game;
    expect(after.players[HUMAN_SEAT].chips).toBe(980);
    expect(after.pot).toBe(50);
  });

  it('非真人回合时真人操作被拒绝', () => {
    const c = makeController(new MemoryStorage(), seedWithAiStart());
    c.newMatch();
    const g = c.getSnapshot().match!.game;
    expect(c.humanAction({ type: 'call' }, g.turnId).ok).toBe(false);
    expect(c.getSnapshot().match!.game).toBe(g);
  });

  it('结算后处于暂停状态时，开始下一局会解除暂停，电脑继续推进', () => {
    const c = makeController(new MemoryStorage(), 8);
    c.newMatch();
    c.enter();
    playOutGame(c);
    c.pause();
    expect(c.nextGame()).toBe(true);
    expect(c.getSnapshot().paused).toBe(false);
    const g = c.getSnapshot().match!.game;
    if (g.currentSeat !== HUMAN_SEAT) {
      vi.advanceTimersByTime(DELAY + 10);
      expect(c.getSnapshot().match!.game.version).toBe(g.version + 1);
    }
  });

  it('可以完整打完 8 局并写入一次战绩', () => {
    const storage = new MemoryStorage();
    const c = makeController(storage, 3);
    c.newMatch();
    c.enter();
    for (let i = 0; i < 8; i++) {
      playOutGame(c);
      if (i < 7) {
        expect(c.nextGame()).toBe(true);
        expect(c.nextGame()).toBe(false);
      }
    }
    const m = c.getSnapshot().match!;
    expect(m.finished).toBe(true);
    expect(c.getSnapshot().records).toHaveLength(1);
    c.finishAndClear();
    expect(c.getSnapshot().records).toHaveLength(1);
    expect(storage.getItem(KEYS.save)).toBeNull();
  });
});

describe('控制器：刷新恢复', () => {
  it('恢复后不重新发牌、不重复扣底分、不重复已完成动作', () => {
    const storage = new MemoryStorage();
    const a = makeController(storage, seedWithAiStart());
    a.newMatch();
    a.enter();
    vi.advanceTimersByTime((DELAY + 10) * 2);
    const before = a.getSnapshot().match!;
    a.dispose(); // 模拟页面关闭

    const b = makeController(storage, 42); // 不同随机源：若重新发牌必然不同
    expect(b.init()).toBe('resumable');
    const restored = b.getSnapshot().match!;
    expect(restored).toEqual(before);
    expect(restored.game.log.filter((e) => e.kind === 'ante')).toHaveLength(1);
    const sum = restored.game.players.reduce((s, p) => s + p.chips, 0) + restored.game.pot;
    expect(sum).toBe(4000);
  });

  it('已结算的局恢复后不重复结算，下一局只开一次', () => {
    const storage = new MemoryStorage();
    const a = makeController(storage, 8);
    a.newMatch();
    a.enter();
    playOutGame(a);
    const settled = a.getSnapshot().match!;
    a.dispose();

    const b = makeController(storage, 9);
    b.init();
    b.enter();
    vi.advanceTimersByTime(10_000);
    const m = b.getSnapshot().match!;
    expect(m.games).toHaveLength(1);
    expect(m.scores).toEqual(settled.scores);
    expect(b.nextGame()).toBe(true);
    expect(b.getSnapshot().match!.game.gameIndex).toBe(1);
    expect(b.getSnapshot().match!.scores).toEqual(settled.scores);
  });

  it('存档损坏时给出提示，不恢复也不写入战绩', () => {
    const storage = new MemoryStorage();
    storage.setItem(KEYS.save, '{not json');
    const c = makeController(storage, 1);
    expect(c.init()).toBe('corrupt');
    expect(c.getSnapshot().loadError).toBeTruthy();
    expect(c.getSnapshot().match).toBeNull();
    expect(c.getSnapshot().records).toHaveLength(0);
    c.discardSave();
    expect(storage.getItem(KEYS.save)).toBeNull();
  });

  it('被篡改的存档（积分不守恒、重复牌、成绩不符）被识别为损坏', () => {
    const storage = new MemoryStorage();
    const a = makeController(storage, 2);
    a.newMatch();
    const raw = storage.getItem(KEYS.save)!;

    const tamper = (fn: (o: any) => void) => {
      const o = JSON.parse(raw);
      fn(o.match);
      storage.setItem(KEYS.save, JSON.stringify(o));
      return loadMatch(storage).status;
    };
    expect(tamper(() => {})).toBe('ok');
    expect(tamper((m) => (m.game.players[1].chips += 100))).toBe('corrupt');
    expect(tamper((m) => (m.game.hands[1][0] = { ...m.game.hands[0][0] }))).toBe('corrupt');
    expect(tamper((m) => (m.scores[0] = 500))).toBe('corrupt');
    expect(tamper((m) => (m.game.players[2].chips = -10))).toBe('corrupt');
    expect(tamper((m) => (m.game.level = 30))).toBe('corrupt');
  });
});
