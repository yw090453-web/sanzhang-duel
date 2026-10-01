// 三种风格的电脑策略：可调参数 + 随机化启发式。
// 输入只有 Observation（可观察状态）和随机数函数，因此：
// - 未看牌时拿不到任何手牌信息；
// - 看牌后只能评估自己的手牌；
// - 任何时候都拿不到其他人的暗牌。
import { handPercentile } from '../engine/hand';
import type { Action } from '../engine/types';
import type { Observation } from './observation';

export type Persona = 'cautious' | 'balanced' | 'aggressive';

export interface PersonaParams {
  /** 未看牌时第 1 轮选择看牌的基础概率 */
  lookBase: number;
  /** 每多一轮增加的看牌概率 */
  lookPerRound: number;
  /** 档位升高时额外增加的看牌概率（40 档取全额，20 档取一半） */
  lookHighLevel: number;
  /** 闷牌时加码的概率 */
  blindRaise: number;
  /** 高档位后期闷牌弃牌的概率 */
  blindFoldLate: number;
  /** 估计胜率低于此值倾向弃牌 */
  foldBelow: number;
  /** 估计胜率高于此值倾向加码 */
  raiseAbove: number;
  /** 单挑胜率高于此值才考虑比牌 */
  compareAbove: number;
  /** 满足条件时实际发起比牌的概率 */
  compareRate: number;
  /** 弱牌仍继续行动的概率 */
  bluff: number;
  /** 非强牌时仍加码的概率 */
  bluffRaise: number;
  /** 胜率估计的随机扰动幅度 */
  noise: number;
  /** 对手公开加码/比牌胜利对胜率估计的压低系数 */
  pressureWeight: number;
  /** 行动费用占比对弃牌阈值的影响 */
  potOddsWeight: number;
}

export const PERSONAS: Record<Persona, PersonaParams> = {
  cautious: {
    lookBase: 0.6,
    lookPerRound: 0.25,
    lookHighLevel: 0.2,
    blindRaise: 0.03,
    blindFoldLate: 0.08,
    foldBelow: 0.38,
    raiseAbove: 0.82,
    compareAbove: 0.62,
    compareRate: 0.35,
    bluff: 0.04,
    bluffRaise: 0,
    noise: 0.08,
    pressureWeight: 0.06,
    potOddsWeight: 0.4,
  },
  balanced: {
    lookBase: 0.3,
    lookPerRound: 0.18,
    lookHighLevel: 0.2,
    blindRaise: 0.1,
    blindFoldLate: 0.03,
    foldBelow: 0.28,
    raiseAbove: 0.68,
    compareAbove: 0.56,
    compareRate: 0.45,
    bluff: 0.1,
    bluffRaise: 0.03,
    noise: 0.12,
    pressureWeight: 0.045,
    potOddsWeight: 0.3,
  },
  aggressive: {
    lookBase: 0.1,
    lookPerRound: 0.1,
    lookHighLevel: 0.15,
    blindRaise: 0.3,
    blindFoldLate: 0,
    foldBelow: 0.18,
    raiseAbove: 0.55,
    compareAbove: 0.52,
    compareRate: 0.5,
    bluff: 0.22,
    bluffRaise: 0.1,
    noise: 0.16,
    pressureWeight: 0.025,
    potOddsWeight: 0.2,
  },
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** 根据公开行动估计某个对手的“威胁度”（0~1） */
function threatOf(obs: Observation, seat: number): number {
  let raises = 0;
  let compareWins = 0;
  for (const e of obs.history) {
    if (e.kind === 'raise' && e.seat === seat) raises += e.seen ? 1 : 0.5;
    if (e.kind === 'compare' && e.winner === seat) compareWins += 1;
  }
  const seen = obs.players[seat].seen ? 0.15 : 0;
  return clamp01(0.25 + seen + raises * 0.2 + compareWins * 0.15);
}

/** 保证返回合法动作：首选不合法时依次退回跟进、弃牌 */
function legalize(obs: Observation, a: Action): Action {
  const o = obs.options;
  const ok =
    (a.type === 'look' && o.look.allowed) ||
    (a.type === 'call' && o.call.allowed) ||
    (a.type === 'raise' && o.raise.allowed) ||
    (a.type === 'fold' && o.fold.allowed) ||
    (a.type === 'compare' && o.compare.allowed && o.compare.targets.includes(a.target));
  if (ok) return a;
  if (o.call.allowed) return { type: 'call' };
  return { type: 'fold' };
}

function decideBlind(obs: Observation, p: PersonaParams, rand: () => number): Action {
  const o = obs.options;
  const levelBoost = obs.level === 40 ? p.lookHighLevel : obs.level === 20 ? p.lookHighLevel / 2 : 0;
  const pLook = p.lookBase + p.lookPerRound * (obs.round - 1) + levelBoost;
  if (o.look.allowed && rand() < pLook) return { type: 'look' };
  if (obs.level === 40 && obs.round >= 4 && rand() < p.blindFoldLate) return { type: 'fold' };
  if (o.raise.allowed && rand() < p.blindRaise) return { type: 'raise' };
  return { type: 'call' };
}

function decideSeen(obs: Observation, p: PersonaParams, rand: () => number): Action {
  const o = obs.options;
  const hand = obs.hand!;
  const s = handPercentile(hand);
  const opps = obs.players.filter((x) => x.seat !== obs.seat && x.status === 'active').map((x) => x.seat);
  const oppCount = Math.max(1, opps.length);

  let pressure = 0;
  for (const e of obs.history) {
    if (e.seat === null || !opps.includes(e.seat)) continue;
    if (e.kind === 'raise') pressure += e.seen ? 1 : 0.4;
  }
  for (const e of obs.history) if (e.kind === 'compare' && e.winner !== undefined && opps.includes(e.winner)) pressure += 0.6;

  const est = Math.pow(s, 1 + (oppCount - 1) * 0.8) - pressure * p.pressureWeight + (rand() - 0.5) * p.noise;
  const odds = o.call.cost / (obs.pot + o.call.cost);
  const foldThr = p.foldBelow + p.potOddsWeight * (odds - 0.15);

  if (est < foldThr && rand() >= p.bluff) return { type: 'fold' };

  if (o.compare.allowed) {
    // 选威胁度最低的对手
    let target = o.compare.targets[0];
    let best = Infinity;
    for (const t of o.compare.targets) {
      const th = threatOf(obs, t);
      if (th < best) {
        best = th;
        target = t;
      }
    }
    const headsUp = s - best * 0.15;
    const monster = s > 0.95 && obs.round < obs.maxRounds - 1 && rand() < 0.6;
    const marginal = est < foldThr + 0.1 && headsUp >= 0.5 && obs.round >= 3;
    const r = rand();
    if (!monster && headsUp >= p.compareAbove && (r < p.compareRate || (oppCount === 1 && obs.round >= 4))) {
      return { type: 'compare', target };
    }
    if (marginal && r < p.compareRate) return { type: 'compare', target };
  }

  if (o.raise.allowed) {
    if (est >= p.raiseAbove && rand() < 0.7) return { type: 'raise' };
    if (rand() < p.bluffRaise) return { type: 'raise' };
  }
  return { type: 'call' };
}

/**
 * 电脑决策：返回一个动作。可能返回“看牌”；调用方执行看牌后应基于新的可观察状态再次调用。
 */
export function decide(obs: Observation, persona: Persona, rand: () => number): Action {
  const p = PERSONAS[persona];
  const choice = obs.seen && obs.hand ? decideSeen(obs, p, rand) : decideBlind(obs, p, rand);
  return legalize(obs, choice);
}
