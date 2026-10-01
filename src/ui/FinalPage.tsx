import { SEATS, SEAT_NAMES } from '../config';
import { METHOD_LABEL } from '../engine/log';
import { ranking, type MatchState } from '../engine/match';
import { HUMAN_SEAT } from '../engine/types';
import { signClass, signed } from './format';

export function FinalPage({ match, onHome }: { match: MatchState; onHome: () => void }) {
  const rows = ranking(match);
  const me = rows.find((r) => r.seat === HUMAN_SEAT)!;
  const tied = rows.filter((r) => r.rank === me.rank).length > 1;

  return (
    <div className="result-page final-page">
      <header className="result-head">
        <p className="eyebrow">8 局对战结束</p>
        <h1>
          你获得第 {me.rank} 名{tied ? '（并列）' : ''}
        </h1>
        <div className="result-kpis">
          <div>
            <span>本场成绩</span>
            <b className={signClass(me.score)}>{signed(me.score)}</b>
          </div>
          <div>
            <span>获胜局数</span>
            <b>{me.gamesWon}</b>
          </div>
        </div>
      </header>

      <section className="panel">
        <h2>整场排名</h2>
        <ol className="ranking">
          {rows.map((r) => (
            <li key={r.seat} className={r.seat === HUMAN_SEAT ? 'me' : ''}>
              <span className="rank-no">{r.rank}</span>
              <span className="rank-name">
                {SEATS[r.seat].name}
                {SEATS[r.seat].kind === 'computer' && <em className="muted"> · {SEATS[r.seat].styleLabel}</em>}
              </span>
              <span className="rank-won">获胜 {r.gamesWon} 局</span>
              <b className={signClass(r.score)}>{signed(r.score)}</b>
            </li>
          ))}
        </ol>
        <p className="muted small">按本场成绩排序；同分并列，不以获胜局数区分。</p>
      </section>

      <section className="panel">
        <h2>各局结果</h2>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>局</th>
                <th>获胜者</th>
                <th>方式</th>
                {SEATS.map((s) => (
                  <th key={s.seat}>{s.seat === HUMAN_SEAT ? '你' : s.name.replace('电脑·', '')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {match.games.map((g) => (
                <tr key={g.gameIndex}>
                  <td>{g.gameIndex + 1}</td>
                  <td>{g.winners.map((w) => SEAT_NAMES[w]).join('、')}</td>
                  <td>{METHOD_LABEL[g.method]}</td>
                  {g.net.map((n, i) => (
                    <td key={i} className={signClass(n)}>
                      {signed(n)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="result-actions">
        <button className="btn primary big" onClick={onHome}>
          返回首页
        </button>
      </footer>
    </div>
  );
}
