import { NUM_PLAYERS } from './types';

/**
 * 平分公共积分池：每名获胜者得 floor(pot/n)；
 * 余数从本局起始座位开始顺时针遍历，只给获胜者逐人加 1 分，直到分完。
 * 返回长度为 NUM_PLAYERS 的“获得积分”数组。
 */
export function splitPot(pot: number, winners: readonly number[], startSeat: number): number[] {
  if (winners.length === 0) throw new Error('至少需要一名获胜者');
  if (!Number.isInteger(pot) || pot < 0) throw new Error('公共积分必须是非负整数');
  const gained = new Array<number>(NUM_PLAYERS).fill(0);
  const share = Math.floor(pot / winners.length);
  for (const w of winners) gained[w] += share;
  let rem = pot - share * winners.length;
  for (let i = 0; rem > 0; i++) {
    const seat = (startSeat + i) % NUM_PLAYERS;
    if (winners.includes(seat)) {
      gained[seat] += 1;
      rem -= 1;
    }
  }
  return gained;
}
