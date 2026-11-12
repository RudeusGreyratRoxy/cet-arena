'use strict';

/**
 * 首页公告测试：
 * - 存储层：空值、换行保留、控制字符清洗、500 字上限、清空、持久化
 * - HTTP：GET 公开且 no-store、POST 未登录 401、登录后发布/下架、GET 同步
 */

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createArenaServer } = require('../src/app');
const { createAnnouncementStore, cleanContent, MAX_CONTENT } = require('../src/announcement');

let passed = 0;
function ok(label, cond) {
  assert(cond, label);
  passed += 1;
  console.log('  ✓ ' + label);
}

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'announce-'));
  return path.join(dir, 'announcement.json');
}

(async () => {
  console.log('=== 1. 存储层 ===');
  const file = tmpFile();
  const empty = createAnnouncementStore({ file });
  const initial = empty.get();
  ok('文件不存在时返回空内容', initial.content === '' && initial.updatedAt === null);
  ok('不主动创建空文件', !fs.existsSync(file));

  const text = '第一行\n\n第二行 带空格';
  const saved = empty.set(text);
  ok('保存成功并回显内容', saved.ok === true && saved.content === text);
  ok('updatedAt 是 ISO 时间', typeof saved.updatedAt === 'string' && !Number.isNaN(Date.parse(saved.updatedAt)));
  ok('换行被保留', saved.content.includes('\n\n'));
  ok('已落盘', fs.existsSync(file));

  const reread = createAnnouncementStore({ file });
  ok('新实例能读回内容与时间', reread.get().content === text && reread.get().updatedAt === saved.updatedAt);

  ok('非字符串内容被拒', createAnnouncementStore({ file }).set(123).code === 'BAD_CONTENT');
  const tooLong = createAnnouncementStore({ file }).set('字'.repeat(MAX_CONTENT + 1));
  ok('超过 500 字被拒', tooLong.ok === false && tooLong.code === 'TOO_LONG');
  const exact = createAnnouncementStore({ file }).set('字'.repeat(MAX_CONTENT));
  ok('正好 500 字可以通过', exact.ok === true);

  const cleared = createAnnouncementStore({ file }).set('');
  ok('空字符串 = 清空公告', cleared.ok === true && cleared.content === '');

  console.log('=== 2. 文本清洗 ===');
  ok('CRLF 归一为 LF', cleanContent('a\r\nb') === 'a\nb');
  ok('控制字符被移除', cleanContent('a\u0000b\u0007c') === 'abc');
  ok('行尾空白被去掉', cleanContent('a   \nb\t') === 'a\nb');
  ok('连续空行压缩为一段空行', cleanContent('a\n\n\n\nb') === 'a\n\nb');

  console.log('=== 3. HTTP 接口 ===');
  const httpFile = tmpFile();
  const arena = createArenaServer({
    adminPassword: 'test-admin-pass',
    announcementOptions: { file: httpFile },
  });
  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${arena.httpServer.address().port}`;
  let cookie = '';

  async function http(method, route, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(base + route, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (error) { data = null; }
    const setCookie = response.headers.get('set-cookie') || '';
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data, headers: response.headers };
  }

  const getEmpty = await http('GET', '/api/announcement');
  ok('GET 无需登录即可访问', getEmpty.status === 200);
  ok('空公告返回空内容', getEmpty.data.ok === true && getEmpty.data.content === '' && getEmpty.data.updatedAt === null);
  ok('GET 下发 no-store', /no-store/.test(getEmpty.headers.get('cache-control') || ''));

  const denied = await http('POST', '/api/admin/announcement', { content: '未登录发布' });
  ok('未登录发布被拒（401）', denied.status === 401);
  ok('未登录不会写入公告', createAnnouncementStore({ file: httpFile }).get().content === '');

  const login = await http('POST', '/api/admin/login', { password: 'test-admin-pass' });
  ok('站长登录成功', login.status === 200 && login.data.ok === true);

  const published = await http('POST', '/api/admin/announcement', {
    content: '维护通知\n\n请稍后再试',
  });
  ok('登录后可发布公告', published.status === 200 && published.data.ok === true);
  ok('返回内容保留换行', published.data.content.includes('\n\n'));
  ok('返回新的 updatedAt', typeof published.data.updatedAt === 'string');

  const afterPublish = await http('GET', '/api/announcement');
  ok('GET 能读到刚发布的公告', afterPublish.data.content === '维护通知\n\n请稍后再试');

  const tooLongHttp = await http('POST', '/api/admin/announcement', { content: '字'.repeat(MAX_CONTENT + 1) });
  ok('接口层同样拦截超长内容（400）', tooLongHttp.status === 400 && tooLongHttp.data.code === 'TOO_LONG');

  const unpublish = await http('POST', '/api/admin/announcement', { content: '' });
  ok('空内容 = 下架', unpublish.status === 200 && unpublish.data.content === '');
  const afterUnpublish = await http('GET', '/api/announcement');
  ok('下架后 GET 返回空内容', afterUnpublish.data.content === '');

  await arena.close();
  console.log('');
  console.log(`公告测试全部通过（${passed} 项断言）。`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
