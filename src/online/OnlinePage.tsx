import { useEffect, useState } from 'react';
import { CardRow } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { handName } from '../engine/hand';
import { signed } from '../ui/format';
import { readLocal, saveLocal, useOnline } from './useOnline';
import type { OnlineCommand } from './types';
import './online.css';

export function OnlinePage({ onHome }: { onHome: () => void }) {
  const net = useOnline();
  const { state, status, error, pending, command } = net;
  const [name, setName] = useState(() => readLocal('night-table-name'));
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [capacity, setCapacity] = useState(8);
  const [dialog, setDialog] = useState<'rules' | 'leave' | 'invite' | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const room = state?.room;
  const me = room?.players.find(p => p.id === state?.playerId);
  const canSend = status === 'online' && !!state && !pending;
  const isTurn = room?.currentId === state?.playerId;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  useEffect(() => setTarget(null), [room?.turnId, room?.gameNumber, room?.code]);
  useEffect(() => { if (room) setDialog(null); }, [room?.code]);
  const seconds = room?.deadline ? Math.min(45, Math.max(0, Math.ceil((room.deadline - now - net.offset.current) / 1000))) : 0;
  const play = (kind: OnlineCommand, extra: Record<string, unknown> = {}) => command(kind, { gameNumber: room?.gameNumber, turnId: room?.turnId, ...extra });
  const enter = async (kind: 'createRoom' | 'joinRoom', roomCode = code) => {
    if (!name.trim()) { net.setError('先给自己起个昵称吧'); document.getElementById('online-name')?.focus(); return; }
    saveLocal('night-table-name', name.trim());
    await command(kind, { name, code: roomCode.trim(), capacity });
  };
  const inviteUrl = () => { const url = new URL(location.href); url.search = ''; url.searchParams.set('room', room!.code); url.hash = ''; return url.toString(); };
  const copyInvite = async () => {
    setCopied(false); setDialog('invite');
    try { await navigator.clipboard.writeText(inviteUrl()); setCopied(true); } catch { /* Visible selectable URL is the fallback on LAN HTTP. */ }
  };
  const goHome = () => {
    if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
    onHome();
  };
  return <div className="online-page">
    <header className="online-header">
      <div className="game-brand"><span>三张·对决</span><small>静夜牌桌</small></div>
      <div className="online-top-actions">
        <span className={`connection ${status}`} role="status">{status === 'online' ? '已连接' : status === 'connecting' ? '连接中' : status === 'replaced' ? '已在别处打开' : '连接中断'}</span>
        <button className="btn small" onClick={() => setDialog('rules')}>规则</button>
        <button className="btn small" onClick={() => room ? setDialog('leave') : goHome()}>{room ? '离桌' : '返回首页'}</button>
      </div>
    </header>
    {error && <div className="online-message" role="alert">{error}
      {(status === 'offline' || status === 'replaced') && <button className="btn small" onClick={net.reconnect}>重新连接</button>}
    </div>}
    {room && status !== 'online' && <p className="online-message" role="status">正在恢复连接，操作暂不可用。重连会恢复你的座位，行动超时会自动弃牌。</p>}
    {!room ? <main className="online-lobby">
      <section className="lobby-intro"><p className="lobby-kicker">与 熟 悉 的 人，开 一 桌</p><h1>今晚，谁来赴局？</h1><p>2–8 位好友，三张手牌。<br />创建牌桌，分享房间码，即可相聚。</p><div className="lobby-cards"><CardRow cards={null} faceUp={false} size="lg" /></div><span className="muted">手机和电脑均可加入 · 无需注册</span></section>
      <section className="lobby-form panel" aria-label="创建或加入联机房间">
        <label htmlFor="online-name">你的牌桌昵称</label>
        <input id="online-name" autoComplete="nickname" maxLength={12} placeholder="例如：夜归人" value={name} onChange={e => setName(e.target.value)} />
        <div className="lobby-create"><label htmlFor="capacity">牌桌人数上限</label><select id="capacity" value={capacity} onChange={e => setCapacity(Number(e.target.value))}><option value={4}>4 人</option><option value={6}>6 人</option><option value={8}>8 人</option></select></div>
        <button className="btn primary big" disabled={!canSend} onClick={() => void enter('createRoom')}>{pending ? '请稍候…' : '创建好友牌桌'}</button>
        <div className="lobby-divider">已有房间码</div>
        <form onSubmit={e => { e.preventDefault(); void enter('joinRoom'); }}>
          <label htmlFor="room-code">6 位房间码</label>
          <div className="join-row"><input id="room-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="输入房间码" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /><button className="btn" disabled={!canSend || code.length !== 6}>加入</button></div>
        </form>
        <p className="fine">积分仅记录本桌输赢，不可购买或兑换。</p>
      </section>
      <section className="available-rooms"><h2>正在等人的牌桌 <span>{state?.rooms.filter(r => !r.playing).length ?? 0}</span></h2>
        {!state?.rooms.some(r => !r.playing) ? <p className="muted">暂时没有等待中的牌桌。创建一桌，邀请朋友来吧。</p> : <div className="room-list">{state.rooms.filter(r => !r.playing).map(r => <button className="room-item" key={r.code} disabled={!canSend || r.count >= r.capacity} onClick={() => { setCode(r.code); void enter('joinRoom', r.code); }}><b>{r.owner}的牌桌</b><span>房间 {r.code} · {r.count}/{r.capacity} 人</span><em>{r.count >= r.capacity ? '已满' : '入座 →'}</em></button>)}</div>}
      </section>
    </main> : <main className="online-room">
      <div className="room-heading"><div><span className="lobby-kicker">好 友 联 机</span><h1>房间 <strong>{room.code}</strong></h1><p>{room.players.filter(p => p.status !== 'left').length}/{room.capacity} 人 · {room.phase === 'playing' ? `第 ${room.gameNumber} 局 · 第 ${room.round}/20 轮` : room.phase === 'settled' ? `第 ${room.gameNumber} 局已结束` : '等待朋友入座'}</p></div><button className="btn" onClick={() => void copyInvite()}>邀请好友</button></div>
      <section className="online-board" aria-label="联机牌桌">
        <div className="online-opponents">{room.players.filter(p => p.id !== state.playerId).map(p => <article className={`online-seat ${room.currentId === p.id ? 'current' : ''} ${room.phase === 'playing' && p.status !== 'active' ? 'out' : ''}`} key={p.id}>
          <div className="online-seat-name"><span className="avatar">{Array.from(p.name)[0]}</span><b>{p.name}</b></div>
          <span className="online-seat-state">{!p.connected ? '离线' : room.phase !== 'playing' ? p.ready ? '已准备' : '待准备' : p.status === 'folded' ? '已弃牌' : p.status === 'lost' ? '比牌落败' : p.status === 'left' ? '已离桌' : p.seen ? '已看牌' : '未看牌'}{p.id === room.ownerId ? ' · 房主' : ''}</span>
          <CardRow cards={room.phase === 'settled' ? room.result?.players.find(r => r.id === p.id)?.cards ?? null : null} faceUp={room.phase === 'settled'} size="sm" />
          <div className="online-seat-score"><span>成绩 <b className={p.score > 0 ? 'pos' : p.score < 0 ? 'neg' : ''}>{signed(p.score)}</b></span><small>本局投入 {p.invested}</small></div>
        </article>)}
        {room.players.length === 1 && <div className="empty-seat"><p>留一席，等好友</p><span>分享房间码 {room.code}，至少两人准备即可开局</span></div>}
        </div>
        <div className="online-pot"><span>{room.phase === 'playing' ? '公共积分' : room.phase === 'settled' ? '本局积分池' : '牌桌已就绪'}</span><b>{room.phase === 'waiting' ? '静候开局' : room.pot}</b><small>{room.phase === 'playing' ? `当前档位 ${room.base} · 看牌后投入翻倍` : '各自准备后，自动发牌'}</small></div>
        {room.phase === 'settled' && room.result && <section className="online-result" aria-label="本局结算"><h2>{room.result.winners.includes(state.playerId) ? '这一局，你赢了' : `${room.result.players.filter(p => room.result!.winners.includes(p.id)).map(p => p.name).join('、')} 获胜`}</h2><p>{room.result.reason} · 你的本局成绩 <b className={(room.result.players.find(p => p.id === state.playerId)?.net ?? 0) >= 0 ? 'pos' : 'neg'}>{signed(room.result.players.find(p => p.id === state.playerId)?.net ?? 0)}</b></p><details><summary>查看全部手牌与计分</summary><div className="result-players">{room.result.players.map(p => <div key={p.id}><b>{p.name}</b><CardRow cards={p.cards} faceUp size="sm" /><span>{handName(p.cards)} · {signed(p.net)}</span></div>)}</div></details></section>}
        {me && <section className={`online-self ${isTurn ? 'my-turn' : ''}`} aria-label="我的手牌">
          <div className="online-self-cards"><CardRow cards={room.myCards} faceUp={!!room.myCards} size="lg" /><span>{room.myCards ? handName(room.myCards) : room.phase === 'waiting' ? '准备后开始你的第一局' : '手牌未公开'}</span></div>
          <div className="online-self-info"><b>{me.name} <small>你{me.id === room.ownerId ? ' · 房主' : ''}</small></b><span>本桌成绩 <strong className={me.score >= 0 ? 'pos' : 'neg'}>{signed(me.score)}</strong></span><span>本局投入 <strong>{me.invested}</strong></span></div>
        </section>}
      </section>
      <section className="online-controls" aria-label="牌桌操作">
        {room.phase !== 'playing' ? <><p>{room.players.length < 2 ? '再来一位牌友，就能开局' : `已准备 ${room.players.filter(p => p.ready).length}/${room.players.length} 人${room.players.some(p => !p.connected) ? ' · 等待离线玩家重连' : ''}`}</p><button className={`btn big ${me?.ready ? '' : 'primary'}`} disabled={!canSend} onClick={() => void command('ready', { ready: !me?.ready })}>{me?.ready ? '取消准备' : room.phase === 'settled' ? '准备下一局' : '准备开局'}</button></> : <>
          <p className={isTurn ? 'turn-prompt' : ''} role="status">{me?.status !== 'active' ? `${me?.status === 'folded' ? '你已弃牌' : '你已出局'} · 观看剩余对局` : isTurn ? `轮到你了 · ${seconds} 秒` : `等待 ${room.players.find(p => p.id === room.currentId)?.name ?? '牌友'} 行动 · ${seconds} 秒`}</p>
          {target !== null ? <div className="online-compare"><p>与谁比牌？消耗 {room.options.compareCost} 积分</p><div className="row wrap">{room.options.compareTargets.map(id => <button className={`btn ${target === id ? 'primary' : ''}`} key={id} onClick={() => setTarget(id)}>{room.players.find(p => p.id === id)?.name}</button>)}</div>{target && <button className="btn primary" disabled={!canSend} onClick={async () => { if (await play('compare', { target })) setTarget(null); }}>确认比牌</button>}<button className="btn subtle" onClick={() => setTarget(null)}>取消</button></div> : <div className="online-action-grid">
            <button className="btn o-look" disabled={!canSend || !room.options.look} onClick={() => void play('look')}>{me?.seen ? '已看牌' : '看牌'}</button>
            <button className="btn" disabled={!canSend || !room.options.call || seconds === 0} onClick={() => void play('call')}>跟进 {room.options.callCost}</button>
            <button className="btn" disabled={!canSend || !room.options.raise || seconds === 0} onClick={() => void play('raise')}>{room.base < 5 ? `加码 ${room.options.raiseCost}` : '已达上限'}</button>
            <button className="btn" disabled={!canSend || room.options.compareTargets.length === 0 || seconds === 0} onClick={() => setTarget('')}>{room.round === 1 ? '首轮不比牌' : `比牌 ${room.options.compareCost}`}</button>
            <button className="btn o-fold" disabled={!canSend || !room.options.fold || seconds === 0} onClick={() => void play('fold')}>弃牌</button>
          </div>}
        </>}
      </section>
      <details className="online-log"><summary>对局记录 <span>{room.log.at(-1)?.text ?? '好友入座后，各自点击准备'}</span></summary><ol>{room.log.map(l => <li key={l.id}>{l.text}</li>)}</ol></details>
      <p className="online-fine">积分仅用于本桌计分 · 断线后 2 分钟内可恢复座位 · 每步 45 秒，超时自动弃牌</p>
    </main>}
    {dialog === 'rules' && <Modal title="好友牌桌 · 玩法" onClose={() => setDialog(null)}><div className="online-rules"><p>2–8 人联机，所有人准备后自动发牌。每人三张手牌，开局投入 1 积分。</p><p><b>牌型：</b>豹子 ＞ 同花顺 ＞ 同花 ＞ 顺子 ＞ 对子 ＞ 单张。A23 为最小顺子，不比较花色。</p><p><b>操作：</b>轮到你时可跟进、加码、比牌或弃牌；首轮不可比牌。看牌可随时进行，之后投入翻倍。暗牌档位 1–5 分，明牌 2–10 分。</p><p><b>胜负：</b>比牌小者出局，同牌型同点数时发起方出局。达到 20 轮自动摊牌，同牌力平分积分池，余数按座位顺序分配。</p><p><b>联机：</b>每步 45 秒，超时自动弃牌。离桌视为退出本局；掉线保留座位 2 分钟。所有手牌在结算后公开。</p><p><b>计分：</b>本桌成绩从 0 开始，允许负分，只记录输赢。不设充值、提现或付费道具。房间为临时对局，服务器重启会清空；空闲 30 分钟自动关闭。</p></div></Modal>}
    {dialog === 'leave' && <Modal title="离开这张牌桌？" onClose={() => setDialog(null)}><p>{room?.phase === 'playing' ? '离桌将退出本局，本局已投入积分不退回。其余玩家继续对局。' : '离桌后本桌成绩不再保留。房主离开时会自动移交房主。'}</p><div className="row"><button className="btn" onClick={() => setDialog(null)}>继续留在牌桌</button><button className="btn danger" disabled={!canSend} onClick={async () => { if (await command('leaveRoom')) { setDialog(null); if (location.search) history.replaceState(null, '', location.pathname); } }}>确认离桌</button></div></Modal>}
    {dialog === 'invite' && room && <Modal title="邀好友来一局" onClose={() => setDialog(null)}><p className="invite-code">{room.code}</p><p>{copied ? '邀请链接已复制，发给好友即可。' : '把房间码或下面的链接发给好友。'}</p><label htmlFor="invite-url">邀请链接</label><input className="invite-input" id="invite-url" value={inviteUrl()} readOnly onFocus={e => e.target.select()} /><p className="muted small">局域网游玩时，双方需连接同一 Wi-Fi，并使用电脑的局域网 IP 地址打开游戏。</p></Modal>}
  </div>;
}
