'use strict';

/**
 * 站长后台鉴权。
 *
 * - 密码来源：显式传入 > 环境变量 ADMIN_PASSWORD > 本地默认占位值 `boss2026`。
 *   生产环境由 `server.js` 的启动守卫强制要求注入 ADMIN_PASSWORD，缺失或留空直接拒绝启动，
 *   因此默认占位值只在本地开发与自动化测试中生效。
 * - 环境变量「已设置但为空」（trim 后无内容）一律抛错，不静默回落默认值。
 * - 登录成功后发一个随机 token，存在服务端内存 Map 里，同时下发 HttpOnly Cookie，
 *   刷新页面不会掉线；服务重启或 token 过期需重新登录。
 * - 同一 IP 连续输错 5 次锁 10 分钟，避免后台密码被暴力枚举。
 */

const crypto = require('crypto');

const DEFAULT_PASSWORD = 'boss2026';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_LOCK_MS = 10 * 60 * 1000;

function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) {
    // 长度不等时也做一次等长比较，避免用响应耗时推测密码长度。
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/**
 * 决定站长密码来源。优先级：显式 `options.password` > 环境变量 `ADMIN_PASSWORD` > 本地默认值。
 *
 * 关键约束：**「设置了但为空」绝不回落默认值**。
 * 旧写法是 `options.password || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD`，
 * `||` 把空串当假值，于是 `ADMIN_PASSWORD=""`（注入失败、变量名写错、漏传值）会静默降级成
 * 仓库与 README 里都公开的 `boss2026`——这正是「失效保护缺失」要堵的口子。
 * 现在：显式传入或环境变量只要「非 null」，就必须 trim 后非空；为空直接抛错，
 * 由 `server.js` 的启动守卫在生产环境提前拦下（见 `assertAdminPasswordInProduction`）。
 * 真正「没设置」时才回落到本地默认值，保证 `npm run dev` 与测试不受影响。
 */
function resolvePassword(options = {}) {
  const explicit = options.password;
  if (explicit != null) {
    const trimmed = String(explicit).trim();
    if (trimmed === '') {
      throw new Error(
        '站长密码（options.password）已传入但为空，拒绝使用默认口令。'
      );
    }
    return trimmed;
  }

  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv != null) {
    const trimmed = String(fromEnv).trim();
    if (trimmed === '') {
      throw new Error(
        'ADMIN_PASSWORD 已设置但为空（trim 后无内容），拒绝回落到默认口令。' +
          '请注入非空密码，或删除该环境变量以使用本地默认值。'
      );
    }
    return trimmed;
  }

  return DEFAULT_PASSWORD;
}

function createAdminAuth(options = {}) {
  const password = resolvePassword(options);
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const maxFailures = options.maxFailures || DEFAULT_MAX_FAILURES;
  const lockMs = options.lockMs || DEFAULT_LOCK_MS;
  const now = options.now || (() => Date.now());

  /** @type {Map<string, number>} token -> 过期时间戳 */
  const tokens = new Map();
  /** @type {Map<string, {count: number, lockedUntil: number}>} */
  const failures = new Map();

  function sweepTokens() {
    const current = now();
    for (const [token, expiresAt] of tokens) {
      if (expiresAt <= current) tokens.delete(token);
    }
  }

  function lockRemainingMs(ip) {
    const record = failures.get(ip);
    if (!record || !record.lockedUntil) return 0;
    const remain = record.lockedUntil - now();
    if (remain <= 0) {
      failures.delete(ip);
      return 0;
    }
    return remain;
  }

  function recordFailure(ip) {
    const current = now();
    const record = failures.get(ip) || { count: 0, lockedUntil: 0 };
    if (record.lockedUntil && record.lockedUntil <= current) {
      // 上一轮锁定已过期，重新计数。
      record.count = 0;
      record.lockedUntil = 0;
    }
    record.count += 1;
    if (record.count >= maxFailures) {
      record.lockedUntil = current + lockMs;
      record.count = 0;
    }
    failures.set(ip, record);
    return record;
  }

  /**
   * @returns {{ok: boolean, token?: string, expiresAt?: number, code?: string, message?: string}}
   */
  function login(rawPassword, ip) {
    const lockedFor = lockRemainingMs(ip);
    if (lockedFor > 0) {
      const minutes = Math.ceil(lockedFor / 60_000);
      return {
        ok: false,
        code: 'LOCKED',
        message: `密码错误次数过多，请 ${minutes} 分钟后再试`,
      };
    }

    if (!safeEqual(rawPassword == null ? '' : rawPassword, password)) {
      const record = recordFailure(ip);
      if (record.lockedUntil && record.lockedUntil > now()) {
        return {
          ok: false,
          code: 'LOCKED',
          message: '密码错误次数过多，账号已临时锁定',
        };
      }
      const remaining = Math.max(maxFailures - record.count, 0);
      return {
        ok: false,
        code: 'BAD_PASSWORD',
        message: remaining > 0
          ? `密码错误，还剩 ${remaining} 次机会`
          : '密码错误次数过多，账号已临时锁定',
      };
    }

    failures.delete(ip);
    sweepTokens();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = now() + ttlMs;
    tokens.set(token, expiresAt);
    return { ok: true, token, expiresAt };
  }

  function check(token) {
    if (!token || typeof token !== 'string') return false;
    const expiresAt = tokens.get(token);
    if (!expiresAt) return false;
    if (expiresAt <= now()) {
      tokens.delete(token);
      return false;
    }
    return true;
  }

  function logout(token) {
    if (token) tokens.delete(token);
  }

  return { login, check, logout, ttlMs, password };
}

module.exports = { createAdminAuth, DEFAULT_PASSWORD };
