'use strict';

/**
 * 站长后台测试：
 * - 页面可访问，但所有管理接口未登录一律 401；
 * - 密码错误拒绝、连续错误锁定；
 * - 登录后能列卡密、生成新码（写盘 + 无需重启即可验证）、解绑后可在新 IP 重新激活。
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { createVipStore } = require('../src/vipCodes');
const { createArenaServer } = require('../src/app');

const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-admin-'));
const seedPath = path.join(dir, 'vip_codes.json');
const statePath = path.join(dir, 'vip_codes.state.json');
const customPath = path.join(dir, 'vip_codes.custom.json');

fs.writeFileSync(
  seedPath,
  JSON.stringify({
    version: 1,
    codes: {
      TESTSECRET1: { type: 'unlimited', label: '站长' },
      VIP888: { type: 'once', label: '单人码' },
      VIP666: { type: 'once', label: '单人码' },
    },
  })
);

let passed = 0;
const ok = (label, condition) => {
  assert(condition, label);
  passed += 1;
  console.log('  ✓ ' + label);
};

// 模拟两台不同设备的 device_token（32 位十六进制）
const DEVICE_X = 'cafebabecafebabecafebabecafebabe';
const DEVICE_Y = '0123456789abcdef0123456789abcdef';

function readSeed() {
  return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
}

function readCustom() {
  try {
    return JSON.parse(fs.readFileSync(customPath, 'utf8'));
  } catch (error) {
    return { version: 1, codes: {} };
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    return {};
  }
}

async function main() {
  const arena = createArenaServer({ vipRequired: true, vipOptions: { seedPath, statePath } });
  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = arena.httpServer.address();
  const base = `http://127.0.0.1:${port}`;

  let cookie = '';

  async function http(method, route, options = {}) {
    const headers = { 'x-forwarded-for': options.ip || '203.0.113.9' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const jar = options.cookie === undefined ? cookie : options.cookie;
    if (jar) headers.Cookie = jar;
    const response = await fetch(base + route, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = null;
    }
    const setCookie = response.headers.get('set-cookie') || '';
    if (setCookie) {
      cookie = setCookie.split(';')[0];
    }
    return { status: response.status, data, text, setCookie, headers: response.headers };
  }

  try {
    console.log('=== 1. 页面与未登录拦截 ===');
    const page = await http('GET', '/admin');
    ok('GET /admin 返回 200', page.status === 200);
    ok('页面包含后目标题', page.text.includes('站长后台'));
    // 回归：自定义生成 UI 必须在 DOM 里（曾出现站长手机看不到输入框的反馈）
    ok('页面含自定义卡密输入框', page.text.includes('id="customCodeInput"'));
    ok('页面含自定义生成按钮', page.text.includes('id="customGenBtn"'));
    ok('说明文案指向 vip_codes.custom.json', page.text.includes('vip_codes.custom.json'));
    ok('后台静态资源带版本号', /admin\.(js|css)\?v=/.test(page.text));
    ok('后台页面禁止缓存', /no-store/.test(page.headers.get('cache-control') || ''));

    const guestState = await http('GET', '/api/admin/state');
    ok('未登录读卡密被拒 401', guestState.status === 401 && guestState.data.code === 'UNAUTHORIZED');

    const guestSession = await http('GET', '/api/admin/session');
    ok('登录态探测返回 200 且 authed=false', guestSession.status === 200 && guestSession.data.authed === false);

    const guestReset = await http('POST', '/api/admin/codes/reset', { body: { code: 'VIP888' } });
    ok('未登录解绑被拒 401', guestReset.status === 401);

    const guestGen = await http('POST', '/api/admin/codes/generate', { body: { count: 3 } });
    ok('未登录生成被拒 401', guestGen.status === 401);
    ok('未登录时没有写入任何新卡密', Object.keys(readSeed().codes).length === 3);

    console.log('=== 2. 登录鉴权 ===');
    const bad = await http('POST', '/api/admin/login', { body: { password: 'wrong' }, cookie: '' });
    ok('错误密码被拒 401', bad.status === 401 && bad.data.code === 'BAD_PASSWORD');
    ok('错误密码不下发 Cookie', (bad.setCookie || '') === '');

    const login = await http('POST', '/api/admin/login', {
      body: { password: 'boss2026' },
      cookie: '',
    });
    ok('正确密码登录成功', login.status === 200 && login.data.ok === true);
    ok('登录下发 HttpOnly Cookie', /cet_admin=.+HttpOnly/i.test(login.setCookie));
    ok('Cookie 带 SameSite=Strict', /SameSite=Strict/i.test(login.setCookie));

    console.log('=== 3. 卡密列表 ===');
    const sessionAfter = await http('GET', '/api/admin/session');
    ok('登录后探测 authed=true', sessionAfter.status === 200 && sessionAfter.data.authed === true);

    const stateRes = await http('GET', '/api/admin/state');
    ok('登录后可读卡密', stateRes.status === 200 && stateRes.data.codes.length === 3);
    ok('列表含绑定 IP 字段', 'boundIp' in stateRes.data.codes[0]);
    ok('列表含绑定时间字段', 'usedAt' in stateRes.data.codes[0]);
    ok('统计：总数 3', stateRes.data.stats.total === 3);
    ok('统计：管理员 1', stateRes.data.stats.unlimited === 1);
    ok('返回在线人数与房间数', typeof stateRes.data.live.players === 'number' && typeof stateRes.data.live.rooms === 'number');

    console.log('=== 4. 一键生成 ===');
    const gen = await http('POST', '/api/admin/codes/generate', { body: { count: 5 } });
    ok('生成 5 张成功', gen.status === 200 && gen.data.created.length === 5);
    ok('卡密为 6 位大写字母/数字', gen.data.created.every((code) => /^[A-Z0-9]{6}$/.test(code)));
    ok('新卡密互不重复', new Set(gen.data.created).size === 5);
    ok('已写入 vip_codes.custom.json（运行时新增）', gen.data.created.every((code) => Boolean(readCustom().codes[code])));
    ok('种子文件未被改动', !Object.keys(readSeed().codes).some((code) => gen.data.created.includes(code)));
    ok('新卡密类型为普通码', gen.data.created.every((code) => readCustom().codes[code].type === 'once'));
    ok('生成后总数变为 8', gen.data.stats.total === 8);

    const fresh = gen.data.created[0];
    const freshVerify = arena.vip.verify(fresh, '198.51.100.7', DEVICE_X);
    ok('新卡密无需重启即可验证通过', freshVerify.ok === true && freshVerify.firstUse === true);

    const reloaded = createVipStore({ seedPath, statePath });
    ok('重启后新卡密仍在（已持久化）', reloaded.verify(gen.data.created[1], '198.51.100.8', DEVICE_Y).ok === true);

    const tooMany = await http('POST', '/api/admin/codes/generate', { body: { count: 101 } });
    ok('超过 100 张被拒', tooMany.status === 400 && tooMany.data.code === 'TOO_MANY');
    const zero = await http('POST', '/api/admin/codes/generate', { body: { count: 0 } });
    ok('数量 0 被拒', zero.status === 400 && zero.data.code === 'BAD_COUNT');

    console.log('=== 4.5 自定义卡密 ===');
    const custom = await http('POST', '/api/admin/codes/generate-custom', { body: { code: 'cet_boss_01' } });
    ok('自定义生成成功', custom.status === 200 && custom.data.ok === true);
    ok('自动归一化为大写', custom.data.code === 'CET_BOSS_01');
    ok('写入 custom 文件且类型为 once', readCustom().codes.CET_BOSS_01.type === 'once');
    ok('种子文件仍未被改动', readSeed().codes.CET_BOSS_01 === undefined);
    ok('生成后立即出现在列表中', custom.data.codes.some((item) => item.code === 'CET_BOSS_01'));
    ok('总数加 1', custom.data.stats.total === 9);

    const dupSame = await http('POST', '/api/admin/codes/generate-custom', { body: { code: 'CET_BOSS_01' } });
    ok('重复自定义码被拒', dupSame.status === 400 && dupSame.data.code === 'DUPLICATE');
    const dupLower = await http('POST', '/api/admin/codes/generate-custom', { body: { code: 'cet_boss_01' } });
    ok('大小写不同仍判重复', dupLower.status === 400 && dupLower.data.code === 'DUPLICATE');
    const dupSeed = await http('POST', '/api/admin/codes/generate-custom', { body: { code: 'VIP888' } });
    ok('与种子里已有码冲突被拒', dupSeed.status === 400 && dupSeed.data.code === 'DUPLICATE');

    const badChar = await http('POST', '/api/admin/codes/generate-custom', { body: { code: '中文CODE' } });
    ok('非法字符被拒', badChar.status === 400 && badChar.data.code === 'BAD_FORMAT');
    const tooShort = await http('POST', '/api/admin/codes/generate-custom', { body: { code: 'ABC' } });
    ok('过短被拒', tooShort.status === 400 && tooShort.data.code === 'TOO_SHORT');
    const tooLong = await http('POST', '/api/admin/codes/generate-custom', { body: { code: 'A'.repeat(17) } });
    ok('过长被拒', tooLong.status === 400 && tooLong.data.code === 'TOO_LONG');

    const customNoAuth = await http('POST', '/api/admin/codes/generate-custom', {
      body: { code: 'NOAUTH01' },
      cookie: '',
    });
    ok('未登录自定义生成 401', customNoAuth.status === 401);
    ok('未登录不会写入 custom 文件', readCustom().codes.NOAUTH01 === undefined);

    const reloadedCustom = createVipStore({ seedPath, statePath });
    ok(
      '重启后自定义码仍可验证',
      reloadedCustom.verify('CET_BOSS_01', '198.51.100.9', DEVICE_X).ok === true
    );

    console.log('=== 5. 解绑 / 重置 ===');
    arena.vip.verify('VIP888', '10.9.9.1', DEVICE_X);
    ok('VIP888 已绑定设备与 IP', readState().VIP888.boundDevice === DEVICE_X && readState().VIP888.boundIp === '10.9.9.1');

    const beforeReset = await http('GET', '/api/admin/state');
    const boundItem = beforeReset.data.codes.find((item) => item.code === 'VIP888');
    ok('列表中显示已绑定状态', boundItem.status === 'used' && boundItem.boundIp === '10.9.9.1');
    ok('列表显示设备 Token 前 8 位', boundItem.boundDevicePrefix === DEVICE_X.slice(0, 8));
    ok('列表不泄露完整设备 Token', !JSON.stringify(beforeReset.data).includes(DEVICE_X));

    const reset = await http('POST', '/api/admin/codes/reset', { body: { code: 'VIP888' } });
    ok('解绑成功', reset.status === 200 && reset.data.ok === true);
    ok('解绑后状态回到 available', reset.data.code.status === 'available');
    ok('解绑后设备 Token 已清空', reset.data.code.boundDevicePrefix === null);
    ok('解绑后 IP 已清空', reset.data.code.boundIp === null);
    ok('state 文件已清除该卡密', !readState().VIP888);
    ok('统计已绑定数减少', reset.data.stats.used === 1); // fresh 仍在

    const afterReset = arena.vip.verify('VIP888', '10.9.9.2', DEVICE_Y);
    ok('解绑后可在新设备重新激活', afterReset.ok === true && afterReset.firstUse === true);
    ok('重新激活后绑定到新设备', readState().VIP888.boundDevice === DEVICE_Y);

    const badReset = await http('POST', '/api/admin/codes/reset', { body: { code: 'NOSUCH' } });
    ok('解绑不存在的卡密被拒', badReset.status === 400 && badReset.data.code === 'INVALID');

    const notBound = await http('POST', '/api/admin/codes/reset', { body: { code: 'VIP666' } });
    ok('解绑未使用的卡密被拒', notBound.status === 400 && notBound.data.code === 'NOT_BOUND');

    const adminReset = await http('POST', '/api/admin/codes/reset', { body: { code: 'TESTSECRET1' } });
    ok('站长码不允许解绑', adminReset.status === 400 && adminReset.data.code === 'UNLIMITED');

    console.log('=== 6. 退出与防爆破 ===');
    const out = await http('POST', '/api/admin/logout', { body: {} });
    ok('退出成功', out.status === 200);
    const afterLogout = await http('GET', '/api/admin/state');
    ok('退出后接口失效 401', afterLogout.status === 401);

    let locked = null;
    for (let i = 0; i < 5; i += 1) {
      locked = await http('POST', '/api/admin/login', {
        body: { password: 'nope' },
        cookie: '',
        ip: '198.51.100.99',
      });
    }
    ok('连续 5 次错误后锁定 429', locked.status === 429 && locked.data.code === 'LOCKED');
    const lockedRight = await http('POST', '/api/admin/login', {
      body: { password: 'boss2026' },
      cookie: '',
      ip: '198.51.100.99',
    });
    ok('锁定期间正确密码也被拒', lockedRight.status === 429);

    console.log('');
    console.log(`站长后台测试全部通过（${passed} 项断言）。`);
  } finally {
    await arena.close();
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
