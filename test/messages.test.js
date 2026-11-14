'use strict';

/**
 * 联系站长留言板测试：
 * - 内容校验（空 / 超 50 字 / 控制字符）；
 * - 按 device_token 限流：每台设备最多 20 条；
 * - 落盘持久化、倒序列表；
 * - 公开 socket 入口可用，后台接口必须登录；
 * - 后台可标记已处理 / 删除。
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const { createMessageStore, MAX_CONTENT, MAX_REPLY } = require('../src/messages');
const { createArenaServer } = require('../src/app');
const { APP_VERSION } = require('../src/version');

const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-msg-'));
const file = path.join(dir, 'messages.json');
const vDir = path.join(dir, 'vip');
fs.mkdirSync(vDir, { recursive: true });
fs.writeFileSync(path.join(vDir, 'vip_codes.json'), JSON.stringify({ version: 1, codes: {} }));

const DEVICE_A = 'aaaabbbbccccddddeeeeffff00001111';
const DEVICE_B = '11110000ffffeeeeddddccccbbbbaaaa';

let passed = 0;
const ok = (label, condition, detail) => {
  assert(condition, label + (detail === undefined ? '' : ` -> ${detail}`));
  passed += 1;
  console.log('  ✓ ' + label);
};

function freshStore(options = {}) {
  fs.rmSync(file, { force: true });
  return createMessageStore({ file, minIntervalMs: 0, ...options });
}

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { messages: [] };
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      forceNew: true,
      reconnection: false,
      auth: { clientVersion: APP_VERSION },
      timeout: 5000,
      transports: ['websocket', 'polling'],
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function call(socket, event, payload) {
  return new Promise((resolve) => {
    socket.timeout(5000).emit(event, payload, (error, response) => {
      resolve(error ? { ok: false, error: 'timeout' } : response || { ok: false });
    });
  });
}

async function main() {
  try {
    console.log('=== 1. 内容校验 ===');
    let store = freshStore();
    ok('空内容被拒', store.add({ content: '   ', deviceToken: DEVICE_A }).code === 'EMPTY');
    ok('超过 50 字被拒', store.add({ content: '字'.repeat(MAX_CONTENT + 1), deviceToken: DEVICE_A }).code === 'TOO_LONG');
    ok('正好 50 字可以通过', store.add({ content: '字'.repeat(MAX_CONTENT), deviceToken: DEVICE_A }).ok === true);
    ok('缺少设备 Token 被拒', store.add({ content: '你好', deviceToken: '' }).code === 'DEVICE_REQUIRED');

    store = freshStore();
    const cleaned = store.add({ content: '  第一行\n\n第二行\t tab  ', deviceToken: DEVICE_A });
    ok('换行与多余空白被压缩', cleaned.ok === true);
    const saved = readFile().messages[0];
    ok('落盘内容已清理', saved.content === '第一行 第二行 tab', saved.content);
    ok('记录设备前 8 位', saved.devicePrefix === DEVICE_A.slice(0, 8));
    ok('不保存完整设备 Token', !JSON.stringify(saved).includes(DEVICE_A));

    console.log('=== 2. 动态配额：最多 5 条未处理 ===');
    store = freshStore();
    let added = 0;
    for (let i = 0; i < 5; i += 1) {
      if (store.add({ content: `第 ${i + 1} 条留言`, deviceToken: DEVICE_A }).ok) added += 1;
    }
    ok('前 5 条全部写入', added === 5, String(added));
    const overflow = store.add({ content: '第 6 条', deviceToken: DEVICE_A });
    ok('第 6 条被限流', overflow.ok === false && overflow.code === 'LIMIT');
    ok(
      '限流文案符合新规则',
      overflow.message === '您的留言额度已用完（最多5条），请等待站长处理后再试',
      overflow.message
    );
    ok('另一台设备不受影响', store.add({ content: '别的设备', deviceToken: DEVICE_B }).ok === true);
    ok('限流后文件仍是 6 条', readFile().messages.length === 6);

    console.log('=== 2.1 处理 / 删除后额度自动归还 ===');
    store = freshStore();
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const result = store.add({ content: `待处理 ${i + 1}`, deviceToken: DEVICE_A });
      ids.push(result.record.id);
    }
    ok('先占满 5 条额度', store.add({ content: '超额', deviceToken: DEVICE_A }).code === 'LIMIT');

    store.markHandled(ids[0], true);
    ok('标记已处理后可以再发一条', store.add({ content: '处理后续发', deviceToken: DEVICE_A }).ok === true);
    ok('再次占满后被限流', store.add({ content: '又超额', deviceToken: DEVICE_A }).code === 'LIMIT');

    store.remove(ids[1]);
    ok('删除一条后额度再归还 1', store.add({ content: '删除后续发', deviceToken: DEVICE_A }).ok === true);

    const pendingCount = readFile().messages.filter(
      (item) => item.deviceHash && item.status !== 'handled'
    ).length;
    ok('未处理数不超过 5', pendingCount <= 5, String(pendingCount));
    ok('已处理的历史留言不占额度', readFile().messages.length === 6, String(readFile().messages.length));

    const reopened = store.markHandled(ids[2], false);
    ok('已处理可恢复为待处理', reopened.ok === true);
    ok('恢复后重新占用额度', store.add({ content: '恢复后检查', deviceToken: DEVICE_A }).code === 'LIMIT');

    console.log('=== 3. 防重复提交（冷却）===');
    store = freshStore({ minIntervalMs: 3000 });
    ok('第一次通过', store.add({ content: '连点测试', deviceToken: DEVICE_A }).ok === true);
    const second = store.add({ content: '连点测试', deviceToken: DEVICE_A });
    ok('3 秒内第二次被拒', second.ok === false && second.code === 'TOO_FAST');
    ok('仅写入 1 条', readFile().messages.length === 1);

    console.log('=== 4. 列表与统计 ===');
    store = freshStore();
    store.add({ content: 'A 留言', deviceToken: DEVICE_A });
    store.add({ content: 'B 留言', deviceToken: DEVICE_B });
    const listed = store.list();
    ok('列表按时间倒序', listed[0].content === 'B 留言', listed[0].content);
    ok('统计总数 2', store.stats().total === 2);
    ok('统计待处理 2', store.stats().pending === 2);

    console.log('=== 5. 标记已处理 / 删除 ===');
    const firstId = listed[0].id;
    const handled = store.markHandled(firstId, true);
    ok('标记已处理成功', handled.ok === true && handled.record.status === 'handled');
    ok('待处理数减少', store.stats().pending === 1);
    const restored = store.markHandled(firstId, false);
    ok('可恢复为待处理', restored.record.status === 'new');
    const deleted = store.remove(firstId);
    ok('删除成功', deleted.ok === true);
    ok('删除后只剩 1 条', store.list().length === 1);
    ok('删除不存在的留言被拒', store.remove('nope').code === 'NOT_FOUND');

    console.log('=== 5.1 站长回复（vip18） ===');
    store = freshStore();
    const replyTargetId = store.add({ content: '听不到声音', deviceToken: DEVICE_A }).record.id;
    const replied = store.reply(replyTargetId, '已经修好了，请刷新页面');
    ok('回复成功', replied.ok === true && replied.record.reply === '已经修好了，请刷新页面');
    ok('回复后自动变为已处理', replied.record.status === 'handled');
    ok(
      '回复时间已写入',
      typeof replied.record.repliedAt === 'string' && replied.record.repliedAt.length > 0
    );
    ok('回复后待处理数归零', store.stats().pending === 0);
    ok('回复空内容被拒', store.reply(replyTargetId, '   ').code === 'EMPTY_REPLY');
    ok(
      '回复超过 100 字被拒',
      store.reply(replyTargetId, '字'.repeat(MAX_REPLY + 1)).code === 'REPLY_TOO_LONG'
    );
    ok('回复正好 100 字可以通过', store.reply(replyTargetId, '字'.repeat(MAX_REPLY)).ok === true);
    ok('回复不存在的留言被拒', store.reply('nope', '你好').code === 'NOT_FOUND');

    const mineHash = readFile().messages[0].deviceHash;
    ok('listByDevice 能查到本设备留言', store.listByDevice(mineHash).length === 1);
    ok('listByDevice 不返回别的设备', store.listByDevice('deadbeef').length === 0);
    ok('listByDevice 空哈希返回空数组', store.listByDevice('').length === 0);

    console.log('=== 6. 公开接口 + 后台接口（HTTP / socket）===');
    fs.rmSync(file, { force: true });
    const arena = createArenaServer({
      vipRequired: true,
      vipOptions: { seedPath: path.join(vDir, 'vip_codes.json'), statePath: path.join(vDir, 'state.json') },
      messageOptions: { file, minIntervalMs: 0 },
    });
    await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = arena.httpServer.address();
    const base = `http://127.0.0.1:${port}`;

    const socket = await connect(base);
    const created = await call(socket, 'message:create', { content: '游戏里听不到声音', deviceToken: DEVICE_A });
    ok('未激活也能留言', created.ok === true, JSON.stringify(created));
    const empty = await call(socket, 'message:create', { content: '', deviceToken: DEVICE_A });
    ok('空内容被服务端拒绝', empty.ok === false && empty.code === 'EMPTY');
    socket.close();

    const guard = await fetch(`${base}/api/admin/messages`);
    ok('未登录读留言 401', guard.status === 401);

    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'boss2026' }),
    });
    ok('后台登录成功', login.ok === true);
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

    const listRes = await (
      await fetch(`${base}/api/admin/messages`, { headers: { Cookie: cookie } })
    ).json();
    ok('后台可读留言', listRes.ok === true && listRes.messages.length === 1);
    ok('留言含设备前 8 位', listRes.messages[0].devicePrefix === DEVICE_A.slice(0, 8));
    ok('留言含 IP 风控字段', 'ip' in listRes.messages[0]);

    const msgId = listRes.messages[0].id;

    // --- 回复接口鉴权：未登录必须 401 ---
    const guardReply = await fetch(`${base}/api/admin/messages/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: msgId, reply: '未登录回复' }),
    });
    ok('未登录调回复接口 401', guardReply.status === 401);

    // --- 回复成功，并自动转为已处理 ---
    const replyRes = await (
      await fetch(`${base}/api/admin/messages/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ id: msgId, reply: '已为你修复，请重试' }),
      })
    ).json();
    ok('后台回复成功', replyRes.ok === true && replyRes.record.reply === '已为你修复，请重试');
    ok('回复后自动变已处理', replyRes.record.status === 'handled');
    ok('回复后待处理数归零', replyRes.stats.pending === 0, JSON.stringify(replyRes.stats));
    ok(
      '回复时间已回传',
      typeof replyRes.record.repliedAt === 'string' && replyRes.record.repliedAt.length > 0
    );

    // --- 回复超长 / 目标不存在 ---
    const longReply = await fetch(`${base}/api/admin/messages/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: msgId, reply: '字'.repeat(100 + 1) }),
    });
    ok('回复超过 100 字返回 400', longReply.status === 400);

    const missingReply = await fetch(`${base}/api/admin/messages/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: 'not-exist', reply: '你好' }),
    });
    ok('回复不存在的留言返回 404', missingReply.status === 404);

    // --- 用户端 message:mine：只看得到自己的留言与回复 ---
    const mineSocket = await connect(base);
    const mineA = await call(mineSocket, 'message:mine', { deviceToken: DEVICE_A });
    ok('message:mine 查到本设备留言', mineA.ok === true && mineA.messages.length === 1);
    ok('message:mine 能拿到站长回复', mineA.messages[0].reply === '已为你修复，请重试');
    ok(
      'message:mine 只回白名单字段',
      Object.keys(mineA.messages[0]).sort().join(',') ===
        ['content', 'createdAt', 'id', 'reply', 'repliedAt', 'status'].sort().join(',')
    );

    const mineB = await call(mineSocket, 'message:mine', { deviceToken: DEVICE_B });
    ok('message:mine 查不到别的设备的留言', mineB.ok === true && mineB.messages.length === 0);
    ok(
      'message:mine 不回他人留言内容',
      !JSON.stringify(mineB).includes('听不到声音')
    );

    const mineNoToken = await call(mineSocket, 'message:mine', { deviceToken: '' });
    ok('message:mine 缺少设备 Token 被拒', mineNoToken.ok === false && mineNoToken.code === 'DEVICE_REQUIRED');
    mineSocket.close();

    const handleRes = await (
      await fetch(`${base}/api/admin/messages/handle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ id: msgId, handled: true }),
      })
    ).json();
    ok('后台标记已处理', handleRes.ok === true && handleRes.stats.pending === 0);

    const delRes = await (
      await fetch(`${base}/api/admin/messages/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ id: msgId }),
      })
    ).json();
    ok('后台删除留言', delRes.ok === true && delRes.stats.total === 0);

    const stateRes = await (
      await fetch(`${base}/api/admin/state`, { headers: { Cookie: cookie } })
    ).json();
    ok('登录态接口带出待处理数', stateRes.messages && typeof stateRes.messages.pending === 'number');

    await arena.close();

    console.log('');
    console.log(`留言板测试全部通过（${passed} 项断言）。`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }
  process.exit(1);
});
