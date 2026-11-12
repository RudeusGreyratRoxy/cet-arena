'use strict';

/**
 * 站长后台鉴权。
 *
 * - 超级密码默认写死 `boss2026`，可用环境变量 ADMIN_PASSWORD 覆盖（后续上线建议改成环境变量）。
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

function createAdminAuth(options = {}) {
  const password = String(
    options.password || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD
  );
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
