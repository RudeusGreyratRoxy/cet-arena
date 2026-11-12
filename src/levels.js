'use strict';

/**
 * 闯关关卡：读取 data/levels.json（关卡 → 词条 id 列表）。
 *
 * 为什么单独一个文件，而不是给 words.json 的每个词加 chapter 字段：
 * - words.json 是 2868 条的扁平词库，闯关只是它的一种「视图」，
 *   不该为了玩法反过来污染词库结构；
 * - 关卡可以独立调序、增删、改标题，不需要重写词库、也不影响音频脚本；
 * - 词库校验（wordBank.validateWords）保持现状，职责不扩散。
 *
 * 校验风格与 validateWords 一致：数据不合法直接抛错，
 * 让问题在服务启动阶段暴露（Phase 1 会在 createArenaServer 里实例化本模块）。
 */

const fs = require('fs');
const path = require('path');

const LEVELS_PATH = path.join(__dirname, '..', 'data', 'levels.json');

// 一道题需要 3 个干扰项，且干扰项来自同池的其他词，所以单关至少 4 个词。
const MIN_LEVEL_WORDS = 4;

// 竞速模式一局 25 题，buildQuestions 要求 pool.length >= count；
// 免费关卡合集必须撑得起竞速，否则「免费能玩竞速」就是空话。
const MIN_FREE_WORDS = 25;

// 限时闯关：第 1/2/3 关每题限时（毫秒）。关卡越往后越紧。
const TRIAL_TIME_LIMITS_MS = [10_000, 7_000, 5_000];
const DEFAULT_TIME_LIMIT_MS = TRIAL_TIME_LIMITS_MS[0];

/** 读取关卡配置（只解析，不校验）。 */
function loadLevels(filePath = LEVELS_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`无法读取关卡配置：${filePath}（${error.message}）`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`关卡配置不是合法 JSON：${error.message}`);
  }
}

/**
 * 校验关卡配置。
 * @param {object} config levels.json 的内容
 * @param {Set<string>} [knownWordIds] 词库中存在的词条 id；传入时校验引用不越界
 */
function validateLevels(config, knownWordIds) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('关卡配置必须是对象');
  }
  if (!Array.isArray(config.levels)) {
    throw new Error('关卡配置缺少 levels 数组');
  }
  if (config.levels.length === 0) {
    throw new Error('关卡配置至少需要 1 个关卡');
  }

  const seenLevelIds = new Set();
  const freeWordIds = new Set();

  config.levels.forEach((level, index) => {
    const where = `第 ${index + 1} 关`;
    if (!level || typeof level !== 'object' || Array.isArray(level)) {
      throw new Error(`${where}不是对象`);
    }
    if (typeof level.id !== 'string' || !level.id.trim()) {
      throw new Error(`${where}缺少 id`);
    }
    if (seenLevelIds.has(level.id)) {
      throw new Error(`关卡 id 重复：${level.id}`);
    }
    seenLevelIds.add(level.id);
    if (typeof level.title !== 'string' || !level.title.trim()) {
      throw new Error(`${where}缺少 title`);
    }
    if (typeof level.free !== 'boolean') {
      throw new Error(`${where}的 free 必须是布尔值`);
    }
    if (!Array.isArray(level.words)) {
      throw new Error(`${where}缺少 words 数组`);
    }
    if (level.words.length < MIN_LEVEL_WORDS) {
      throw new Error(
        `${where}的 words 至少需要 ${MIN_LEVEL_WORDS} 个词条，当前 ${level.words.length} 个`
      );
    }

    const seenInLevel = new Set();
    level.words.forEach((wordId, wordIndex) => {
      const label = `${where}的第 ${wordIndex + 1} 个词条`;
      if (typeof wordId !== 'string' || !wordId.trim()) {
        throw new Error(`${label}缺少 id`);
      }
      if (seenInLevel.has(wordId)) {
        throw new Error(`${where}的词条 id 重复：${wordId}`);
      }
      seenInLevel.add(wordId);
      if (knownWordIds && !knownWordIds.has(wordId)) {
        throw new Error(`${where}引用了词库中不存在的词条 id：${wordId}`);
      }
      if (level.free) freeWordIds.add(wordId);
    });
  });

  if (freeWordIds.size < MIN_FREE_WORDS) {
    throw new Error(
      `免费关卡合计至少需要 ${MIN_FREE_WORDS} 个词条，当前 ${freeWordIds.size} 个`
    );
  }

  return config;
}

