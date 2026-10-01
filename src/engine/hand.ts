import type { Card } from './types';
import { createDeck } from './cards';

/** 牌型，数值越大越强 */
export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  Straight = 2,
  Flush = 3,
  StraightFlush = 4,
  Trips = 5,
}

export const CATEGORY_NAME: Record<HandCategory, string> = {
  [HandCategory.Trips]: '豹子',
  [HandCategory.StraightFlush]: '同花顺',
  [HandCategory.Flush]: '同花',
  [HandCategory.Straight]: '顺子',
  [HandCategory.Pair]: '对子',
  [HandCategory.HighCard]: '单张',
};

export interface HandValue {
  category: HandCategory;
  /** 同牌型内逐项比较的点数序列 */
  kickers: number[];
}

/**
 * 顺子判定：返回顺子的“高张”，不是顺子返回 null。
 * A-K-Q 高张 14（最大）；A-2-3 高张 3（最小，小于 2-3-4）；K-A-2 不算顺子。
 */
function straightHigh(desc: number[]): number | null {
  const [a, b, c] = desc;
  if (a - 1 === b && b - 1 === c) return a;
  if (a === 14 && b === 3 && c === 2) return 3;
  return null;
}

export function evaluateHand(cards: readonly Card[]): HandValue {
  if (cards.length !== 3) throw new Error('一手牌必须是 3 张');
  const desc = cards.map((c) => c.rank).sort((x, y) => y - x);
  const flush = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
  const high = straightHigh(desc);

  if (desc[0] === desc[2]) return { category: HandCategory.Trips, kickers: [desc[0]] };
  if (flush && high !== null) return { category: HandCategory.StraightFlush, kickers: [high] };
  if (flush) return { category: HandCategory.Flush, kickers: desc };
  if (high !== null) return { category: HandCategory.Straight, kickers: [high] };
  if (desc[0] === desc[1]) return { category: HandCategory.Pair, kickers: [desc[0], desc[2]] };
  if (desc[1] === desc[2]) return { category: HandCategory.Pair, kickers: [desc[1], desc[0]] };
  return { category: HandCategory.HighCard, kickers: desc };
}

/**
 * 通用牌力比较：a 大返回 1，b 大返回 -1，完全相同返回 0。
 * 不比较花色。“主动比牌同牌力发起者落败”不在这里处理。
 */
export function compareHandValues(a: HandValue, b: HandValue): -1 | 0 | 1 {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  const n = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < n; i++) {
    const x = a.kickers[i] ?? 0;
    const y = b.kickers[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export function compareHands(a: readonly Card[], b: readonly Card[]): -1 | 0 | 1 {
  return compareHandValues(evaluateHand(a), evaluateHand(b));
}

export function handName(cards: readonly Card[]): string {
  return CATEGORY_NAME[evaluateHand(cards).category];
}

/** 把牌力编码为单个整数，便于排序与查表 */
export function handScore(v: HandValue): number {
  let s = v.category;
  for (let i = 0; i < 3; i++) s = s * 16 + (v.kickers[i] ?? 0);
  return s;
}

let sortedScores: number[] | null = null;

function allScores(): number[] {
  if (sortedScores) return sortedScores;
  const deck = createDeck();
  const out: number[] = [];
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++)
      for (let k = j + 1; k < deck.length; k++) out.push(handScore(evaluateHand([deck[i], deck[j], deck[k]])));
  out.sort((x, y) => x - y);
  sortedScores = out;
  return out;
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 这手牌在全部 22100 种三张组合中的百分位（0~1，越大越强）。
 * 只依赖传入的这手牌本身，供电脑评估“自己已看过的手牌”。
 */
export function handPercentile(cards: readonly Card[]): number {
  const arr = allScores();
  const s = handScore(evaluateHand(cards));
  const below = lowerBound(arr, s);
  const equalEnd = lowerBound(arr, s + 1);
  return (below + (equalEnd - below) / 2) / arr.length;
}
