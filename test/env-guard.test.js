'use strict';

/**
 * 站长密码失效保护回归测试（方案 A）。
 *
 * 守两件事：
 * 1. 生产环境 `NODE_ENV=production` 下，`server.js` 在 ADMIN_PASSWORD 缺失或 trim 后为空时
 *    必须**拒绝启动**（退出码 1 + stderr 有明确中文提示），绝不静默降级成默认口令 boss2026；
 * 2. `src/adminAuth.js` 的解析规则：环境变量「已设置但为空」抛错、完全未设置才用本地默认值、
 *    有效值按 trim 后生效、显式 `options.password` 优先级最高。
 *
 * 实现说明：子进程的 stdout/stderr 重定向到**临时文件**而不是 `stdio: 'pipe'`。
 * DSH 沙箱禁止创建命名管道（管道会 EPERM），文件重定向在沙箱内外都稳定，
 * 也避免管道缓冲区打满导致的假死。
 */

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const { createAdminAuth, DEFAULT_PASSWORD } = require('../src/adminAuth');

let passed = 0;
function ok(name, condition, detail) {
  assert.ok(condition, detail ? `${name}：${detail}` : name);
  passed += 1;
  console.log(`ok - ${name}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-env-guard-'));

/** 启动一次 server.js，返回退出码与实际输出（不依赖管道）。 */
function runServer(envOverrides) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const outFile = path.join(tmpDir, `out-${stamp}.log`);
  const errFile = path.join(tmpDir, `err-${stamp}.log`);
  const outFd = fs.openSync(outFile, 'w');
  const errFd = fs.openSync(errFile, 'w');

  const env = { ...process.env };
  // 先彻底摘掉，避免受外层 shell/CI 已有值影响，保证用例可重复。
  delete env.ADMIN_PASSWORD;
  delete env.NODE_ENV;
  Object.assign(env, envOverrides);

  const result = spawnSync(process.execPath, [serverPath], {
    cwd: root,
    env,
    stdio: ['ignore', outFd, errFd],
    timeout: 20000,
  });

  fs.closeSync(outFd);
  fs.closeSync(errFd);

  return {
    status: result.status,
    signal: result.signal,
    stdout: fs.readFileSync(outFile, 'utf8'),
    stderr: fs.readFileSync(errFile, 'utf8'),
  };
}

// ---------------------------------------------------------------------------
// 1. 生产环境 + 未设置 ADMIN_PASSWORD → 退出码 1 + 明确提示
// ---------------------------------------------------------------------------
const noEnv = runServer({ NODE_ENV: 'production' });

ok('生产环境缺少 ADMIN_PASSWORD 时退出码为 1', noEnv.status === 1, `实际 ${noEnv.status}`);
ok(
  '未设置时 stderr 指出是 ADMIN_PASSWORD 未设置',
  noEnv.stderr.includes('ADMIN_PASSWORD') && noEnv.stderr.includes('未设置'),
  noEnv.stderr.slice(0, 200)
);
ok(
  '未设置时 stderr 明确说明已拒绝启动',
  noEnv.stderr.includes('拒绝启动'),
  noEnv.stderr.slice(0, 200)
);
ok(
  '拒绝启动时不会打印启动成功的横幅（没有静默降级）',
  !noEnv.stdout.includes('CET Arena 已启动'),
  noEnv.stdout.slice(0, 200)
);

// ---------------------------------------------------------------------------
// 2. 生产环境 + ADMIN_PASSWORD 只有空白 → 同样拒绝启动
// ---------------------------------------------------------------------------
const blankEnv = runServer({ NODE_ENV: 'production', ADMIN_PASSWORD: '   ' });

ok('生产环境 ADMIN_PASSWORD 为空白时退出码为 1', blankEnv.status === 1, `实际 ${blankEnv.status}`);
ok(
  '空白值时 stderr 指出「trim 后为空」',
  blankEnv.stderr.includes('trim 后为空'),
  blankEnv.stderr.slice(0, 200)
);

// ---------------------------------------------------------------------------
// 3. 非生产环境（不设 NODE_ENV）不受守卫影响：不会因缺密码直接退出。
//    用一个非法监听地址让它停在 listen 阶段快速失败，避免真的占用端口。
// ---------------------------------------------------------------------------
const devRun = runServer({ HOST: '256.256.256.256' });
ok(
  '非生产环境不会被密码守卫拦下',
  !devRun.stderr.includes('生产环境必须注入 ADMIN_PASSWORD'),
  devRun.stderr.slice(0, 200)
);
ok(
  '非生产环境确实进入了监听阶段（说明守卫只在 production 生效）',
  devRun.stderr.includes('HTTP 服务启动失败'),
  devRun.stderr.slice(0, 200)
);
ok('非生产环境监听失败时以退出码 1 结束', devRun.status === 1, `实际 ${devRun.status}`);

// ---------------------------------------------------------------------------
// 4. src/adminAuth.js 的解析规则
// ---------------------------------------------------------------------------
const savedEnv = process.env.ADMIN_PASSWORD;
const savedNodeEnv = process.env.NODE_ENV;

try {
  // 4a. 已设置但为空 → 抛错，绝不回落默认值
  process.env.ADMIN_PASSWORD = '   ';
  assert.throws(
    () => createAdminAuth(),
    /已设置但为空/,
    '空白环境变量必须抛错而不是回落默认口令'
  );
  ok('环境变量为空白时 createAdminAuth 抛错', true);

  // 4b. 完全未设置 → 回落本地默认值（npm run dev 与既有测试依赖这条）
  delete process.env.ADMIN_PASSWORD;
  ok(
    '完全未设置时回落到本地默认值',
    createAdminAuth().password === DEFAULT_PASSWORD
  );

  // 4c. 有效值 → trim 后生效（避免复制粘贴带入空白导致登录不上）
  process.env.ADMIN_PASSWORD = '  real-admin-pass  ';
  ok('有效值按 trim 后生效', createAdminAuth().password === 'real-admin-pass');

  // 4d. 显式 options.password 优先级最高
  ok(
    'options.password 优先于环境变量',
    createAdminAuth({ password: 'opt-pass' }).password === 'opt-pass'
  );

  // 4e. 显式传空串同样抛错，不静默使用环境变量或默认值
  assert.throws(
    () => createAdminAuth({ password: '  ' }),
    /已传入但为空/,
    '显式空密码必须抛错'
  );
  ok('显式传入空密码时抛错', true);
} finally {
  if (savedEnv === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = savedEnv;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`站长密码失效保护测试全部通过（${passed} 项断言）。`);
