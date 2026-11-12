'use strict';

/**
 * 激活码（VIP）校验。
 *
 * 只有两类：
 * - unlimited：站长/专属码，不限次数、不绑定任何设备；
 * - once：普通单人码。一码一用，首次验证成功后标记 used 并绑定**设备 Token**；
 *   同一设备再次验证视为同一台机器，允许（用于刷新后静默恢复）；
 *   换设备一律拒绝「该卡密已绑定其他设备」。
 *
 * 为什么不用 IP 绑定：大学校园网普遍是 NAT，全校共用一个公网 IP，
 * 按 IP 绑定等于「一人买码、全校白嫖」。因此绑定主体改为前端生成的随机
 * device_token（存 localStorage），IP 只作为风控参考记录，不参与放行判断。
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

// 自定义卡密：6–16 位，只允许大写字母 / 数字 / 下划线（归一化后校验）。
const CUSTOM_CODE_PATTERN = /^[A-Z0-9_]{6,16}$/;
const CUSTOM_MIN_LENGTH = 6;
const CUSTOM_MAX_LENGTH = 16;

// 设备 Token：前端随机生成，长度与字符集都做限制，避免塞入任意脏数据。
const DEVICE_TOKEN_MIN = 16;
const DEVICE_TOKEN_MAX = 128;
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

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

/** 设备 Token 规范化：空白、过短、过长、含非法字符一律视为无效。 */
function normalizeDeviceToken(raw) {
  const token = String(raw == null ? '' : raw).trim();
  if (token.length < DEVICE_TOKEN_MIN || token.length > DEVICE_TOKEN_MAX) return '';
  if (!DEVICE_TOKEN_PATTERN.test(token)) return '';
  return token;
}

/** 只对外暴露前 8 位，后台列表据此人工核对设备。 */
function devicePrefix(token) {
  if (!token) return null;
  return String(token).slice(0, 8);
}

/** 兼容旧数据：任何非 unlimited 的类型都视为普通单人码。 */
function normalizeType(rawType) {
  return rawType === 'unlimited' || rawType === 'super_admin' ? 'unlimited' : 'once';
}

