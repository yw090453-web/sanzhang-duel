import { describe, expect, it } from 'vitest';
import { HandCategory, compareHands, evaluateHand, handPercentile } from '../src/engine/hand';
import { createDeck, deal, shuffle } from '../src/engine/cards';
import { createCryptoRandom, createSeededRandom } from '../src/engine/random';
import { h } from './helpers';

describe('牌型识别', () => {
  it('识别六种牌型', () => {
    expect(evaluateHand(h('SA HA DA')).category).toBe(HandCategory.Trips);
    expect(evaluateHand(h('S5 S6 S7')).category).toBe(HandCategory.StraightFlush);
    expect(evaluateHand(h('S2 S9 SK')).category).toBe(HandCategory.Flush);
    expect(evaluateHand(h('S5 H6 D7')).category).toBe(HandCategory.Straight);
    expect(evaluateHand(h('S5 H5 D7')).category).toBe(HandCategory.Pair);
    expect(evaluateHand(h('S2 H9 DK')).category).toBe(HandCategory.HighCard);
  });

  it('牌型大小顺序：豹子 > 同花顺 > 同花 > 顺子 > 对子 > 单张', () => {
    const ordered = [h('S2 H2 D2'), h('SA SK SQ'), h('SA SK SJ'), h('SA HK DQ'), h('SA HA DK'), h('SA HK DJ')];
    // 用每类中较大的对手也能被上一类中最小的击败来验证顺序
    const minOfEach = [h('S2 H2 D2'), h('SA S2 S3'), h('S2 S3 S5'), h('SA H2 D3'), h('S2 H2 D3'), h('S2 H3 D5')];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareHands(ordered[i], ordered[i + 1])).toBe(1);
      expect(compareHands(minOfEach[i], ordered[i + 1])).toBe(1);
    }
  });

  it('豹子：AAA 最大，222 最小', () => {
    expect(compareHands(h('SA HA DA'), h('SK HK DK'))).toBe(1);
    expect(compareHands(h('S2 H2 D2'), h('S3 H3 D3'))).toBe(-1);
  });

  it('A-K-Q 为最大顺子，A-2-3 为最小顺子，A-2-3 < 2-3-4', () => {
    expect(evaluateHand(h('SA HK DQ')).category).toBe(HandCategory.Straight);
    expect(evaluateHand(h('SA H2 D3')).category).toBe(HandCategory.Straight);
    expect(compareHands(h('SA HK DQ'), h('SK HQ DJ'))).toBe(1);
    expect(compareHands(h('SA H2 D3'), h('S2 H3 D4'))).toBe(-1);
    expect(compareHands(h('SA H2 D3'), h('SQ HK DA'))).toBe(-1);
    // 同花顺同理
    expect(compareHands(h('SA SK SQ'), h('HK HQ HJ'))).toBe(1);
    expect(compareHands(h('SA S2 S3'), h('H2 H3 H4'))).toBe(-1);
  });

  it('K-A-2 不算顺子', () => {
    expect(evaluateHand(h('SK HA D2')).category).toBe(HandCategory.HighCard);
    expect(evaluateHand(h('SK SA S2')).category).toBe(HandCategory.Flush);
  });

  it('同花与单张按点数从大到小逐张比较', () => {
    expect(compareHands(h('SA S9 S2'), h('HK HQ H9'))).toBe(1);
    expect(compareHands(h('SA S9 S3'), h('HA H9 H2'))).toBe(1);
    expect(compareHands(h('SA S10 S2'), h('HA H9 H8'))).toBe(1);
    expect(compareHands(h('SA H9 D3'), h('CA S9 H2'))).toBe(1);
    expect(compareHands(h('SK HQ D9'), h('CA S3 H2'))).toBe(-1);
  });

  it('对子先比对子，再比单牌', () => {
    expect(compareHands(h('SQ HQ D5'), h('SJ HJ DA'))).toBe(1);
    expect(compareHands(h('SQ HQ DA'), h('CQ DQ H10'))).toBe(1);
    expect(compareHands(h('S2 H2 DA'), h('C2 D2 HK'))).toBe(1);
  });

  it('相同牌力不比较花色，返回相等', () => {
    expect(compareHands(h('SA HK D9'), h('CA DK H9'))).toBe(0);
    expect(compareHands(h('SA SK S9'), h('HA HK H9'))).toBe(0);
    expect(compareHands(h('SQ HQ D5'), h('CQ DQ H5'))).toBe(0);
    expect(compareHands(h('S5 H6 D7'), h('C5 D6 H7'))).toBe(0);
  });

  it('百分位单调：更强的牌百分位更高', () => {
    expect(handPercentile(h('SA HA DA'))).toBeGreaterThan(handPercentile(h('SA SK SQ')));
    expect(handPercentile(h('SQ HQ D5'))).toBeGreaterThan(handPercentile(h('SA HK DJ')));
    expect(handPercentile(h('S2 H3 D5'))).toBeLessThan(0.01);
  });
});

describe('牌组与发牌', () => {
  it('52 张不重复', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.suit + c.rank)).size).toBe(52);
  });

  it('洗牌后仍是同一副牌', () => {
    const d = shuffle(createDeck(), createSeededRandom(7));
    expect(new Set(d.map((c) => c.suit + c.rank)).size).toBe(52);
  });

  it('多次发牌不出现重复牌（浏览器随机源与种子随机源）', () => {
    for (const rng of [createSeededRandom(1), createCryptoRandom()]) {
      for (let i = 0; i < 200; i++) {
        const hands = deal(4, rng);
        const keys = hands.flat().map((c) => c.suit + c.rank);
        expect(hands.every((x) => x.length === 3)).toBe(true);
        expect(new Set(keys).size).toBe(12);
      }
    }
  });

  it('crypto 随机整数在范围内', () => {
    const r = createCryptoRandom();
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[r.nextInt(3)]++;
    expect(counts.every((c) => c > 800)).toBe(true);
  });
});
