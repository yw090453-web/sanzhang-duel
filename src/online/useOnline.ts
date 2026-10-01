import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { CommandReply, OnlineCommand, OnlineSnapshot } from './types';

const TOKEN_KEY = 'night-table-session';
export function readLocal(key: string) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }
export function saveLocal(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* The current tab can still play without persistence. */ } }
export function useOnline() {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<OnlineSnapshot | null>(null);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline' | 'replaced'>('connecting');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const offset = useRef(0);
  useEffect(() => {
    const socket = io({ auth: { token: readLocal(TOKEN_KEY) }, timeout: 8000, reconnectionDelayMax: 5000 });
    socketRef.current = socket;
    socket.on('connect', () => { setStatus('online'); setError(''); });
    socket.on('session', (s: { token: string; expired: boolean }) => {
      socket.auth = { token: s.token };
      saveLocal(TOKEN_KEY, s.token);
      if (s.expired) setError('上次的联机身份已过期，请重新创建或加入房间');
    });
    socket.on('state', (s: OnlineSnapshot) => {
      offset.current = s.serverTime - Date.now();
      setState(s); saveLocal('night-table-room', s.room?.code ?? '');
    });
    socket.on('connect_error', () => { setStatus('offline'); setError('暂时连接不上牌桌服务，正在重试。请确认服务器已启动。'); });
    socket.on('disconnect', reason => { if (reason !== 'io server disconnect') setStatus('offline'); });
    socket.on('replaced', () => { setStatus('replaced'); setError('这个玩家身份已在另一个窗口打开。每位玩家请使用自己的浏览器。'); });
    socket.on('notice', (message: string) => setError(message));
    return () => { socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, []);
  const command = useCallback(async (kind: OnlineCommand, data: Record<string, unknown> = {}) => {
    const socket = socketRef.current;
    if (inFlight.current || !socket?.connected) return false;
    inFlight.current = true; setPending(true); setError('');
    try {
      const reply = await socket.timeout(6000).emitWithAck('command', { kind, ...data }) as CommandReply;
      if (!reply.ok) setError(reply.error ?? '操作失败，请重试');
      return reply.ok;
    } catch {
      setError('未收到操作确认，请等待牌桌同步后再操作');
      if (socket.connected) socket.emit('command', { kind: 'sync' });
      return false;
    } finally { inFlight.current = false; setPending(false); }
  }, []);
  const reconnect = () => { setStatus('connecting'); socketRef.current?.connect(); };
  return { state, status, error, pending, command, reconnect, offset, setError };
}
