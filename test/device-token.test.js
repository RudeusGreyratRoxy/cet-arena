'use strict';

/**
 * 设备 Token 绑定行为的「明文基线」回归测试。
 *
 * 目的：锁住**当前**实现（`boundDevice` / `revokedDevices` 存 `sha256:<64hex>`，
 * 同时用 `boundDevicePrefix` 保留前 8 位供后台核对；比较走 `deviceMatches` 兼容
 * 老明文记录）。这样将来若再改存储格式，本套件会成批失败——这是有意的绊线。
 *
 * 覆盖：
 *   a) 首次绑定后 state 里 boundDevice 是 sha256:<64hex>、prefix 是原 token 前 8 位
 *   b) 同设备再次 verify 放行（不是 BOUND）
 *   c) 换设备 verify 被拒（BOUND）
 *   d) reset 封禁后原设备 REVOKED，且不影响其他卡密
 *   e) allowRebind 后新设备可绑定，旧设备以哈希进 revokedDevices
 *   f) 被拉黑设备再次 verify 仍 REVOKED
 *   g) reset 返回 previousDevice（哈希，供在线踢线）+ 审计用前缀，未绑定码不返回
 *
 * 全部使用假卡密与假 token，state/seed 都写在系统临时目录，绝不读写项目 data/。
 */

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVipStore, hashDevice, deviceMatches } = require('../src/vipCodes');

// 假卡密：三个 once 码，互不影响
const CODE_1 = 'TOKENCODE1';
const CODE_2 = 'TOKENCODE2';
const CODE_3 = 'TOKENCODE3'; // 始终不绑定，用于「未使用码」场景

// 假设备 Token（32 位十六进制，形状与前端 randomUUID 去横线后一致）
const DEVICE_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DEVICE_B = 'ffeeddccbbaa99887766554433221100';
const DEVICE_C = '0123456789abcdef0123456789abcdef';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-device-token-'));
const seedPath = path.join(dir, 'vip_codes.json');
const statePath = path.join(dir, 'vip_codes.state.json');

fs.writeFileSync(
  seedPath,
  JSON.stringify({
    version: 1,
    codes: {
      [CODE_1]: { type: 'once', label: '测试单人码 1' },
      [CODE_2]: { type: 'once', label: '测试单人码 2' },
      [CODE_3]: { type: 'once', label: '测试单人码 3' },
    },
  })
);

let passed = 0;
function ok(label, condition, detail) {
  assert.ok(condition, detail === undefined ? label : `${label}（实际：${detail}）`);
  passed += 1;
  console.log('  ✓ ' + label);
}

