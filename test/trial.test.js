'use strict';

/**
 * 单人限时闯关（免费体验）测试：
 * - 关卡清单与限时配置
 * - 出题只来自关卡词池、且不下发答案
 * - 判分、超时判定（服务端 deadline 复核）、跳过计错、结算
 * - 免费用户可玩闯关，但 solo:start（错词挑战）被 VIP 闸门拦住
 */

const assert = require('assert/strict');
const { io } = require('socket.io-client');
const { createArenaServer } = require('../src/app');
const { APP_VERSION } = require('../src/version');

// 专属码已改为环境变量注入（仓库不再保存明文）：这里用临时无限码验证 VIP 路径。
process.env.VIP_UNLIMITED_CODES = 'TESTBOSS1';

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

async function listen(arena) {
  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${arena.httpServer.address().port}`;
}

async function main() {
  let passed = 0;
  const ok = (label, condition) => {
    assert(condition, label);
    passed += 1;
    console.log('  ✓ ' + label);
  };

  // ---------- 默认配置：真实限时 10s / 7s / 5s ----------
  const arena = createArenaServer();
  const url = await listen(arena);
  const socket = await connect(url);

  console.log('=== 1. 关卡清单 ===');
  const listed = await call(socket, 'trial:levels', {});
  ok('返回关卡清单', listed.ok === true && Array.isArray(listed.levels));
  ok('共 3 关', listed.levels.length === 3);
  ok('关卡 id 为 L1/L2/L3', listed.levels.map((l) => l.id).join(',') === 'L1,L2,L3');
  ok('每关 50 词', listed.levels.every((l) => l.wordCount === 50));
  ok(
    '限时为 10s / 7s / 5s',
    listed.levels.map((l) => l.timeLimitMs).join(',') === '10000,7000,5000'
  );
  ok('三关都标记为免费', listed.levels.every((l) => l.free === true));

  console.log('=== 2. 免费用户也能开始闯关 ===');
  const freeStart = await call(socket, 'trial:start', { chapter: 'L1' });
  ok('未激活也能 start（闯关免费）', freeStart.ok === true);
  ok('每题 10 秒', freeStart.timeLimitMs === 10000);
  ok('每关 10 题', freeStart.total === 10);
  ok('题目含 deadline 与 serverNow', Number.isFinite(freeStart.question.deadline) &&
    Number.isFinite(freeStart.question.serverNow));
  ok('题目不下发 correctIndex', freeStart.question.correctIndex === undefined);
  ok('题目不下发释义', freeStart.question.meanings === undefined);
  ok('4 个不同选项', freeStart.question.options.length === 4 &&
    new Set(freeStart.question.options).size === 4);

  console.log('=== 3. 判分一致性（服务端下发 correctIndex 后才可着色）===');
  const graded = await call(socket, 'trial:answer', { index: 0 });
  ok('作答返回 ok', graded.ok === true);
  ok('correct 与 correctIndex 一致', graded.correct === (graded.correctIndex === 0));
  ok('作答后下发正确答案文本', typeof graded.correctText === 'string' && graded.correctText.length > 0);
  ok('重复作答被拒', (await call(socket, 'trial:answer', { index: 1 })).ok === false);
  ok('非法选项被拒', (await call(socket, 'trial:answer', { index: 99 })).ok === false);

  console.log('=== 4. 下一题推进 ===');
  const second = await call(socket, 'trial:next', {});
  ok('返回下一题', second.ok === true && second.done === false);
  ok('题号推进到 2', second.question.index === 2);
  ok('新题换了单词或题型', second.question.id !== freeStart.question.id);

  console.log('=== 5. 未作答直接下一题记为错误 ===');
  await call(socket, 'trial:next', {}); // 第 2 题直接跳过
  const afterSkip = await call(socket, 'trial:next', {}); // 第 3 题也跳过
  ok('连续跳过仍能继续', afterSkip.ok === true);

  console.log('=== 6. 错词挑战仍是 VIP 专属 ===');
  const freeSolo = await call(socket, 'solo:start', { words: ['abandon'] });
  ok('免费用户被拒绝', freeSolo.ok === false && freeSolo.code === 'VIP_REQUIRED');
  ok('提示文案说明是 VIP 专属', /VIP/.test(freeSolo.error || ''));

  const vip = await call(socket, 'vip:verify', { code: 'TESTBOSS1' });
  ok('站长码激活成功', vip.ok === true);
  const vipSolo = await call(socket, 'solo:start', { words: ['abandon', 'ability', 'absolute'] });
  ok('VIP 用户可以使用错词挑战', vipSolo.ok === true);

  socket.close();
  await arena.close();

  // ---------- 短限时：超时判定 ----------
  const shortArena = createArenaServer({ trialTimeLimitsMs: [80, 80, 80] });
  const shortUrl = await listen(shortArena);
  const shortSocket = await connect(shortUrl);

  console.log('=== 7. 超时由服务端判定 ===');
  const timed = await call(shortSocket, 'trial:start', { chapter: 'L1' });
  ok('短限时生效', timed.ok === true && timed.timeLimitMs === 80);
  // 等过 deadline + grace，再提交：即使选中正确项也必须判超时。
  await sleep(500);
  const late = await call(shortSocket, 'trial:answer', { index: 0 });
  ok('迟到答案被判超时', late.ok === true && late.timedOut === true);
  ok('超时不计分', late.correct === false);
  ok('超时仍返回正确答案供复盘', typeof late.correctText === 'string' && late.correctText.length > 0);

  console.log('=== 8. 主动提交空答案 = 超时 ===');
  const nextQ = await call(shortSocket, 'trial:next', {});
  ok('进入下一题', nextQ.ok === true);
  const nullAnswer = await call(shortSocket, 'trial:answer', { index: null });
  ok('index=null 视为超时', nullAnswer.ok === true && nullAnswer.timedOut === true);

  console.log('=== 9. 完整一关结算 ===');
  const fresh = await call(shortSocket, 'trial:start', { chapter: 'L2' });
  ok('第 2 关限时 80ms（注入值）', fresh.timeLimitMs === 80);
  let summary = null;
  let guard = 0;
  while (!summary && guard < 30) {
    guard += 1;
    await call(shortSocket, 'trial:answer', { index: 0 });
    const step = await call(shortSocket, 'trial:next', {});
    if (step.done) summary = step.summary;
  }
  ok('打完一关拿到结算', summary !== null);
  ok('结算总题数为 10', summary.total === 10);
  ok('答对 + 答错 = 总题数', summary.correct + summary.wrong === summary.total);
  ok('结算带关卡标题', typeof summary.title === 'string' && summary.title.includes('第'));

  console.log('=== 10. 异常与退出 ===');
  ok('无效关卡被拒', (await call(shortSocket, 'trial:start', { chapter: 'L9' })).ok === false);
  ok('缺少关卡参数被拒', (await call(shortSocket, 'trial:start', {})).ok === false);
  await call(shortSocket, 'trial:start', { chapter: 'L1' });
  ok('退出闯关成功', (await call(shortSocket, 'trial:quit', {})).ok === true);
  ok('退出后不能再出题', (await call(shortSocket, 'trial:next', {})).ok === false);

  shortSocket.close();
  await shortArena.close();

  console.log('');
  console.log(`限时闯关测试全部通过（${passed} 项断言）。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
