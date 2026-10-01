import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app';
import { action, addPlayer, newPlayer, newRoom, setReady, view } from '../server/rooms';
import type { CommandReply, OnlineSnapshot } from '../src/online/types';
import type { AddressInfo } from 'node:net';

type Game = ReturnType<typeof createGameServer>;
type Client = { socket: Socket; state: OnlineSnapshot; token: string };
const games: Game[] = [];
const clients: Client[] = [];
afterEach(async () => { clients.splice(0).forEach(c => c.socket.disconnect()); await Promise.all(games.splice(0).map(g => g.close())); });
async function setup(options: Parameters<typeof createGameServer>[0] = {}) {
  const game = createGameServer(options); games.push(game);
  await new Promise<void>(resolve => game.http.listen(0, '127.0.0.1', resolve));
  return { game, url: `http://127.0.0.1:${(game.http.address() as AddressInfo).port}` };
}
async function connect(url: string, token?: string) {
  const socket = io(url, { autoConnect: false, forceNew: true, auth: { token }, transports: ['websocket'] });
  const c = { socket, token: '', state: null as unknown as OnlineSnapshot };
  socket.on('session', data => { c.token = data.token; });
  socket.on('state', data => { c.state = data; });
  clients.push(c);
  await new Promise<void>((resolve, reject) => { socket.once('state', () => resolve()); socket.once('connect_error', reject); socket.connect(); });
  return c;
}
async function cmd(c: Client, kind: string, extra: Record<string, unknown> = {}): Promise<CommandReply> {
  const r = await c.socket.timeout(1000).emitWithAck('command', { kind, gameNumber: c.state.room?.gameNumber, turnId: c.state.room?.turnId, ...extra });
  await new Promise(resolve => setTimeout(resolve, 12));
  return r;
}
async function pair(options: Parameters<typeof createGameServer>[0] = {}) {
  const { game, url } = await setup(options);
  const a = await connect(url); const b = await connect(url);
  expect((await cmd(a, 'createRoom', { name: '甲', capacity: 8 })).ok).toBe(true);
  const code = a.state.room!.code;
  expect((await cmd(b, 'joinRoom', { code, name: '乙' })).ok).toBe(true);
  await cmd(a, 'ready', { ready: true }); await cmd(b, 'ready', { ready: true });
  return { a, b, code, game, url };
}

