'use strict';

/**
 * 超长闯关（marathon）后端测试。
 *
 * 覆盖：
 * - 纯函数 applyAnswer：答对/答错推进、错词入池、队列答完切下一轮、全对通关、同词不重复入池
 * - normalizeProgress：词库/下标异常时的自愈
 * - 存储：落盘、跨实例（模拟重启）读回、getProgress 返回副本、reset 清空
 * - socket 协议：marathon:start / answer / reset 的字段与错误分支
 *
 * 注意：断言只看结构与计数，不打印词库内容；进度文件写在系统临时目录，不碰项目 data/。
 */

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');
const {
  applyAnswer,
  normalizeProgress,
  createMarathonStore,
} = require('../src/marathon');
const { createArenaServer } = require('../src/app');
const { APP_VERSION } = require('../src/version');

const DEVICE = 'marathon-device-0001';

// 专属码改为环境变量注入：本文件用它验证「激活后可以进超长闯关」。
process.env.VIP_UNLIMITED_CODES = 'TESTBOSS1';

let passed = 0;
function ok(label, condition, detail) {
  assert.ok(condition, detail === undefined ? label : `${label}（实际：${detail}）`);
  passed += 1;
  console.log('  ✓ ' + label);
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
      resolve(error ? { ok: false, error: 'timeout' } : response || { ok: false, error: 'empty' });
    });
  });
}

/** 确定性洗牌：反转。便于断言「新一轮队列来自错词池」。 */
const reverseShuffle = (list) => list.slice().reverse();

function testApplyAnswer() {
  console.log('=== 1. 轮次推进（纯函数） ===');
  const base = { round: 1, index: 0, queue: ['w1', 'w2', 'w3'], wrongPool: [], completed: false };

  const r1 = applyAnswer(base, 'w1', true);
  ok('答对推进到第 2 题', r1.index === 1 && r1.wrongPool.length === 0 && r1.completed === false);

  const r2 = applyAnswer(r1, 'w2', false);
  ok('答错同样推进到下一题', r2.index === 2);
  ok('答错的词进入错词池', r2.wrongPool.join(',') === 'w2');

  const r3 = applyAnswer(r2, 'w3', true, reverseShuffle);
  ok('答完最后一题自动切换下一轮', r3.round === 2 && r3.index === 0 && r3.roundChanged === true);
  ok('新一轮队列来自错词池', r3.queue.join(',') === 'w2');
  ok('切换轮次后错词池清空', r3.wrongPool.length === 0);
  ok('切换轮次后未通关', r3.completed === false);

  console.log('=== 2. 全对通关 ===');
  const start = { round: 1, index: 0, queue: ['a', 'b'], wrongPool: [], completed: false };
  const s1 = applyAnswer(start, 'a', true);
  const s2 = applyAnswer(s1, 'b', true);
  ok('全部答对后标记通关', s2.completed === true);
  ok('通关时轮次不再增加', s2.round === 1);
  ok('通关时下标停在队尾', s2.index === 2);

  console.log('=== 3. 同一个词重复答错只入池一次 ===');
  const dup = { round: 1, index: 0, queue: ['x', 'y'], wrongPool: ['x'], completed: false };
  const d1 = applyAnswer(dup, 'x', false);
  ok('同一词不重复进入错词池', d1.wrongPool.filter((id) => id === 'x').length === 1);
}

function testNormalizeProgress() {
  console.log('=== 4. 载入自愈 ===');
  const droppedUnknown = normalizeProgress({
    round: 1,
    index: 0,
    queue: ['a', 'a', 'b'],
    wrongPool: ['c', 'c'],
    completed: false,
  });
  ok('队列去重', droppedUnknown.queue.length === 2);
  ok('错词池去重', droppedUnknown.wrongPool.length === 1);

  const overflowWithWrong = normalizeProgress({
    round: 1,
    index: 5,
    queue: ['a', 'b'],
    wrongPool: ['b'],
    completed: false,
  });
  ok('下标越界且有错词 → 自动进入下一轮', overflowWithWrong.round === 2 && overflowWithWrong.index === 0);

  const overflowNoWrong = normalizeProgress({
    round: 1,
    index: 5,
    queue: ['a', 'b'],
    wrongPool: [],
    completed: false,
  });
  ok('下标越界且无错词 → 标记通关', overflowNoWrong.completed === true);
}