/**
 * 创建关卡仓储。
 * @param {object} [options]
 * @param {string} [options.levelsPath]
 * @param {Array<object>} [options.words] 词库数组；不传时按需读取 words.json
 */
function createLevelStore(options = {}) {
  const levelsPath = options.levelsPath || LEVELS_PATH;
  // 延迟 require，避免本模块被单独引入时把整个词库读进内存。
  const wordList = options.words || require('./wordBank').loadWords();
  const wordById = new Map(wordList.map((entry) => [entry.id, entry]));

  const config = loadLevels(levelsPath);
  validateLevels(config, new Set(wordById.keys()));

  const levels = config.levels.map((level) => ({
    id: level.id,
    title: level.title,
    free: level.free,
    words: [...level.words],
  }));

  /** 支持 1 基序号（1/2/3）或关卡 id（'L1'）。 */
  function findLevel(chapter) {
    if (typeof chapter === 'number') {
      if (!Number.isInteger(chapter) || chapter < 1 || chapter > levels.length) {
        throw new Error(`关卡不存在：${chapter}`);
      }
      return levels[chapter - 1];
    }
    if (typeof chapter === 'string' && chapter.trim()) {
      const wanted = chapter.trim().toUpperCase();
      const found = levels.find((level) => level.id.toUpperCase() === wanted);
      if (found) return found;
    }
    throw new Error(`关卡不存在：${chapter}`);
  }

  /**
   * 取某一关的题池（词条对象数组），可直接传给 buildQuestions/buildQuestion。
   */
  function trialPoolFor(chapter) {
    const level = findLevel(chapter);
    const pool = level.words.map((id) => wordById.get(id)).filter(Boolean);
    if (pool.length !== level.words.length) {
      // 正常不会发生：validateLevels 已经校验过引用完整性。
      throw new Error(`关卡 ${level.id} 的词条解析不完整`);
    }
    return pool;
  }

  /** 免费体验可用的关卡清单（给前端渲染用，不含词条 id）。 */
  function listLevels() {
    return levels.map((level, index) => ({
      id: level.id,
      title: level.title,
      free: level.free,
      wordCount: level.words.length,
      timeLimitMs: TRIAL_TIME_LIMITS_MS[index] || DEFAULT_TIME_LIMIT_MS,
    }));
  }

  /** 某一关每题的限时（毫秒）。序号或关卡 id 都行。 */
  function timeLimitFor(chapter) {
    const level = findLevel(chapter);
    const index = levels.indexOf(level);
    return TRIAL_TIME_LIMITS_MS[index] || DEFAULT_TIME_LIMIT_MS;
  }

  /** 所有免费关卡合并去重后的题池，用于「免费能玩哪些词」的统一校验。 */
  function freePool() {
    const ids = new Set();
    for (const level of levels) {
      if (!level.free) continue;
      for (const id of level.words) ids.add(id);
    }
    return [...ids].map((id) => wordById.get(id)).filter(Boolean);
  }

  return {
    levelsPath,
    trialPoolFor,
    listLevels,
    timeLimitFor,
    freePool,
    findLevel,
  };
}

let defaultStore = null;

function defaultLevelStore() {
  if (!defaultStore) defaultStore = createLevelStore();
  return defaultStore;
}

function trialPoolFor(chapter) {
  return defaultLevelStore().trialPoolFor(chapter);
}

function listLevels() {
  return defaultLevelStore().listLevels();
}

function timeLimitFor(chapter) {
  return defaultLevelStore().timeLimitFor(chapter);
}

module.exports = {
  LEVELS_PATH,
  MIN_LEVEL_WORDS,
  MIN_FREE_WORDS,
  TRIAL_TIME_LIMITS_MS,
  DEFAULT_TIME_LIMIT_MS,
  loadLevels,
  validateLevels,
  createLevelStore,
  trialPoolFor,
  listLevels,
  timeLimitFor,
};
