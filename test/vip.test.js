'use strict';

/**
 * 激活码测试（单一类型）：
 * - unlimited 码不限次、不绑 IP；
 * - 普通码一码一用、绑 IP、同 IP 可复用、并发互斥；
 * - 验证通过后建房与加入都放行，未验证两者都拦截。
 */

const assert = require('assert/strict');
const fs = require('fs');
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
      VIP888: { type: 'once', label: '单人码' },
      VIP666: { type: 'once', label: '单人码' },
      VIP777: { type: 'once', label: '并发测试' },
    },
  })
);

let passed = 0;
const ok = (label, condition) => {
  assert(condition, label);
  passed += 1;
  console.log('  ✓ ' + label);
};

const resetState = () => {
  try {
    fs.unlinkSync(statePath);
  } catch (error) {
    /* not exists */
  }
};
const newStore = () => createVipStore({ seedPath, statePath });

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

async function main() {
  try {
    console.log('=== 1. 特殊码 ===');
    resetState();
    const s1 = newStore();
    ok('BOSS888 通过且不限次', s1.verify('BOSS888', '1.1.1.1').ok === true && s1.verify('BOSS888', '2.2.2.2').ok === true);
    ok('080323 通过且不限次', s1.verify('080323', '3.3.3.3').ok === true && s1.verify('080323', '4.4.4.4').ok === true);
    ok('特殊码不写绑定状态', !fs.existsSync(statePath));

    console.log('=== 2. 普通码：一码一用 + IP 绑定 ===');
    resetState();
    const s2 = newStore();
    const first = s2.verify('VIP888', '10.0.0.1');
    ok('首次验证通过', first.ok === true && first.kind === 'once');
    ok('首次写入 used + boundIp', fs.existsSync(statePath));
    ok('同 IP 再次验证通过', s2.verify('VIP888', '10.0.0.1').ok === true);
    const other = s2.verify('VIP888', '10.0.0.2');
    ok('换 IP 被拒绝', other.ok === false && other.code === 'BOUND');
    ok('拒绝提示正确', other.message === '该卡密已绑定其他设备');

    console.log('=== 3. 并发互斥 ===');
    resetState();
    const s3 = newStore();
    const results = [1, 2, 3, 4].map((n) => s3.verify('VIP777', '10.1.0.' + n));
    ok('并发只有 1 个成功', results.filter((r) => r.ok).length === 1);
    ok('其余 3 个被拒', results.filter((r) => !r.ok).length === 3);

    console.log('=== 4. 建房 / 加入闸门（socket 集成）===');
    resetState();
    const arena = createArenaServer({ vipRequired: true, vipOptions: { seedPath, statePath } });
    await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = arena.httpServer.address();
    const url = `http://127.0.0.1:${port}`;

    const guest = await connect(url, '10.2.0.1');
    const gCreate = await call(guest, 'room:create', { nickname: 'Guest' });
    const gJoin = await call(guest, 'room:join', { nickname: 'Guest', code: '123456' });
    ok('未激活不能建房', gCreate.ok === false && gCreate.code === 'VIP_REQUIRED');
    ok('未激活不能加入', gJoin.ok === false && gJoin.code === 'VIP_REQUIRED');
    guest.close();

    const host = await connect(url, '10.2.0.2');
    const hv = await call(host, 'vip:verify', { code: 'VIP888' });
    ok('普通码验证通过', hv.ok === true && hv.kind === 'once');
    const created = await call(host, 'room:create', { nickname: '房主' });
    ok('验证后可建房', created.ok === true && /^\d{6}$/.test(created.room.code));

    const joiner = await connect(url, '10.2.0.3');
    const jv = await call(joiner, 'vip:verify', { code: 'VIP666' });
    ok('第二名玩家用自己的码验证通过', jv.ok === true);
    const joined = await call(joiner, 'room:join', { nickname: '队友', code: created.room.code });
    ok('验证后可加入他人房间', joined.ok === true && joined.room.players.length === 2);

    const noCode = await connect(url, '10.2.0.4');
    const nc = await call(noCode, 'room:join', { nickname: '白嫖', code: created.room.code });
    ok('没码的人无法挤进房间', nc.ok === false && nc.code === 'VIP_REQUIRED');
    noCode.close();

    host.close();
    joiner.close();
    await arena.close();

    console.log('');
    console.log(`激活码测试全部通过（${passed} 项断言）。`);
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
