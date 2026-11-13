'use strict';

const os = require('os');
const fs = require('fs');
const { createArenaServer } = require('./src/app');
const { APP_VERSION } = require('./src/version');

/**
 * 生产环境启动守卫：缺少站长密码就拒绝启动，绝不静默降级。
 *
 * 背景：`src/adminAuth.js` 在「完全没配置」时会回落到仓库与 README 里都公开的默认口令
 * `boss2026`。一旦某次部署漏传 ADMIN_PASSWORD，线上后台就会悄悄退回这个人人皆知的密码，
 * 且没有任何告警——这是失效保护缺失，不是可用性优化。生产环境必须 fail closed：
 * 宁可起不来，也不能带着默认口令对外服务。
 *
 * 只在 NODE_ENV=production 时生效；本地开发（npm start / npm run dev）与自动化测试
 * （不设 NODE_ENV）保持原有默认值行为，不受影响。
 * 用 fs.writeSync(2, ...) 而非 console.error：确保退出码生效前提示已真正写到 stderr，
 * 否则管道场景下异步写可能被 process.exit 截断，测试与 PM2 日志都会看不到失败原因。
 */
function assertAdminPasswordInProduction() {
  if (process.env.NODE_ENV !== 'production') return;

  const raw = process.env.ADMIN_PASSWORD;
  const missing = raw == null || String(raw).trim() === '';
  if (!missing) return;

  const state = raw == null ? '未设置（环境变量不存在）' : '已设置但 trim 后为空';
  fs.writeSync(
    2,
    [
      '',
      '  [启动失败] 生产环境必须注入 ADMIN_PASSWORD 环境变量。',
      `  当前 NODE_ENV=production，ADMIN_PASSWORD ${state}。`,
      '  为避免后台口令静默回落到代码里的默认占位密码，服务已拒绝启动。',
      "  修复：ADMIN_PASSWORD='新密码' pm2 restart cet-arena --update-env && pm2 save",
      '',
    ].join('\n')
  );
  process.exit(1);
}

assertAdminPasswordInProduction();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const arena = createArenaServer();
const { httpServer, io } = arena;

/** 找出本机局域网 IPv4，方便手机同 WiFi 直连。 */
function lanAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(interfaces)) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) {
        result.push({ name, address: item.address });
      }
    }
  }
  return result;
}

httpServer.listen(port, host, () => {
  console.log('');
  console.log('  CET Arena 已启动');
  console.log(`  版本号:     ${APP_VERSION}`);
  console.log(`  监听地址:   ${host}:${port}`);
  console.log(`  本机访问:   http://localhost:${port}`);
  for (const entry of lanAddresses()) {
    console.log(`  手机访问:   http://${entry.address}:${port}   (${entry.name})`);
  }
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
