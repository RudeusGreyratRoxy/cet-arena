'use strict';

/**
 * 激活码（VIP）校验。
 *
 * 只有两类：
 * - unlimited：站长/专属码，不限次数、不绑定 IP；
 * - once：普通单人码。一码一用，首次验证成功后标记 used 并绑定 IP；
 *   同一 IP 再次验证视为同一设备，允许（用于刷新后静默恢复）；
 *   换 IP 一律拒绝「该卡密已绑定其他设备」。
 *
 * 验证通过后权限一致：该玩家既能建房，也能加入他人房间。
 *
 * 防并发：验证过程完全同步，并在进入临界区前加内存锁，
 * 同一毫秒只有第一个请求能完成「检查 + 落 state + 持久化」。
 *
 * 持久化：种子卡密在 data/vip_codes.json（入库），
 * 运行状态在 data/vip_codes.state.json（不入库），先写临时文件再 rename，保证原子性。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 生成新卡密用的字符集：去掉 I / O / 0 / 1 等易混淆字符，方便客户手输。
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_GENERATE = 100;

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

/** 兼容旧数据：任何非 unlimited 的类型都视为普通单人码。 */
function normalizeType(rawType) {
  return rawType === 'unlimited' || rawType === 'super_admin' ? 'unlimited' : 'once';
}

function createVipStore(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const seedPath = options.seedPath || path.join(dataDir, 'vip_codes.json');
  const statePath = options.statePath || path.join(dataDir, 'vip_codes.state.json');
  const now = options.now || (() => new Date());

  // 每次启动重新读一次种子文件；对象常驻内存，新生成的卡密无需重启即可验证。
  const seed = readJson(seedPath, null) || { version: 1, codes: {} };
  if (!seed.codes || typeof seed.codes !== 'object') seed.codes = {};
  const codes = seed.codes;

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
    const type = normalizeType(def.type);
    const record = state[code];
    return {
      code,
      kind: type,
      label: def.label || '',
      status: type === 'unlimited' ? 'unlimited' : (record && record.status) || 'available',
      boundIp: record ? record.boundIp || null : null,
      usedAt: record ? record.usedAt || null : null,
    };
  }

  /**
   * @returns {{ok: boolean, kind?: string, code?: string, message: string}}
   */
  function verify(rawCode, ip) {
    const code = normalizeCode(rawCode);
    if (!code) {
      return { ok: false, code: 'EMPTY', message: '请输入激活码' };
    }
    if (!has(code)) {
      return { ok: false, code: 'INVALID', message: '激活码无效，请核对后重试' };
    }

    const type = normalizeType(codes[code].type);
    if (type === 'unlimited') {
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

  /** 汇总给后台用的统计。 */
  function stats() {
    const all = list();
    const once = all.filter((entry) => entry.kind !== 'unlimited');
    return {
      total: all.length,
      unlimited: all.length - once.length,
      available: once.filter((entry) => entry.status !== 'used').length,
      used: once.filter((entry) => entry.status === 'used').length,
    };
  }

  /**
   * 解绑：清掉该卡密在 state 里的使用记录，让它可以重新在任意 IP 激活。
   * 站长码不使用绑定状态，直接拒绝，避免前端把它当成可解绑对象。
   */
  function reset(rawCode) {
    const code = normalizeCode(rawCode);
    if (!has(code)) {
      return { ok: false, code: 'INVALID', message: '该卡密不存在' };
    }
    if (normalizeType(codes[code].type) === 'unlimited') {
      return { ok: false, code: 'UNLIMITED', message: '站长码不绑定设备，无需解绑' };
    }
    if (!state[code]) {
      return { ok: false, code: 'NOT_BOUND', message: '该卡密尚未使用，无需解绑' };
    }

    delete state[code];
    writeJsonAtomic(statePath, state);
    return { ok: true, message: '已解绑，可重新激活', record: describe(code) };
  }

  /**
   * 批量生成普通码：写回 vip_codes.json（入库），同时立刻进内存，
   * 所以新码无需重启服务就能被 / 客户端验证使用。
   */
  function generate(rawCount, options = {}) {
    const count = Math.floor(Number(rawCount));
    if (!Number.isFinite(count) || count < 1) {
      return { ok: false, code: 'BAD_COUNT', message: '请输入 1 以上的生成数量' };
    }
    if (count > MAX_GENERATE) {
      return { ok: false, code: 'TOO_MANY', message: `一次最多生成 ${MAX_GENERATE} 张` };
    }

    const label = options.label || '批量生成';
    const created = [];
    // 撞码概率极低，但保留上限，避免随机源异常时死循环。
    const guardLimit = count * 200 + 1000;
    let guard = 0;
    while (created.length < count && guard < guardLimit) {
      guard += 1;
      let candidate = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        candidate += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      }
      if (has(candidate)) continue;
      codes[candidate] = { type: 'once', label };
      created.push(candidate);
    }

    if (created.length === 0) {
      return { ok: false, code: 'GENERATE_FAILED', message: '生成失败，请重试' };
    }

    writeJsonAtomic(seedPath, seed);
    return { ok: true, created, message: `已生成 ${created.length} 张卡密` };
  }

  return { verify, list, describe, reset, generate, stats, seedPath, statePath };
}

module.exports = { createVipStore, normalizeCode, normalizeType };
