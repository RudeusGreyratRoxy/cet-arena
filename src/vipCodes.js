'use strict';

/**
 * 激活码（VIP）校验。
 *
 * 规则：
 * - unlimited：站长/专属码，不限次数、不绑定 IP；
 * - once：一码一用。首次验证成功后标记 used 并绑定 IP；
 *   同一 IP 再次验证视为同一设备，允许（用于刷新后静默恢复）；
 *   换 IP 一律拒绝「该卡密已绑定其他设备」。
 *
 * 防并发：验证过程完全同步，并在进入临界区前加内存锁，
 * 同一毫秒只有第一个请求能完成「检查 + 落 state + 持久化」。
 *
 * 持久化：种子卡密在 data/vip_codes.json（入库），
 * 运行状态在 data/vip_codes.state.json（不入库），先写临时文件再 rename，保证原子性。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SEED = { version: 1, codes: {} };

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function normalizeCode(raw) {
  return String(raw == null ? '' : raw).trim().toUpperCase();
}

function createVipStore(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const seedPath = options.seedPath || path.join(dataDir, 'vip_codes.json');
  const statePath = options.statePath || path.join(dataDir, 'vip_codes.state.json');
  const now = options.now || (() => new Date());

  const seed = readJson(seedPath, DEFAULT_SEED);
  const codes = seed && seed.codes && typeof seed.codes === 'object' ? seed.codes : {};

  let state = readJson(statePath, {});
  if (!state || typeof state !== 'object') state = {};

  // 正在验证中的卡密（同一毫秒并发请求会被挡在门外）
  const inFlight = new Set();

  function has(code) {
    return Object.prototype.hasOwnProperty.call(codes, code);
  }

  function describe(code) {
    const def = codes[code];
    if (!def) return null;
    const record = state[code];
    return {
      code,
      type: def.type === 'unlimited' ? 'unlimited' : 'once',
      label: def.label || '',
      status: def.type === 'unlimited' ? 'unlimited' : (record && record.status) || 'available',
      boundIp: record ? record.boundIp || null : null,
      usedAt: record ? record.usedAt || null : null,
    };
  }

  /**
   * @returns {{ok: boolean, code?: string, message: string, kind?: string}}
   */
  function verify(rawCode, ip) {
    const code = normalizeCode(rawCode);
    if (!code) {
      return { ok: false, code: 'EMPTY', message: '请输入激活码' };
    }
    if (!has(code)) {
      return { ok: false, code: 'INVALID', message: '激活码无效，请核对后重试' };
    }

    const def = codes[code];
    if (def.type === 'unlimited') {
      return { ok: true, kind: 'unlimited', message: '验证成功' };
    }

    if (inFlight.has(code)) {
      return { ok: false, code: 'BUSY', message: '该激活码正在验证中，请稍后重试' };
    }
    inFlight.add(code);
    try {
      const record = state[code];
      if (record && record.status === 'used') {
        if (record.boundIp && record.boundIp !== ip) {
          return { ok: false, code: 'BOUND', message: '该卡密已绑定其他设备' };
        }
        return { ok: true, kind: 'once', reused: true, message: '验证成功' };
      }

      // 首次使用：同步完成「标记 + 绑定 + 持久化」
      state[code] = {
        status: 'used',
        boundIp: ip || null,
        usedAt: now().toISOString(),
      };
      writeJsonAtomic(statePath, state);
      return { ok: true, kind: 'once', firstUse: true, message: '验证成功' };
    } finally {
      inFlight.delete(code);
    }
  }

  function list() {
    return Object.keys(codes).map(describe).filter(Boolean);
  }

  return { verify, list, describe, seedPath, statePath };
}

module.exports = { createVipStore, normalizeCode };
