'use strict';

const assert = require('assert/strict');
const { io } = require('socket.io-client');
const { createArenaServer, DEFAULT_CONFIG } = require('../src/app');
const { loadWords } = require('../src/wordBank');
const { APP_VERSION } = require('../src/version');

const words = loadWords();
const wordMap = new Map(words.map((entry) => [entry.word, entry]));

assert.equal(DEFAULT_CONFIG.racePenaltyMs, 1000, '生产环境答错冷却必须是 1 秒');

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
    async nextMatching(predicate, timeout = 5000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await this.next(Math.max(1, deadline - Date.now()));
        if (predicate(value)) return value;
      }
      throw new Error(`等待满足条件的 ${label || event} 超时`);
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
  assert(primary, `${question.word} 缺少最高频释义`);
  const text = `${primary.pos} ${primary.meaning}`;
  const index = question.options.indexOf(text);
  assert(index >= 0, `${question.word} 的正确答案不在选项中`);
  return index;
}

function wrongIndex(question) {
  return (correctIndex(question) + 1) % question.options.length;
}

function statOf(final, playerId) {
  return final.stats.find((entry) => entry.id === playerId);
}

async function run() {
  const arena = createArenaServer({
    racePenaltyMs: 150,
    raceAdvanceDelayMs: 25,
    vipRequired: false,
    cleanupIntervalMs: 60_000,
  });

  await new Promise((resolve) => arena.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = arena.httpServer.address();
  const url = `http://127.0.0.1:${port}`;

  const alice = await TestClient.connect(url);
  const bob = await TestClient.connect(url);
  const charlie = await TestClient.connect(url);

  const created = await alice.request('room:create', {
    nickname: 'Alice',
    level: 'CET4',
  });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.room.mode, 'quiz', '默认应为抢答模式');
  alice.sessionId = created.sessionId;
  alice.playerId = created.playerId;
  const roomCode = created.room.code;

  const joined = await bob.request('room:join', {
    nickname: 'Bob',
    code: roomCode,
  });
  assert.equal(joined.ok, true, joined.error);
  bob.sessionId = joined.sessionId;
  bob.playerId = joined.playerId;

  const full = await charlie.request('room:join', {
    nickname: 'Charlie',
    code: roomCode,
  });
  assert.equal(full.ok, false);
  assert.match(full.error, /已满/);

  const bobModeSwitch = await bob.request('room:mode', { mode: 'race' });
  assert.equal(bobModeSwitch.ok, false, '非房主不能切换模式');

  const switched = await alice.request('room:mode', { mode: 'race' });
  assert.equal(switched.ok, true, switched.error);
  assert.equal(switched.room.mode, 'race');

  assert.equal((await alice.request('player:ready', { ready: true })).ok, true);
  assert.equal((await bob.request('player:ready', { ready: true })).ok, true);

  const aliceSync = alice.queue('race:sync');
  const bobSync = bob.queue('race:sync');
  const aliceQuestions = alice.queue('race:question');
  const bobQuestions = bob.queue('race:question');
  const aliceProgress = alice.queue('race:progress');
  const bobLocked = bob.queue('race:locked');
  const bobUnlocked = bob.queue('race:unlocked');
  const aliceOver = alice.queue('game:over');

  const started = await alice.request('game:start', {});
  assert.equal(started.ok, true, started.error);
  assert.equal(started.room.mode, 'race');
  assert.equal(started.room.total || started.room.game.total, 25);

  const [syncA, syncB] = await Promise.all([aliceSync.next(), bobSync.next()]);
  assert.equal(syncA.mode, 'race');
  assert.equal(syncA.total, 25);
  assert.equal(syncB.total, 25);
  assert.equal(syncA.question.index, 1);
  assert.equal(syncB.question.index, 1);
  assert.equal(syncA.question.word, syncB.question.word, '竞速开局应看到同一套题');
  assert.equal(syncA.question.type, syncB.question.type);
  assert.equal(syncA.question.prompt, syncB.question.prompt);
  assert.deepEqual(syncA.question.options, syncB.question.options);
  assert.equal('correctIndex' in syncA.question, false);
  assert.equal('meaning' in syncA.question, false);
  if (syncA.question.type === 'en2zh') {
    assert.equal(syncA.question.prompt, syncA.question.word);
    assert(
      syncA.question.options.every((option) => /^(?:v|vt|vi|aux|n|pron|num|adj|a|adv|ad|prep|conj|int|art|pl)\.\s/.test(option)),
      '英译中竞速选项也必须带词性'
    );
  } else if (syncA.question.type === 'zh2en') {
    assert.equal(syncA.question.promptLabel, '选择正确的英文单词');
    assert(
      syncA.question.options.every((option) => /^[a-z]+$/.test(option)),
      '中译英竞速选项必须是纯英文单词'
    );
  } else {
    assert.equal(syncA.question.type, 'listen');
    assert.equal(syncA.question.prompt, '');
    assert.equal(syncA.question.promptLabel, '点击喇叭听发音，选择正确的英文单词');
    assert(
      syncA.question.options.every((option) => /^[a-z]+$/.test(option)),
      '听音选词竞速选项必须是纯英文单词'
    );
    assert(syncA.question.options.includes(syncA.question.word));
  }
  assert.equal(syncA.you.progress, 0);
  assert.equal(syncA.you.errors, 0);

  const firstQuestion = syncA.question;
  const aliceFirst = await alice.request('race:answer', {
    optionIndex: correctIndex(firstQuestion),
  });
  assert.equal(aliceFirst.ok, true, aliceFirst.error);
  assert.equal(aliceFirst.correct, true);
  assert.equal(aliceFirst.progress, 1);

  const progressAfterAlice = await aliceProgress.nextMatching(
    (payload) =>
      payload.progress.find((entry) => entry.id === alice.playerId)?.progress === 1
  );
  assert.equal(
    progressAfterAlice.progress.find((entry) => entry.id === bob.playerId).progress,
    0,
    'A 前进时 B 的进度应保持独立'
  );

  const aliceQuestion2 = await aliceQuestions.next();
  assert.equal(aliceQuestion2.index, 2);

  const bobWrong = await bob.request('race:answer', {
    optionIndex: wrongIndex(firstQuestion),
  });
  assert.equal(bobWrong.ok, true, bobWrong.error);
  assert.equal(bobWrong.correct, false);
  assert.equal(bobWrong.progress, 0, '答错不应推进进度');
  assert.equal(bobWrong.errors, 1);
  const lockEvent = await bobLocked.next();
  assert.equal(lockEvent.penaltyMs, 150);
  assert(lockEvent.lockedUntil > Date.now() - 1000);

  const bobRetryWhileLocked = await bob.request('race:answer', {
    optionIndex: correctIndex(firstQuestion),
  });
  assert.equal(bobRetryWhileLocked.ok, false);
  assert.equal(bobRetryWhileLocked.code, 'LOCKED', '惩罚期间服务端必须拒绝作答');

  await bobUnlocked.next(3000);
  const bobFirstCorrect = await bob.request('race:answer', {
    optionIndex: correctIndex(firstQuestion),
  });
  assert.equal(bobFirstCorrect.ok, true, bobFirstCorrect.error);
  assert.equal(bobFirstCorrect.correct, true);
  assert.equal(bobFirstCorrect.progress, 1);

  const bobQuestion2 = await bobQuestions.next();
  assert.equal(bobQuestion2.index, 2);
  const bobSecondWrong = await bob.request('race:answer', {
    optionIndex: wrongIndex(bobQuestion2),
  });
  assert.equal(bobSecondWrong.correct, false);
  assert.equal(bobSecondWrong.errors, 2);
  await bobLocked.next();

  const aliceWaitingSync = alice.queue('race:sync');
  const bobOver = bob.queue('game:over');

  let current = aliceQuestion2;
  for (let index = 2; index <= 25; index += 1) {
    assert.equal(current.index, index);
    assert.equal('correctIndex' in current, false);
    assert(['en2zh', 'zh2en', 'listen'].includes(current.type));
    if (current.type === 'en2zh') {
      assert.equal(current.prompt, current.word);
      assert(current.options.every((option) => /^(?:v|vt|vi|aux|n|pron|num|adj|a|adv|ad|prep|conj|int|art|pl)\.\s/.test(option)));
    } else if (current.type === 'zh2en') {
      assert.equal(current.promptLabel, '选择正确的英文单词');
      assert(current.options.every((option) => /^[a-z]+$/.test(option)));
    } else {
      assert.equal(current.prompt, '');
      assert.equal(current.promptLabel, '点击喇叭听发音，选择正确的英文单词');
      assert(current.options.every((option) => /^[a-z]+$/.test(option)));
      assert(current.options.includes(current.word));
    }
    const answer = await alice.request('race:answer', {
      optionIndex: correctIndex(current),
    });
    assert.equal(answer.ok, true, answer.error);
    assert.equal(answer.correct, true);
    assert.equal(answer.progress, index);
    if (index < 25) {
      current = await aliceQuestions.next();
    } else {
      assert.equal(answer.finished, true);
    }
  }

  const waiting = await aliceWaitingSync.next(8000);
  assert.equal(waiting.question, null, '先完成的一方不应再收到新题');
  assert(waiting.you.finishedAt > 0, '等待快照必须包含个人完成时间');
  const waitingMine = waiting.progress.find((entry) => entry.id === alice.playerId);
  assert.equal(waitingMine.progress, 25);
  assert.equal(waitingMine.finished, true);
  assert.equal(
    arena.rooms.get(roomCode).status,
    'playing',
    '只有一方完成时整局必须继续'
  );
  assert.equal(
    arena.rooms.get(roomCode).game.states[bob.playerId].finishedAt,
    null,
    '未完成的一方不应被标记完成'
  );

  // 慢的一方继续正常作答，直到也完成 25 题。
  await bobUnlocked.next(3000);
  let bobCurrent = bobQuestion2;
  for (let index = 2; index <= 25; index += 1) {
    if (index > 2) {
      bobCurrent = await bobQuestions.next(8000);
      assert.equal(bobCurrent.index, index, '完成等待期间另一方应继续收到题目');
    }
    const answer = await bob.request('race:answer', {
      optionIndex: correctIndex(bobCurrent),
    });
    assert.equal(answer.ok, true, answer.error);
    assert.equal(answer.correct, true);
    assert.equal(answer.progress, index);
    if (index === 25) {
      assert.equal(answer.finished, true);
    }
  }

  const [final, bobFinal] = await Promise.all([
    aliceOver.next(8000),
    bobOver.next(8000),
  ]);
  assert.equal(final.mode, 'race');
  assert.equal(final.total, 25);
  assert.equal(bobFinal.mode, 'race');
  assert.equal(bobFinal.winnerId, alice.playerId, '双方完成后按总用时判定胜者');
  assert.equal(final.winnerId, alice.playerId, '双方必须同时收到相同的结算结果');
  assert.equal(final.review.length, 25);
  assert.equal(new Set(final.review.map((entry) => entry.word)).size, 25);

  const aliceStat = statOf(final, alice.playerId);
  const bobStat = statOf(final, bob.playerId);
  assert.equal(aliceStat.progress, 25);
  assert.equal(aliceStat.errors, 0);
  assert.equal(aliceStat.finished, true);
  assert.equal(bobStat.progress, 25);
  assert.equal(bobStat.errors, 2);
  assert.equal(bobStat.finished, true);
  assert(
    aliceStat.totalMs < bobStat.totalMs,
    '先完成的一方总用时应更短'
  );
  assert(
    final.review.every(
      (entry) =>
        entry.statuses[alice.playerId] === 'correct' &&
        entry.statuses[bob.playerId] === 'correct'
    ),
    '双方都完成时复盘不应出现未作答'
  );
  assert(
    final.review.every(
      (entry) =>
        entry.meanings.length >= 2 &&
        entry.meanings.every((meaning) => meaning.pos && meaning.frequencyRank >= 1)
    ),
    '竞速复盘必须包含完整释义、词性和词频'
  );

  const secondReview = final.review.find((entry) => entry.index === 2);
  assert(secondReview, '复盘应包含第 2 题');
  assert.equal(secondReview.word, bobQuestion2.word);
  assert.equal(secondReview.statuses[bob.playerId], 'correct');
  assert.equal(
    secondReview.mistakes[bob.playerId],
    true,
    '答错后纠正的题目必须保留 hasMistake 标记'
  );
  assert.equal(secondReview.mistakes[alice.playerId], false);
  assert(
    final.review.every(
      (entry) =>
        entry.mistakes[alice.playerId] === false &&
        entry.mistakes[bob.playerId] === (entry.index === 1 || entry.index === 2)
    ),
    'Bob 第 1、2 题都应保留答错标记'
  );
  assert.equal(
    arena.rooms.get(roomCode).game.states[bob.playerId].answers[0].hasMistake,
    true,
    '房间状态中的每题作答记录必须保存 hasMistake'
  );
  assert.equal(
    arena.rooms.get(roomCode).game.states[bob.playerId].answers[1].hasMistake,
    true,
    '答错后纠正的题目也必须保留 hasMistake'
  );

  console.log('  ✓ 竞速模式：一方完成后继续等待，双方都完成才统一结算');
  console.log('  ✓ 慢的一方在对手完成后仍可继续作答直至完成');
  console.log('  ✓ 答错后纠正的题目在复盘中保留答错标记');
  console.log('  ✓ 竞速复盘 25 个单词，双方完成状态与总用时正确');

  const rematch = await bob.request('game:rematch', {});
  assert.equal(rematch.ok, true, rematch.error);
  assert.equal(rematch.room.status, 'waiting');
  assert.equal(rematch.room.mode, 'race', '再来一局应保留竞速模式');

  alice.close();
  bob.close();
  charlie.close();
  await arena.close();
  console.log('\n竞速模式测试全部通过。');
}

run().catch((error) => {
  console.error('\n竞速模式测试失败：');
  console.error(error);
  process.exit(1);
});
