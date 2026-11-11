'use strict';

/**
 * 激活码系统测试：特殊无限码、一码一用、IP 绑定、并发互斥、持久化、建房闸门。
 */

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');
const { createVipStore } = require('../src/vipCodes');
const { createArenaServer } = require('../src/app');
const { APP_VERSION } = require('../src/version');

const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-vip-'));
const seedPath = path.join(dir, 'vip_codes.json');
const statePath = path.join(dir, 'vip_codes.state.json');

fs.writeFileSync(
  seedPath,
  JSON.stringify({
    version: 1,
    codes: {
      BOSS888: { type: 'unlimited', label: '站长' },
      '080323': { type: 'unlimited', label: '专属永久' },
      VIP888: { type: 'once', label: '早鸟' },
      VIP666: { type: 'once', label: '会员' },
    },
  })
);

let passed = 0;
const ok = (label, condition) => {
  assert(condition, label);
  passed += 1;
  console.log('  ✓ ' + label);
};

function resetState() {
  try {
    fs.unlinkSync(statePath);
  } catch (error) {
    /* 文件不存在 */
  }
}

function newStore() {
  return createVipStore({ seedPath, statePath });
}

async function main() {
  try {
    console.log('=== 1. 特殊无限码 ===');
    const store = newStore();
    const boss1 = store.verify('BOSS888', '1.1.1.1');
    const boss2 = store.verify('BOSS888', '2.2.2.2');
    ok('BOSS888 首次通过', boss1.ok === true && boss1.kind === 'unlimited');
    ok('BOSS888 换 IP 仍通过（不限次数）', boss2.ok === true);
    ok('080323 通过且不绑定', store.verify('080323', '3.3.3.3').ok === true);
    ok('大小写不敏感', store.verify('boss888', '9.9.9.9').ok === true);

    console.log('=== 2. 一码一用 + IP 绑定 ===');
    resetState();
    const s2 = newStore();
    const first = s2.verify('VIP888', '10.0.0.1');
    ok('普通码首次验证通过', first.ok === true && first.firstUse === true);
    ok('同 IP 再次验证通过（视为同一设备刷新）', s2.verify('VIP888', '10.0.0.1').ok === true);
    const otherIp = s2.verify('VIP888', '10.0.0.2');
    ok('换 IP 被拒绝', otherIp.ok === false && otherIp.code === 'BOUND');
    ok('拒绝提示正确', otherIp.message === '该卡密已绑定其他设备');

    console.log('=== 3. 并发互斥（同一毫秒多个请求）===');
    resetState();
    const s3 = newStore();
    const results = [
      s3.verify('VIP666', '10.0.1.1'),
      s3.verify('VIP666', '10.0.1.2'),
      s3.verify('VIP666', '10.0.1.3'),
      s3.verify('VIP666', '10.0.1.4'),
    ];
    const winners = results.filter((r) => r.ok);
    ok('只有 1 个请求成功', winners.length === 1);
    ok('其余均被拒绝', results.filter((r) => !r.ok).length === 3);

    console.log('=== 4. 持久化 ===');
    const s4 = newStore();
    const reused = s4.verify('VIP666', '10.0.1.1');
    ok('重启后仍记得绑定状态（同 IP 可用）', reused.ok === true && reused.reused === true);
    ok('重启后换 IP 仍被拒', s4.verify('VIP666', '10.0.1.9').ok === false);

    console.log('=== 5. 无效输入 ===');
    ok('空码被拒绝', s5Reject(s4, ''));
    ok('未知码被拒绝', s5Reject(s4, 'NOT-A-CODE'));

    console.log('=== 6. 建房闸门（socket 集成）===');
    resetState();
    const arena = createArenaServer({ vipRequired: true, vipOptions: { seedPath, statePath } });
    await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = arena.httpServer.address();
    const url = `http://127.0.0.1:${port}`;

    const alice = await connect(url, '10.1.0.1');
    const before = await call(alice, 'room:create', { nickname: 'Alice' });
    ok('未激活时禁止建房', before.ok === false && before.code === 'VIP_REQUIRED');

    const badCode = await call(alice, 'vip:verify', { code: 'WRONG' });
    ok('错误激活码被拒绝', badCode.ok === false);

    const verified = await call(alice, 'vip:verify', { code: 'VIP888' });
    ok('正确激活码验证通过', verified.ok === true);

    const afterCreate = await call(alice, 'room:create', { nickname: 'Alice' });
    ok('激活后可以建房', afterCreate.ok === true && !!afterCreate.room.code);

    const bob = await connect(url, '10.1.9.9');
    const stolen = await call(bob, 'vip:verify', { code: 'VIP888' });
    ok('另一 IP 复用同一码被拒绝', stolen.ok === false && stolen.code === 'BOUND');

    const carol = await connect(url, '10.1.5.5');
    const boss = await call(carol, 'vip:verify', { code: '080323' });
    ok('特殊码换 IP 依然可用', boss.ok === true);

    alice.close();
    bob.close();
    carol.close();
    await arena.close();

    console.log('');
    console.log(`激活码测试全部通过（${passed} 项断言）。`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function s5Reject(store, code) {
  const r = store.verify(code, '10.0.0.1');
  return r.ok === false && (r.code === 'EMPTY' || r.code === 'INVALID');
}

function connect(url, ip) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      forceNew: true,
      reconnection: false,
      auth: { clientVersion: APP_VERSION },
      timeout: 5000,
      transports: ['websocket', 'polling'],
      extraHeaders: { 'x-forwarded-for': ip },
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function call(socket, event, payload) {
  return new Promise((resolve) => {
    socket.timeout(5000).emit(event, payload, (error, response) => {
      if (error) resolve({ ok: false, error: 'timeout' });
      else resolve(response || { ok: false, error: 'empty' });
    });
  });
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
