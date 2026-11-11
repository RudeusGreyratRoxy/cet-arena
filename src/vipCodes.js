'use strict';

/**
 * 激活码（VIP）校验。
 *
 * 类型：
 * - super_admin：站长/专属码，不限次数、不绑定 IP，可建房也可加入；
 * - host：房主码，一次性，可创建房间（也可加入）；
 * - player：单人码，一次性，只能加入房间。
 *
 * 一次性码规则：首次验证成功标记 used 并绑定 IP；同 IP 再次验证视为同一设备放行，
 * 换 IP 拒绝「该卡密已绑定其他设备」。
 *
 * 防并发：验证过程完全同步，进入临界区前加内存锁，同一毫秒只有第一个请求能完成
 * 「检查 + 落 state + 持久化」。
 *
 * 持久化：种子卡密在 data/vip_codes.json（入库），
 * 运行状态在 data/vip_codes.state.json（不入库），先写临时文件再 rename，保证原子性。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SEED = { version: 2, codes: {} };
const TIERS = ['super_admin', 'host', 'player'];

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

/** 兼容旧数据：unlimited -> super_admin，once -> host。 */
function normalizeTier(rawType) {
  if (rawType === 'super_admin' || rawType === 'unlimited') return 'super_admin';
  if (rawType === 'player') return 'player';
  return 'host';
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

  function tierOf(code) {
    const def = codes[code];
    return def ? normalizeTier(def.type) : null;
  }

  function has(code) {
    return Object.prototype.hasOwnProperty.call(codes, code);
  }

  function describe(code) {
    const tier = tierOf(code);
    if (!tier) return null;
    const record = state[code];
    return {
      code,
      tier,
      label: codes[code].label || '',
      status: tier === 'super_admin' ? 'unlimited' : (record && record.status) || 'available',
      boundIp: record ? record.boundIp || null : null,
      usedAt: record ? record.usedAt || null : null,
    };
  }

  /**
   * @returns {{ok: boolean, tier?: string, code?: string, message: string}}
   */
  function verify(rawCode, ip) {
    const code = normalizeCode(rawCode);
    if (!code) {
      return { ok: false, code: 'EMPTY', message: '请输入激活码' };
    }
    if (!has(code)) {
      return { ok: false, code: 'INVALID', message: '激活码无效，请核对后重试' };
    }

    const tier = tierOf(code);
    if (tier === 'super_admin') {
      return { ok: true, tier, message: '验证成功' };
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
        return { ok: true, tier, reused: true, message: '验证成功' };
      }

      // 首次使用：同步完成「标记 + 绑定 + 持久化」
      state[code] = {
        status: 'used',
        tier,
        boundIp: ip || null,
        usedAt: now().toISOString(),
      };
      writeJsonAtomic(statePath, state);
      return { ok: true, tier, firstUse: true, message: '验证成功' };
    } finally {
      inFlight.delete(code);
    }
  }

  function list() {
    return Object.keys(codes).map(describe).filter(Boolean);
  }

  return { verify, list, describe, seedPath, statePath, tiers: TIERS };
}

module.exports = { createVipStore, normalizeCode, normalizeTier, TIERS };
