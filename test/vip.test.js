'use strict';

/**
 * 激活码测试（设备 Token 绑定）：
 * - unlimited 码不限次、不绑任何设备；
 * - 普通码一码一用、绑定 device_token，同设备可复用（换网络也放行）；
 * - **换设备一律拒绝**，哪怕两台机器在同一个公网 IP 后面（校园网 NAT 场景）；
 * - 验证通过后建房与加入都放行，未验证两者都拦截。
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const { createVipStore, normalizeDeviceToken } = require('../src/vipCodes');
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
      TESTSECRET1: { type: 'unlimited', label: '站长' },
      'TESTSECRET2': { type: 'unlimited', label: '专属永久' },
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

// 32 位十六进制，模拟前端 randomUUID().replace(/-/g,'')
const DEVICE_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DEVICE_B = 'ffeeddccbbaa99887766554433221100';
const DEVICE_C = '0123456789abcdef0123456789abcdef';

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
    ok('TESTSECRET1 通过且不限次', s1.verify('TESTSECRET1', '1.1.1.1').ok === true && s1.verify('TESTSECRET1', '2.2.2.2').ok === true);
    ok('TESTSECRET2 通过且不限次', s1.verify('TESTSECRET2', '3.3.3.3').ok === true && s1.verify('TESTSECRET2', '4.4.4.4').ok === true);
    ok('特殊码不需要设备 Token', s1.verify('TESTSECRET1', '5.5.5.5', '').ok === true);
    ok('特殊码不写绑定状态', !fs.existsSync(statePath));

    console.log('=== 2. 普通码：必须带设备 Token ===');
    resetState();
    const s2 = newStore();
    const noDevice = s2.verify('VIP888', '10.0.0.1');
    ok('缺少设备 Token 被拒', noDevice.ok === false && noDevice.code === 'DEVICE_REQUIRED');
    ok('过短的 Token 被拒', s2.verify('VIP888', '10.0.0.1', 'abc').ok === false);
    ok('含非法字符的 Token 被拒', s2.verify('VIP888', '10.0.0.1', 'bad token!@#$%^&*()123456').ok === false);
    ok('此时仍未绑定', !fs.existsSync(statePath));

    console.log('=== 3. 设备绑定：一码一设备 ===');
    resetState();
    const s3 = newStore();
    const first = s3.verify('VIP888', '10.0.0.1', DEVICE_A);
    ok('首次验证通过', first.ok === true && first.kind === 'once' && first.firstUse === true);
    ok('首次写入 used + 设备 Token', fs.existsSync(statePath));
    ok('同设备同 IP 再次验证通过', s3.verify('VIP888', '10.0.0.1', DEVICE_A).ok === true);

    console.log('=== 4. 校园网 NAT 核心场景（同 IP、不同设备）===');
    const natShare = s3.verify('VIP888', '10.0.0.1', DEVICE_B);
    ok('同 IP 换设备被拒绝', natShare.ok === false && natShare.code === 'BOUND');
    ok('提示文案正确', natShare.message === '该卡密已绑定其他设备');
    const natShare3 = s3.verify('VIP888', '10.0.0.1', DEVICE_C);
    ok('同 IP 第三台设备同样被拒', natShare3.ok === false && natShare3.code === 'BOUND');

    console.log('=== 5. 同设备换网络应放行 ===');
    const moved = s3.verify('VIP888', '10.9.9.9', DEVICE_A);
    ok('同设备换 IP 仍通过（宿舍 Wi-Fi ↔ 热点）', moved.ok === true && moved.reused === true);
    const record = JSON.parse(fs.readFileSync(statePath, 'utf8')).VIP888;
    ok('绑定主体是设备 Token', record.boundDevice === DEVICE_A);
    ok('IP 仅作风控记录（保留首次绑定 IP）', record.boundIp === '10.0.0.1');
    ok('记录最近一次来源 IP', record.lastIp === '10.9.9.9');

    console.log('=== 6. 换设备换 IP 也被拒 ===');
    resetState();
    const s4 = newStore();
    s4.verify('VIP666', '10.2.0.1', DEVICE_A);
    ok('完全不同的设备被拒', s4.verify('VIP666', '10.3.0.1', DEVICE_B).ok === false);

    console.log('=== 7. 并发互斥（4 台不同设备抢同一码）===');
    resetState();
    const s5 = newStore();
    const results = [DEVICE_A, DEVICE_B, DEVICE_C, 'deadbeefdeadbeefdeadbeefdeadbeef']
      .map((device, index) => s5.verify('VIP777', '10.1.0.' + index, device));
    ok('并发只有 1 个成功', results.filter((r) => r.ok).length === 1);
    ok('其余 3 个被拒', results.filter((r) => !r.ok).length === 3);

    console.log('=== 8. 旧数据迁移（只有 IP、没有设备 Token）===');
    resetState();
    fs.writeFileSync(
      statePath,
      JSON.stringify({ VIP666: { status: 'used', boundIp: '10.4.0.1', usedAt: '2026-11-01T00:00:00.000Z' } })
    );
    const s6 = newStore();
    ok('旧记录换 IP 仍被拒', s6.verify('VIP666', '10.4.0.9', DEVICE_A).ok === false);
    const migrated = s6.verify('VIP666', '10.4.0.1', DEVICE_A);
    ok('旧记录同 IP 首次带 Token 时可迁移通过', migrated.ok === true && migrated.migrated === true);
    ok('迁移后已落库设备 Token', JSON.parse(fs.readFileSync(statePath, 'utf8')).VIP666.boundDevice === DEVICE_A);

    console.log('=== 9. Token 规范化 ===');
    ok('正常 Token 保留', normalizeDeviceToken('  ' + DEVICE_A + '  ') === DEVICE_A);
    ok('空值归一为空串', normalizeDeviceToken(null) === '' && normalizeDeviceToken(undefined) === '');
    ok('超长 Token 归一为空串', normalizeDeviceToken('x'.repeat(129)) === '');

    console.log('=== 10. 建房 / 加入闸门（socket 集成）===');
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
    const noToken = await call(host, 'vip:verify', { code: 'VIP888' });
    ok('socket 不带 deviceToken 被拒', noToken.ok === false && noToken.code === 'DEVICE_REQUIRED');

    const hv = await call(host, 'vip:verify', { code: 'VIP888', deviceToken: DEVICE_A });
    ok('普通码验证通过', hv.ok === true && hv.kind === 'once');
    const created = await call(host, 'room:create', { nickname: '房主' });
    ok('验证后可建房', created.ok === true && /^\d{6}$/.test(created.room.code));

    // 同一公网 IP 下的另一台设备（同一校园网），拿同一个码尝试
    const neighbor = await connect(url, '10.2.0.2');
    const stolen = await call(neighbor, 'vip:verify', { code: 'VIP888', deviceToken: DEVICE_B });
    ok('同 IP 的邻居设备无法复用该码', stolen.ok === false && stolen.code === 'BOUND');
    neighbor.close();

    const joiner = await connect(url, '10.2.0.3');
    const jv = await call(joiner, 'vip:verify', { code: 'VIP666', deviceToken: DEVICE_B });
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
