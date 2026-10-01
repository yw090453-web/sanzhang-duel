import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/ai/observation';
import { decide, type Persona } from '../src/ai/strategy';
import { deal } from '../src/engine/cards';
import { createSeededRandom } from '../src/engine/random';
import { applyAction, createGameWithHands, getActionOptions } from '../src/engine/rules';
import type { Action, Card, GameState } from '../src/engine/types';

const PERSONAS: Persona[] = ['cautious', 'balanced', 'aggressive'];

/** 用同一串公开动作，从两副不同的手牌推进出两个状态（公开部分完全一致） */
function playScript(hands: Card[][], script: Array<[number, Action]>): GameState {
  let s = createGameWithHands(0, 0, hands);
  for (const [seat, a] of script) {
    const r = applyAction(s, seat, a);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

/** 固定、不依赖牌面结果的公开动作序列（没有比牌），结束后轮到 seat 1 */
const SCRIPT_R1: Array<[number, Action]> = [[0, { type: 'call' }]];
const SCRIPT_R3: Array<[number, Action]> = [
  [0, { type: 'call' }],
  [1, { type: 'call' }],
  [2, { type: 'look' }],
  [2, { type: 'raise' }],
  [3, { type: 'call' }],
  [0, { type: 'look' }],
  [0, { type: 'call' }],
  [1, { type: 'call' }],
  [2, { type: 'call' }],
  [3, { type: 'raise' }],
  [0, { type: 'call' }],
];

function seqRand(seed: number): () => number {
  const r = createSeededRandom(seed);
  return () => r.next();
}

describe('电脑可观察状态', () => {
  it('未看牌时 hand 为 null，且不包含任何手牌字段', () => {
    const s = createGameWithHands(0, 1, deal(4, createSeededRandom(3)));
    const obs = buildObservation(s, 1);
    expect(obs.hand).toBeNull();
    expect(Object.keys(obs)).not.toContain('hands');
    expect(JSON.stringify(obs)).not.toMatch(/"suit"/);
  });

  it('看牌后只含自己的 3 张牌', () => {
    let s = createGameWithHands(0, 1, deal(4, createSeededRandom(4)));
    s = (applyAction(s, 1, { type: 'look' }) as { state: GameState }).state;
    const obs = buildObservation(s, 1);
    expect(obs.hand).toEqual(s.hands[1]);
    expect((JSON.stringify(obs).match(/"suit"/g) ?? []).length).toBe(3);
  });

  it('修改 observation 不影响真实状态', () => {
    const s = createGameWithHands(0, 1, deal(4, createSeededRandom(5)));
    const obs = buildObservation(s, 1);
    obs.players[0].chips = 0;
    obs.history.length = 0;
    expect(s.players[0].chips).toBe(990);
    expect(s.log.length).toBeGreaterThan(0);
  });
});

describe('电脑公平性：隐藏信息不影响决策', () => {
  it('未看牌时，改变自身及他人的暗牌，决策完全相同', () => {
    const rng = createSeededRandom(99);
    for (const script of [SCRIPT_R1, SCRIPT_R3]) {
      for (let trial = 0; trial < 200; trial++) {
        const a = playScript(deal(4, rng), script);
        const b = playScript(deal(4, rng), script);
        expect(a.hands[1]).not.toEqual(b.hands[1]);
        const oa = buildObservation(a, 1);
        const ob = buildObservation(b, 1);
        expect(oa).toEqual(ob);
        for (const p of PERSONAS) {
          expect(decide(oa, p, seqRand(trial))).toEqual(decide(ob, p, seqRand(trial)));
        }
      }
    }
  });

  it('看牌后，改变其他人的暗牌不改变决策', () => {
    const rng = createSeededRandom(123);
    for (let trial = 0; trial < 200; trial++) {
      const base = deal(4, rng);
      // 另一组：seat1 手牌不变，其余三人换成与之不冲突的其他牌
      const used = new Set(base[1].map((c) => c.suit + c.rank));
      const others = deal(4, rng).flat().concat(deal(4, rng).flat()).filter((c) => !used.has(c.suit + c.rank));
      const uniq: Card[] = [];
      for (const c of others) if (!uniq.some((u) => u.suit === c.suit && u.rank === c.rank)) uniq.push(c);
      const alt = [uniq.slice(0, 3), base[1], uniq.slice(3, 6), uniq.slice(6, 9)];
      const script: Array<[number, Action]> = [...SCRIPT_R3, [1, { type: 'look' }]];
      const a = playScript(base, script);
      const b = playScript(alt, script);
      const oa = buildObservation(a, 1);
      const ob = buildObservation(b, 1);
      expect(oa).toEqual(ob);
      for (const p of PERSONAS) expect(decide(oa, p, seqRand(trial))).toEqual(decide(ob, p, seqRand(trial)));
    }
  });
});

describe('电脑决策合法性与风格', () => {
  it('任何情况下都返回合法动作；看牌后不会再选看牌', () => {
    const rng = createSeededRandom(7);
    for (let g = 0; g < 300; g++) {
      let s = createGameWithHands(0, g % 4, deal(4, rng));
      while (s.phase === 'playing') {
        const seat = s.currentSeat!;
        const persona = PERSONAS[seat % 3];
        const obs = buildObservation(s, seat);
        const a = decide(obs, persona, () => rng.next());
        if (obs.seen) expect(a.type).not.toBe('look');
        const r = applyAction(s, seat, a);
        expect(r.ok).toBe(true);
        s = (r as { state: GameState }).state;
      }
    }
  });

  it('风格差异：谨慎型更早看牌，主动型更常加码', () => {
    const rng = createSeededRandom(11);
    const lookFirstRound: Record<Persona, number> = { cautious: 0, balanced: 0, aggressive: 0 };
    const raises: Record<Persona, number> = { cautious: 0, balanced: 0, aggressive: 0 };
    for (let i = 0; i < 2000; i++) {
      const s = createGameWithHands(0, 1, deal(4, rng));
      for (const p of PERSONAS) {
        const a = decide(buildObservation(s, 1), p, () => rng.next());
        if (a.type === 'look') lookFirstRound[p]++;
        if (a.type === 'raise') raises[p]++;
      }
    }
    expect(lookFirstRound.cautious).toBeGreaterThan(lookFirstRound.balanced);
    expect(lookFirstRound.balanced).toBeGreaterThan(lookFirstRound.aggressive);
    expect(raises.aggressive).toBeGreaterThan(raises.cautious);
    // 选项与费用来自规则引擎
    const s = createGameWithHands(0, 1, deal(4, rng));
    expect(buildObservation(s, 1).options).toEqual(getActionOptions(s, 1));
  });
});
