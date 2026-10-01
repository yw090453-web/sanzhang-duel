/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // 不对源码路径做 realpath 解析：在 Windows 打包应用的虚拟化目录中，
  // realpath 会指向本进程无法读取的重定向路径，导致开发服务器加载失败。
  resolve: { preserveSymlinks: true },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
      '/api': { target: 'http://127.0.0.1:3001' },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
