// Development-only peers for checking the eight-seat responsive layout.
// Run: node scripts/qa-peers.mjs ROOM_CODE [http://localhost:3001]
import { io } from 'socket.io-client';
const code = process.argv[2];
if (!/^\d{6}$/.test(code ?? '')) throw new Error('Provide the six-digit test room code');
const sockets = [];
for (const name of ['石衡', '赤焰', '听雨', '远山', '星河', '小满']) {
  const s = io(process.argv[3] ?? 'http://localhost:3001', { autoConnect: false, forceNew: true });
  sockets.push(s);
  await new Promise(resolve => { s.once('state', resolve); s.connect(); });
  const joined = await s.timeout(2000).emitWithAck('command', { kind: 'joinRoom', code, name });
  if (!joined.ok) throw new Error(joined.error);
}
for (const s of sockets) await s.timeout(2000).emitWithAck('command', { kind: 'ready', ready: true });
console.log('Six independent test peers have joined and are ready.');
process.on('SIGINT', async () => {
  for (const s of sockets) { await s.timeout(1000).emitWithAck('command', { kind: 'leaveRoom' }).catch(() => {}); s.disconnect(); }
  process.exit(0);
});
