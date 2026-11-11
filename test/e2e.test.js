'use strict';

const assert = require('assert/strict');
const { io } = require('socket.io-client');
const { createArenaServer } = require('../src/app');
const { loadWords, buildQuestions } = require('../src/wordBank');
const { APP_VERSION } = require('../src/version');

const words = loadWords();
const wordMap = new Map(words.map((entry) => [entry.word, entry]));

assert(words.length >= 1000, `CET-4 词库应包含至少 1000 个单词（当前 ${words.length} 个）`);
assert(words.every((entry) => entry.level === 'CET4'), '当前只保留 CET-4 词库');
assert.equal(
  new Set(words.map((entry) => entry.word)).size,
  words.length,
  '单词不能重复'
);

const quizDeck = buildQuestions(words, 10, 'CET4');
assert.equal(quizDeck.length, 10);
assert.equal(new Set(quizDeck.map((question) => question.word)).size, 10);
assert(quizDeck.every((question) => question.level === 'CET4'));
const quizEn2zh = quizDeck.filter((question) => question.type === 'en2zh').length;
const quizZh2en = quizDeck.filter((question) => question.type === 'zh2en').length;
const quizListen = quizDeck.filter((question) => question.type === 'listen').length;
assert.equal(quizEn2zh, 5, '10 题抢答应为 5 道英译中');
assert.equal(quizZh2en, 3, '10 题抢答应为 3 道中译英');
assert.equal(quizListen, 2, '10 题抢答应为 2 道听音选词');

const raceDeck = buildQuestions(words, 25, 'CET4');
assert.equal(raceDeck.length, 25);
assert.equal(new Set(raceDeck.map((question) => question.word)).size, 25, '竞速 25 题不能重复');
assert(raceDeck.every((question) => question.level === 'CET4'));
const raceEn2zh = raceDeck.filter((question) => question.type === 'en2zh').length;
const raceZh2en = raceDeck.filter((question) => question.type === 'zh2en').length;
const raceListen = raceDeck.filter((question) => question.type === 'listen').length;
assert([12, 13].includes(raceEn2zh), '25 题中英译中数量应为 12 或 13');
assert([7, 8].includes(raceZh2en), '25 题中中译英数量应为 7 或 8');
assert.equal(raceListen, 5, '25 题中听音选词数量应为 5');
assert.equal(raceEn2zh + raceZh2en + raceListen, 25);
assert(
  raceDeck.every((question) =>
    question.type === 'en2zh'
      ? question.options.every((option) => /^(?:v|vt|vi|aux|n|pron|num|adj|a|adv|ad|prep|conj|int|art|pl)\.\s/.test(option))
      : question.options.every((option) => /^[a-z]+$/.test(option))
  ),
  '三种题型的选项格式必须正确'
);
const raceDeckAgain = buildQuestions(words, 25, 'CET4');
assert.notEqual(
  raceDeck.map((question) => question.word).join(','),
  raceDeckAgain.map((question) => question.word).join(','),
  '重新开局必须重新洗牌'
);
assert.throws(
  () => buildQuestions(words, 10, 'CET6'),
  /不足/,
  '六级词库未加入时不能抽题'
);

function eventQueue(socket, event, label) {
  const buffered = [];
  const waiters = [];
  socket.on(event, (data) => {
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(data);
    } else {
      buffered.push(data);
    }
  });

  return {
    next(timeout = 5000) {
      if (buffered.length) return Promise.resolve(buffered.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((entry) => entry.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`等待 ${label || event} 超时`));
        }, timeout);
        waiters.push({ resolve, reject, timer });
      });
    },
  };
}

class TestClient {
  constructor(socket) {
    this.socket = socket;
    this.sessionId = null;
    this.playerId = null;
  }

