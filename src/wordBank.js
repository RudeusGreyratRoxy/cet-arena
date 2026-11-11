'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORDS_PATH = path.join(__dirname, '..', 'data', 'words.json');

/**
 * 读取并校验词库。词库损坏时启动直接失败，避免对局中出现无效题目。
 */
function loadWords(filePath = WORDS_PATH) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const words = JSON.parse(raw);
  validateWords(words);
  return words;
}

function validateWords(words) {
  if (!Array.isArray(words)) {
    throw new Error('词库必须是 JSON 数组');
  }
  if (words.length < 10) {
    throw new Error('词库至少需要 10 个词条');
  }

  const ids = new Set();
  for (const [index, entry] of words.entries()) {
    const where = `词库第 ${index + 1} 条`;
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${where}不是对象`);
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Error(`${where}缺少 id`);
    }
    if (ids.has(entry.id)) {
      throw new Error(`词条 id 重复：${entry.id}`);
    }
    ids.add(entry.id);
    if (entry.level !== 'CET4' && entry.level !== 'CET6') {
      throw new Error(`${where}的 level 必须是 CET4 或 CET6`);
    }
    if (typeof entry.word !== 'string' || !entry.word.trim()) {
      throw new Error(`${where}缺少 word`);
    }
    if (!Array.isArray(entry.meanings) || entry.meanings.length < 2) {
      throw new Error(`${where}至少需要 2 个释义`);
    }

    const ranks = new Set();
    for (const [meaningIndex, item] of entry.meanings.entries()) {
      const label = `${where}的第 ${meaningIndex + 1} 个释义`;
      if (!item || typeof item !== 'object') {
        throw new Error(`${label}不是对象`);
      }
      if (typeof item.pos !== 'string' || !item.pos.trim()) {
        throw new Error(`${label}缺少 partOfSpeech（pos）`);
      }
      if (typeof item.meaning !== 'string' || !item.meaning.trim()) {
        throw new Error(`${label}缺少 meaning`);
      }
      if (
        !Number.isInteger(item.frequencyRank) ||
        item.frequencyRank < 1
      ) {
        throw new Error(`${label}的 frequencyRank 必须是正整数`);
      }
      if (ranks.has(item.frequencyRank)) {
        throw new Error(`${where}的 frequencyRank 不能重复`);
      }
      ranks.add(item.frequencyRank);
    }

    if (!ranks.has(1)) {
      throw new Error(`${where}必须有一个 frequencyRank 为 1 的最高频释义`);
    }
  }
}

function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function primaryMeaning(entry) {
  return entry.meanings.find((item) => item.frequencyRank === 1);
}

function formatMeaning(item) {
  return `${item.pos} ${item.meaning}`;
}

// 词性白名单：覆盖 CET 词库常见的缩写（vt./vi./a./ad./prep. 等），
// 只用于校验“带词性的中文释义”这一呈现格式，不影响具体词性取值。
const CHINESE_OPTION_PATTERN =
  /^(?:v|vt|vi|aux|n|pron|num|adj|a|adv|ad|prep|conj|int|art|pl)\.\s/;
const ENGLISH_WORD_PATTERN = /^[a-z]+$/;
const LISTEN_PROMPT_LABEL = '点击喇叭听发音，选择正确的英文单词';

/**
 * 最后一道防线：确保题型、题干和四个选项完全匹配。
 * 任何字段拼装错误都会在出题阶段立即抛错，而不是发到前端。
 */
function assertQuestionShape(question) {
  if (!['en2zh', 'zh2en', 'listen'].includes(question.type)) {
    throw new Error(`题目类型无效：${question.type}`);
  }
  if (question.options.length !== 4 || new Set(question.options).size !== 4) {
    throw new Error(`题目选项必须是 4 个不同值：${question.word}`);
  }
  if (question.options[question.correctIndex] !== question.correctText) {
    throw new Error(`正确选项索引不一致：${question.word}`);
  }

  const allChineseOptions = question.options.every((option) =>
    CHINESE_OPTION_PATTERN.test(option)
  );
  const allEnglishOptions = question.options.every((option) =>
    ENGLISH_WORD_PATTERN.test(option)
  );

  if (question.type === 'en2zh') {
    if (!ENGLISH_WORD_PATTERN.test(question.prompt)) {
      throw new Error(`英译中题干必须是英文单词：${question.word}`);
    }
    if (!allChineseOptions) {
      throw new Error(`英译中选项必须是带词性的中文释义：${question.word}`);
    }
    if (question.promptLabel !== '选择正确的中文释义') {
      throw new Error(`英译中提示文字错误：${question.word}`);
    }
    return;
  }

  if (question.type === 'zh2en') {
    if (!CHINESE_OPTION_PATTERN.test(question.prompt)) {
      throw new Error(`中译英题干必须是带词性的中文释义：${question.word}`);
    }
    if (!allEnglishOptions) {
      throw new Error(`中译英选项必须是纯英文单词：${question.word}`);
    }
    if (question.promptLabel !== '选择正确的英文单词') {
      throw new Error(`中译英提示文字错误：${question.word}`);
    }
    return;
  }

  if (!ENGLISH_WORD_PATTERN.test(question.word)) {
    throw new Error(`听音选词的目标单词必须是英文：${question.word}`);
  }
  if (question.prompt !== '') {
    throw new Error(`听音选词不得显示题干文字：${question.word}`);
  }
  if (!allEnglishOptions) {
    throw new Error(`听音选词选项必须是纯英文单词：${question.word}`);
  }
  if (question.correctText !== question.word) {
    throw new Error(`听音选词正确答案必须是发声单词：${question.word}`);
  }
  if (question.promptLabel !== LISTEN_PROMPT_LABEL) {
    throw new Error(`听音选词提示文字错误：${question.word}`);
  }
}

/**
 * 生成英译中 50% / 中译英 30% / 听音选词 20% 的题型序列，并随机打乱。
 * 10 题固定 5/3/2；25 题固定 5 道听音选词，英译中在 12/13 道之间随机，
 * 中译英相应为 8/7 道，使长期比例严格等于 50/30/20。
 */
function buildTypeSequence(count) {
  const targets = [
    { type: 'en2zh', exact: count * 0.5 },
    { type: 'zh2en', exact: count * 0.3 },
    { type: 'listen', exact: count * 0.2 },
  ];
  const allocations = targets.map((target) => {
    const base = Math.floor(target.exact);
    return { type: target.type, count: base, fraction: target.exact - base };
  });

  let remaining = count - allocations.reduce((sum, item) => sum + item.count, 0);
  // 随机打乱后再按小数部分排序，用来公平地分配无法整除的余数。
  const order = shuffle(allocations.map((_, index) => index));
  order.sort((a, b) => allocations[b].fraction - allocations[a].fraction);
  for (let index = 0; index < remaining; index += 1) {
    allocations[order[index % allocations.length]].count += 1;
  }

  return shuffle(
    allocations.flatMap((item) => Array(item.count).fill(item.type))
  );
}

/**
 * 随机抽题，服务端打乱选项。传入 level 时只从对应词库抽题。
 * 每道题按 50/30/20 配额随机决定英译中、中译英或听音选词：
 * - 英译中：题干为英文单词，选项为带词性的中文最高频释义；
 * - 中译英：题干为带词性的中文最高频释义，选项为纯英文单词；
 * - 听音选词：题干不显示文字，只播放英文发音，选项为四个纯英文单词。
 * 返回对象含 correctIndex 与完整释义，只能用于服务端判分与赛后复盘。
 */
function buildQuestions(words, count = 10, level = null) {
  if (level !== null && level !== 'CET4' && level !== 'CET6') {
    throw new Error('词库等级必须是 CET4 或 CET6');
  }
  if (!Array.isArray(words)) {
    throw new Error('词库格式不正确');
  }

  const pool = level ? words.filter((entry) => entry.level === level) : words;
  if (pool.length < count) {
    const label = level ? `${level} 词库` : '词库';
    throw new Error(`${label}数量不足，至少需要 ${count} 个词条`);
  }

  const types = buildTypeSequence(count);
  return shuffle(pool)
    .slice(0, count)
    .map((entry, index) => buildQuestion(entry, pool, types[index]));
}

/**
 * 为指定词条生成一道题（干扰项从 pool 中取）。
 * 单人错词挑战复用它，保证与双人对战完全相同的题型与选项规则。
 */
function buildQuestion(entry, pool, type) {
  const primary = primaryMeaning(entry);
  if (!primary) {
    throw new Error(`${entry.word} 缺少最高频释义`);
  }
  const primaryText = formatMeaning(primary);
  const otherEntries = pool.filter((candidate) => candidate.id !== entry.id);
  const isZh2en = type === 'zh2en';
  const isListen = type === 'listen';
  const correctText = isZh2en || isListen ? entry.word : primaryText;
  const prompt = isListen ? '' : isZh2en ? primaryText : entry.word;
  const promptLabel = isListen
    ? LISTEN_PROMPT_LABEL
    : isZh2en
      ? '选择正确的英文单词'
      : '选择正确的中文释义';

  const rawDistractors =
    isZh2en || isListen
      ? otherEntries.map((candidate) => candidate.word)
      : otherEntries
          .map((candidate) => primaryMeaning(candidate))
          .filter(Boolean)
          .map((item) => formatMeaning(item));
  const distractors = [...new Set(shuffle(rawDistractors))]
    .filter((text) => text !== correctText)
    .slice(0, 3);
  if (distractors.length < 3) {
    throw new Error(`${entry.word} 无法生成 3 个不同的干扰项`);
  }

  const options = shuffle([correctText, ...distractors]);
  const question = {
    id: entry.id,
    word: entry.word,
    level: entry.level,
    type,
    prompt,
    promptLabel,
    meanings: entry.meanings,
    primary: {
      pos: primary.pos,
      meaning: primary.meaning,
      frequencyRank: primary.frequencyRank,
      text: primaryText,
    },
    meaning: primary.meaning,
    options,
    correctIndex: options.indexOf(correctText),
    correctText,
  };
  assertQuestionShape(question);
  return question;
}

module.exports = {
  WORDS_PATH,
  loadWords,
  validateWords,
  shuffle,
  primaryMeaning,
  formatMeaning,
  buildTypeSequence,
  buildQuestions,
  buildQuestion,
  assertQuestionShape,
};

