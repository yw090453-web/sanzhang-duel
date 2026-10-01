import type { RandomSource } from './types';

/**
 * 浏览器随机源：crypto.getRandomValues + 拒绝采样，避免取模偏差。
 */
export function createCryptoRandom(): RandomSource {
  const buf = new Uint32Array(1);
  const u32 = (): number => {
    crypto.getRandomValues(buf);
    return buf[0];
  };
  return {
    nextInt(n: number): number {
      if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) throw new Error(`invalid bound ${n}`);
      // 丢弃落在 2^32 不能被 n 整除的尾段内的值
      const limit = 0x100000000 - (0x100000000 % n);
      let x = u32();
      while (x >= limit) x = u32();
      return x % n;
    },
    next(): number {
      return u32() / 0x100000000;
    },
  };
}

/**
 * 可复现的随机源（mulberry32），仅供测试与调试注入。
 */
export function createSeededRandom(seed: number): RandomSource {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt(n: number): number {
      return Math.floor(next() * n);
    },
  };
}