  static async connect(url) {
    const socket = io(url, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      timeout: 5000,
      auth: { clientVersion: APP_VERSION },
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket 连接超时')), 5000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return new TestClient(socket);
  }

  request(event, payload, timeout = 5000) {
    return new Promise((resolve, reject) => {
      this.socket.timeout(timeout).emit(event, payload, (error, response) => {
        if (error) {
          reject(new Error(`${event} 请求超时`));
          return;
        }
        resolve(response);
      });
    });
  }

  queue(event) {
    return eventQueue(this.socket, event, event);
  }

  close() {
    this.socket.disconnect();
  }
}

function correctIndex(question) {
  const entry = wordMap.get(question.word);
  assert(entry, `词库中找不到 ${question.word}`);
  if (question.type === 'zh2en' || question.type === 'listen') {
    const index = question.options.indexOf(question.word);
    assert(index >= 0, `${question.word} 的英文不在选项中`);
    return index;
  }
  const primary = entry.meanings.find((item) => item.frequencyRank === 1);
  assert(primary, `${question.word} 缺少 frequencyRank 1 释义`);
  const index = question.options.indexOf(`${primary.pos} ${primary.meaning}`);
  assert(index >= 0, `${question.word} 的正确答案不在选项中`);
  return index;
}

function wrongIndex(question) {
  return (correctIndex(question) + 1) % question.options.length;
}

async function run() {
  const arena = createArenaServer({
    questionMs: 900,
    revealMs: 100,
    startDelayMs: 100,
    vipRequired: false,
    cleanupIntervalMs: 60_000,
  });

  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = arena.httpServer.address();
  const url = `http://127.0.0.1:${port}`;

  const homeResponse = await fetch(url);
  const html = await homeResponse.text();
  assert.equal(homeResponse.status, 200);
  assert(html.includes('CET Arena'), '首页未返回应用 HTML');
  assert.match(homeResponse.headers.get('cache-control') || '', /no-cache/);
  assert(html.includes('/socket.io/socket.io.min.js'), '应使用体积更小的 Socket.IO 压缩客户端');
  assert(html.includes('pingDisplay'), '首页应包含 Ping 显示');
  assert(html.includes('id="questionWordText"'), '题干应包含可替换的单词文本节点');
  assert(html.includes('id="speakBtn"'), '题干应包含发音喇叭按钮');

  const cssResponse = await fetch(`${url}/styles.css`, {
    headers: { 'accept-encoding': 'gzip' },
  });
  assert.equal(cssResponse.status, 200);
  assert.equal(cssResponse.headers.get('content-encoding'), 'gzip', '静态 CSS 应启用 gzip');
  assert.match(cssResponse.headers.get('cache-control') || '', /max-age=604800/);

  const [fullClient, minClient] = await Promise.all([
    fetch(`${url}/socket.io/socket.io.js`).then((response) => response.text()),
    fetch(`${url}/socket.io/socket.io.min.js`).then((response) => response.text()),
  ]);
  assert(minClient.length < fullClient.length * 0.5, '应提供压缩版 Socket.IO 客户端');

  const health = await fetch(`${url}/healthz`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.words, words.length, '健康检查的单词数应与词库一致');
  assert.equal(health.version, APP_VERSION);

  const outdatedSocket = io(url, {
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    timeout: 5000,
  });
  const outdatedError = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('旧版本连接测试超时')), 5000);
    outdatedSocket.once('connect_error', (error) => {
      clearTimeout(timer);
      resolve(error);
    });
  });
  outdatedSocket.close();
  assert.match(outdatedError.message, /版本已更新/);

  const alice = await TestClient.connect(url);
  const bob = await TestClient.connect(url);
  const charlie = await TestClient.connect(url);

  const pingStartedAt = performance.now();
  const pong = await alice.request('latency:ping', { t: Date.now() });
  const pingRtt = performance.now() - pingStartedAt;
  assert.equal(pong.ok, true);
  assert.equal(typeof pong.serverNow, 'number');
  assert(pingRtt >= 0 && pingRtt < 1000, `本机 Ping 应正常，实际 ${pingRtt}ms`);

  const created = await alice.request('room:create', {
    nickname: 'Alice',
    level: 'CET4',
  });
  assert.equal(created.ok, true, created.error);
  assert.match(created.room.code, /^\d{6}$/);
  assert.equal(created.room.status, 'waiting');
  assert.equal(created.room.level, 'CET4');
  assert.equal(created.room.players.length, 1);
  assert.equal(created.room.players[0].isHost, true);
  alice.sessionId = created.sessionId;
  alice.playerId = created.playerId;
  const roomCode = created.room.code;

  const joined = await bob.request('room:join', { nickname: 'Bob', code: roomCode });
  assert.equal(joined.ok, true, joined.error);
  assert.equal(joined.room.players.length, 2);
  assert.equal(joined.room.mode, 'quiz');
  bob.sessionId = joined.sessionId;
  bob.playerId = joined.playerId;

  const bobModeChange = await bob.request('room:mode', { mode: 'race' });
  assert.equal(bobModeChange.ok, false, '非房主不能切换模式');
  const switchedToRace = await alice.request('room:mode', { mode: 'race' });
  assert.equal(switchedToRace.ok, true, switchedToRace.error);
  assert.equal(switchedToRace.room.mode, 'race');
  const switchedBack = await alice.request('room:mode', { mode: 'quiz' });
  assert.equal(switchedBack.ok, true, switchedBack.error);
  assert.equal(switchedBack.room.mode, 'quiz');

  const bobLevelChange = await bob.request('room:level', { level: 'CET6' });
  assert.equal(bobLevelChange.ok, false, '非房主不能切换词库范围');
  const unavailableCet6 = await alice.request('room:level', { level: 'CET6' });
  assert.equal(unavailableCet6.ok, false);
  assert.match(unavailableCet6.error, /建设中/);
  const stayCet4 = await alice.request('room:level', { level: 'CET4' });
  assert.equal(stayCet4.ok, true, stayCet4.error);
  assert.equal(stayCet4.room.level, 'CET4');

  const full = await charlie.request('room:join', { nickname: 'Charlie', code: roomCode });
  assert.equal(full.ok, false);
  assert.match(full.error, /已满/);

  const earlyStart = await alice.request('game:start', {});
  assert.equal(earlyStart.ok, false, '未准备时不应允许开始');
  assert.match(earlyStart.error, /准备/);

  const unrelatedStart = await bob.request('game:start', {});
  assert.equal(unrelatedStart.ok, false, '非房主不应能开始');

  assert.equal((await alice.request('player:ready', { ready: true })).ok, true);
  assert.equal((await bob.request('player:ready', { ready: true })).ok, true);

  const aliceQuestions = alice.queue('question:start');
  const bobQuestions = bob.queue('question:start');
  const aliceEnds = alice.queue('question:end');
  const bobEnds = bob.queue('question:end');
  const aliceOver = alice.queue('game:over');

  const started = await alice.request('game:start', {});
  assert.equal(started.ok, true, started.error);
  assert.equal(started.room.status, 'playing');

  let expectedAlice = 0;
  let expectedBob = 0;
  const gameTypes = [];

  for (let questionNumber = 1; questionNumber <= 10; questionNumber += 1) {
    const [questionA, questionB] = await Promise.all([
      aliceQuestions.next(),
      bobQuestions.next(),
    ]);

    assert.equal(questionA.index, questionNumber);
    assert.equal(questionA.total, 10);
    assert.equal(questionA.level, 'CET4', '必须只出现房主选择的四级词库');
    const entry = wordMap.get(questionA.word);
    assert.equal(entry.level, 'CET4');
    const primary = entry.meanings.find((item) => item.frequencyRank === 1);
    assert(['en2zh', 'zh2en', 'listen'].includes(questionA.type));
    gameTypes.push(questionA.type);
    if (questionA.type === 'en2zh') {
      assert.equal(questionA.prompt, questionA.word);
      assert.equal(questionA.promptLabel, '选择正确的中文释义');
      assert(
        questionA.options.every((option) => /^(?:v|vt|vi|aux|n|pron|num|adj|a|adv|ad|prep|conj|int|art|pl)\.\s/.test(option)),
        '英译中选项必须带词性'
      );
    } else if (questionA.type === 'zh2en') {
      assert.equal(questionA.prompt, `${primary.pos} ${primary.meaning}`);
      assert.equal(questionA.promptLabel, '选择正确的英文单词');
      assert(
        questionA.options.every((option) => /^[a-z]+$/.test(option)),
        '中译英选项必须是纯英文单词'
      );
    } else {
      assert.equal(questionA.prompt, '');
      assert.equal(questionA.promptLabel, '点击喇叭听发音，选择正确的英文单词');
      assert(
        questionA.options.every((option) => /^[a-z]+$/.test(option)),
        '听音选词选项必须是纯英文单词'
      );
      assert(questionA.options.includes(questionA.word));
    }
    assert.equal(questionB.word, questionA.word, '双方必须看到同一道题');
    assert.equal(questionB.type, questionA.type, '双方题型必须一致');
    assert.equal(questionB.prompt, questionA.prompt);
    assert.deepEqual(questionB.options, questionA.options);
    assert.equal(questionA.options.length, 4);
    assert.equal(new Set(questionA.options).size, 4);
    assert.equal('meaning' in questionA, false, '题目不得向前端泄露释义');
    assert.equal('correctIndex' in questionA, false, '题目不得向前端泄露正确选项');
    assert.equal('answers' in questionA, false, '初始题目不应携带作答记录');

    const correct = correctIndex(questionA);
    const wrong = wrongIndex(questionA);

    if (questionNumber === 1) {
      const bobWrong = await bob.request('game:answer', { optionIndex: wrong });
      assert.equal(bobWrong.ok, true, bobWrong.error);
      assert.equal(bobWrong.correct, false);
      assert.equal(bobWrong.score, -5);
      expectedBob -= 5;

      const bobAgain = await bob.request('game:answer', { optionIndex: wrong });
      assert.equal(bobAgain.ok, false, '答错后本题不得再次作答');
      assert.match(bobAgain.error, /已经作答/);

      const aliceCorrect = await alice.request('game:answer', { optionIndex: correct });
      assert.equal(aliceCorrect.ok, true, aliceCorrect.error);
      assert.equal(aliceCorrect.correct, true);
      assert.equal(aliceCorrect.score, 10);
      expectedAlice += 10;
    } else if (questionNumber === 2) {
      const aliceWrong = await alice.request('game:answer', { optionIndex: wrong });
      assert.equal(aliceWrong.correct, false);
      expectedAlice -= 5;

      const bobCorrect = await bob.request('game:answer', { optionIndex: correct });
      assert.equal(bobCorrect.correct, true);
      expectedBob += 10;
    } else if (questionNumber === 3) {
      // 双方都不作答，验证服务端 15 秒逻辑中的超时分支（测试配置为 900ms）。
    } else {
      const aliceCorrect = await alice.request('game:answer', { optionIndex: correct });
      assert.equal(aliceCorrect.correct, true, `第 ${questionNumber} 题应判定正确`);
      expectedAlice += 10;
    }

    const [endA, endB] = await Promise.all([aliceEnds.next(), bobEnds.next()]);
    assert.equal(endA.questionIndex, questionNumber);
    assert.equal(endB.questionIndex, questionNumber);
    assert.equal(endA.correctIndex, correct);
    assert.equal(endA.answers.length, 2);

    if (questionNumber === 1) {
      assert.equal(endA.reason, 'correct');
      assert.equal(endA.winnerId, alice.playerId);
    }
    if (questionNumber === 2) {
      assert.equal(endA.winnerId, bob.playerId);
    }
    if (questionNumber === 3) {
      assert.equal(endA.reason, 'timeout');
      assert.equal(endA.winnerId, null);
    }
  }

  assert.equal(
    gameTypes.filter((type) => type === 'en2zh').length,
    5,
    '实际对局中英译中应为 5 题'
  );
  assert.equal(
    gameTypes.filter((type) => type === 'zh2en').length,
    3,
    '实际对局中中译英应为 3 题'
  );
  assert.equal(
    gameTypes.filter((type) => type === 'listen').length,
    2,
    '实际对局中听音选词应为 2 题'
  );

  const final = await aliceOver.next(5000);
  assert.equal(final.mode, 'quiz');
  assert.equal(final.tie, false);
  assert.equal(final.winnerId, alice.playerId);
  const finalAlice = final.scores.find((entry) => entry.id === alice.playerId);
  const finalBob = final.scores.find((entry) => entry.id === bob.playerId);
  assert.equal(finalAlice.score, 75);
  assert.equal(finalBob.score, 5);
  assert.equal(finalAlice.score, expectedAlice);
  assert.equal(finalBob.score, expectedBob);
  assert.equal(final.review.length, 10, '抢答模式复盘应包含 10 个单词');
  assert(
    final.review.every(
      (entry) =>
        entry.meanings.length >= 2 &&
        entry.meanings.every((meaning) => meaning.pos && meaning.frequencyRank >= 1)
    ),
    '复盘必须包含完整释义、词性和词频'
  );
  assert.equal(final.review[0].statuses[alice.playerId], 'correct');
  assert.equal(final.review[0].statuses[bob.playerId], 'wrong');
  assert.equal(final.review[1].statuses[alice.playerId], 'wrong');
  assert.equal(final.review[1].statuses[bob.playerId], 'correct');
  assert.equal(final.review[2].statuses[alice.playerId], 'unanswered');
  assert.equal(final.review[2].statuses[bob.playerId], 'unanswered');

  console.log(`  ✓ 完整 10 题对局与实时比分：Alice ${finalAlice.score} : ${finalBob.score} Bob`);
  console.log('  ✓ 选项带词性，结算复盘含完整释义与个人对错标记');

  const rematch = await bob.request('game:rematch', {});
  assert.equal(rematch.ok, true, rematch.error);
  assert.equal(rematch.room.status, 'waiting');
  assert.equal(rematch.room.mode, 'quiz');
  assert(rematch.room.players.every((player) => player.score === 0 && !player.ready));

  assert.equal((await alice.request('player:ready', { ready: true })).ok, true);
  assert.equal((await bob.request('player:ready', { ready: true })).ok, true);
  const aliceReconnectQuestions = alice.queue('question:start');
  const bobReconnectQuestions = bob.queue('question:start');
  assert.equal((await alice.request('game:start', {})).ok, true);

  const questionBeforeReconnect = await aliceReconnectQuestions.next();
  await bobReconnectQuestions.next();

  alice.close();
  await new Promise((resolve) => setTimeout(resolve, 150));

  const aliceAgain = await TestClient.connect(url);
  const aliceAgainEnds = aliceAgain.queue('question:end');
  const resumed = await aliceAgain.request('room:resume', { sessionId: alice.sessionId });
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.room.code, roomCode);
  assert.equal(resumed.room.status, 'playing');
  assert.equal(resumed.room.game.question.index, 1);
  assert.equal('correctIndex' in resumed.room.game.question, false, '重连快照不得泄露答案');
  assert.equal('meaning' in resumed.room.game.question, false, '重连快照不得泄露释义');
  assert.equal(resumed.playerId, alice.playerId);

  const reconnectCorrect = correctIndex(questionBeforeReconnect);
  const reconnectAnswer = await aliceAgain.request('game:answer', {
    optionIndex: reconnectCorrect,
  });
  assert.equal(reconnectAnswer.ok, true, reconnectAnswer.error);
  assert.equal(reconnectAnswer.correct, true);
  await aliceAgainEnds.next();
  console.log('  ✓ 对局中刷新/断线后通过 sessionId 重连并继续作答');

  aliceAgain.close();
  bob.close();
  charlie.close();
  await arena.close();

  console.log('  ✓ 创建/加入/第三人已满/准备/房主开始校验');
  console.log('  ✓ 答错扣 5 分、锁题、对手仍可作答');
  console.log('  ✓ 超时无人得分、10 题结算、再来一局');
  console.log('\nE2E 测试全部通过。');
}

run().catch((error) => {
  console.error('\nE2E 测试失败：');
  console.error(error);
  process.exit(1);
});
