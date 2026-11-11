'use strict';

/**
 * 公网验收脚本：对已运行的站点跑一局完整 10 题，并测试中途重连。
 * 用法：npm run test:remote -- https://xxxx.trycloudflare.com
 */

const assert = require('assert/strict');
const { io } = require('socket.io-client');
const { loadWords } = require('../src/wordBank');
const { APP_VERSION } = require('../src/version');

const baseUrl = (process.argv[2] || '').replace(/\/+$/, '');
if (!baseUrl) {
  console.error('用法: npm run test:remote -- https://你的公网地址');
  process.exit(1);
}

const words = loadWords();
const wordMap = new Map(words.map((entry) => [entry.word, entry]));

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
    next(timeout = 8000) {
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
      timeout: 20000,
      auth: { clientVersion: APP_VERSION },
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket 连接超时')), 25000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    assert.equal(
      socket.io.engine.transport.name,
      'websocket',
      '公网连接必须成功升级到 WebSocket'
    );
    return new TestClient(socket);
  }

  request(event, payload, timeout = 10000) {
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
  assert(primary, `${question.word} 缺少最高频释义`);
  const index = question.options.indexOf(`${primary.pos} ${primary.meaning}`);
  assert(index >= 0, `${question.word} 的正确答案不在选项中`);
  return index;
}

async function run() {
  console.log(`\n公网地址: ${baseUrl}`);
  const home = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(30000) });
  const html = await home.text();
  assert.equal(home.status, 200);
  assert(html.includes('CET Arena'));
  assert(html.includes('id="levelSelect"'), '公网首页缺少词库范围下拉框');
  const health = await fetch(`${baseUrl}/healthz`, {
    signal: AbortSignal.timeout(30000),
  }).then((response) => response.json());
  assert.equal(health.ok, true);
  console.log('  ✓ 公网 HTTPS 首页与健康检查可访问');

  const alice = await TestClient.connect(baseUrl);
  const bob = await TestClient.connect(baseUrl);
  console.log(`  ✓ 两个公网 WebSocket 客户端已连接（${baseUrl.replace(/^https?:\/\//, '')}）`);

  const created = await alice.request('room:create', {
    nickname: '远程房主',
    level: 'CET4',
  });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.room.level, 'CET4');
  alice.sessionId = created.sessionId;
  alice.playerId = created.playerId;
  const roomCode = created.room.code;

  const joined = await bob.request('room:join', {
    nickname: '远程好友',
    code: roomCode,
  });
  assert.equal(joined.ok, true, joined.error);
  bob.sessionId = joined.sessionId;
  bob.playerId = joined.playerId;

  const pingStartedAt = performance.now();
  const pong = await alice.request('latency:ping', { t: Date.now() });
  assert.equal(pong.ok, true);
  assert.equal(typeof pong.serverNow, 'number');
  console.log(`  ✓ 公网 Ping 正常（本机到隧道约 ${Math.round(performance.now() - pingStartedAt)}ms）`);

  assert.equal((await alice.request('player:ready', { ready: true })).ok, true);
  assert.equal((await bob.request('player:ready', { ready: true })).ok, true);

  const aliceQuestions = alice.queue('question:start');
  const bobQuestions = bob.queue('question:start');
  const aliceEnds = alice.queue('question:end');
  const aliceOver = alice.queue('game:over');

  const started = await alice.request('game:start', {});
  assert.equal(started.ok, true, started.error);
  console.log(`  ✓ 房间 ${roomCode} 已开始 10 题对局`);

  for (let questionNumber = 1; questionNumber <= 10; questionNumber += 1) {
    const [questionA, questionB] = await Promise.all([
      aliceQuestions.next(),
      bobQuestions.next(15000),
    ]);
    assert.equal(questionA.index, questionNumber);
    assert.equal(questionA.level, 'CET4');
    assert.equal(wordMap.get(questionA.word).level, 'CET4');
    assert(['en2zh', 'zh2en', 'listen'].includes(questionA.type));
    if (questionA.type === 'en2zh') {
      assert.equal(questionA.prompt, questionA.word);
      assert(
        questionA.options.every((option) => /^(?:v|vt|vi|aux|n|pron|num|adj|a|adv|ad|prep|conj|int|art|pl)\.\s/.test(option)),
        '英译中选项必须带词性'
      );
    } else if (questionA.type === 'zh2en') {
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
    assert.equal(questionB.word, questionA.word);
    assert.equal(questionB.type, questionA.type);
    assert.deepEqual(questionB.options, questionA.options);
    assert.equal('correctIndex' in questionA, false);
    assert.equal('meaning' in questionA, false);

    const answer = await alice.request('game:answer', {
      optionIndex: correctIndex(questionA),
    });
    assert.equal(answer.ok, true, answer.error);
    assert.equal(answer.correct, true);
    const end = await aliceEnds.next(15000);
    assert.equal(end.questionIndex, questionNumber);
    assert.equal(end.correctIndex, correctIndex(questionA));
  }

  const final = await aliceOver.next(15000);
  assert.equal(final.mode, 'quiz');
  assert.equal(final.winnerId, alice.playerId);
  const aliceScore = final.scores.find((entry) => entry.id === alice.playerId).score;
  const bobScore = final.scores.find((entry) => entry.id === bob.playerId).score;
  assert.equal(aliceScore, 100);
  assert.equal(bobScore, 0);
  assert.equal(final.review.length, 10);
  assert.equal(final.review[0].statuses[alice.playerId], 'correct');
  assert.equal(final.review[0].statuses[bob.playerId], 'unanswered');
  console.log(`  ✓ 完整 10 题、实时比分与结算：${aliceScore} : ${bobScore}`);
  console.log('  ✓ 结算复盘含完整释义与个人作答标记');

  const rematch = await bob.request('game:rematch', {});
  assert.equal(rematch.ok, true, rematch.error);
  assert.equal((await alice.request('player:ready', { ready: true })).ok, true);
  assert.equal((await bob.request('player:ready', { ready: true })).ok, true);

  const questionAfterRematch = alice.queue('question:start');
  const bobQuestionAfterRematch = bob.queue('question:start');
  assert.equal((await alice.request('game:start', {})).ok, true);
  const qBeforeReconnect = await questionAfterRematch.next(15000);
  await bobQuestionAfterRematch.next(15000);

  alice.close();
  await new Promise((resolve) => setTimeout(resolve, 400));

  const aliceAgain = await TestClient.connect(baseUrl);
  const resumed = await aliceAgain.request('room:resume', {
    sessionId: alice.sessionId,
  });
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.room.status, 'playing');
  assert.equal(resumed.room.game.question.index, 1);
  assert.equal('correctIndex' in resumed.room.game.question, false);
  const reconnectEnd = aliceAgain.queue('question:end');
  const reconnectAnswer = await aliceAgain.request('game:answer', {
    optionIndex: correctIndex(qBeforeReconnect),
  });
  assert.equal(reconnectAnswer.ok, true, reconnectAnswer.error);
  assert.equal(reconnectAnswer.correct, true);
  await reconnectEnd.next(15000);
  console.log('  ✓ 公网对局中断线重连成功，并恢复作答');

  aliceAgain.close();
  bob.close();
  console.log('\n公网 E2E 测试全部通过。');
  process.exit(0);
}

run().catch((error) => {
  console.error('\n公网 E2E 测试失败：');
  console.error(error);
  process.exit(1);
});
