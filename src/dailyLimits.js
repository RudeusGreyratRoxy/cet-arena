'use strict';

/**
 * 非 VIP 每日免费进场配额（双人模式）。
 *
 * 产品规则（2026-11-28 定案）：
 * - 消耗点：房主「创建房间」、玩家「加入房间」各扣 1 次；
 * - 基础额度：每人每天 2 次；
 * - 降级：额度耗尽直接拒绝，不进入房间。
 *
 * 存储：`data/daily_limits.json`（已 gitignore），结构
 * `{ version: 1, devices: { "<deviceHash>": { day: "YYYY-MM-DD", used: 1 } } }`。
 *
 * 关键约束：日期必须用**本地时区**拼 `YYYY-MM-DD`（`getFullYear/getMonth/getDate`），
 * **禁止** `toISOString().slice(0,10)`——服务器 TZ 是 Asia/Shanghai（UTC+8），
 * 用 UTC 日期会让每天 00:00–08:00 这段时间的配额提前/延后重置。
 *
 * 本模块只负责配额读写与跨天重置，不含任何 Socket 逻辑；
 * 由 `src/app.js` 在 `room:create` / `room:join` 处调用。
 */

const fs = require('fs');
const path = require('path');

const VERSION = 1;
const DAILY_QUOTA = 2;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 本地日期键 `YYYY-MM-DD`（刻意不用 toISOString，避免 UTC 偏移）。 */
function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeHash(deviceHash) {
  return String(deviceHash == null ? '' : deviceHash).trim();
}

function createDailyLimitStore(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const file = options.file || path.join(dataDir, 'daily_limits.json');
  const now = options.now || (() => new Date());
  const quota =
    Number.isInteger(options.quota) && options.quota > 0 ? options.quota : DAILY_QUOTA;

  let db = readJson(file, null);
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    db = { version: VERSION, devices: {} };
  }
  if (!db.devices || typeof db.devices !== 'object' || Array.isArray(db.devices)) {
    db.devices = {};
  }

  function persist() {
    writeJsonAtomic(file, db);
  }

  /** 该设备今天的已用次数（跨天视为 0，不写盘）。 */
  function usedToday(deviceHash, today) {
    const record = db.devices[deviceHash];
    if (!record || record.day !== today) return 0;
    return Math.max(0, Number(record.used) || 0);
  }

  /** 查询剩余次数，**不消耗**。 */
  function getRemaining(deviceHash) {
    const key = normalizeHash(deviceHash);
    if (!key) return 0;
    const today = dayKey(now());
    return Math.max(0, quota - usedToday(key, today));
  }

  /**
   * 查额度并扣 1 次。
   * @returns {{allowed: boolean, remaining: number, used?: number, day?: string, reason?: string}}
   */
  function checkAndConsume(deviceHash) {
    const key = normalizeHash(deviceHash);
    if (!key) {
      return { allowed: false, remaining: 0, reason: 'DEVICE_REQUIRED' };
    }

    const today = dayKey(now());
    const used = usedToday(key, today);

    if (used >= quota) {
      // 跨天记录的归一（旧 day 覆盖为今天、used 归零）不在这里写盘，
      // 避免「只查询就产生写操作」；真正扣次数时才落盘。
      return { allowed: false, remaining: 0, reason: 'LIMIT', used, day: today };
    }

    const nextUsed = used + 1;
    db.devices[key] = {
      day: today,
      used: nextUsed,
      updatedAt: now().toISOString(),
    };
    persist();

    return {
      allowed: true,
      remaining: Math.max(0, quota - nextUsed),
      used: nextUsed,
      day: today,
    };
  }

  /** 只读汇总，便于排查与测试。 */
  function stats() {
    const today = dayKey(now());
    const entries = Object.values(db.devices).filter((item) => item && item.day === today);
    return {
      quota,
      devicesToday: entries.length,
      usedToday: entries.reduce((sum, item) => sum + (Number(item.used) || 0), 0),
    };
  }

  return { checkAndConsume, getRemaining, stats, quota, file };
}

module.exports = {
  createDailyLimitStore,
  dayKey,
  DAILY_QUOTA,
  VERSION,
};