describe('real socket multiplayer', () => {
  it('creates, joins and starts only after two players are ready; hides hands and tokens', async () => {
    const { game, url } = await setup(); const a = await connect(url);
    await cmd(a, 'createRoom', { name: '甲', capacity: 4 });
    await cmd(a, 'ready', { ready: true });
    expect(a.state.room?.phase).toBe('waiting');
    const b = await connect(url);
    await cmd(b, 'joinRoom', { code: a.state.room!.code, name: '乙' });
    expect(a.state.room?.players.every(p => !p.ready)).toBe(true);
    await cmd(a, 'ready', { ready: true }); await cmd(b, 'ready', { ready: true });
    expect(a.state.room?.phase).toBe('playing'); expect(b.state.room?.pot).toBe(2);
    expect(a.state.room?.myCards).toBeNull(); expect(b.state.room?.myCards).toBeNull();
    expect(JSON.stringify(a.state)).not.toContain('hands'); expect(JSON.stringify(a.state)).not.toContain(b.token);
    expect(game.rooms.get(a.state.room!.code)?.hands.size).toBe(2);
  });
  it('identifies players by session, rejects out-of-turn/first-round compare and forged room/player fields', async () => {
    const { a, b, url } = await pair();
    expect((await cmd(b, 'call', { username: '甲', playerId: a.state.playerId })).ok).toBe(false);
    expect(a.state.room?.pot).toBe(2);
    expect((await cmd(a, 'compare', { target: b.state.playerId })).ok).toBe(false);
    const stranger = await connect(url);
    expect((await cmd(stranger, 'fold', { id: a.state.room?.code, username: '甲' })).ok).toBe(false);
    expect((await cmd(stranger, 'destroyRoom', { id: a.state.room?.code })).ok).toBe(false);
    expect(a.state.room?.phase).toBe('playing');
  });
  it('look reveals only own cards, invalidates stale actions and doubles the server-computed cost', async () => {
    const { a, b } = await pair(); const oldTurn = a.state.room!.turnId;
    await cmd(a, 'look');
    expect(a.state.room?.myCards).toHaveLength(3); expect(b.state.room?.myCards).toBeNull();
    expect((await cmd(a, 'call', { turnId: oldTurn })).ok).toBe(false);
    await cmd(a, 'call', { currBase: -10000, amount: -10000 });
    expect(a.state.room?.pot).toBe(4); expect(a.state.room?.currentId).toBe(b.state.playerId);
    expect((await cmd(a, 'call')).ok).toBe(false);
  });
  it('settles exactly once and preserves zero-sum scores; next hand resets readiness and cards', async () => {
    const { a, b } = await pair();
    await cmd(a, 'fold');
    expect(a.state.room?.phase).toBe('settled'); expect(a.state.room?.result?.winners).toEqual([b.state.playerId]);
    expect(a.state.room?.players.map(p => p.score)).toEqual([-1, 1]);
    expect((await cmd(a, 'fold')).ok).toBe(false);
    await cmd(a, 'ready', { ready: true }); await cmd(b, 'ready', { ready: true });
    expect(a.state.room?.gameNumber).toBe(2); expect(a.state.room?.currentId).toBe(b.state.playerId);
    expect(a.state.room?.myCards).toBeNull(); expect(a.state.room?.result).toBeNull();
    await cmd(b, 'call'); expect(a.state.room?.round).toBe(1);
    await cmd(a, 'call'); expect(a.state.room?.round).toBe(2);
  });
  it('reconnects the same seat, restores only its own seen hand and replaces the old socket', async () => {
    const { a, b, url } = await pair(); await cmd(a, 'look');
    const cards = a.state.room!.myCards; const id = a.state.playerId;
    a.socket.disconnect(); await new Promise(resolve => setTimeout(resolve, 25));
    expect(b.state.room?.players.find(p => p.id === id)?.connected).toBe(false);
    const again = await connect(url, a.token);
    expect(again.state.playerId).toBe(id); expect(again.state.room?.myCards).toEqual(cards);
    expect(again.state.room?.players).toHaveLength(2);
    const replacement = await connect(url, a.token);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(again.socket.connected).toBe(false); expect(replacement.socket.connected).toBe(true);
  });
  it('explicit leave folds and transfers ownership; deleting last seat removes room', async () => {
    const { a, b, game } = await pair(); await cmd(a, 'leaveRoom');
    expect(a.state.room).toBeNull(); expect(b.state.room?.phase).toBe('settled');
    expect(b.state.room?.ownerId).toBe(b.state.playerId); expect(b.state.room?.players).toHaveLength(1);
    expect(b.state.room?.result?.players.reduce((sum, p) => sum + p.net, 0)).toBe(0);
    await cmd(b, 'leaveRoom'); expect(game.rooms.size).toBe(0);
  });
  it('times out turns and removes disconnected seats after the reconnect grace period', async () => {
    const { a, b } = await pair({ turnMs: 60, reconnectMs: 100 });
    a.socket.disconnect();
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(b.state.room?.phase).toBe('settled'); expect(b.state.room?.players).toHaveLength(1);
    expect(b.state.room?.result?.winners).toEqual([b.state.playerId]);
  });
  it('isolates rooms and refuses joining a running hand', async () => {
    const { a, b, url } = await pair(); const c = await connect(url);
    expect((await cmd(c, 'joinRoom', { name: '丙', code: a.state.room!.code })).ok).toBe(false);
    await cmd(c, 'createRoom', { name: '丙' });
    const other = c.state.room!.code;
    await cmd(a, 'fold'); expect(c.state.room?.code).toBe(other); expect(c.state.room?.phase).toBe('waiting');
    expect(c.state.room?.result).toBeNull(); expect(b.state.room?.phase).toBe('settled');
  });
  it('rejects invalid input, capacity overflow and duplicate nicknames', async () => {
    const { url } = await setup(); const a = await connect(url);
    expect((await cmd(a, 'createRoom', { name: '', capacity: 4 })).ok).toBe(false);
    expect((await cmd(a, 'createRoom', { name: '甲', capacity: 999 })).ok).toBe(false);
    await cmd(a, 'createRoom', { name: '甲', capacity: 4 }); const code = a.state.room!.code;
    const b = await connect(url);
    expect((await cmd(b, 'joinRoom', { name: '甲', code })).ok).toBe(false);
    expect((await cmd(b, 'joinRoom', { name: '乙', code: '../' })).ok).toBe(false);
    await cmd(b, 'joinRoom', { name: '乙', code });
    for (const name of ['丙', '丁']) await cmd(await connect(url), 'joinRoom', { name, code });
    const e = await connect(url); expect((await cmd(e, 'joinRoom', { name: '戊', code })).ok).toBe(false);
    expect((await cmd(a, 'ready', { ready: 'yes' })).ok).toBe(false);
  });
  it('exposes a health check but no payment routes or original source files', async () => {
    const { url } = await setup();
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    for (const path of ['/api/recharge', '/api/payment', '/api/withdraw', '/server/app.ts', '/vendor/zjh-backend.zip']) {
      expect((await fetch(`${url}${path}`)).status).toBe(404);
    }
  });
});

