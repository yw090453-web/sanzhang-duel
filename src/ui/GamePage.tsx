import { useEffect, useRef, useState } from 'react';
import { SEATS, SEAT_NAMES, type SeatConfig } from '../config';
import type { GameController, Snapshot } from '../controller/GameController';
import { handName } from '../engine/hand';
import { formatLog } from '../engine/log';
import { getActionOptions, REASON, type ActionOption } from '../engine/rules';
import { HUMAN_SEAT, LEVELS, MAX_ROUNDS, TOTAL_GAMES, type Action, type GameState, type PlayerState } from '../engine/types';
import { CardRow } from './Card';
import { lastActionText, signClass, signed, statusLabel } from './format';
import { Modal } from './Modal';
import { ResultPage } from './ResultPage';
import { RulesContent } from './RulesContent';

type Mode = { kind: 'idle' } | { kind: 'select' } | { kind: 'confirm'; target: number };

/** 操作后锁定真人按钮的时长（覆盖翻牌/状态切换动画） */
const ACTION_LOCK_MS = 420;
const RESULT_DELAY_MS = 1800;

interface Props {
  snap: Snapshot;
  controller: GameController;
  onHome: () => void;
  onFinal: () => void;
}

export function GamePage({ snap, controller, onHome, onFinal }: Props) {
  const match = snap.match!;
  const g = match.game;
  const [showRules, setShowRules] = useState(false);
  const [resultFor, setResultFor] = useState<number | null>(g.phase === 'settled' ? g.gameIndex : null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 回合变化时取消比牌目标选择
  useEffect(() => setMode({ kind: 'idle' }), [g.turnId, g.gameIndex]);

  // 每次状态变化后短暂锁定真人操作，等待动画结束
  useEffect(() => {
    setLocked(true);
    const t = setTimeout(() => setLocked(false), ACTION_LOCK_MS);
    return () => clearTimeout(t);
  }, [g.version, g.gameIndex]);

  // 本局结算后稍作停留再进入结算页
  useEffect(() => {
    if (g.phase !== 'settled' || resultFor === g.gameIndex) return;
    const t = setTimeout(() => setResultFor(g.gameIndex), snap.fastForward ? 300 : RESULT_DELAY_MS);
    return () => clearTimeout(t);
  }, [g.phase, g.gameIndex, resultFor, snap.fastForward]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  if (g.phase === 'settled' && resultFor === g.gameIndex) {
    return (
      <ResultPage
        match={match}
        onNext={() => {
          if (match.finished) onFinal();
          else controller.nextGame();
        }}
        onHome={onHome}
      />
    );
  }

  const me = g.players[HUMAN_SEAT];
  const opts = getActionOptions(g, HUMAN_SEAT);
  const humanOut = me.status !== 'active';
  const inputBlocked = locked || snap.paused || g.phase !== 'playing';

  const act = (a: Action) => {
    if (inputBlocked) return;
    const r = controller.humanAction(a, g.turnId);
    if (!r.ok) setToast(r.error ?? '操作无效');
    else setLocked(true);
  };

  const onSeatClick = (seat: number) => {
    if (mode.kind === 'idle' || !opts.compare.targets.includes(seat)) return;
    setMode({ kind: 'confirm', target: seat });
  };

  const seatProps = (seat: number) => ({
    cfg: SEATS[seat],
    player: g.players[seat],
    game: g,
    isCurrent: g.currentSeat === seat,
    targetable: mode.kind !== 'idle' && opts.compare.targets.includes(seat),
    selected: mode.kind === 'confirm' && mode.target === seat,
    onClick: () => onSeatClick(seat),
  });

  return (
    <div className={`game-page ${snap.paused ? 'is-paused' : ''}`}>
      <header className="topbar">
        <div className="game-brand"><span>三张·对决</span><small>静夜牌桌</small></div>
        <div className="progress">
          <span>
            第 <b>{g.gameIndex + 1}</b> 局 / 共 {TOTAL_GAMES} 局
          </span>
          <span className="sep">·</span>
          <span>
            第 <b>{g.round}</b> 轮 / 最多 {MAX_ROUNDS} 轮
          </span>
        </div>
        <div className="top-actions">
          <button className="btn small" onClick={() => setShowRules(true)}>
            规则
          </button>
          <button className="btn small" onClick={() => controller.pause()} disabled={snap.paused || g.phase !== 'playing'}>
            暂停
          </button>
        </div>
      </header>

      <main className="table">
        <Seat pos="left" {...seatProps(1)} />
        <Seat pos="top" {...seatProps(2)} />
        <Seat pos="right" {...seatProps(3)} />
        <Center game={g} />
      <section className={`me-panel ${g.currentSeat === HUMAN_SEAT ? 'my-turn' : ''} ${humanOut ? 'out' : ''}`}>
        <div className="me-info">
          <div className="me-name">
            <span className="avatar">你</span>
            <div>
              <b>你</b>
              <span className={`tag ${me.seen ? 'seen' : ''}`}>{me.seen ? '已看牌' : '未看牌'}</span>
              <span className={`tag status-${me.status}`}>{statusLabel(me, g.currentSeat === HUMAN_SEAT)}</span>
            </div>
          </div>
          <div className="me-stats">
            <div>
              <span>局内积分</span>
              <b>{me.chips}</b>
            </div>
            <div>
              <span>本局已投入</span>
              <b>{me.invested}</b>
            </div>
            <div>
              <span>本场成绩</span>
              <b className={signClass(match.scores[HUMAN_SEAT])}>{signed(match.scores[HUMAN_SEAT])}</b>
            </div>
          </div>
        </div>

        <div className="me-cards">
          <CardRow cards={g.hands[HUMAN_SEAT]} faceUp={me.seen || g.phase === 'settled'} size="lg" dim={humanOut} />
          <div className="hand-name">{me.seen ? handName(g.hands[HUMAN_SEAT]) : '未看牌'}</div>
        </div>
      </section>
      <GameLog game={g} />
      <div className="game-controls">
        {g.phase === 'settled' ? (
          <div className="action-status">本局结束，正在进入结算…</div>
        ) : humanOut ? (
          <div className="out-panel">
            <p>{me.status === 'folded' ? '你已弃牌，退出本局。' : '你在比牌中落败，退出本局。'}</p>
            <div className="row">
              <button className={`btn ${!snap.fastForward ? 'primary' : ''}`} onClick={() => controller.setFastForward(false)}>
                观看剩余对局
              </button>
              <button className={`btn ${snap.fastForward ? 'primary' : ''}`} onClick={() => controller.setFastForward(true)}>
                快进至结算
              </button>
            </div>
          </div>
        ) : (
          <ActionBar
            opts={opts}
            mode={mode}
            blocked={inputBlocked}
            onAct={act}
            onMode={setMode}
            waitingText={
              snap.paused
                ? '已暂停'
                : g.currentSeat !== HUMAN_SEAT
                  ? `等待其他玩家行动 · ${SEAT_NAMES[g.currentSeat ?? 0]}思考中…`
                  : null
            }
          />
        )}
      </div>
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {snap.paused && (
        <Modal title="已暂停" footer={null}>
          <p className="muted">电脑行动已停止推进，进度已保存。</p>
          <div className="pause-actions">
            <button className="btn primary big" onClick={() => controller.resume()}>
              继续游戏
            </button>
            <button className="btn" onClick={() => setShowRules(true)}>
              查看规则
            </button>
            <button className="btn" onClick={onHome}>
              返回首页（保留存档）
            </button>
          </div>
        </Modal>
      )}

      {showRules && (
        <Modal title="规则" onClose={() => setShowRules(false)}>
          <RulesContent />
        </Modal>
      )}
    </div>
  );
}

function Seat({
  pos,
  cfg,
  player,
  game,
  isCurrent,
  targetable,
  selected,
  onClick,
}: {
  pos: 'left' | 'top' | 'right';
  cfg: SeatConfig;
  player: PlayerState;
  game: GameState;
  isCurrent: boolean;
  targetable: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const last = lastActionText(game.log, cfg.seat, SEAT_NAMES);
  const out = player.status !== 'active';
  const settled = game.phase === 'settled';
  const cls = ['seat', `seat-${pos}`, isCurrent ? 'current' : '', out ? 'out' : '', targetable ? 'targetable' : '', selected ? 'selected' : '']
    .filter(Boolean)
    .join(' ');
  const inner = (
    <>
      <div className="seat-head">
        <span className="avatar">{cfg.avatar}</span>
        <div className="seat-title">
          <b>{cfg.name}</b>
          <span className="badge">电脑 · {cfg.styleLabel}</span>
        </div>
      </div>
      <div className="seat-body">
        {/* 局内只显示牌背；本局彻底结束后才翻开 */}
        <CardRow cards={settled ? game.hands[cfg.seat] : null} faceUp={settled} size="sm" dim={out} />
        <div className="seat-stats">
          <span className="chips">
            积分 <b>{player.chips}</b>
          </span>
          <span className={`tag ${player.seen ? 'seen' : ''}`}>{player.seen ? '已看牌' : '未看牌'}</span>
          <span className={`tag status-${player.status}`}>{isCurrent ? '思考中…' : statusLabel(player, isCurrent)}</span>
        </div>
      </div>
      <div className="seat-last" key={last ?? ''}>
        {last ?? '—'}
      </div>
    </>
  );
  return targetable ? (
    <button className={cls} onClick={onClick} aria-label={`选择 ${cfg.name} 作为比牌对象`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function Center({ game }: { game: GameState }) {
  const latest = [...game.log].reverse().find((e) => e.kind !== 'round' && e.kind !== 'ante');
  return (
    <div className="center">
      <div className="pot">
        <span>公共积分</span>
        <b key={game.pot} className="pot-num">
          {game.pot}
        </b>
      </div>
      <div className="levels" aria-label={`当前基础档位 ${game.level}`}>
        <span>基础档位</span>
        {LEVELS.map((l) => (
          <i key={l} className={l === game.level ? 'on' : l < game.level ? 'past' : ''}>
            {l}
          </i>
        ))}
      </div>
      {latest && (
        <div key={latest.seq} className={`latest kind-${latest.kind}`}>
          {formatLog(latest, SEAT_NAMES)}
        </div>
      )}
    </div>
  );
}

function GameLog({ game }: { game: GameState }) {
  const logRef = useRef<HTMLOListElement>(null);
  const entries = game.log.filter((e) => e.kind !== 'ante');
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [game.log.length]);
  return (
    <aside className="game-log" aria-label="对局记录">
      <h2>对局记录</h2>
      <ol className="log" ref={logRef} tabIndex={0} aria-label="滚动查看行动记录">
        {entries.map((e) => (
          <li key={e.seq} className={`kind-${e.kind}`}>
            {formatLog(e, SEAT_NAMES)}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ActBtn({ opt, label, onClick, blocked, className = '', showReason }: { opt: ActionOption; label: string; onClick: () => void; blocked: boolean; className?: string; showReason: boolean }) {
  const reason = showReason && !opt.allowed ? opt.reason : null;
  return (
    <div className={`act ${className} ${reason ? 'has-reason' : ''}`}>
      <button className="btn act-btn" disabled={!opt.allowed || blocked} onClick={onClick} title={opt.reason}>
        {label}
      </button>
      {reason && <small className="reason">{reason}</small>}
    </div>
  );
}

function ActionBar({
  opts,
  mode,
  blocked,
  onAct,
  onMode,
  waitingText,
}: {
  opts: ReturnType<typeof getActionOptions>;
  mode: Mode;
  blocked: boolean;
  onAct: (a: Action) => void;
  onMode: (m: Mode) => void;
  waitingText: string | null;
}) {
  if (mode.kind === 'select') {
    return (
      <div className="compare-panel">
        <p>
          选择比牌对象 · 消耗 <b>{opts.compare.cost}</b>
        </p>
        <div className="row wrap">
          {opts.compare.targets.map((t) => (
            <button key={t} className="btn" onClick={() => onMode({ kind: 'confirm', target: t })}>
              {SEAT_NAMES[t]}
            </button>
          ))}
          <button className="btn subtle" onClick={() => onMode({ kind: 'idle' })}>
            取消
          </button>
        </div>
      </div>
    );
  }
  if (mode.kind === 'confirm') {
    return (
      <div className="compare-panel">
        <p>
          与 <b>{SEAT_NAMES[mode.target]}</b>（{SEATS[mode.target].styleLabel}）比牌 · 消耗 <b>{opts.compare.cost}</b>
        </p>
        <p className="muted small">牌力小者出局，完全相同则发起者出局。双方牌面不公开。</p>
        <div className="row">
          <button className="btn primary" disabled={blocked || !opts.compare.allowed} onClick={() => onAct({ type: 'compare', target: mode.target })}>
            确认比牌
          </button>
          <button className="btn" onClick={() => onMode({ kind: 'select' })}>
            换一个对象
          </button>
          <button className="btn subtle" onClick={() => onMode({ kind: 'idle' })}>
            取消
          </button>
        </div>
      </div>
    );
  }

  const showReason = opts.isTurn;
  return (
    <div className="action-wrap">
      <div className="action-status" aria-live="polite">
        {waitingText ?? (opts.look.reason === REASON.seen ? '轮到你了：选择一个动作' : '轮到你了：可先看牌，再选择一个动作')}
      </div>
      <div className="actions">
        <ActBtn className="a-look" opt={opts.look} label={opts.look.reason === REASON.seen ? '已看牌' : '看牌'} onClick={() => onAct({ type: 'look' })} blocked={blocked} showReason={showReason && opts.look.reason !== REASON.seen} />
        <ActBtn className="a-call" opt={opts.call} label={`跟进 ${opts.call.cost}`} onClick={() => onAct({ type: 'call' })} blocked={blocked} showReason={showReason} />
        <ActBtn
          className="a-raise"
          opt={opts.raise}
          label={opts.raise.newLevel ? `加码至 ${opts.raise.newLevel} · 消耗 ${opts.raise.cost}` : '加码'}
          onClick={() => onAct({ type: 'raise' })}
          blocked={blocked}
          showReason={showReason || !opts.raise.newLevel}
        />
        <ActBtn className="a-compare" opt={opts.compare} label={`比牌 ${opts.compare.cost}`} onClick={() => onMode({ kind: 'select' })} blocked={blocked} showReason={showReason} />
        <ActBtn className="a-fold" opt={opts.fold} label="弃牌" onClick={() => onAct({ type: 'fold' })} blocked={blocked} showReason={false} />
      </div>
    </div>
  );
}
