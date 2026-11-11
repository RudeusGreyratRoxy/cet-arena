'use strict';

/**
 * 房间生命周期与审计日志测试。
 * 覆盖：双方离线后快速回收、宽限期内重连可救回、审计日志字段齐全。
 */

const assert = require('assert/strict');
const { io } = require('socket.io-client');
const { createArenaServer } = require('../src/app');
const { APP_VERSION } = require('../src/version');

const GRACE = 250;

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
      if (error) resolve({ ok: false, error: 'timeout' });
      else resolve(response || { ok: false, error: 'empty' });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    originalLog(...args);
  };

  const arena = createArenaServer({ emptyRoomGraceMs: GRACE, vipRequired: false });
  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = arena.httpServer.address();
  const url = `http://127.0.0.1:${port}`;
  const ok = (label, condition) => {
    assert(condition, label);
    console.log('  ✓ ' + label);
  };

  try {
    console.log('=== 1. 双方掉线后回收（未结束对局，走宽限期）===');
    const alice = await connect(url);
    const bob = await connect(url);
    const created = await call(alice, 'room:create', { nickname: 'Alice', level: 'CET4' });
    assert.equal(created.ok, true, created.error);
    const roomCode = created.room.code;
    const joined = await call(bob, 'room:join', { nickname: 'Bob', code: roomCode });
    assert.equal(joined.ok, true, joined.error);
    ok('房间已创建', arena.rooms.size === 1);

    alice.close();
    bob.close();
    await sleep(120);
    ok('宽限期内房间仍然保留（等待可能的重连）', arena.rooms.size === 1);

    await sleep(GRACE + 250);
    ok('超过宽限期后房间被自动回收', arena.rooms.size === 0);

    console.log('=== 2. 宽限期内重连，房间应被保留 ===');
    const carol = await connect(url);
    const dave = await connect(url);
    const created2 = await call(carol, 'room:create', { nickname: 'Carol', level: 'CET4' });
    assert.equal(created2.ok, true, created2.error);
    const code2 = created2.room.code;
    const joined2 = await call(dave, 'room:join', { nickname: 'Dave', code: code2 });
    assert.equal(joined2.ok, true, joined2.error);

    carol.close();
    dave.close();
    await sleep(60);

    const carolAgain = await connect(url);
    const resumed = await call(carolAgain, 'room:resume', { sessionId: created2.sessionId });
    ok('重连成功回到原房间', resumed.ok === true && resumed.room.code === code2);

    await sleep(GRACE + 250);
    ok('重连后房间未被回收', arena.rooms.size === 1);

    const leave = await call(carolAgain, 'room:leave', {});
    ok('退出成功', leave.ok === true);
    await sleep(GRACE + 250);
    ok('最后一个在线玩家退出后房间被回收', arena.rooms.size === 0);
    carolAgain.close();

    console.log('=== 3. 审计日志字段 ===');
    const auditLines = logs.filter((line) => line.startsWith('[audit] '));
    ok('产生了审计日志', auditLines.length > 0);

    const parsed = auditLines.map((line) => JSON.parse(line.slice(8)));
    const events = new Set(parsed.map((entry) => entry.event));
    for (const required of ['socket_connect', 'player_bind', 'socket_disconnect', 'room_closed']) {
      ok('包含事件 ' + required, events.has(required));
    }

    const bind = parsed.find((entry) => entry.event === 'player_bind');
    ok('player_bind 记录 IP', typeof bind.ip === 'string' && bind.ip.length > 0);
    ok('player_bind 记录昵称', bind.nickname === 'Alice');
    ok('player_bind 记录房间码', bind.room === roomCode);
    ok('日志带 ISO 时间戳', /^\d{4}-\d{2}-\d{2}T/.test(bind.ts));

    const disconnect = parsed.find((entry) => entry.event === 'socket_disconnect' && entry.nickname);
    ok('socket_disconnect 记录昵称与房间', disconnect.nickname === 'Alice' && disconnect.room === roomCode);
    ok('socket_disconnect 记录在线时长', typeof disconnect.durationMs === 'number');

    const closed = parsed.find((entry) => entry.event === 'room_closed');
    ok('room_closed 记录房间码与玩家', closed.room === roomCode && Array.isArray(closed.players));
  } finally {
    console.log = originalLog;
    await arena.close();
  }

  console.log('');
  console.log('房间生命周期测试全部通过。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
