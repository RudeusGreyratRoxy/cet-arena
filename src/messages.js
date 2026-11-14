'use strict';

/**
 * 站长留言板存储。
 *
 * - 公开接口只允许「新增」，按 device_token 的 SHA-256 计数限流（默认每台 20 条）；
 * - 存储文件 data/messages.json（不入库），先写临时文件再 rename，保证原子性；
 * - 只保存设备 Token 的前 8 位与哈希，不落完整凭据。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_CONTENT = 50;
// 站长回复长度上限（码点计），比留言正文宽松，够写一两句解释。
const MAX_REPLY = 100;
// 动态配额：同一设备「未处理」留言的并发上限，站长处理后自动归还额度。
const MAX_PER_DEVICE = 5;
const MIN_INTERVAL_MS = 5_000;

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

/** 去掉控制字符、把连续空白压成一个空格，避免把换行塞进列表。 */
function cleanContent(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createMessageStore(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const file = options.file || path.join(dataDir, 'messages.json');
  const now = options.now || (() => new Date());
  const maxPerDevice = options.maxPerDevice || MAX_PER_DEVICE;
  const minIntervalMs = options.minIntervalMs === undefined ? MIN_INTERVAL_MS : options.minIntervalMs;

  let db = readJson(file, null);
  if (!db || typeof db !== 'object') db = { version: 1, messages: [] };
  if (!Array.isArray(db.messages)) db.messages = [];

  function persist() {
    writeJsonAtomic(file, db);
  }

  function byNewestFirst(a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }

  function list() {
    return db.messages.slice().sort(byNewestFirst);
  }

  function stats() {
    return {
      total: db.messages.length,
      pending: db.messages.filter((item) => item.status !== 'handled').length,
    };
  }

  /**
   * @returns {{ok: boolean, code?: string, message: string, record?: object}}
   */
  function add(input = {}) {
    const text = cleanContent(input.content);
    const length = Array.from(text).length;

    if (!text) {
      return { ok: false, code: 'EMPTY', message: '请先写下你遇到的问题' };
    }
    if (length > MAX_CONTENT) {
      return { ok: false, code: 'TOO_LONG', message: `留言最多 ${MAX_CONTENT} 字` };
    }

    const token = String(input.deviceToken == null ? '' : input.deviceToken).trim();
    if (!token) {
      return { ok: false, code: 'DEVICE_REQUIRED', message: '设备标识缺失，请刷新页面后重试' };
    }

    const deviceHash = crypto.createHash('sha256').update(token).digest('hex');

    const mine = db.messages.filter((item) => item.deviceHash === deviceHash);

    // 动态配额：只统计「未处理」的留言。站长标记已处理或删除后，额度自动归还。
    const pending = mine.filter((item) => item.status !== 'handled');
    if (pending.length >= maxPerDevice) {
      return {
        ok: false,
        code: 'LIMIT',
        message: `您的留言额度已用完（最多${maxPerDevice}条），请等待站长处理后再试`,
      };
    }

    if (minIntervalMs > 0) {
      const lastAt = mine
        .map((item) => Date.parse(item.createdAt))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)[0];
      if (lastAt && now().getTime() - lastAt < minIntervalMs) {
        return { ok: false, code: 'TOO_FAST', message: '留言太频繁，请稍后再试' };
      }
    }

    const record = {
      id: crypto.randomBytes(12).toString('hex'),
      content: text,
      deviceHash,
      devicePrefix: token.slice(0, 8),
      ip: input.ip || null,
      createdAt: now().toISOString(),
      status: 'new',
      // 站长回复：默认 null，由 reply() 写入；老记录没有这两个键，读取处一律按 null 处理。
      reply: null,
      repliedAt: null,
    };

    db.messages.push(record);
    persist();
    return { ok: true, message: '已发送给站长，谢谢反馈！', record: { id: record.id } };
  }

  function markHandled(id, handled = true) {
    const record = db.messages.find((item) => item.id === id);
    if (!record) return { ok: false, code: 'NOT_FOUND', message: '留言不存在' };
    record.status = handled ? 'handled' : 'new';
    record.handledAt = handled ? now().toISOString() : null;
    persist();
    return { ok: true, message: handled ? '已标记为已处理' : '已恢复为待处理', record };
  }

  function remove(id) {
    const index = db.messages.findIndex((item) => item.id === id);
    if (index === -1) return { ok: false, code: 'NOT_FOUND', message: '留言不存在' };
    const [removed] = db.messages.splice(index, 1);
    persist();
    return { ok: true, message: '已删除', record: removed };
  }

  /**
   * 站长回复。写入 reply + repliedAt 后，该条留言自动变为「已处理」，
   * 因此这台设备的待处理额度会被释放（回复即处理，站长不用再点一次「标记已处理」）。
   * @returns {{ok: boolean, code?: string, message: string, record?: object}}
   */
  function reply(id, text) {
    const record = db.messages.find((item) => item.id === id);
    if (!record) return { ok: false, code: 'NOT_FOUND', message: '留言不存在' };

    const body = cleanContent(text);
    const length = Array.from(body).length;
    if (!body) {
      return { ok: false, code: 'EMPTY_REPLY', message: '回复内容不能为空' };
    }
    if (length > MAX_REPLY) {
      return { ok: false, code: 'REPLY_TOO_LONG', message: `回复最多 ${MAX_REPLY} 字` };
    }

    const repliedAt = now().toISOString();
    record.reply = body;
    record.repliedAt = repliedAt;
    record.status = 'handled';
    record.handledAt = repliedAt;
    persist();
    return { ok: true, message: '回复已发送', record };
  }

  /**
   * 按设备查自己的留言（用户端「我的留言」），只认 deviceHash，不认明文 token。
   * deviceHash 为空时返回空数组——调用方负责先校验 token，避免空哈希匹配到脏记录。
   */
  function listByDevice(deviceHash) {
    const hash = String(deviceHash == null ? '' : deviceHash).trim();
    if (!hash) return [];
    return db.messages.filter((item) => item.deviceHash === hash).slice().sort(byNewestFirst);
  }

  return { add, list, markHandled, remove, reply, listByDevice, stats, file };
}

module.exports = { createMessageStore, cleanContent, MAX_CONTENT, MAX_REPLY, MAX_PER_DEVICE };
