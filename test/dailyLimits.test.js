'use strict';

/**
 * 非 VIP 每日免费进场配额测试。
 *
 * 覆盖：
 * - 每天 2 次：首次剩余 1、第二次剩余 0、第三次被拒
 * - getRemaining 只查不扣
 * - 跨天重置（注入可控时钟，23:59 → 次日 00:01）
 * - 不同设备互不影响
 * - 落盘与跨实例（模拟重启）读回
 * - dayKey 使用本地时区（严禁 toISOString 的 UTC 偏移）
 *
 * 全部读写写在系统临时目录，不碰项目 data/。
 */

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createDailyLimitStore,
  dayKey,
  DAILY_QUOTA,
} = require('../src/dailyLimits');

const DEVICE_A = 'hash-device-aaaa';
const DEVICE_B = 'hash-device-bbbb';

let passed = 0;
function ok(label, condition, detail) {
  assert.ok(condition, detail === undefined ? label : `${label}（实际：${detail}）`);
  passed += 1;
  console.log('  ✓ ' + label);
}

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-daily-'));
  try {
    const file = path.join(dir, 'daily_limits.json');

    console.log('=== 1. 日期键使用本地时区 ===');
    ok('配额基础值为 2', DAILY_QUOTA === 2);
    ok('dayKey 输出 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(dayKey(new Date(2026, 10, 28, 10, 0))));
    ok('dayKey 取本地日期（深夜）', dayKey(new Date(2026, 10, 29, 0, 30)) === '2026-11-29');
    ok('dayKey 取本地日期（23:59）', dayKey(new Date(2026, 10, 28, 23, 59)) === '2026-11-28');
    // 东八区下 00:30 的 UTC 日期仍是前一天；若机器本身是 UTC 则跳过该对比。
    const sample = new Date(2026, 10, 29, 0, 30);
    if (sample.getTimezoneOffset() < 0) {
      ok(
        '本地日期与 UTC 日期在凌晨确实不同（证明没用 toISOString）',
        dayKey(sample) !== sample.toISOString().slice(0, 10)
      );
    }

    console.log('=== 2. 每天 2 次 ===');
    let clock = new Date(2026, 10, 28, 10, 0, 0);
    const store = createDailyLimitStore({ file, now: () => clock });

    ok('初始剩余 2 次', store.getRemaining(DEVICE_A) === 2);

    const first = store.checkAndConsume(DEVICE_A);
    ok('第 1 次消耗成功', first.allowed === true);
    ok('第 1 次后剩余 1 次', first.remaining === 1);
    ok('记录当天已用 1 次', first.used === 1 && first.day === '2026-11-28');

    const second = store.checkAndConsume(DEVICE_A);
    ok('第 2 次消耗成功', second.allowed === true);
    ok('第 2 次后剩余 0 次', second.remaining === 0);

    const third = store.checkAndConsume(DEVICE_A);
    ok('第 3 次被拒绝', third.allowed === false);
    ok('被拒时剩余 0 且给出 LIMIT', third.remaining === 0 && third.reason === 'LIMIT');
    ok('被拒不会把已用次数继续叠加', store.getRemaining(DEVICE_A) === 0);

    console.log('=== 3. 查询不消耗额度 ===');
    ok('连续查询两次仍为 0（已用完）', store.getRemaining(DEVICE_A) === 0 && store.getRemaining(DEVICE_A) === 0);
    const freshQueries = [store.getRemaining(DEVICE_B), store.getRemaining(DEVICE_B), store.getRemaining(DEVICE_B)];
    ok('新设备连续查询不影响额度', freshQueries.join(',') === '2,2,2');

    console.log('=== 4. 落盘与重启后读回 ===');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok('文件结构包含 version/devices', raw.version === 1 && typeof raw.devices === 'object');
    ok('记录里保存 day 与 used', raw.devices[DEVICE_A].day === '2026-11-28' && raw.devices[DEVICE_A].used === 2);
    const reopened = createDailyLimitStore({ file, now: () => clock });
    ok('新实例（模拟重启）读到同一额度', reopened.getRemaining(DEVICE_A) === 0);
    ok('新实例仍可正常扣减其他设备', reopened.checkAndConsume(DEVICE_B).allowed === true);

    console.log('=== 5. 不同设备互不影响 ===');
    const other = store.checkAndConsume(DEVICE_B);
    ok('设备 B 首次消耗成功', other.allowed === true && other.remaining === 1);
    ok('设备 A 仍为 0，不受 B 影响', store.getRemaining(DEVICE_A) === 0);

    console.log('=== 6. 跨天重置 ===');
    // 造一台新设备，在 23:59 用掉两次
    const lateClock = new Date(2026, 10, 28, 23, 59, 0);
    let time = lateClock;
    const crossing = createDailyLimitStore({ file: path.join(dir, 'cross.json'), now: () => time });
    const DEVICE_C = 'hash-device-cccc';
    crossing.checkAndConsume(DEVICE_C);
    crossing.checkAndConsume(DEVICE_C);
    ok('23:59 时额度已用尽', crossing.checkAndConsume(DEVICE_C).allowed === false);

    // 跨到次日 00:01
    time = new Date(2026, 10, 29, 0, 1, 0);
    ok('跨天后剩余恢复到 2', crossing.getRemaining(DEVICE_C) === 2);
    const afterMidnight = crossing.checkAndConsume(DEVICE_C);
    ok('跨天后可以重新消耗', afterMidnight.allowed === true && afterMidnight.remaining === 1);
    ok('跨天记录的 day 已更新为今天', afterMidnight.day === '2026-11-29');

    console.log('=== 7. 异常输入 ===');
    const empty = store.checkAndConsume('');
    ok('空 deviceHash 被拒', empty.allowed === false && empty.reason === 'DEVICE_REQUIRED');
    ok('空 deviceHash 剩余为 0', store.getRemaining('') === 0);

    console.log('');
    console.log(`每日免费配额测试全部通过（${passed} 项断言）。`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