function readState() {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function tokenMask(token) {
  if (!token) return null;
  const s = String(token);
  return s.length <= 8 ? '****' : `${s.slice(0, 4)}****${s.slice(-4)}`;
}

function main() {
  const store = createVipStore({ seedPath, statePath });

  console.log('=== a) 首次绑定：boundDevice 存 sha256 哈希 + prefix ===');
  const first = store.verify(CODE_1, '203.0.113.10', DEVICE_A);
  ok('首次验证成功', first.ok === true, JSON.stringify(first));
  ok('返回 firstUse 标记', first.firstUse === true);
  const bound = readState()[CODE_1].boundDevice;
  ok('state 里 boundDevice 是 sha256:<64hex>', /^sha256:[0-9a-f]{64}$/.test(String(bound)), tokenMask(bound));
  ok('boundDevice 总长度为 71（sha256: + 64）', typeof bound === 'string' && bound.length === 71);
  ok('boundDevice 等于 hashDevice(原 token)', bound === hashDevice(DEVICE_A));
  ok('boundDevice 不等于原 token（已哈希）', bound !== DEVICE_A);
  ok(
    'boundDevicePrefix 等于原 token 前 8 位',
    readState()[CODE_1].boundDevicePrefix === DEVICE_A.slice(0, 8)
  );
  ok('旧明文 token 仍能被 deviceMatches 命中（兼容分支）', deviceMatches(bound, DEVICE_A) === true);
  ok('别的设备不会被误判命中', deviceMatches(bound, DEVICE_B) === false);

  console.log('=== b) 同设备再次 verify：放行，不判 BOUND ===');
  const again = store.verify(CODE_1, '198.51.100.7', DEVICE_A);
  ok('同设备换 IP 仍通过', again.ok === true, JSON.stringify(again));
  ok('标记为 reused', again.reused === true);
  ok('没有返回 BOUND', again.code !== 'BOUND');

  console.log('=== c) 不同设备 verify：BOUND ===');
  const other = store.verify(CODE_1, '198.51.100.7', DEVICE_B);
  ok('换设备被拒', other.ok === false && other.code === 'BOUND', JSON.stringify(other));
  ok('绑定关系未被换设备改写', readState()[CODE_1].boundDevice === hashDevice(DEVICE_A));

  console.log('=== d) reset 封禁：原设备 REVOKED，其他码不受影响 ===');
  // 先让第二张码正常绑定，用来验证「不受影响」
  const second = store.verify(CODE_2, '203.0.113.20', DEVICE_C);
  ok('第二张码正常绑定', second.ok === true);

  const reset = store.reset(CODE_1);
  ok('封禁成功', reset.ok === true, JSON.stringify(reset));
  ok('记录状态变为 revoked', readState()[CODE_1].status === 'revoked');
  ok('绑定设备被清空', readState()[CODE_1].boundDevice === null);

  const revokedHit = store.verify(CODE_1, '203.0.113.10', DEVICE_A);
  ok('被封禁码原设备返回 REVOKED', revokedHit.ok === false && revokedHit.code === 'REVOKED', JSON.stringify(revokedHit));

  const untouched = store.verify(CODE_2, '203.0.113.20', DEVICE_C);
  ok('其他码不受影响（仍可验证）', untouched.ok === true, JSON.stringify(untouched));

  console.log('=== e) allowRebind：新设备可绑定，旧设备进 revokedDevices ===');
  const rebind = store.allowRebind(CODE_1);
  ok('允许换机成功', rebind.ok === true, JSON.stringify(rebind));
  ok('状态回到 available', readState()[CODE_1].status === 'available');

  const afterRebind = readState()[CODE_1];
  ok(
    '旧设备已进入 revokedDevices（存哈希）',
    Array.isArray(afterRebind.revokedDevices) && afterRebind.revokedDevices.includes(hashDevice(DEVICE_A)),
    JSON.stringify((afterRebind.revokedDevices || []).map(tokenMask))
  );
  ok(
    '黑名单条目全部是 sha256: 前缀',
    (afterRebind.revokedDevices || []).every((v) => String(v).startsWith('sha256:'))
  );

  const newDevice = store.verify(CODE_1, '203.0.113.30', DEVICE_B);
  ok('新设备可以重新绑定', newDevice.ok === true, JSON.stringify(newDevice));
  ok('state 里绑定的是新设备哈希', readState()[CODE_1].boundDevice === hashDevice(DEVICE_B));

  console.log('=== f) revokedDevices 拦截：被拉黑设备仍 REVOKED ===');
  const blacklisted = store.verify(CODE_1, '203.0.113.10', DEVICE_A);
  ok('被拉黑设备返回 REVOKED', blacklisted.ok === false && blacklisted.code === 'REVOKED', JSON.stringify(blacklisted));
  ok('拦截来源是黑名单而非状态', readState()[CODE_1].status === 'used');

  console.log('=== g) reset 返回 previousDevice（踢线用） ===');
  const reset2 = store.reset(CODE_2);
  ok('reset 返回 previousDevice', reset2.previousDevice === hashDevice(DEVICE_C), tokenMask(reset2.previousDevice));
  ok('previousDevice 是哈希而非 null', reset2.previousDevice !== null && String(reset2.previousDevice).startsWith('sha256:'));
  ok('reset 同时返回用于审计的前缀', reset2.previousDevicePrefix === DEVICE_C.slice(0, 8));

  const unbound = store.reset(CODE_3);
  ok('未使用的码不能封禁', unbound.ok === false && unbound.code === 'NOT_BOUND', JSON.stringify(unbound));
  ok('未绑定码不返回 previousDevice', !unbound.previousDevice);

  console.log('');
  console.log(`设备 Token 哈希基线测试全部通过（${passed} 项断言）。`);
}

try {
  main();
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
