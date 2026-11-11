/**
 * 错词本：纯数据逻辑 + localStorage 适配层。
 *
 * 设计要点：
 * - 以【单词】作为唯一键：服务端结算复盘只下发 word，没有 id，
 *   用 word 做键可以避免前后端字段对不上导致数据写不进去；
 * - 所有变更函数都是纯函数，返回新的 book 对象，方便单元测试；
 * - 存储格式带 version，读取时容错（损坏的 JSON 视为空错词本）；
 * - 掌握规则：同一单词连续答对 MASTERY_STREAK 次即移出错词本。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.WrongBook = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'cetArena.wrongBook.v1';
  const VERSION = 1;
  const MASTERY_STREAK = 3;
  const MAX_WORDS = 500;

  function emptyBook() {
    return { version: VERSION, words: [] };
  }

  function keyOf(word) {
    return typeof word === 'string' ? word.trim().toLowerCase() : '';
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const word = typeof raw.word === 'string' ? raw.word.trim() : '';
    if (!word) return null;
    const level = raw.level === 'CET6' ? 'CET6' : 'CET4';
    const streak = Number.isInteger(raw.streak) && raw.streak > 0 ? raw.streak : 0;
    const wrongCount =
      Number.isInteger(raw.wrongCount) && raw.wrongCount > 0 ? raw.wrongCount : 0;
    return {
      word,
      level,
      streak,
      wrongCount,
      addedAt: Number.isFinite(raw.addedAt) ? raw.addedAt : Date.now(),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    };
  }

  function normalizeBook(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.words)) {
      return emptyBook();
    }
    const seen = new Set();
    const words = [];
    for (const item of raw.words) {
      // 兼容早期写入的字符串数组或带 id 的对象
      const entry =
        typeof item === 'string'
          ? normalizeEntry({ word: item })
          : normalizeEntry(item);
      if (!entry) continue;
      const key = keyOf(entry.word);
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(entry);
    }
    return { version: VERSION, words };
  }

  function parse(text) {
    if (!text) return emptyBook();
    try {
      return normalizeBook(JSON.parse(text));
    } catch (error) {
      return emptyBook();
    }
  }

  function serialize(book) {
    return JSON.stringify(normalizeBook(book));
  }

  function load(storage) {
    if (!storage) return emptyBook();
    try {
      return parse(storage.getItem(STORAGE_KEY));
    } catch (error) {
      return emptyBook();
    }
  }

  function save(storage, book) {
    if (!storage) return emptyBook();
    const normalized = normalizeBook(book);
    try {
      storage.setItem(STORAGE_KEY, serialize(normalized));
    } catch (error) {
      // 隐私模式或超额时静默失败，不影响答题。
    }
    return normalized;
  }

  function count(book) {
    return normalizeBook(book).words.length;
  }

  function has(book, word) {
    return normalizeBook(book).words.some(
      (entry) => keyOf(entry.word) === keyOf(word)
    );
  }

  function get(book, word) {
    return (
      normalizeBook(book).words.find(
        (entry) => keyOf(entry.word) === keyOf(word)
      ) || null
    );
  }

  /**
   * 把结算页里答错的单词写入错词本。
   * 已存在的单词不会重复添加，但连对计数清零、错误次数累加。
   */
  function addMistakes(book, entries, now) {
    const stamp = Number.isFinite(now) ? now : Date.now();
    const current = normalizeBook(book);
    const byKey = new Map(current.words.map((entry) => [keyOf(entry.word), entry]));
    let added = 0;
    let updated = 0;

    for (const raw of entries || []) {
      if (!raw) continue;
      const word =
        typeof raw === 'string' ? raw.trim() : typeof raw.word === 'string' ? raw.word.trim() : '';
      if (!word) continue;
      const level = raw.level === 'CET6' ? 'CET6' : 'CET4';
      const key = keyOf(word);
      const existing = byKey.get(key);

      if (existing) {
        byKey.set(key, {
          ...existing,
          level: level === 'CET6' ? 'CET6' : existing.level,
          streak: 0,
          wrongCount: existing.wrongCount + 1,
          updatedAt: stamp,
        });
        updated += 1;
      } else {
        byKey.set(key, {
          word,
          level,
          streak: 0,
          wrongCount: 1,
          addedAt: stamp,
          updatedAt: stamp,
        });
        added += 1;
      }
    }

    const words = [...byKey.values()].slice(-MAX_WORDS);
    return { book: { version: VERSION, words }, added, updated };
  }

  /**
   * 答对一次：连对 +1；达到 3 次则移出错词本。
   * @returns {{book: object, streak: number, mastered: boolean, entry: object|null}}
   */
  function markCorrect(book, word, now) {
    const stamp = Number.isFinite(now) ? now : Date.now();
    const current = normalizeBook(book);
    const key = keyOf(word);
    const entry = current.words.find((item) => keyOf(item.word) === key);
    if (!entry) {
      return { book: current, streak: 0, mastered: false, entry: null };
    }
    const streak = entry.streak + 1;
    if (streak >= MASTERY_STREAK) {
      return {
        book: {
          version: VERSION,
          words: current.words.filter((item) => keyOf(item.word) !== key),
        },
        streak,
        mastered: true,
        entry: { ...entry, streak, updatedAt: stamp },
      };
    }
    const words = current.words.map((item) =>
      keyOf(item.word) === key ? { ...item, streak, updatedAt: stamp } : item
    );
    return {
      book: { version: VERSION, words },
      streak,
      mastered: false,
      entry: { ...entry, streak, updatedAt: stamp },
    };
  }

  /**
   * 答错一次：该词连对计数清零（保留在错词本中）。
   */
  function markWrong(book, word, now) {
    const stamp = Number.isFinite(now) ? now : Date.now();
    const current = normalizeBook(book);
    const key = keyOf(word);
    const entry = current.words.find((item) => keyOf(item.word) === key);
    if (!entry) {
      return { book: current, streak: 0, entry: null };
    }
    const words = current.words.map((item) =>
      keyOf(item.word) === key
        ? {
            ...item,
            streak: 0,
            wrongCount: item.wrongCount + 1,
            updatedAt: stamp,
          }
        : item
    );
    return {
      book: { version: VERSION, words },
      streak: 0,
      entry: { ...entry, streak: 0 },
    };
  }

  function clear() {
    return emptyBook();
  }

  return {
    STORAGE_KEY,
    VERSION,
    MASTERY_STREAK,
    MAX_WORDS,
    emptyBook,
    normalizeBook,
    parse,
    serialize,
    load,
    save,
    count,
    has,
    get,
    addMistakes,
    markCorrect,
    markWrong,
    clear,
  };
});
