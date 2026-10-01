import { useState } from 'react';
import { SEATS } from '../config';
import type { GameController, Snapshot } from '../controller/GameController';
import { TOTAL_GAMES } from '../engine/types';
import type { Speed } from '../storage/save';
import { formatDate, signClass, signed } from './format';
import { Modal } from './Modal';
import { RulesContent } from './RulesContent';
import { CardRow } from './Card';

const SPEEDS: Array<[Speed, string]> = [
  ['slow', '慢'],
  ['normal', '标准'],
  ['fast', '快'],
];

export function StartPage({ snap, controller, onPlay, onOnline }: { snap: Snapshot; controller: GameController; onPlay: () => void; onOnline: () => void }) {
  const [dialog, setDialog] = useState<null | 'rules' | 'records' | 'confirmNew'>(null);
  const resumable = snap.match !== null && !snap.match.finished;
  const staticPreview = location.hostname.endsWith('.github.io');

  const start = () => {
    controller.newMatch();
    onPlay();
  };

  const records = snap.records;
  const firsts = records.filter((r) => r.ranks[0] === 1).length;
  const avgRank = records.length ? records.reduce((a, r) => a + r.ranks[0], 0) / records.length : 0;

  return (
    <div className="start-page">
      <div className="start-card">
        <div className="logo" aria-hidden="true">
          <CardRow cards={null} faceUp={false} />
        </div>
        <p className="lobby-kicker">静 夜 牌 桌</p>
        <h1>三张·对决</h1>
        <p className="tagline">三张手牌，八局交锋。<br />在未知中，做出你的选择。</p>

        {snap.loadError && (
          <div className="alert" role="alert">
            <strong>存档已损坏，无法恢复该对局。</strong>
            <p>原因：{snap.loadError}。为避免产生错误战绩，该存档不会被计入。</p>
            <div className="row">
              <button className="btn primary" onClick={() => { controller.discardSave(); start(); }}>
                删除存档并重新开始
              </button>
              <button className="btn" onClick={() => controller.discardSave()}>
                仅删除存档
              </button>
            </div>
          </div>
        )}

        <div className="start-actions">
          <button className="btn primary big" onClick={onOnline} disabled={staticPreview}>好友联机<small>{staticPreview ? '联机服务待上线，请先体验下方单机模式' : '创建或加入 2–8 人牌桌'}</small></button>
          {resumable && (
            <button className="btn primary big" onClick={onPlay}>
              继续对局
              <small>第 {snap.match!.game.gameIndex + 1} / {TOTAL_GAMES} 局</small>
            </button>
          )}
          <button
            className={`btn big ${resumable ? '' : 'primary'}`}
            disabled={snap.loadError !== null}
            onClick={() => (resumable ? setDialog('confirmNew') : start())}
          >
            单机 · {TOTAL_GAMES}局对战
          </button>
          <div className="row">
            <button className="btn" onClick={() => setDialog('rules')}>
              玩法说明
            </button>
            <button className="btn" onClick={() => setDialog('records')}>
              本地战绩
            </button>
          </div>
        </div>

        <div className="setting">
          <span>电脑行动速度</span>
          <div className="seg" role="radiogroup" aria-label="电脑行动速度">
            {SPEEDS.map(([v, label]) => (
              <button key={v} role="radio" aria-checked={snap.settings.speed === v} className={snap.settings.speed === v ? 'on' : ''} onClick={() => controller.setSpeed(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <ul className="opponents">
          {SEATS.filter((s) => s.kind === 'computer').map((s) => (
            <li key={s.seat}>
              <span className="avatar sm">{s.avatar}</span>
              {s.name}
              <em>{s.styleLabel}</em>
            </li>
          ))}
        </ul>
        <p className="fine">单机练习，或邀请好友联机。无需注册，积分仅用于游戏内计分，不涉及真实金钱。</p>
      </div>

      {dialog === 'rules' && (
        <Modal title="玩法说明" onClose={() => setDialog(null)}>
          <RulesContent />
        </Modal>
      )}

      {dialog === 'records' && (
        <Modal
          title="本地战绩"
          onClose={() => setDialog(null)}
          footer={
            records.length > 0 && (
              <button className="btn subtle" onClick={() => controller.clearRecords()}>
                清空战绩
              </button>
            )
          }
        >
          {snap.recordsCorrupt && <p className="alert small">部分战绩记录已损坏，已忽略。</p>}
          {records.length === 0 ? (
            <p className="muted">还没有完成的对战。完成 8 局后会在这里记录。</p>
          ) : (
            <>
              <div className="stat-row">
                <div>
                  <b>{records.length}</b>
                  <span>完成场次</span>
                </div>
                <div>
                  <b>{firsts}</b>
                  <span>第一名</span>
                </div>
                <div>
                  <b>{avgRank.toFixed(2)}</b>
                  <span>平均名次</span>
                </div>
              </div>
              <table className="data">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>名次</th>
                    <th>本场成绩</th>
                    <th>获胜局数</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.finishedAt)}</td>
                      <td>第 {r.ranks[0]} 名</td>
                      <td className={signClass(r.scores[0])}>{signed(r.scores[0])}</td>
                      <td>{r.gamesWon[0]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}

      {dialog === 'confirmNew' && (
        <Modal
          title="开始新对战？"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                取消
              </button>
              <button className="btn danger" onClick={start}>
                放弃并开始新对战
              </button>
            </>
          }
        >
          <p>当前有未完成的对局（第 {snap.match!.game.gameIndex + 1} 局）。开始新对战会放弃它，未完成的对战不计入战绩。</p>
        </Modal>
      )}
    </div>
  );
}
