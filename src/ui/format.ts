import type { LogEntry, PlayerState } from '../engine/types';

export const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export function signClass(n: number): string {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
}

/** 某个座位在本局的最近一次公开行动（简短文字） */
export function lastActionText(log: readonly LogEntry[], seat: number, names: readonly string[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.kind === 'compare' && e.target === seat) return `被 ${names[e.seat!]} 比牌 · ${e.winner === seat ? '胜' : '负'}`;
    if (e.seat !== seat) continue;
    switch (e.kind) {
      case 'look':
        return '看牌';
      case 'call':
        return `跟进 ${e.cost}`;
      case 'raise':
        return `加码至 ${e.level} · 消耗 ${e.cost}`;
      case 'fold':
        return '弃牌';
      case 'compare':
        return `比牌 ${names[e.target!]} · ${e.winner === seat ? '胜' : '负'}`;
    }
  }
  return null;
}

export function statusLabel(p: PlayerState, isCurrent: boolean): string {
  if (p.status === 'folded') return '已弃牌';
  if (p.status === 'lost') return '比牌落败';
  return isCurrent ? '行动中' : '留场';
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