function testStore(dir) {
  console.log('=== 5. 进度持久化 ===');
  const file = path.join(dir, 'marathon_progress.json');
  const store = createMarathonStore({ file });

  ok('初始没有进度', store.getProgress('hash-a') === null);

  store.saveProgress('hash-a', {
    round: 2,
    index: 3,
    queue: ['w1', 'w2', 'w3', 'w4', 'w5'],
    wrongPool: ['w9'],
    completed: false,
  });
  const loaded = store.getProgress('hash-a');
  ok('保存后可读回', loaded.round === 2 && loaded.index === 3 && loaded.queue.length === 5);
  ok('进度已落盘', fs.existsSync(file));

  const reopened = createMarathonStore({ file });
  ok('新实例（模拟重启）仍能读到进度', reopened.getProgress('hash-a').index === 3);

  const copy = store.getProgress('hash-a');
  copy.queue.push('w100');
  ok('getProgress 返回副本，外部修改不污染存储', store.getProgress('hash-a').queue.length === 5);

  ok('不同设备互不影响', store.getProgress('hash-b') === null);

  const removed = store.reset('hash-a');
  ok('reset 清空该设备进度', removed.ok === true && removed.removed === true);
  ok('清空后读不到进度', store.getProgress('hash-a') === null);
  ok('reset 不存在的记录也不报错', store.reset('hash-a').removed === false);
  ok('汇总里没有残留设备', store.stats().devices === 0);

  const reopenedAfterReset = createMarathonStore({ file });
  ok('清空状态同样已落盘', reopenedAfterReset.getProgress('hash-a') === null);
}

async function testSocket(dir) {
  console.log('=== 6. Socket 协议 ===');
  const vipDir = path.join(dir, 'vip');
  fs.mkdirSync(vipDir, { recursive: true });
  fs.writeFileSync(path.join(vipDir, 'vip_codes.json'), JSON.stringify({ version: 1, codes: {} }));

  const arena = createArenaServer({
    vipRequired: false,
    vipOptions: {
      seedPath: path.join(vipDir, 'vip_codes.json'),
      statePath: path.join(vipDir, 'state.json'),
    },
    messageOptions: { file: path.join(dir, 'messages.json'), minIntervalMs: 0 },
    marathonOptions: { file: path.join(dir, 'progress.json') },
  });
  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${arena.httpServer.address().port}`;
  const socket = await connect(base);

  const started = await call(socket, 'marathon:start', { deviceToken: DEVICE });
  ok('开始返回第一轮第一题', started.ok === true && started.round === 1 && started.index === 0);
  ok('首轮队列覆盖全量词库', started.total === 2868, String(started.total));
  ok('题目有 4 个选项', started.question && started.question.options.length === 4);
  ok('题目不下发正确答案', started.question && !('correctIndex' in started.question));
  ok('初始错词池为 0', started.wrongPoolSize === 0);

  const firstIndex = started.question.options.length - 1;
  const answered = await call(socket, 'marathon:answer', { index: firstIndex });
  ok('作答返回判分结果', answered.ok === true && typeof answered.correct === 'boolean');
  ok('作答后才下发正确答案', Number.isInteger(answered.correctIndex));
  ok('判分与 correctIndex 一致', answered.correct === (firstIndex === answered.correctIndex));
  ok('进度推进到第 2 题', answered.index === 1 && answered.remaining === started.total - 1);
  ok(
    '答错时错词池 +1、答对时保持 0',
    answered.wrongPoolSize === (answered.correct ? 0 : 1),
    'wrongPoolSize=' + answered.wrongPoolSize
  );
  ok('返回下一题（未通关）', answered.completed === false && answered.question !== null);

  const badIndex = await call(socket, 'marathon:answer', { index: 999 });
  ok('非法选项被拒', badIndex.ok === false);

  const reset = await call(socket, 'marathon:reset', { deviceToken: DEVICE });
  ok('重置成功', reset.ok === true && reset.removed === true);

  const restarted = await call(socket, 'marathon:start', { deviceToken: DEVICE });
  ok('重置后从第 1 轮第 1 题重新开始', restarted.round === 1 && restarted.index === 0);
  ok('重置后错词池为空', restarted.wrongPoolSize === 0);

  const noToken = await call(socket, 'marathon:start', {});
  ok('缺少 deviceToken 被拒', noToken.ok === false && noToken.code === 'DEVICE_REQUIRED');

  const other = await connect(base);
  const notStarted = await call(other, 'marathon:answer', { index: 0 });
  ok('未开始就答题被拒', notStarted.ok === false);
  other.close();

  socket.close();
  await arena.close();
  ok('重置写盘后进度文件里没有该设备', createMarathonStore({ file: path.join(dir, 'progress.json') }).getProgress('hash-x') === null);
}

/**
 * socket 层轮次切换：用 4 词小池 + 预设「单题队列」，答完这一题必然触发
 * 「进入下一轮」或「通关」两条分支之一，两条都做确定性断言。
 */
async function testRoundSwitchOverSocket(dir) {
  console.log('=== 7. Socket 层轮次切换（单题队列） ===');
  const hash = crypto.createHash('sha256').update(DEVICE).digest('hex');
  const progressFile = path.join(dir, 'progress-round.json');
  const stamp = new Date().toISOString();
  fs.writeFileSync(
    progressFile,
    JSON.stringify({
      version: 1,
      devices: {
        [hash]: {
          round: 1,
          index: 0,
          queue: ['mwa'],
          wrongPool: [],
          completed: false,
          startedAt: stamp,
          updatedAt: stamp,
        },
      },
    })
  );

  const suffix = ['a', 'b', 'c', 'd'];
  const cn = ['甲', '乙', '丙', '丁'];
  const words = suffix.map((s, i) => ({
    id: 'mw' + s,
    level: 'CET4',
    word: 'marathonword' + s,
    meanings: [
      { pos: 'n.', meaning: '测试释义' + cn[i], frequencyRank: 1 },
      { pos: 'v.', meaning: '备用释义' + cn[i], frequencyRank: 2 },
    ],
  }));

  const vipDir = path.join(dir, 'vip2');
  fs.mkdirSync(vipDir, { recursive: true });
  fs.writeFileSync(path.join(vipDir, 'vip_codes.json'), JSON.stringify({ version: 1, codes: {} }));

  const arena = createArenaServer({
    words,
    // 本用例只测 marathon，注入的 4 词小池与 data/levels.json 的关卡 id 不匹配，
    // 因此给一个空关卡桩，避免撞上关卡校验（不调用任何 trial:* 事件）。
    levels: {
      listLevels: () => [],
      findLevel: () => {
        throw new Error('no levels');
      },
      trialPoolFor: () => [],
      timeLimitFor: () => 0,
    },
    vipRequired: false,
    vipOptions: {
      seedPath: path.join(vipDir, 'vip_codes.json'),
      statePath: path.join(vipDir, 'state.json'),
    },
    messageOptions: { file: path.join(dir, 'messages2.json'), minIntervalMs: 0 },
    marathonOptions: { file: progressFile },
  });
  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${arena.httpServer.address().port}`;
  const socket = await connect(base);

  const started = await call(socket, 'marathon:start', { deviceToken: DEVICE });
  ok('从预设进度恢复（队列只剩 1 题）', started.total === 1 && started.index === 0);
  ok('恢复出来的题目就是队列里的那个词', started.question && started.question.id === 'mwa');

  const answered = await call(socket, 'marathon:answer', { index: 0 });
  ok('单题队列答完必然触发「切轮」或「通关」', answered.completed === true || answered.roundChanged === true);
  if (answered.completed) {
    ok('全对分支：标记通关且剩余 0', answered.round === 1 && answered.remaining === 0);
    ok('全对分支：不再下发题目', answered.question === null);
  } else {
    ok('有错词分支：进入第 2 轮', answered.round === 2 && answered.index === 0);
    ok('有错词分支：新一轮题目仍是该错词', answered.question && answered.question.id === 'mwa');
    ok('有错词分支：错词池已清空', answered.wrongPoolSize === 0);
  }

  socket.close();
  await arena.close();
}

