import type { Card, RandomSource, Suit } from './types';

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };

export function rankLabel(rank: number): string {
  switch (rank) {
    case 14:
      return 'A';
    case 13:
      return 'K';
    case 12:
      return 'Q';
    case 11:
      return 'J';
    default:
      return String(rank);
  }
}

export function cardLabel(c: Card): string {
  return `${SUIT_SYMBOL[c.suit]}${rankLabel(c.rank)}`;
}

export function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

/** 52 张牌（无大小王） */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit });
  }
  return deck;
}

/** Fisher–Yates 洗牌，返回新数组 */
export function shuffle<T>(items: readonly T[], rng: RandomSource): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** 洗牌后给 players 人每人发 3 张 */
export function deal(players: number, rng: RandomSource): Card[][] {
  const deck = shuffle(createDeck(), rng);
  const hands: Card[][] = [];
  for (let p = 0; p < players; p++) hands.push(deck.slice(p * 3, p * 3 + 3));
  return hands;
}

export function isValidCard(c: unknown): c is Card {
  if (typeof c !== 'object' || c === null) return false;
  const { rank, suit } = c as Card;
  return Number.isInteger(rank) && rank >= 2 && rank <= 14 && (SUITS as string[]).includes(suit);
}
