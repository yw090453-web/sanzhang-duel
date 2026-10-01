import type { Card, Suit } from '../src/engine/types';

const RANKS: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };

/** 'SA HK D10' → 牌数组。花色 S/H/D/C，点数 2-10/J/Q/K/A（10 也可写作 T） */
export function h(spec: string): Card[] {
  return spec
    .trim()
    .split(/\s+/)
    .map((t) => {
      const suit = t[0] as Suit;
      const r = t.slice(1);
      const rank = RANKS[r] ?? Number(r);
      if (!'SHDC'.includes(suit) || !(rank >= 2 && rank <= 14)) throw new Error(`bad card ${t}`);
      return { suit, rank };
    });
}

export class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}
