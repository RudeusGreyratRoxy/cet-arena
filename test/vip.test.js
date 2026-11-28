'use strict';

/**
 * 激活码测试（设备 Token 绑定）：
 * - unlimited 码不限次、不绑任何设备；
 * - 普通码一码一用、绑定 device_token，同设备可复用（换网络也放行）；
 * - **换设备一律拒绝**，哪怕两台机器在同一个公网 IP 后面（校园网 NAT 场景）；
 * - 验证通过后建房与加入都放行，未验证两者都拦截。
 */

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const { createVipStore, normalizeDeviceToken, hashDevice } = require('../src/vipCodes');
const { createArenaServer } = require('../src/app');
const { createDailyLimitStore } = require('../src/dailyLimits');
const { APP_VERSION } = require('../src/version');

const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-vip-'));
const seedPath = path.join(dir, 'vip_codes.json');
const statePath = path.join(dir, 'vip_codes.state.json');
const customPath = path.join(dir, 'vip_codes.custom.json');

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

function connect(url, ip, deviceToken) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      forceNew: true,
      reconnection: false,
      auth: { clientVersion: APP_VERSION, ...(deviceToken ? { deviceToken } : {}) },
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
    ok('绑定主体是设备 Token（哈希存储）', record.boundDevice === hashDevice(DEVICE_A));
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
    const migratedState = JSON.parse(fs.readFileSync(statePath, 'utf8')).VIP666;
    ok('迁移后已落库设备 Token 哈希', migratedState.boundDevice === hashDevice(DEVICE_A));
    ok('迁移后同时写入前 8 位前缀', migratedState.boundDevicePrefix === DEVICE_A.slice(0, 8));

    console.log('=== 8.1 兼容老明文 boundDevice（方案 A 核心保障）===');
    resetState();
    fs.writeFileSync(
      statePath,
      JSON.stringify({ VIP666: { status: 'used', boundDevice: DEVICE_A, boundIp: '10.4.0.1' } })
    );
    const s6b = newStore();
    const legacySame = s6b.verify('VIP666', '10.4.1.1', DEVICE_A);
    ok('老明文记录：同设备仍可验证通过', legacySame.ok === true && legacySame.reused === true);
    ok('老明文记录：换设备仍被拒', s6b.verify('VIP666', '10.4.1.2', DEVICE_B).code === 'BOUND');
    ok(
      '老明文记录：statusByDevice 也能认出来',
      s6b.statusByDevice(DEVICE_A, '').vip === true
    );

    console.log('=== 9. Token 规范化 ===');
    ok('正常 Token 保留', normalizeDeviceToken('  ' + DEVICE_A + '  ') === DEVICE_A);
    ok('空值归一为空串', normalizeDeviceToken(null) === '' && normalizeDeviceToken(undefined) === '');
    ok('超长 Token 归一为空串', normalizeDeviceToken('x'.repeat(129)) === '');

    console.log('=== 9.5 自定义卡密生成 ===');
    fs.rmSync(customPath, { force: true });
    const s7 = newStore();
    const madeCustom = s7.generateCustom('  boss_2026  ');
    ok('自定义码生成成功并归一化', madeCustom.ok === true && madeCustom.code === 'BOSS_2026');
    ok('写入 custom 文件（不进种子）', fs.existsSync(customPath));
    const seedAfter = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    ok('种子文件未被写入', seedAfter.codes.BOSS_2026 === undefined);
    ok('立即生效（无需重启）', s7.verify('BOSS_2026', '10.5.0.1', DEVICE_A).ok === true);
    ok(
      '重新实例化后仍在列表里',
      newStore().list().some((item) => item.code === 'BOSS_2026')
    );

    ok('重复自定义码被拒', s7.generateCustom('BOSS_2026').code === 'DUPLICATE');
    ok('小写重复同样被拒', s7.generateCustom('boss_2026').code === 'DUPLICATE');
    ok('与种子已有码冲突被拒', s7.generateCustom('VIP888').code === 'DUPLICATE');
    ok('含中文被拒', s7.generateCustom('中文CODE').code === 'BAD_FORMAT');
    ok('含连字符被拒', s7.generateCustom('BOSS-2026').code === 'BAD_FORMAT');
    ok('过短被拒', s7.generateCustom('AB12').code === 'TOO_SHORT');
    ok('过长被拒', s7.generateCustom('A'.repeat(17)).code === 'TOO_LONG');
    ok('非字符串被拒', s7.generateCustom(null).code === 'BAD_FORMAT');

    // 状态文件里有绑定记录的码（种子已删）不允许复用
    fs.writeFileSync(statePath, JSON.stringify({ GHOST01: { status: 'used', boundDevice: DEVICE_A } }));
    const s8 = newStore();
    ok('有历史绑定记录的码被拒', s8.generateCustom('GHOST01').code === 'STATE_CONFLICT');

    console.log('=== 9.6 解绑后原设备失效（revoked 语义） ===');
    fs.rmSync(statePath, { force: true });
    const s9 = newStore();

    const silentOnNew = s9.verify('VIP666', '10.6.0.2', DEVICE_A, { silent: true });
    ok('silent 模式不会自动首次绑定', silentOnNew.ok === false && silentOnNew.code === 'SILENT_UNBOUND');
    const stateAfterSilent = fs.existsSync(statePath)
      ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
      : {};
    ok('silent 失败后没有写入绑定', !stateAfterSilent.VIP666);

    const firstBind = s9.verify('VIP888', '10.6.0.1', DEVICE_A);
    ok('首次绑定成功', firstBind.ok === true && firstBind.firstUse === true);

    const resetRes = s9.reset('VIP888');
    ok('解绑成功', resetRes.ok === true);
    const stateAfterReset = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    ok('状态改为 revoked', stateAfterReset.VIP888.status === 'revoked');
    ok('记录被撤销的设备（哈希）', stateAfterReset.VIP888.revokedDevices.includes(hashDevice(DEVICE_A)));
    ok('只返回设备给服务端踢线用', resetRes.previousDevice === hashDevice(DEVICE_A));
    ok('踢线用的前缀一并返回', resetRes.previousDevicePrefix === DEVICE_A.slice(0, 8));

    const oldAgain = s9.verify('VIP888', '10.6.0.3', DEVICE_A);
    ok('原设备再次验证被拒', oldAgain.ok === false && oldAgain.code === 'REVOKED');
    const oldSilent = s9.verify('VIP888', '10.6.0.3', DEVICE_A, { silent: true });
    ok('原设备静默重验也被拒', oldSilent.ok === false && oldSilent.code === 'REVOKED');

    // A' 核心：封禁期间「换一个 deviceToken」也同样被拒（清缓存/换浏览器无效）
    const anyDevice = s9.verify('VIP888', '10.6.0.4', DEVICE_B);
    ok('封禁期间新设备（换 token）也被拒', anyDevice.ok === false && anyDevice.code === 'REVOKED');
    const brandNew = s9.verify('VIP888', '10.6.0.5', 'f'.repeat(32));
    ok('全新 token 同样被拒', brandNew.ok === false && brandNew.code === 'REVOKED');
    ok('封禁后没有绑定任何设备', JSON.parse(fs.readFileSync(statePath, 'utf8')).VIP888.boundDevice === null);

    // 站长点「允许换机」后：新设备可绑，原设备仍死锁
    const allow = s9.allowRebind('VIP888');
    ok('允许换机成功', allow.ok === true);
    const stAllow = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    ok('状态回到 available', stAllow.VIP888.status === 'available');
    ok('原设备仍在黑名单', stAllow.VIP888.revokedDevices.includes(hashDevice(DEVICE_A)));
    ok('封禁设备数可查询', s9.describe('VIP888').revokedDeviceCount === 1);

    const rebind = s9.verify('VIP888', '10.6.0.6', DEVICE_B);
    ok('允许换机后新设备可激活', rebind.ok === true);
    ok('已绑定到新设备（哈希）', JSON.parse(fs.readFileSync(statePath, 'utf8')).VIP888.boundDevice === hashDevice(DEVICE_B));
    const oldStillBlocked = s9.verify('VIP888', '10.6.0.7', DEVICE_A);
    ok('换机后原设备仍被拒（永久拉黑）', oldStillBlocked.ok === false && oldStillBlocked.code === 'REVOKED');
    ok('重复允许换机会被拒', s9.allowRebind('VIP888').code === 'NOT_REVOKED');

    ok('statusByDevice 对新设备返回 VIP', s9.statusByDevice(DEVICE_B).vip === true);
    ok('statusByDevice 对原设备返回非 VIP', s9.statusByDevice(DEVICE_A).vip === false);
    ok('statusByDevice 对专属码返回 VIP', s9.statusByDevice('', 'TESTSECRET1').vip === true);

    // 彻底删除
    const customCode = s9.generateCustom('DELME01');
    ok('自定义码生成成功', customCode.ok === true);
    s9.verify('DELME01', '10.6.0.8', DEVICE_A);
    const removed = s9.removeCode('DELME01');
    ok('彻底删除成功', removed.ok === true);
    ok('删除后无法再验证', s9.verify('DELME01', '10.6.0.9', DEVICE_A).code === 'INVALID');
    ok('删除后从列表消失', !s9.list().some((item) => item.code === 'DELME01'));
    ok('删除后 custom 文件里也没有', !JSON.parse(fs.readFileSync(customPath, 'utf8')).codes.DELME01);
    ok('删除后 state 记录已清理', !JSON.parse(fs.readFileSync(statePath, 'utf8')).DELME01);
    ok('种子码不允许删除', s9.removeCode('VIP666').code === 'SEED_PROTECTED');

    console.log('=== 10. 建房 / 加入：非 VIP 每日免费额度 + VIP 不扣次数 ===');
    resetState();
    const dailyLimitPath = path.join(dir, 'daily_limits.json');
    const arena = createArenaServer({
      vipRequired: true,
      vipOptions: { seedPath, statePath },
      dailyLimitOptions: { file: dailyLimitPath },
    });
    await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = arena.httpServer.address();
    const url = `http://127.0.0.1:${port}`;

    const DEVICE_GUEST = '00112233445566778899aabbccddeeff';
    const guestKey = crypto.createHash('sha256').update(DEVICE_GUEST).digest('hex');
    const dailyStore = () => createDailyLimitStore({ file: dailyLimitPath });
    const keyOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

    // 完全没有设备标识：无法归属每日免费额度，直接拒绝
    const anon = await connect(url, '10.2.0.1');
    const anonCreate = await call(anon, 'room:create', { nickname: 'Guest' });
    ok(
      '非 VIP 且缺设备标识时被拒（DEVICE_REQUIRED）',
      anonCreate.ok === false && anonCreate.code === 'DEVICE_REQUIRED'
    );
    anon.close();

    // 非 VIP 第 1 次：放行并返回剩余次数
    const guest1 = await connect(url, '10.2.0.2', DEVICE_GUEST);
    const g1 = await call(guest1, 'room:create', { nickname: 'Guest' });
    ok(
      '非 VIP 首次建房放行（免费体验，剩余 1 次）',
      g1.ok === true && g1.isFreeAttempt === true && g1.freeRemaining === 1
    );
    guest1.close();

    // 进不去的房间不扣额度：房间码不存在
    const guestMiss = await connect(url, '10.2.0.2', DEVICE_GUEST);
    const gMiss = await call(guestMiss, 'room:join', { nickname: 'Guest', code: '123456' });
    ok('加入不存在的房间失败', gMiss.ok === false);
    ok('进不去房间时不消耗免费额度', dailyStore().getRemaining(guestKey) === 1);
    guestMiss.close();

    // 非 VIP 第 2 次：放行，剩余 0
    const guest2 = await connect(url, '10.2.0.3', DEVICE_GUEST);
    const g2 = await call(guest2, 'room:create', { nickname: 'Guest2' });
    ok('非 VIP 第 2 次建房放行（剩余 0 次）', g2.ok === true && g2.freeRemaining === 0);
    guest2.close();

    // 非 VIP 第 3 次：拒绝
    const guest3 = await connect(url, '10.2.0.4', DEVICE_GUEST);
    const g3 = await call(guest3, 'room:create', { nickname: 'Guest3' });
    ok('非 VIP 第 3 次建房被拒（FREE_LIMIT_REACHED）', g3.ok === false && g3.code === 'FREE_LIMIT_REACHED');
    ok('被拒文案引导激活 VIP', /VIP/.test(g3.error || ''));
    ok('被拒后仍不包含房间信息', !g3.room);
    guest3.close();

    // VIP：正常建房，且完全不消耗每日免费额度
    const host = await connect(url, '10.2.0.5', DEVICE_A);
    const noToken = await call(host, 'vip:verify', { code: 'VIP888' });
    ok('socket 不带 deviceToken 被拒', noToken.ok === false && noToken.code === 'DEVICE_REQUIRED');

    const hv = await call(host, 'vip:verify', { code: 'VIP888', deviceToken: DEVICE_A });
    ok('普通码验证通过', hv.ok === true && hv.kind === 'once');
    const created = await call(host, 'room:create', { nickname: '房主' });
    ok('验证后可建房', created.ok === true && /^\d{6}$/.test(created.room.code));
    ok('VIP 建房不返回免费体验标记', created.isFreeAttempt === undefined);
    ok('VIP 建房不消耗免费额度', dailyStore().getRemaining(keyOf(DEVICE_A)) === 2);

    // 同一公网 IP 下的另一台设备（同一校园网），拿同一个码尝试
    const neighbor = await connect(url, '10.2.0.5', DEVICE_B);
    const stolen = await call(neighbor, 'vip:verify', { code: 'VIP888', deviceToken: DEVICE_B });
    ok('同 IP 的邻居设备无法复用该码', stolen.ok === false && stolen.code === 'BOUND');
    neighbor.close();

    const joiner = await connect(url, '10.2.0.6', DEVICE_B);
    const jv = await call(joiner, 'vip:verify', { code: 'VIP666', deviceToken: DEVICE_B });
    ok('第二名玩家用自己的码验证通过', jv.ok === true);
    const joined = await call(joiner, 'room:join', { nickname: '队友', code: created.room.code });
    ok('验证后可加入他人房间', joined.ok === true && joined.room.players.length === 2);

    // 房间已满时，免费玩家进不去，也不该扣额度
    const full = await connect(url, '10.2.0.7', DEVICE_C);
    const fullJoin = await call(full, 'room:join', { nickname: '白嫖', code: created.room.code });
    ok('房间已满时加入失败', fullJoin.ok === false);
    ok('进房失败不消耗免费额度', dailyStore().getRemaining(keyOf(DEVICE_C)) === 2);
    full.close();

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
