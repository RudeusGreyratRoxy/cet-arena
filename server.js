'use strict';

const { createArenaServer } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const arena = createArenaServer();
const { httpServer, io } = arena;

httpServer.listen(port, host, () => {
  console.log('');
  console.log('  CET Arena 已启动');
  console.log(`  本机访问:   http://localhost:${port}`);
  console.log(`  健康检查:   http://localhost:${port}/healthz`);
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});

httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。请关闭占用该端口的程序，或使用 PORT=3001 npm start。`);
  } else {
    console.error('HTTP 服务启动失败：', error);
  }
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务...`);
  arena.close().finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 避免未处理的 Promise 让进程悄悄异常退出。
process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 拒绝：', error);
});

module.exports = { arena, io };