/**
 * VIP 闸门：vipRequired 开启时，未激活连接必须被拒绝，且**不产生进度**；
 * 用环境变量注入的专属码激活后，同一连接可以正常开始。
 */
async function testVipGate(dir) {
  console.log('=== 8. VIP 闸门 ===');
  const vipDir = path.join(dir, 'vip-gate');
  fs.mkdirSync(vipDir, { recursive: true });
  fs.writeFileSync(path.join(vipDir, 'vip_codes.json'), JSON.stringify({ version: 1, codes: {} }));
  const progressFile = path.join(dir, 'progress-vip.json');

  const arena = createArenaServer({
    vipRequired: true,
    vipOptions: {
      seedPath: path.join(vipDir, 'vip_codes.json'),
      statePath: path.join(vipDir, 'state.json'),
    },
    messageOptions: { file: path.join(dir, 'messages-vip.json'), minIntervalMs: 0 },
    marathonOptions: { file: progressFile },
  });
  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${arena.httpServer.address().port}`;
  const socket = await connect(base);

  const denied = await call(socket, 'marathon:start', { deviceToken: DEVICE });
  ok('非 VIP 调用 marathon:start 被拒', denied.ok === false && denied.code === 'VIP_REQUIRED');
  ok('被拒时提示为 VIP 专属', String(denied.error || '').includes('VIP 专属'));
  ok('被拒时不返回题目', !denied.question);
  ok('被拒时未落盘进度文件', fs.existsSync(progressFile) === false);
  ok(
    '被拒时也没有内存/落盘进度',
    createMarathonStore({ file: progressFile }).getProgress(
      crypto.createHash('sha256').update(DEVICE).digest('hex')
    ) === null
  );

  const activated = await call(socket, 'vip:verify', { code: 'TESTBOSS1', deviceToken: DEVICE });
  ok('专属码激活成功', activated.ok === true, JSON.stringify(activated));

  const started = await call(socket, 'marathon:start', { deviceToken: DEVICE });
  ok('激活后可以开始超长闯关', started.ok === true && started.round === 1);
  ok('激活后正常下发题目', started.question && started.question.options.length === 4);
  ok('激活后进度已落盘', fs.existsSync(progressFile) === true);

  socket.close();
  await arena.close();
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-marathon-'));
  try {
    testApplyAnswer();
    testNormalizeProgress();
    testStore(dir);
    await testSocket(dir);
    await testRoundSwitchOverSocket(dir);
    await testVipGate(dir);
    console.log('');
    console.log(`超长闯关测试全部通过（${passed} 项断言）。`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
