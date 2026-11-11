'use strict';

/**
 * 激活码分级测试：super_admin / host（房主码）/ player（单人码）。
 * 覆盖：类型权限、一码一用、IP 绑定、并发互斥、持久化、建房/加入闸门。
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
    version: 2,
    codes: {
      BOSS888: { type: 'super_admin', label: '站长' },
      '080323': { type: 'super_admin', label: '专属永久' },
      HOST888: { type: 'host', label: '房主码' },
      HOST666: { type: 'host', label: '房主码2' },
      PLAY888: { type: 'player', label: '单人码' },
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
    console.log('=== 1. 类型与 tier ===');
    resetState();
    const s1 = newStore();
    const boss = s1.verify('BOSS888', '1.1.1.1');
    ok('super_admin 验证通过且返回 tier', boss.ok === true && boss.tier === 'super_admin');
    ok('super_admin 换 IP 仍通过', s1.verify('BOSS888', '2.2.2.2').ok === true);
    const host = s1.verify('HOST888', '10.0.0.1');
    ok('host 码返回 tier=host', host.ok === true && host.tier === 'host');
    const player = s1.verify('PLAY888', '10.0.0.5');
    ok('player 码返回 tier=player', player.ok === true && player.tier === 'player');

    console.log('=== 2. 一次性与 IP 绑定（host / player 同规则）===');
    ok('host 码同 IP 复用通过', s1.verify('HOST888', '10.0.0.1').ok === true);
    const hostOther = s1.verify('HOST888', '10.0.0.2');
    ok('host 码换 IP 被拒', hostOther.ok === false && hostOther.code === 'BOUND');
    ok('player 码同 IP 复用通过', s1.verify('PLAY888', '10.0.0.5').ok === true);
    const playerOther = s1.verify('PLAY888', '10.0.0.6');
    ok('player 码换 IP 被拒', playerOther.ok === false && playerOther.code === 'BOUND');

    console.log('=== 3. 并发互斥 ===');
    resetState();
    const s3 = newStore();
    const results = [1, 2, 3, 4].map((n) => s3.verify('HOST666', '10.1.0.' + n));
    ok('并发只有一个成功', results.filter((r) => r.ok).length === 1);
    ok('其余三个被拒', results.filter((r) => !r.ok).length === 3);

    console.log('=== 4. 建房 / 加入闸门（socket 集成）===');
    resetState();
    const arena = createArenaServer({ vipRequired: true, vipOptions: { seedPath, statePath } });
    await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = arena.httpServer.address();
    const url = `http://127.0.0.1:${port}`;

    const guest = await connect(url, '10.2.0.1');
    const guestCreate = await call(guest, 'room:create', { nickname: 'Guest' });
    ok('未激活不能建房', guestCreate.ok === false && guestCreate.code === 'VIP_REQUIRED');
    const guestJoin = await call(guest, 'room:join', { nickname: 'Guest', code: '123456' });
    ok('未激活不能加入', guestJoin.ok === false && guestJoin.code === 'VIP_REQUIRED');
    guest.close();

    const hostSocket = await connect(url, '10.2.0.2');
    const hostVerify = await call(hostSocket, 'vip:verify', { code: 'HOST888' });
    ok('房主码验证返回 host', hostVerify.ok === true && hostVerify.tier === 'host');
    const created = await call(hostSocket, 'room:create', { nickname: '房主' });
    ok('房主码可以建房', created.ok === true && /^\d{6}$/.test(created.room.code));

    const playerSocket = await connect(url, '10.2.0.3');
    const playerVerify = await call(playerSocket, 'vip:verify', { code: 'PLAY888' });
    ok('单人码验证返回 player', playerVerify.ok === true && playerVerify.tier === 'player');

    const playerCreate = await call(playerSocket, 'room:create', { nickname: '单人' });
    ok('单人码不能建房', playerCreate.ok === false && playerCreate.code === 'VIP_TIER');
    ok('拒绝文案说明需要房主码', /房主码/.test(playerCreate.error || ''));

    const playerJoin = await call(playerSocket, 'room:join', {
      nickname: '单人',
      code: created.room.code,
    });
    ok('单人码可以加入房间', playerJoin.ok === true && playerJoin.room.players.length === 2);

    const bossSocket = await connect(url, '10.2.0.4');
    const bossVerify = await call(bossSocket, 'vip:verify', { code: '080323' });
    ok('super_admin 验证通过', bossVerify.ok === true && bossVerify.tier === 'super_admin');
    const bossCreate = await call(bossSocket, 'room:create', { nickname: '站长' });
    ok('super_admin 可以建房', bossCreate.ok === true);

    hostSocket.close();
    playerSocket.close();
    bossSocket.close();
    await arena.close();

    console.log('');
    console.log(`激活码分级测试全部通过（${passed} 项断言）。`);
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
