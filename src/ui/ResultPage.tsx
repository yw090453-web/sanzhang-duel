import { SEATS, SEAT_NAMES } from '../config';
import { handName } from '../engine/hand';
import { METHOD_LABEL, formatLog } from '../engine/log';
import type { MatchState } from '../engine/match';
import { HUMAN_SEAT, TOTAL_GAMES, type LogEntry } from '../engine/types';
import { CardRow } from './Card';
import { signClass, signed } from './format';

function outcomeOf(match: MatchState, seat: number): string {
  const g = match.game;
  const r = g.result!;
  const p = g.players[seat];
  if (r.winners.includes(seat)) return r.winners.length > 1 ? '并列获胜' : '获胜';
  if (p.status === 'folded') return '弃牌';
  if (p.status === 'lost') return '比牌落败';
  return '摊牌落败';
}

export function ResultPage({ match, onNext, onHome }: { match: MatchState; onNext: () => void; onHome: () => void }) {
  const g = match.game;
  const r = g.result!;
  const myNet = r.net[HUMAN_SEAT];
  const winners = r.winners.map((w) => SEAT_NAMES[w]).join('、');
  const last = g.gameIndex === TOTAL_GAMES - 1;

  // 按轮分组的时间线
  const groups: Array<{ round: number; items: LogEntry[] }> = [];
  for (const e of g.log) {
    if (e.kind === 'round') groups.push({ round: e.round, items: [] });
    else if (groups.length === 0) groups.push({ round: 0, items: [e] });
    else groups[groups.length - 1].items.push(e);
  }

  return (
    <div className="result-page">
      <header className="result-head">
        <p className="eyebrow">
          第 {g.gameIndex + 1} 局 / 共 {TOTAL_GAMES} 局 · 结算
        </p>
        <h1>
          {r.winners.includes(HUMAN_SEAT) ? (r.winners.length > 1 ? '你与其他玩家并列获胜' : '你赢得了本局') : `${winners} ${r.winners.length > 1 ? '并列获胜' : '获胜'}`}
        </h1>
        <p className="method">获胜方式：{METHOD_LABEL[r.method]}</p>
        <div className="result-kpis">
          <div>
            <span>你的本局净得分</span>
            <b className={signClass(myNet)}>{signed(myNet)}</b>
          </div>
          <div>
            <span>你的本场累计</span>
            <b className={signClass(match.scores[HUMAN_SEAT])}>{signed(match.scores[HUMAN_SEAT])}</b>
          </div>
        </div>
      </header>

      <section className="panel">
        <h2>积分明细</h2>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>玩家</th>
                <th>本局投入</th>
                <th>获得积分</th>
                <th>本局净得分</th>
                <th>本场累计</th>
              </tr>
            </thead>
            <tbody>
              {SEATS.map((s) => (
                <tr key={s.seat} className={r.winners.includes(s.seat) ? 'win-row' : ''}>
                  <td>
                    {s.name}
                    {s.kind === 'computer' && <em className="muted"> · {s.styleLabel}</em>}
                  </td>
                  <td>{r.invested[s.seat]}</td>
                  <td>{r.gained[s.seat]}</td>
                  <td className={signClass(r.net[s.seat])}>{signed(r.net[s.seat])}</td>
                  <td className={signClass(match.scores[s.seat])}>{signed(match.scores[s.seat])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>最终手牌</h2>
        <ul className="hands">
          {SEATS.map((s) => (
            <li key={s.seat} className={r.winners.includes(s.seat) ? 'winner' : ''}>
              <div className="hand-who">
                <b>{s.name}</b>
                <span className="tag">{outcomeOf(match, s.seat)}</span>
              </div>
              <CardRow cards={g.hands[s.seat]} faceUp size="sm" />
              <span className="hand-type">{handName(g.hands[s.seat])}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>行动时间线</h2>
        <div className="timeline">
          {groups.map((grp, i) => (
            <div key={i} className="tl-group">
              {grp.round > 0 && <h3>第 {grp.round} 轮</h3>}
              <ol>
                {grp.items.map((e) => (
                  <li key={e.seq} className={`kind-${e.kind}`}>
                    {formatLog(e, SEAT_NAMES)}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="muted small">复盘只记录实际发生的行动与结果。</p>
      </section>

      <footer className="result-actions">
        <button className="btn" onClick={onHome}>
          返回首页
        </button>
        <button className="btn primary big" onClick={onNext}>
          {last ? '查看整场排名' : '下一局'}
        </button>
      </footer>
    </div>
  );
}