describe('multiplayer rules', () => {
  function room() { const r = newRoom('123456', newPlayer('a', '甲'), 8); addPlayer(r, newPlayer('b', '乙')); setReady(r, 'a', true); setReady(r, 'b', true); return r; }
  it('deals 24 unique cards for eight players', () => {
    const r = newRoom('123456', newPlayer('0', '0'), 8);
    for (let i = 1; i < 8; i++) addPlayer(r, newPlayer(String(i), String(i)));
    for (let i = 0; i < 8; i++) setReady(r, String(i), true);
    const cards = [...r.hands.values()].flat();
    expect(cards).toHaveLength(24); expect(new Set(cards.map(c => c.suit + c.rank)).size).toBe(24);
  });
  it('caps the base at 5 and equal comparisons eliminate the initiator', () => {
    const r = room();
    for (let i = 0; i < 4; i++) action(r, r.currentId!, 'raise', { turnId: r.turnId, gameNumber: 1 });
    expect(r.base).toBe(5); expect(view(r, r.currentId!).options.raise).toBe(false);
    expect(() => action(r, r.currentId!, 'raise', { turnId: r.turnId, gameNumber: 1 })).toThrow();
    r.hands.set('a', [{ rank: 14, suit: 'S' }, { rank: 14, suit: 'H' }, { rank: 2, suit: 'D' }]);
    r.hands.set('b', [{ rank: 14, suit: 'C' }, { rank: 14, suit: 'D' }, { rank: 2, suit: 'H' }]);
    action(r, 'a', 'compare', { target: 'b', turnId: r.turnId, gameNumber: 1 });
    expect(r.result?.winners).toEqual(['b']); expect(r.result?.players.reduce((s, p) => s + p.net, 0)).toBe(0);
  });
  it('forces showdown at 20 rounds so a game cannot run forever', () => {
    const r = room();
    for (let i = 0; i < 40; i++) action(r, r.currentId!, 'call', { turnId: r.turnId, gameNumber: 1 });
    expect(r.phase).toBe('settled'); expect(r.result?.reason).toContain('20');
    expect(r.result?.players.reduce((s, p) => s + p.net, 0)).toBe(0);
  });
});