function createVipStore(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const seedPath = options.seedPath || path.join(dataDir, 'vip_codes.json');
  const statePath = options.statePath || path.join(dataDir, 'vip_codes.state.json');
  // 运行时新增的卡密（批量生成 / 自定义生成）单独落一个不入库的文件：
  // 种子文件保持只读，避免线上生成卡密后 git pull 冲突。
  const customPath =
    options.customPath || path.join(path.dirname(seedPath), 'vip_codes.custom.json');
  const now = options.now || (() => new Date());

  // 每次启动重新读一次种子文件；对象常驻内存，新生成的卡密无需重启即可验证。
  const seed = readJson(seedPath, null) || { version: 1, codes: {} };
  if (!seed.codes || typeof seed.codes !== 'object') seed.codes = {};
  const codes = seed.codes;

  // 合并运行时新增的卡密（不入库）。种子里已有的同码以种子为准。
  const custom = readJson(customPath, null) || { version: 1, codes: {} };
  if (!custom.codes || typeof custom.codes !== 'object') custom.codes = {};
  for (const [customCode, definition] of Object.entries(custom.codes)) {
    if (!Object.prototype.hasOwnProperty.call(codes, customCode)) {
      codes[customCode] = definition;
    }
  }

  // 专属（无限免绑）码不再随仓库下发：由环境变量 VIP_UNLIMITED_CODES 注入，
  // 避免明文卡密写进 git 历史。格式为逗号分隔，例如 "CODE1,CODE2"。
  // 种子 JSON 里已存在的同码不覆盖（以 JSON 为准），保证旧数据仍可平滑过渡。
  const envCodeList = String(process.env.VIP_UNLIMITED_CODES || '')
    .split(',')
    .map((item) => normalizeCode(item))
    .filter(Boolean);
  for (const envCode of envCodeList) {
    if (Object.prototype.hasOwnProperty.call(codes, envCode)) continue;
    codes[envCode] = { type: 'unlimited', label: '专属(env)' };
  }
  if (envCodeList.length === 0) {
    console.warn(
      '[vip] 未配置环境变量 VIP_UNLIMITED_CODES，当前没有任何专属（无限免绑）码；' +
        '如需站长码请在启动环境里配置后再重启'
    );
  }

  let state = readJson(statePath, {});
  if (!state || typeof state !== 'object') state = {};

  // 正在验证中的卡密（同一毫秒并发请求会被挡在门外）
  const inFlight = new Set();

  function has(code) {
    return Object.prototype.hasOwnProperty.call(codes, code);
  }

  /** 把新生成的卡密写入「运行时新增」文件（不入库），并同步内存。 */
  function persistCustom(entries) {
    Object.assign(custom.codes, entries);
    writeJsonAtomic(customPath, custom);
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
      // 绑定主体是设备 Token；只回传前 8 位，够后台人工核对，又不把完整凭据散出去。
      boundDevicePrefix: record ? devicePrefix(record.boundDevice) : null,
      boundIp: record ? record.boundIp || null : null,
      lastIp: record ? record.lastIp || null : null,
      usedAt: record ? record.usedAt || null : null,
    };
  }

  /**
   * @param {string} rawCode 激活码
   * @param {string} ip 请求来源 IP（风控参考，不参与放行判断）
   * @param {string} rawDevice 前端生成并持久化的设备 Token
   * @returns {{ok: boolean, kind?: string, code?: string, message: string}}
   */
  function verify(rawCode, ip, rawDevice) {
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

    // 普通码必须带设备 Token，否则无法判断是不是同一台机器。
    const device = normalizeDeviceToken(rawDevice);
    if (!device) {
      return {
        ok: false,
        code: 'DEVICE_REQUIRED',
        message: '设备标识缺失，请刷新页面后重试',
      };
    }

    if (inFlight.has(code)) {
      return { ok: false, code: 'BUSY', message: '该激活码正在验证中，请稍后重试' };
    }
    inFlight.add(code);
    try {
      const record = state[code];
      if (record && record.status === 'used') {
        // 老数据只有 boundIp、没有 boundDevice：同 IP 首次带 Token 请求时补迁移。
        if (!record.boundDevice) {
          if (record.boundIp && record.boundIp !== ip) {
            return { ok: false, code: 'BOUND', message: '该卡密已绑定其他设备' };
          }
          record.boundDevice = device;
          record.lastIp = ip || record.boundIp || null;
          writeJsonAtomic(statePath, state);
          return { ok: true, kind: 'once', reused: true, migrated: true, message: '验证成功' };
        }

        if (record.boundDevice !== device) {
          return { ok: false, code: 'BOUND', message: '该卡密已绑定其他设备' };
        }

        // 同一台设备换网络（宿舍 Wi-Fi ↔ 手机热点）应当放行，只更新风控 IP。
        if (ip && record.lastIp !== ip) {
          record.lastIp = ip;
          writeJsonAtomic(statePath, state);
        }
        return { ok: true, kind: 'once', reused: true, message: '验证成功' };
      }

      // 首次使用：同步完成「标记 + 绑定设备 + 记录 IP + 持久化」
      state[code] = {
        status: 'used',
        boundDevice: device,
        boundIp: ip || null,
        lastIp: ip || null,
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
    const defs = {};
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
      defs[candidate] = codes[candidate];
      created.push(candidate);
    }

    if (created.length === 0) {
      return { ok: false, code: 'GENERATE_FAILED', message: '生成失败，请重试' };
    }

    persistCustom(defs);
    return { ok: true, created, message: `已生成 ${created.length} 张卡密` };
  }

  /**
   * 站长自定义卡密：固定生成 once 码。
   * 规则：去空格转大写后 6–16 位，只允许 A-Z / 0-9 / 下划线。
   * 查重三处：内存 codes（种子 + 运行时新增 + 环境变量专属码）、状态文件、写前双检。
   */
  function generateCustom(rawCode) {
    if (typeof rawCode !== 'string') {
      return { ok: false, code: 'BAD_FORMAT', message: '请输入自定义卡密' };
    }
    const code = normalizeCode(rawCode);
    if (!code) {
      return { ok: false, code: 'BAD_FORMAT', message: '请输入自定义卡密' };
    }
    if (code.length < CUSTOM_MIN_LENGTH) {
      return {
        ok: false,
        code: 'TOO_SHORT',
        message: `自定义卡密至少 ${CUSTOM_MIN_LENGTH} 位，当前 ${code.length} 位`,
      };
    }
    if (code.length > CUSTOM_MAX_LENGTH) {
      return {
        ok: false,
        code: 'TOO_LONG',
        message: `自定义卡密最多 ${CUSTOM_MAX_LENGTH} 位，当前 ${code.length} 位`,
      };
    }
    if (!CUSTOM_CODE_PATTERN.test(code)) {
      return {
        ok: false,
        code: 'BAD_FORMAT',
        message: '只能使用字母、数字和下划线（不支持中文、空格、连字符）',
      };
    }
    if (has(code)) {
      return { ok: false, code: 'DUPLICATE', message: `卡密「${code}」已存在，请换一个` };
    }
    if (state[code]) {
      return {
        ok: false,
        code: 'STATE_CONFLICT',
        message: `卡密「${code}」存在历史绑定记录，请换一个`,
      };
    }

    codes[code] = { type: 'once', label: '自定义' };
    persistCustom({ [code]: codes[code] });
    return {
      ok: true,
      code,
      record: describe(code),
      message: `已生成自定义卡密「${code}」`,
    };
  }

  return {
    verify,
    list,
    describe,
    reset,
    generate,
    generateCustom,
    stats,
    seedPath,
    statePath,
    customPath,
  };
}

module.exports = { createVipStore, normalizeCode, normalizeType, normalizeDeviceToken };
