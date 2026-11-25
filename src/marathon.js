'use strict';

/**
 * 超长闯关（marathon）进度存储与轮次推进逻辑。
 *
 * 玩法：
 * - 第一轮把全量词库洗牌作为答题队列；
 * - 答对进入下一题，答错也进入下一题，但该词进「错词池」；
 * - 当前队列答完：错词池非空 → 洗牌作为新一轮继续；为空 → 通关；
 * - 进度按 deviceHash 落盘，服务重启不丢。
 *
 * 设计要点：
 * - 存储只放「词 ID 队列 + 下标 + 轮次 + 错词池 + 是否通关」，**不存题目本身**，
 *   避免把 correctIndex 写进磁盘被读到；题目在内存里按需生成（见 src/app.js）。
 * - 轮次推进抽成纯函数 `applyAnswer()`，便于单测，不依赖 socket/文件。
 * - `getProgress()` 返回副本，调用方改它不会污染内存状态。
 */

const fs = require('fs');
const path = require('path');

const VERSION = 1;

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

/** 词 ID 数组清洗：去空、去非字符串、去重，保持原有顺序。 */
function normalizeIds(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 默认洗牌：Fisher-Yates（测试里可注入确定性实现）。 */
function shuffleIds(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 纯函数：根据一次作答推进进度。
 *
 * @param {{round:number,index:number,queue:string[],wrongPool:string[]}} progress
 * @param {string} wordId 本次作答的词 ID
 * @param {boolean} correct 是否答对
 * @param {(list:string[])=>string[]} [shuffle] 洗牌函数（默认 Fisher-Yates）
 * @returns {{round:number,index:number,queue:string[],wrongPool:string[],completed:boolean,roundChanged:boolean}}
 */
function applyAnswer(progress, wordId, correct, shuffle = shuffleIds) {
  const next = {
    round: Math.max(1, Number(progress && progress.round) || 1),
    index: Math.max(0, Number(progress && progress.index) || 0),
    queue: normalizeIds(progress && progress.queue),
    wrongPool: normalizeIds(progress && progress.wrongPool),
    completed: false,
    roundChanged: false,
  };

  if (!correct && wordId && !next.wrongPool.includes(wordId)) {
    next.wrongPool.push(wordId);
  }
  next.index += 1;

  if (next.index >= next.queue.length) {
    if (next.wrongPool.length) {
      next.queue = shuffle(next.wrongPool.slice());
      next.wrongPool = [];
      next.round += 1;
      next.index = 0;
      next.roundChanged = true;
    } else {
      next.completed = true;
    }
  }
  return next;
}

/**
 * 载入进度后的自愈：词库可能缩水（词条被删），把失效 ID 过滤掉，
 * 若过滤后下标越界则按「队列已答完」处理，避免卡在空队列上。
 */
function normalizeProgress(progress, shuffle = shuffleIds) {
  const next = {
    round: Math.max(1, Number(progress && progress.round) || 1),
    index: Math.max(0, Number(progress && progress.index) || 0),
    queue: normalizeIds(progress && progress.queue),
    wrongPool: normalizeIds(progress && progress.wrongPool),
    completed: Boolean(progress && progress.completed),
  };
  if (next.completed) return next;

  if (next.index >= next.queue.length) {
    if (next.wrongPool.length) {
      next.queue = shuffle(next.wrongPool.slice());
      next.wrongPool = [];
      next.round += 1;
      next.index = 0;
    } else {
      next.completed = true;
    }
  }
  return next;
}

function createMarathonStore(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const file = options.file || path.join(dataDir, 'marathon_progress.json');
  const now = options.now || (() => new Date());

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

  /** 读取某设备的进度；没有则返回 null（副本，外部修改不回写）。 */
  function getProgress(deviceHash) {
    const key = String(deviceHash == null ? '' : deviceHash).trim();
    if (!key) return null;
    const record = db.devices[key];
    if (!record) return null;
    return {
      deviceHash: key,
      round: Math.max(1, Number(record.round) || 1),
      index: Math.max(0, Number(record.index) || 0),
      queue: normalizeIds(record.queue),
      wrongPool: normalizeIds(record.wrongPool),
      completed: Boolean(record.completed),
      startedAt: record.startedAt || null,
      updatedAt: record.updatedAt || null,
    };
  }

  /** 写入进度（整体覆盖该设备记录），返回落盘后的副本。 */
  function saveProgress(deviceHash, progress) {
    const key = String(deviceHash == null ? '' : deviceHash).trim();
    if (!key) return null;
    const previous = db.devices[key] || null;
    const record = {
      round: Math.max(1, Number(progress && progress.round) || 1),
      index: Math.max(0, Number(progress && progress.index) || 0),
      queue: normalizeIds(progress && progress.queue),
      wrongPool: normalizeIds(progress && progress.wrongPool),
      completed: Boolean(progress && progress.completed),
      startedAt: (progress && progress.startedAt) || (previous && previous.startedAt) || now().toISOString(),
      updatedAt: now().toISOString(),
    };
    db.devices[key] = record;
    persist();
    return { deviceHash: key, ...record };
  }

  /** 清空某设备的进度。返回 removed 表示之前是否存在记录。 */
  function reset(deviceHash) {
    const key = String(deviceHash == null ? '' : deviceHash).trim();
    if (!key) return { ok: false, removed: false };
    const had = Object.prototype.hasOwnProperty.call(db.devices, key);
    if (had) {
      delete db.devices[key];
      persist();
    }
    return { ok: true, removed: had };
  }

  /** 只给测试/运维看的汇总，不暴露具体进度。 */
  function stats() {
    return {
      devices: Object.keys(db.devices).length,
      completed: Object.values(db.devices).filter((item) => item && item.completed).length,
    };
  }

  return { getProgress, saveProgress, reset, stats, file };
}

module.exports = {
  createMarathonStore,
  applyAnswer,
  normalizeProgress,
  shuffleIds,
  normalizeIds,
  VERSION,
};
