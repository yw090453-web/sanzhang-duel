import { createGameServer } from './app';
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const game = createGameServer();
game.http.listen(port, host, () => console.log(`静夜牌桌已启动：http://localhost:${port}（局域网可使用本机 IP）`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void game.close().then(() => process.exit(0)); });
