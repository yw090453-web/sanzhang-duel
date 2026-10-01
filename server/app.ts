import Koa from 'koa';
import serve from 'koa-static';
import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { Server, type Socket } from 'socket.io';
import type { OnlineSnapshot, CommandReply } from '../src/online/types';
import { action, addPlayer, expireTurn, leave, newPlayer, newRoom, nickname, playerId, requireThat, setReady, summary, TURN_MS, view, type Room } from './rooms';

interface Session { id: string; token: string; roomCode: string | null; socketId: string | null; lastSeen: number }
interface ServerOptions { turnMs?: number; reconnectMs?: number; idleMs?: number; staticDir?: string; allowedOrigins?: string[] }
export function createGameServer(config: ServerOptions = {}) {
  const app = new Koa();
  const http = createServer(app.callback());
  const rooms = new Map<string, Room>();
  const sessions = new Map<string, Session>();
  const turnMs = config.turnMs ?? TURN_MS;
  const reconnectMs = config.reconnectMs ?? 120_000;
  const idleMs = config.idleMs ?? 30 * 60_000;
  const allowed = config.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const originAllowed = (origin: string | undefined, host: string | undefined) => {
    if (!origin) return true; // native/test clients still have to own their session token
    try { return new URL(origin).host === host || allowed.includes(origin); } catch { return false; }
  };
  const io = new Server(http, {
    maxHttpBufferSize: 8192,
    serveClient: false,
    allowRequest: (req, done) => done(null, originAllowed(req.headers.origin, req.headers.host)),
  });
  app.use(async (ctx, next) => {
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('Referrer-Policy', 'same-origin');
    if (ctx.path === '/api/health') { ctx.body = { ok: true, mode: 'room-points-only', rooms: rooms.size }; return; }
    await next();
  });
  // Only the production frontend is public. server/, vendor/ and all source files are excluded.
  app.use(serve(config.staticDir ?? resolve('dist'), { hidden: false, maxage: 0 }));

  function snapshot(session: Session): OnlineSnapshot {
    const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
    return { playerId: session.id, room: room ? view(room, session.id) : null,
      rooms: [...rooms.values()].map(summary), serverTime: Date.now() };
  }
  function emitState(session: Session) {
    if (session.socketId) io.to(session.socketId).emit('state', snapshot(session));
  }
  function publish() { for (const s of sessions.values()) if (s.socketId) emitState(s); }
  function roomFor(s: Session) {
    const room = s.roomCode ? rooms.get(s.roomCode) : undefined;
    requireThat(room && room.players.some(p => p.id === s.id && p.status !== 'left'), '你不在房间中');
    return room;
  }
  function removeFromRoom(s: Session) {
    const room = s.roomCode ? rooms.get(s.roomCode) : undefined;
    if (room) {
      leave(room, s.id, turnMs);
      if (!room.players.some(p => p.status !== 'left')) rooms.delete(room.code);
    }
    s.roomCode = null;
  }
  const connections = new Map<string, { start: number; count: number }>();
  io.use((socket, next) => {
    const ip = socket.handshake.address;
    const bucket = connections.get(ip) ?? { start: Date.now(), count: 0 };
    if (Date.now() - bucket.start > 60_000) { bucket.start = Date.now(); bucket.count = 0; }
    connections.set(ip, bucket);
    if (++bucket.count > 60) { next(new Error('连接过于频繁，请稍后重试')); return; }
    const token: unknown = socket.handshake.auth?.token;
    let session = typeof token === 'string' ? sessions.get(token) : undefined;
    if (!session) {
      if (sessions.size >= 2000) { next(new Error('当前服务繁忙，请稍后再试')); return; }
      const token = randomBytes(32).toString('hex');
      session = { id: playerId(), token, socketId: null, roomCode: null, lastSeen: Date.now() };
      sessions.set(token, session);
      socket.data.expired = !!socket.handshake.auth?.token;
    }
    socket.data.session = session;
    next();
  });
  io.on('connection', (socket: Socket) => {
    const s = socket.data.session as Session;
    const previous = s.socketId;
    s.socketId = socket.id; s.lastSeen = Date.now();
    if (previous && previous !== socket.id) {
      io.to(previous).emit('replaced');
      io.sockets.sockets.get(previous)?.disconnect(true);
    }
    if (s.roomCode) {
      const p = rooms.get(s.roomCode)?.players.find(p => p.id === s.id);
      if (p) p.connected = true;
      else s.roomCode = null;
    }
    socket.emit('session', { token: s.token, playerId: s.id, expired: socket.data.expired === true });
    publish();
    let events = 0; let windowStart = Date.now();
    socket.on('command', (raw: unknown, ack?: (reply: CommandReply) => void) => {
      try {
        requireThat(s.socketId === socket.id, '当前身份已在另一窗口打开');
        if (Date.now() - windowStart > 10_000) { events = 0; windowStart = Date.now(); }
        requireThat(++events <= 45, '操作太快了，请稍候');
        requireThat(raw && typeof raw === 'object' && !Array.isArray(raw), '操作格式无效');
        const data = raw as Record<string, unknown>;
        requireThat(typeof data.kind === 'string', '操作格式无效');
        s.lastSeen = Date.now();
        switch (data.kind) {
          case 'createRoom': {
            requireThat(!s.roomCode, '请先退出当前房间');
            requireThat(rooms.size < 100, '房间数量已满，请稍后再试');
            const name = nickname(data.name);
            const capacity = data.capacity ?? 8;
            requireThat(capacity === 4 || capacity === 6 || capacity === 8, '人数上限无效');
            let code: string;
            do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
            rooms.set(code, newRoom(code, newPlayer(s.id, name), capacity));
            s.roomCode = code; break;
          }
          case 'joinRoom': {
            requireThat(!s.roomCode, '请先退出当前房间');
            requireThat(typeof data.code === 'string' && /^\d{6}$/.test(data.code), '请输入 6 位房间码');
            const room = rooms.get(data.code);
            requireThat(room, '房间不存在或已结束');
            addPlayer(room, newPlayer(s.id, nickname(data.name)));
            s.roomCode = room.code; break;
          }
          case 'leaveRoom': removeFromRoom(s); break;
          case 'ready': setReady(roomFor(s), s.id, data.ready, turnMs); break;
          case 'look': case 'call': case 'raise': case 'compare': case 'fold':
            action(roomFor(s), s.id, data.kind, data, turnMs); break;
          case 'sync': emitState(s); break;
          default: throw new Error('不支持的操作');
        }
        if (typeof ack === 'function') ack({ ok: true });
        publish();
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, error: e instanceof Error ? e.message : '操作失败' });
        emitState(s);
      }
    });
    socket.on('disconnect', () => {
      if (s.socketId !== socket.id) return;
      s.socketId = null; s.lastSeen = Date.now();
      const p = s.roomCode ? rooms.get(s.roomCode)?.players.find(p => p.id === s.id) : undefined;
      if (p) { p.connected = false; p.ready = false; }
      publish();
    });
  });
  const timer = setInterval(() => {
    let changed = false;
    for (const room of rooms.values()) {
      changed = expireTurn(room, turnMs) || changed;
      if (Date.now() - room.touchedAt > idleMs) {
        for (const s of sessions.values()) if (s.roomCode === room.code) {
          s.roomCode = null;
          if (s.socketId) io.to(s.socketId).emit('notice', '房间长时间无操作，已自动关闭');
        }
        rooms.delete(room.code); changed = true;
      }
    }
    for (const [token, s] of sessions) {
      if (!s.socketId && Date.now() - s.lastSeen > reconnectMs && s.roomCode) { removeFromRoom(s); changed = true; }
      if (!s.socketId && !s.roomCode && Date.now() - s.lastSeen > 24 * 60 * 60_000) sessions.delete(token);
    }
    for (const [ip, bucket] of connections) if (Date.now() - bucket.start > 60_000) connections.delete(ip);
    if (changed) publish();
  }, 250);
  timer.unref();
  return { http, io, rooms, close: () => new Promise<void>(resolve => { clearInterval(timer); io.close(() => resolve()); }) };
}
