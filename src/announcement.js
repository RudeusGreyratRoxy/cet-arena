'use strict';

/**
 * 首页「更新公告」存储。
 *
 * - 单条公告（无历史版本），后台保存即覆盖；
 * - 文件 data/announcement.json 属**运行时状态**（已 gitignore），
 *   避免每次发布公告都产生 git 脏改动 / pull 冲突；
 * - 先写临时文件再 rename，保证原子性；
 * - 公告需要分段，因此**保留换行**，只清掉控制字符。
 */

const fs = require('fs');
const path = require('path');

const MAX_CONTENT = 500;

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

/**
 * 清洗公告文本：统一换行、去掉除 \n 之外的控制字符、去行尾空白、压缩多余空行。
 */
function cleanContent(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createAnnouncementStore(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const file = options.file || path.join(dataDir, 'announcement.json');
  const now = options.now || (() => new Date());

  const db = readJson(file, null) || {};
  let content = typeof db.content === 'string' ? cleanContent(db.content) : '';
  let updatedAt = typeof db.updatedAt === 'string' && db.updatedAt ? db.updatedAt : null;

  /** 公开给首页的只读快照。 */
  function get() {
    return { content, updatedAt };
  }

  /**
   * 覆盖保存公告；空字符串表示清空（首页将不再展示）。
   * @returns {{ok: boolean, code?: string, message?: string, content?: string, updatedAt?: string}}
   */
  function set(raw) {
    if (typeof raw !== 'string') {
      return { ok: false, code: 'BAD_CONTENT', message: '公告内容格式不正确' };
    }
    const text = cleanContent(raw);
    const length = Array.from(text).length;
    if (length > MAX_CONTENT) {
      return {
        ok: false,
        code: 'TOO_LONG',
        message: `公告最多 ${MAX_CONTENT} 字，当前 ${length} 字`,
      };
    }

    content = text;
    updatedAt = now().toISOString();
    writeJsonAtomic(file, { version: 1, content, updatedAt });
    return { ok: true, content, updatedAt };
  }

  return { get, set, file };
}

module.exports = { createAnnouncementStore, cleanContent, MAX_CONTENT };
