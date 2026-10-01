import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/ai/observation';
import { decide, type Persona } from '../src/ai/strategy';
import { applyMatchAction, createMatch, ranking, startNextGame, type MatchState } from '../src/engine/match';
import { createSeededRandom } from '../src/engine/random';
import { checkInvariants } from '../src/engine/rules';
import { TOTAL_GAMES } from '../src/engine/types';

const PERSONA_BY_SEAT: Persona[] = ['balanced', 'cautious', 'balanced', 'aggressive'];

function playWholeMatch(seed: number): MatchState {
  const rng = createSeededRandom(seed);
  let m = createMatch(rng, `t${seed}`, 0);
  for (let gi = 0; gi < TOTAL_GAMES; gi++) {
    expect(m.game.gameIndex).toBe(gi);
    expect(m.game.startSeat).toBe((m.firstStartSeat + gi) % 4);
    expect(m.game.players.map((p) => p.chips)).toEqual([990, 990, 990, 990]);
    expect(m.game.pot).toBe(40);
    const scoresBefore = m.scores.slice();
    while (m.game.phase === 'playing') {
      const seat = m.game.currentSeat!;
      const a = decide(buildObservation(m.game, seat), PERSONA_BY_SEAT[seat], () => rng.next());
      const r = applyMatchAction(m, seat, a, m.game.turnId);
      expect(r.ok).toBe(true);
      m = (r as { match: MatchState }).match;
      expect(checkInvariants(m.game)).toEqual([]);
    }
    expect(m.games).toHaveLength(gi + 1);
    expect(m.scores).toEqual(scoresBefore.map((s, i) => s + m.game.result!.net[i]));
    if (gi < TOTAL_GAMES - 1) {
      expect(m.finished).toBe(false);
      const n = startNextGame(m, rng);
      expect(n.ok).toBe(true);
      // 同一局不能重复开下一局
      m = (n as { match: MatchState }).match;
      expect(startNextGame(m, rng).ok).toBe(false);
      // 新局保留本场成绩
      expect(m.scores).toEqual(scoresBefore.map((s, i) => s + m.games[gi].net[i]));
    }
  }
  return m;
}

describe('完整 8 局', () => {
  it('多场模拟：正常结束、成绩守恒、起始座位轮换', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const m = playWholeMatch(seed);
      expect(m.finished).toBe(true);
      expect(m.games).toHaveLength(8);
      expect(m.scores.reduce((a, b) => a + b, 0)).toBe(0);
      expect(startNextGame(m, createSeededRandom(1)).ok).toBe(false);
      expect(applyMatchAction(m, 0, { type: 'call' }).ok).toBe(false);
    }
  });

  it('结算后重复提交不会重复计入本场成绩', () => {
    const m = playWholeMatch(5);
    const again = applyMatchAction(m, 0, { type: 'fold' });
    expect(again.ok).toBe(false);
    expect(m.games).toHaveLength(8);
  });

  it('排名：同分并列，不用获胜局数区分', () => {
    const rows = ranking({
      scores: [50, 50, -30, -70],
      games: [
        { gameIndex: 0, startSeat: 0, winners: [0], method: 'others_out', invested: [], gained: [], net: [0, 0, 0, 0] },
        { gameIndex: 1, startSeat: 1, winners: [0], method: 'others_out', invested: [], gained: [], net: [0, 0, 0, 0] },
      ],
    });
    expect(rows.map((r) => [r.seat, r.rank])).toEqual([
      [0, 1],
      [1, 1],
      [2, 3],
      [3, 4],
    ]);
    expect(rows[0].gamesWon).toBe(2);
    expect(rows[1].gamesWon).toBe(0);
  });
});
