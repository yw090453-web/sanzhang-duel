import type { LogEntry, WinMethod } from './types';

export const METHOD_LABEL: Record<WinMethod, string> = {
  others_out: '其余玩家退出',
  compare: '主动比牌后仅剩一人',
  showdown: '最终摊牌',
};

/** 把一条公开行动记录格式化为文字。只使用记录中的公开信息。 */
export function formatLog(e: LogEntry, names: readonly string[]): string {
  const who = e.seat !== null ? names[e.seat] : '';
  const blind = e.seen ? '' : '（未看牌）';
  switch (e.kind) {
    case 'ante':
      return `每人投入底分 ${e.cost}，公共积分 ${e.amount}`;
    case 'round':
      return `第 ${e.round} 轮开始`;
    case 'look':
      return `${who} 看牌`;
    case 'call':
      return `${who} 跟进 ${e.cost}${blind}`;
    case 'raise':
      return `${who} 加码至 ${e.level} · 消耗 ${e.cost}${blind}`;
    case 'fold':
      return `${who} 弃牌`;
    case 'compare':
      return `${who} 向 ${names[e.target!]} 发起比牌（消耗 ${e.cost}），${names[e.winner!]} 胜，${names[e.loser!]} 出局`;
    case 'settle': {
      const ws = (e.winners ?? []).map((w) => names[w]).join('、');
      if ((e.winners ?? []).length > 1) return `${METHOD_LABEL[e.method!]}：${ws} 并列获胜，平分公共积分 ${e.amount}`;
      return `${METHOD_LABEL[e.method!]}：${ws} 获得公共积分 ${e.amount}`;
    }
  }
}
