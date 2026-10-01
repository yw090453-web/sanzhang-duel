import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkInvariants,
  createGame,
  createGameWithHands,
  getActionOptions,
  REASON,
} from '../src/engine/rules';
import { splitPot } from '../src/engine/settle';
import { createSeededRandom } from '../src/engine/random';
import type { Action, GameState } from '../src/engine/types';
import { h } from './helpers';

// seat0 豹子A，seat1 最小单张，seat2 同花顺，seat3 对子
const HANDS = [h('SA HA DA'), h('S2 H3 D5'), h('SK SQ SJ'), h('C9 D9 H4')];

function fresh(startSeat = 0, hands = HANDS): GameState {
  return createGameWithHands(0, startSeat, hands);
}

function act(s: GameState, seat: number, a: Action): GameState {
  const r = applyAction(s, seat, a);
  if (!r.ok) throw new Error(`动作失败 seat${seat} ${a.type}: ${r.error}`);
  expect(checkInvariants(r.state)).toEqual([]);
  return r.state;
}

/** 让当前行动者依次跟进，直到进入指定轮次 */
function callUntilRound(s: GameState, round: number): GameState {
  while (s.phase === 'playing' && s.round < round) s = act(s, s.currentSeat!, { type: 'call' });
  return s;
}

describe('开局状态', () => {
  it('初始积分、底分、档位、轮次正确', () => {
    const s = fresh(2);
    expect(s.players.map((p) => p.chips)).toEqual([990, 990, 990, 990]);
    expect(s.pot).toBe(40);
    expect(s.level).toBe(10);
    expect(s.round).toBe(1);
    expect(s.currentSeat).toBe(2);
    expect(s.players.every((p) => !p.seen && p.status === 'active' && p.invested === 10)).toBe(true);
    expect(s.log.filter((e) => e.kind === 'ante')).toHaveLength(1);
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('看牌与费用', () => {
  it('看牌不结束回合、不扣分，费用立即更新', () => {
    let s = fresh();
    const before = getActionOptions(s, 0);
    expect(before.call.cost).toBe(10);
    expect(before.raise.cost).toBe(20);
    s = act(s, 0, { type: 'look' });
    expect(s.currentSeat).toBe(0);
    expect(s.turnId).toBe(0);
    expect(s.players[0].chips).toBe(990);
    expect(s.players[0].seen).toBe(true);
    const after = getActionOptions(s, 0);
    expect(after.call.cost).toBe(20);
    expect(after.raise.cost).toBe(40);
    expect(after.look.allowed).toBe(false);
    // 看牌不可重复
    expect(applyAction(s, 0, { type: 'look' }).ok).toBe(false);
  });

  it('跟进扣分：未看牌=档位，已看牌=档位×2，且不追补差额', () => {
    let s = fresh();
    s = act(s, 0, { type: 'call' });
    expect(s.players[0].chips).toBe(980);
    s = act(s, 1, { type: 'look' });
    s = act(s, 1, { type: 'call' });
    expect(s.players[1].chips).toBe(970);
    expect(s.pot).toBe(70);
  });

  it('加码只提高一级，按新档位与看牌状态扣费，不额外扣跟进费', () => {
    let s = fresh();
    s = act(s, 0, { type: 'raise' }); // 10→20，未看牌 20
    expect(s.level).toBe(20);
    expect(s.players[0].chips).toBe(970);
    s = act(s, 1, { type: 'look' });
    expect(getActionOptions(s, 1).raise).toMatchObject({ allowed: true, cost: 80, newLevel: 40 });
    s = act(s, 1, { type: 'raise' }); // 20→40，已看牌 80
    expect(s.level).toBe(40);
    expect(s.players[1].chips).toBe(910);
    const o = getActionOptions(s, 2);
    expect(o.raise.allowed).toBe(false);
    expect(o.raise.reason).toBe(REASON.maxLevel);
    expect(applyAction(s, 2, { type: 'raise' }).ok).toBe(false);
    expect(o.call.cost).toBe(40);
  });

  it('比牌费用 = 跟进费用×2，替代跟进，不另收跟进费；被挑战者不付费', () => {
    for (const [level, cost] of [
      [10, 40],
      [20, 80],
      [40, 160],
    ] as const) {
      let s = fresh();
      s = callUntilRound(s, 2);
      while (s.level < level) s = act(s, s.currentSeat!, { type: 'raise' });
      // 推进到 seat3（仍在第 2 轮），看牌后比牌
      while (s.currentSeat !== 3) s = act(s, s.currentSeat!, { type: 'call' });
      s = act(s, 3, { type: 'look' });
      expect(getActionOptions(s, 3).compare.cost).toBe(cost);
      const chips3 = s.players[3].chips;
      const chips1 = s.players[1].chips;
      const pot = s.pot;
      s = act(s, 3, { type: 'compare', target: 1 });
      expect(s.players[3].chips).toBe(chips3 - cost);
      expect(s.players[1].chips).toBe(chips1);
      expect(s.pot).toBe(pot + cost);
    }
  });
});

describe('比牌规则', () => {
  it('第1轮禁止比牌（即使已看牌）', () => {
    let s = act(fresh(), 0, { type: 'look' });
    const o = getActionOptions(s, 0);
    expect(o.compare.allowed).toBe(false);
    expect(o.compare.reason).toBe(REASON.round2);
    const r = applyAction(s, 0, { type: 'compare', target: 1 });
    expect(r.ok).toBe(false);
  });

  it('未看牌者不能主动比牌', () => {
    const s = callUntilRound(fresh(), 2);
    const o = getActionOptions(s, 0);
    expect(o.compare.reason).toBe(REASON.mustLook);
    // 显示的比牌费用按已看牌计算（发起者必须已看牌）
    expect(o.compare.cost).toBe(40);
    expect(applyAction(s, 0, { type: 'compare', target: 1 }).ok).toBe(false);
  });

  it('不能挑战自己或已退出者', () => {
    let s = fresh();
    s = act(s, 0, { type: 'call' });
    s = act(s, 1, { type: 'fold' });
    s = act(s, 2, { type: 'call' });
    s = act(s, 3, { type: 'call' });
    s = act(s, 0, { type: 'look' });
    expect(getActionOptions(s, 0).compare.targets).toEqual([2, 3]);
    const snapshot = JSON.stringify(s);
    expect(applyAction(s, 0, { type: 'compare', target: 0 }).ok).toBe(false);
    expect(applyAction(s, 0, { type: 'compare', target: 1 }).ok).toBe(false);
    expect(applyAction(s, 0, { type: 'compare', target: 9 }).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('牌力小者出局；胜者不获得额外行动；未看牌的被挑战者获胜后仍未看牌', () => {
    let s = callUntilRound(fresh(), 2);
    s = act(s, 0, { type: 'call' });
    s = act(s, 1, { type: 'look' });
    s = act(s, 1, { type: 'compare', target: 2 }); // 单张 vs 同花顺
    expect(s.players[1].status).toBe('lost');
    expect(s.players[2].status).toBe('active');
    expect(s.players[2].seen).toBe(false);
    expect(s.currentSeat).toBe(2); // 2 本轮尚未行动，正常轮到它，而非额外奖励
    const last = s.log[s.log.length - 1];
    expect(last).toMatchObject({ kind: 'compare', seat: 1, target: 2, winner: 2, loser: 1 });
    expect(JSON.stringify(last)).not.toMatch(/rank|suit/);
  });

  it('主动比牌同牌力时发起者落败', () => {
    const hands = [h('SA HK D9'), h('CA DK H9'), h('S2 H3 D5'), h('C2 D3 H6')];
    let s = callUntilRound(fresh(0, hands), 2);
    s = act(s, 0, { type: 'look' });
    s = act(s, 0, { type: 'compare', target: 1 });
    expect(s.players[0].status).toBe('lost');
    expect(s.players[1].status).toBe('active');
  });
});

describe('轮次与座次', () => {
  it('加码不重开本轮，已行动者不重复行动', () => {
    let s = fresh();
    s = act(s, 0, { type: 'call' });
    s = act(s, 1, { type: 'raise' });
    s = act(s, 2, { type: 'call' });
    expect(s.round).toBe(1);
    s = act(s, 3, { type: 'call' });
    expect(s.round).toBe(2);
    expect(s.currentSeat).toBe(0);
    expect(s.players[0].invested).toBe(20); // 没有补差额
  });

  it('本轮未行动但已被比牌淘汰者被跳过', () => {
    let s = callUntilRound(fresh(), 2);
    s = act(s, 0, { type: 'look' });
    s = act(s, 0, { type: 'compare', target: 1 });
    expect(s.players[1].status).toBe('lost');
    expect(s.currentSeat).toBe(2);
    s = act(s, 2, { type: 'call' });
    s = act(s, 3, { type: 'call' });
    expect(s.round).toBe(3);
    expect(s.currentSeat).toBe(0);
  });

  it('起始玩家出局不会打乱顺序', () => {
    let s = fresh(2);
    s = act(s, 2, { type: 'fold' });
    expect(s.currentSeat).toBe(3);
    s = act(s, 3, { type: 'call' });
    s = act(s, 0, { type: 'call' });
    s = act(s, 1, { type: 'call' });
    expect(s.round).toBe(2);
    expect(s.currentSeat).toBe(3);
    s = act(s, 3, { type: 'call' });
    expect(s.currentSeat).toBe(0);
  });

  it('每名玩家一轮最多执行一次结束回合的动作', () => {
    let s = fresh();
    s = act(s, 0, { type: 'call' });
    expect(applyAction(s, 0, { type: 'call' }).ok).toBe(false);
  });
});

describe('结束条件与结算', () => {
  it('只剩 1 人时立即结算，赢家获得全部公共积分', () => {
    let s = fresh();
    s = act(s, 0, { type: 'call' });
    s = act(s, 1, { type: 'fold' });
    s = act(s, 2, { type: 'fold' });
    s = act(s, 3, { type: 'fold' });
    expect(s.phase).toBe('settled');
    expect(s.result?.winners).toEqual([0]);
    expect(s.result?.method).toBe('others_out');
    expect(s.pot).toBe(0);
    expect(s.players[0].chips).toBe(1030);
    expect(s.result?.net).toEqual([30, -10, -10, -10]);
    // 结算后任何动作都无效
    expect(applyAction(s, 0, { type: 'call' }).ok).toBe(false);
  });

  it('主动比牌后仅剩一人，方式标记为比牌', () => {
    let s = fresh();
    s = act(s, 0, { type: 'call' });
    s = act(s, 1, { type: 'fold' });
    s = act(s, 2, { type: 'fold' });
    s = act(s, 3, { type: 'call' });
    s = act(s, 0, { type: 'look' });
    s = act(s, 0, { type: 'compare', target: 3 });
    expect(s.phase).toBe('settled');
    expect(s.result?.method).toBe('compare');
    expect(s.result?.winners).toEqual([0]);
    expect(s.result?.net.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('第 6 轮结束时自动摊牌，只在留场者中比较', () => {
    let s = fresh();
    s = act(s, 0, { type: 'fold' }); // 豹子弃牌，不参与摊牌
    s = callUntilRound(s, 7);
    expect(s.phase).toBe('settled');
    expect(s.round).toBe(6);
    expect(s.result?.method).toBe('showdown');
    expect(s.result?.showdownSeats).toEqual([1, 2, 3]);
    expect(s.result?.winners).toEqual([2]);
    expect(s.log.filter((e) => e.kind === 'settle')).toHaveLength(1);
    // 40 底分 + 6 轮 × 3 人 × 10
    expect(s.result?.gained[2]).toBe(220);
  });

  it('最终摊牌同牌力并列获胜，平分积分并按座次分配余数', () => {
    const hands = [h('SA HK D9'), h('CA DK H9'), h('HA SK C9'), h('C2 D3 H6')];
    let s = fresh(1, hands);
    s = act(s, 1, { type: 'call' });
    s = act(s, 2, { type: 'call' });
    s = act(s, 3, { type: 'fold' });
    s = callUntilRound(s, 7);
    expect(s.result?.winners).toEqual([0, 1, 2]);
    // 底分 40 + 6 轮 × 3 人 × 10 = 220，220 = 73×3 + 1，余 1 从起始座位 1 开始分
    expect(s.result?.gained).toEqual([73, 74, 73, 0]);
    expect(s.result?.net.reduce((a, b) => a + b, 0)).toBe(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('splitPot 余数只分给获胜者', () => {
    expect(splitPot(100, [0, 1, 3], 2)).toEqual([33, 33, 0, 34]);
    expect(splitPot(50, [0, 1, 2], 3)).toEqual([17, 17, 16, 0]);
    expect(splitPot(40, [1, 3], 0)).toEqual([0, 20, 0, 20]);
  });
});

describe('非法与重复操作', () => {
  it('非当前玩家、过期回合标识、未知动作都不改变状态', () => {
    const s = fresh();
    const snap = JSON.stringify(s);
    expect(applyAction(s, 1, { type: 'call' }).ok).toBe(false);
    expect(applyAction(s, 0, { type: 'call' }, 5).ok).toBe(false);
    expect(applyAction(s, 0, { type: 'bogus' } as unknown as Action).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('同一回合标识重复提交只生效一次', () => {
    let s = fresh();
    const turn = s.turnId;
    const r1 = applyAction(s, 0, { type: 'call' }, turn);
    expect(r1.ok).toBe(true);
    s = (r1 as { state: GameState }).state;
    const r2 = applyAction(s, 0, { type: 'call' }, turn);
    expect(r2.ok).toBe(false);
    expect(s.players[0].chips).toBe(980);
  });

  it('随机合法/非法动作混合：每步都守恒且无负积分', () => {
    const rng = createSeededRandom(2024);
    const actions: Action[] = [
      { type: 'look' },
      { type: 'call' },
      { type: 'raise' },
      { type: 'fold' },
      { type: 'compare', target: 0 },
      { type: 'compare', target: 1 },
      { type: 'compare', target: 2 },
      { type: 'compare', target: 3 },
    ];
    for (let g = 0; g < 300; g++) {
      let s = createGame(0, g % 4, rng);
      let guard = 0;
      while (s.phase === 'playing' && guard++ < 500) {
        const seat = rng.nextInt(4);
        const a = actions[rng.nextInt(actions.length)];
        // 降低弃牌频率，让更多对局走到后面的轮次
        if (a.type === 'fold' && rng.next() < 0.8) continue;
        const r = applyAction(s, seat, a);
        if (r.ok) {
          s = r.state;
          expect(checkInvariants(s)).toEqual([]);
        }
      }
      expect(s.phase).toBe('settled');
      expect(s.result!.net.reduce((a, b) => a + b, 0)).toBe(0);
      expect(s.players.every((p) => p.chips >= 0)).toBe(true);
    }
  });
});
