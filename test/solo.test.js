'use strict';

/**
 * 单人错词挑战服务端测试：只考指定词、判分正确、掌握后退出抽题池。
 * 客户端以「单词」为键提交错词本（与结算复盘字段保持一致）。
 */

const assert = require('assert/strict');
const { io } = require('socket.io-client');
const { createArenaServer } = require('../src/app');
const { loadWords } = require('../src/wordBank');
const { APP_VERSION } = require('../src/version');

const words = loadWords();
const byWord = new Map(words.map((entry) => [entry.word, entry]));

function primaryText(entry) {
  const primary = entry.meanings.find((item) => item.frequencyRank === 1);
  return `${primary.pos} ${primary.meaning}`;
}

function expectedCorrectText(entry, type) {
  return type === 'en2zh' ? primaryText(entry) : entry.word;
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
      if (error) resolve({ ok: false, error: 'timeout' });
      else resolve(response || { ok: false, error: 'empty' });
    });
  });
}

async function main() {
  const arena = createArenaServer();
  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = arena.httpServer.address();
  const url = `http://127.0.0.1:${port}`;
  const socket = await connect(url);
  let passed = 0;

  const ok = (label, condition) => {
    assert(condition, label);
    passed += 1;
    console.log('  ✓ ' + label);
  };

  console.log('=== 1. 启动校验 ===');
  const empty = await call(socket, 'solo:start', { words: [] });
  ok('空列表无法开始', empty.ok === false);

  const unknown = await call(socket, 'solo:start', { words: ['nope', 'nope2'] });
  ok('不存在的单词无法开始', unknown.ok === false);

  const sample = [words[0].word, words[1].word, words[2].word, words[3].word];
  const started = await call(socket, 'solo:start', { words: sample });
  ok('合法词表可以开始', started.ok === true);
  ok('total 等于传入词数', started.total === sample.length);

  console.log('=== 2. 出题只来自指定词 ===');
  const seen = new Set();
  for (let i = 0; i < 12; i += 1) {
    const next = await call(socket, 'solo:next', { words: sample });
    ok('第 ' + (i + 1) + ' 题返回成功', next.ok === true && !!next.question);
    ok('题目单词在指定词表内', sample.includes(next.question.word));
    ok(
      '题目包含 4 个不同选项',
      Array.isArray(next.question.options) &&
        next.question.options.length === 4 &&
        new Set(next.question.options).size === 4
    );
    ok('题目不下发正确答案', next.question.correctIndex === undefined);
    ok('题目不下发释义', next.question.meanings === undefined);
    seen.add(next.question.word);
    await call(socket, 'solo:answer', { index: 0 });
  }
  ok('12 题至少覆盖 2 个不同单词', seen.size >= 2);

  console.log('=== 3. 判分正确性 ===');
  let correctChecked = 0;
  let wrongChecked = 0;
  for (let i = 0; i < 20 && (correctChecked < 5 || wrongChecked < 3); i += 1) {
    const next = await call(socket, 'solo:next', { words: sample });
    if (!next.ok) continue;
    const entry = byWord.get(next.question.word);
    const expected = expectedCorrectText(entry, next.question.type);
    const correctIndex = next.question.options.indexOf(expected);
    assert.notEqual(correctIndex, -1, '正确答案必须出现在选项里');

    if (correctChecked < 5) {
      const answer = await call(socket, 'solo:answer', { index: correctIndex });
      ok('答对时 correct=true', answer.ok === true && answer.correct === true);
      ok('答对时返回 correctIndex（用于选项着色）', answer.correctIndex === correctIndex);
      ok('答对时返回正确选项文本', answer.correctText === expected);
      ok('答对时返回完整释义', Array.isArray(answer.meanings) && answer.meanings.length >= 2);
      ok('答对时回传单词（用于更新错词本）', answer.word === next.question.word);
      correctChecked += 1;
    } else {
      const wrongIndex = (correctIndex + 1) % 4;
      const answer = await call(socket, 'solo:answer', { index: wrongIndex });
      ok('答错时 correct=false', answer.ok === true && answer.correct === false);
      ok('答错时仍返回正确答案', answer.correctText === expected);
      wrongChecked += 1;
    }
  }

  console.log('=== 4. 已掌握的词退出抽题池 ===');
  const onlyOne = [words[5].word];
  const restarted = await call(socket, 'solo:start', { words: onlyOne });
  ok('可以用单个词重新开始', restarted.ok === true && restarted.total === 1);
  for (let i = 0; i < 4; i += 1) {
    const next = await call(socket, 'solo:next', { words: onlyOne });
    ok('只剩一个词时仍然出这个词', next.ok && next.question.word === onlyOne[0]);
    await call(socket, 'solo:answer', { index: 0 });
  }

  console.log('=== 5. 异常与退出 ===');
  const stray = await call(socket, 'solo:answer', { index: 1 });
  ok('没有待答题时答错不会崩溃', stray.ok === false);
  await call(socket, 'solo:next', { words: onlyOne });
  ok('越界选项被拒绝', (await call(socket, 'solo:answer', { index: 99 })).ok === false);
  ok('无效选项后仍可继续出题', (await call(socket, 'solo:next', { words: onlyOne })).ok);

  const quit = await call(socket, 'solo:quit', {});
  ok('退出挑战成功', quit.ok === true);
  const afterQuit = await call(socket, 'solo:next', { words: onlyOne });
  ok('退出后不能再出题', afterQuit.ok === false);

  socket.close();
  await arena.close();
  console.log('');
  console.log(`单人挑战测试全部通过（${passed} 项断言）。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
