'use strict';

/**
 * 前端集成测试：在 Node 里用最小 DOM + 假 Socket 真实执行 public/app.js，
 * 覆盖两条关键链路：
 *   1) 错词本为空时点击「错词挑战」→ 提示「当前没有错词，快去打一局吧」
 *   2) 连对 3 次 → 单词移出错词本、界面显示掌握
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const wrongbookSource = fs.readFileSync(path.join(root, 'public', 'wrongbook.js'), 'utf8');

function createElement(id) {
  const listeners = new Map();
  const el = {
    id,
    hidden: false,
    textContent: '',
    className: '',
    value: '',
    disabled: false,
    dataset: {},
    style: {},
    children: [],
    classList: (() => {
      const set = new Set();
      return {
        add(...names) {
          names.forEach((name) => set.add(name));
        },
        remove(...names) {
          names.forEach((name) => set.delete(name));
        },
        toggle(name, force) {
          const on = force === undefined ? !set.has(name) : Boolean(force);
          if (on) set.add(name);
          else set.delete(name);
          return on;
        },
        contains(name) {
          return set.has(name);
        },
        _all() {
          return [...set];
        },
      };
    })(),
    append(...nodes) {
      el.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      el.children = nodes;
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    focus() {},
    remove() {},
    _fire(type, event) {
      for (const fn of listeners.get(type) || []) fn(event || {});
    },
    _has(type) {
      return (listeners.get(type) || []).length > 0;
    },
  };
  return el;
}

function createEnv(options = {}) {
  const elements = new Map();
  const timers = [];
  let timerId = 1;

  const payButtons = [
    createElement('pay-solo'),
    createElement('pay-duo'),
    createElement('pay-dorm'),
  ];

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelectorAll(selector) {
      return String(selector).includes('data-package') ? payButtons : [];
    },
    createElement(tag) {
      const node = createElement(`created-${tag}`);
      node.tag = tag;
      return node;
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: text };
    },
    addEventListener() {},
    removeEventListener() {},
    body: { dataset: {}, appendChild() {}, classList: { add() {}, remove() {} } },
    documentElement: { dataset: {} },
  };

  const storageMap = new Map();
  const localStorage = {
    getItem: (key) => (storageMap.has(key) ? storageMap.get(key) : null),
    setItem: (key, value) => storageMap.set(key, String(value)),
    removeItem: (key) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  };

  const ackHandlers = new Map();
  const eventHandlers = new Map();

  // 预置激活态：错词挑战已改为 VIP 专属，需要跑单人流程的用例默认带上激活态。
  // 只写 localStorage 还不够——真正的 state.vip.verified 要走一次静默重验，
  // 所以同时补一个默认的 vip:verify 成功应答（用例可以显式覆盖）。
  if (options.seedVip) {
    storageMap.set('cetArena.vip.v1', JSON.stringify({ code: options.seedVip }));
    if (!options.acks || !options.acks['vip:verify']) {
      ackHandlers.set('vip:verify', () => ({
        ok: true,
        kind: 'unlimited',
        message: '验证成功',
      }));
    }
  }
  for (const [event, handler] of Object.entries(options.acks || {})) {
    ackHandlers.set(event, handler);
  }

  function createSocket() {
    const socket = {
      connected: true,
      on(event, fn) {
        const list = eventHandlers.get(event) || [];
        list.push(fn);
        eventHandlers.set(event, list);
        return socket;
      },
      off() {},
      once(event, fn) {
        return socket.on(event, fn);
      },
      emit() {},
      timeout() {
        return {
          emit(event, payload, callback) {
            const handler = ackHandlers.get(event);
            if (!handler) {
              callback(null, { ok: false, error: 'no handler: ' + event });
              return;
            }
            try {
              const response = handler(payload);
              if (response && typeof response.then === 'function') {
                response.then((value) => callback(null, value));
              } else {
                callback(null, response);
              }
            } catch (error) {
              callback(error);
            }
          },
        };
      },
      connect() {
        for (const fn of eventHandlers.get('connect') || []) fn();
      },
      fire(event, payload) {
        for (const fn of eventHandlers.get(event) || []) fn(payload);
      },
      io: { on() {} },
      disconnect() {},
    };
    return socket;
  }

  const sandbox = {
    console,
    URLSearchParams,
    performance: { now: () => Date.now() },
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    Promise,
    Error,
    setTimeout(fn, ms) {
      const id = timerId++;
      timers.push({ id, fn });
      return id;
    },
    clearTimeout(id) {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    setInterval() {
      return 0;
    },
    clearInterval() {},
    document,
    localStorage,
    location: { search: '', reload() {} },
    scrollTo() {},
    navigator: { userAgent: 'node-test' },
    addEventListener() {},
    removeEventListener() {},
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    },
    speechSynthesis: undefined,
    SpeechSynthesisUtterance: undefined,
    alert() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.io = () => createSocket();

  // 假 <audio>：记录被播放的音频地址，用来断言「听音题自动播报」确实被触发。
  // 正式实现已改为播放 /audio/<word>.mp3，不再依赖 speechSynthesis。
  const spoken = [];
  sandbox.Audio = function FakeAudio(src) {
    this.src = src || '';
    this.preload = '';
    this.currentTime = 0;
    this.volume = 1;
    this.paused = true;
    this.play = () => {
      spoken.push(this.src);
      this.paused = false;
      return Promise.resolve();
    };
    this.pause = () => {
      this.paused = true;
    };
    this.load = () => {};
    this.removeAttribute = () => {};
    this.addEventListener = () => {};
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(wrongbookSource, context, { filename: 'wrongbook.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });

  return {
    sandbox,
    elements,
    localStorage,
    document,
    ackHandlers,
    eventHandlers,
    flushTimers() {
      const pending = timers.splice(0);
      for (const timer of pending) timer.fn();
    },
    fire(event, payload) {
      for (const fn of eventHandlers.get(event) || []) fn(payload);
    },
    payButtons,
    spoken,
    el(id) {
      return document.getElementById(id);
    },
  };
}

const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function scenarioEmptyBook() {
  console.log('=== 场景 1：错词本为空 ===');
  const env = createEnv({ seedVip: '080323' });
  await flush();
  await flush();

  assert.equal(env.document.body.dataset.view, 'home', '应停留在首页');
  assert.equal(env.el('wrongBookCount').textContent, '0', '首页错词数量应为 0');
  assert.equal(env.el('wrongBookHint').textContent, '错词本为空', '提示应为空错词本');

  env.el('wrongChallengeBtn')._fire('click');
  await flush();

  assert.equal(
    env.el('toast').textContent,
    '当前没有错词，快去打一局吧',
    '空错词本应给出指定提示'
  );
  assert.equal(env.document.body.dataset.view, 'home', '空错词本不应进入挑战页');
  console.log('  ✓ 空错词本提示正确，且不进入挑战页');
}

async function scenarioMastery() {
  console.log('=== 场景 2：连对 3 次移出错词本 ===');
  const env = createEnv({ seedVip: '080323' });
  await flush();

  // 预置一本只有 1 个词的错词本
  env.localStorage.setItem(
    'cetArena.wrongBook.v1',
    JSON.stringify({
      version: 1,
      words: [
        {
          id: 'cet4_0001',
          word: 'abandon',
          level: 'CET4',
          streak: 0,
          wrongCount: 1,
          addedAt: 1,
          updatedAt: 1,
        },
      ],
    })
  );

  const question = {
    id: 'cet4_0001',
    word: 'abandon',
    level: 'CET4',
    type: 'en2zh',
    prompt: 'abandon',
    promptLabel: '选择正确的中文释义',
    options: ['vt. 丢弃', 'vt. 放弃', 'n. 能力', 'adj. 绝对的'],
  };

  env.ackHandlers.set('solo:start', () => ({ ok: true, total: 1 }));
  env.ackHandlers.set('solo:next', () => ({ ok: true, question }));
  env.ackHandlers.set('solo:answer', () => ({
    ok: true,
    correct: true,
    id: question.id,
    word: question.word,
    correctIndex: 0,
    correctText: 'vt. 丢弃',
    meanings: [{ pos: 'vt.', meaning: '丢弃', frequencyRank: 1 }],
  }));

  env.el('wrongChallengeBtn')._fire('click');
  await flush();

  assert.equal(env.document.body.dataset.view, 'solo', '应进入错词挑战页');
  assert.equal(env.el('soloOptions').children.length, 4, '应渲染 4 个选项');
  assert.equal(env.el('soloRemaining').textContent, '1', '剩余错词应为 1');
  assert.equal(env.el('soloDots').children.length, 3, '应渲染 3 个连对圆点');
  console.log('  ✓ 进入挑战页并渲染题目');

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    env.el('soloOptions').children[0]._fire('click');
    await flush();

    // 回归：答对时被点选项必须是绿色（is-correct），不能标红。
    const buttons = env.el('soloOptions').children;
    assert(
      buttons[0].classList.contains('is-correct'),
      `第 ${attempt} 次答对后选项应标绿`
    );
    assert(
      !buttons[0].classList.contains('is-wrong'),
      `第 ${attempt} 次答对后选项不应标红`
    );
    assert(
      buttons
        .slice(1)
        .every((button) => !button.classList.contains('is-wrong')),
      '正确作答时其他选项不应标红'
    );

    env.flushTimers();
    await flush();

    const book = JSON.parse(env.localStorage.getItem('cetArena.wrongBook.v1'));
    const entry = book.words.find((item) => item.word === 'abandon');
    if (attempt < 3) {
      assert(entry, `第 ${attempt} 次答对后单词应仍在错词本`);
      assert.equal(entry.streak, attempt, `第 ${attempt} 次答对后连对应为 ${attempt}`);
      assert.equal(env.el('soloStreakValue').textContent, `${attempt} / 3`);
    } else {
      assert.equal(book.words.length, 0, '连对 3 次后应从错词本移除');
      assert.equal(env.el('soloRemaining').textContent, '0', '剩余错词应变为 0');
      assert.equal(env.el('soloSummary').hidden, false, '应显示本轮总结');
      assert(
        env.el('soloSummaryCopy').textContent.includes('掌握'),
        '总结应提到掌握数量'
      );
    }
    console.log(`  ✓ 第 ${attempt} 次答对后的状态正确`);
  }

  assert.equal(env.el('wrongBookCount').textContent, '0', '首页错词数量应更新为 0');
}

async function scenarioWrongResetsStreak() {
  console.log('=== 场景 3：中途答错清零 ===');
  const env = createEnv({ seedVip: '080323' });
  await flush();
  env.localStorage.setItem(
    'cetArena.wrongBook.v1',
    JSON.stringify({
      version: 1,
      words: [
        { id: 'cet4_0002', word: 'ability', level: 'CET4', streak: 2, wrongCount: 1 },
      ],
    })
  );

  const question = {
    id: 'cet4_0002',
    word: 'ability',
    level: 'CET4',
    type: 'en2zh',
    prompt: 'ability',
    promptLabel: '选择正确的中文释义',
    options: ['n. 能力', 'n. 缺席', 'adj. 绝对的', 'v. 吸收'],
  };

  env.ackHandlers.set('solo:start', () => ({ ok: true, total: 1 }));
  env.ackHandlers.set('solo:next', () => ({ ok: true, question }));
  env.ackHandlers.set('solo:answer', () => ({
    ok: true,
    correct: false,
    id: question.id,
    word: question.word,
    correctText: 'n. 能力',
    meanings: [{ pos: 'n.', meaning: '能力', frequencyRank: 1 }],
  }));

  env.el('wrongChallengeBtn')._fire('click');
  await flush();

  env.el('soloOptions').children[1]._fire('click');
  await flush();

  // 先断言即时反馈（定时器推进后会被「正在抽题」覆盖）
  assert(
    env.el('soloFeedback').textContent.includes('连对已清零'),
    '应提示连对已清零'
  );
  assert.equal(env.el('soloStreakValue').textContent, '0 / 3');

  const book = JSON.parse(env.localStorage.getItem('cetArena.wrongBook.v1'));
  const entry = book.words.find((item) => item.word === 'ability');
  assert(entry, '答错后单词仍应留在错词本');
  assert.equal(entry.streak, 0, '答错后连对计数应清零');

  env.flushTimers();
  await flush();
  console.log('  ✓ 答错后连对清零且单词保留');
}

async function scenarioSoloListen() {
  console.log('=== 场景 5：单人听音题（自动发音 + 答后中文释义 + 着色） ===');
  const env = createEnv({ speech: true, seedVip: '080323' });
  await flush();
  env.localStorage.setItem(
    'cetArena.wrongBook.v1',
    JSON.stringify({
      version: 1,
      words: [{ word: 'breast', level: 'CET4', streak: 0, wrongCount: 1 }],
    })
  );

  const question = {
    id: 'cet4_0100',
    word: 'breast',
    level: 'CET4',
    type: 'listen',
    prompt: '',
    promptLabel: '点击喇叭听发音，选择正确的英文单词',
    options: ['abandon', 'breast', 'ability', 'absence'],
  };

  env.ackHandlers.set('solo:start', () => ({ ok: true, total: 1 }));
  env.ackHandlers.set('solo:next', () => ({ ok: true, question }));
  env.ackHandlers.set('solo:answer', () => ({
    ok: true,
    correct: true,
    word: 'breast',
    correctIndex: 1,
    correctText: 'breast',
    meanings: [
      { pos: 'n.', meaning: '乳房', frequencyRank: 1 },
      { pos: 'n.', meaning: '胸部', frequencyRank: 2 },
    ],
  }));

  env.el('wrongChallengeBtn')._fire('click');
  await flush();
  env.flushTimers(); // 触发延迟自动播报
  await flush();

  assert(
    env.spoken.some((src) => src.includes('/audio/breast.mp3')),
    `听音题出现时应自动播放对应 MP3，实际播放：${JSON.stringify(env.spoken)}`
  );
  console.log('  ✓ 题目出现后自动播放发音（静默失败不影响使用）');

  assert.equal(env.el('soloReveal').hidden, true, '作答前不应展示中文释义');

  env.el('soloOptions').children[1]._fire('click');
  await flush();

  const buttons = env.el('soloOptions').children;
  assert(buttons[1].classList.contains('is-correct'), '选对的按钮应标绿');
  assert(!buttons[1].classList.contains('is-wrong'), '选对的按钮不应标红');

  assert.equal(env.el('soloReveal').hidden, false, '答完后应展示中文释义');
  const revealText = env.el('soloReveal').textContent || JSON.stringify(env.el('soloReveal').children);
  assert(env.el('soloReveal').children.length > 0, '释义区域应有内容');
  console.log('  ✓ 答完立即展示中文含义');
}

async function scenarioMultiplayerListen() {
  console.log('=== 场景 6：双人听音题（自动发音 + 答后中文释义） ===');
  const env = createEnv({
    speech: true,
    seedVip: '080323',
    acks: { 'vip:verify': () => ({ ok: true, tier: 'super_admin' }) },
  });
  await flush();
  env.el('nickname').value = 'Tester';
  env.ackHandlers.set('room:create', () => ({
    ok: true,
    playerId: 'p1',
    sessionId: 's1',
    room: {
      code: '654321',
      hostId: 'p1',
      level: 'CET4',
      mode: 'quiz',
      status: 'waiting',
      maxPlayers: 2,
      players: [{ id: 'p1', nickname: 'Tester', ready: false, score: 0, connected: true, isHost: true }],
      game: null,
    },
  }));
  env.el('createBtn')._fire('click');
  await flush();

  env.fire('question:start', {
    index: 1,
    total: 10,
    type: 'listen',
    prompt: '',
    promptLabel: '点击喇叭听发音，选择正确的英文单词',
    word: 'breast',
    level: 'CET4',
    options: ['abandon', 'breast', 'ability', 'absence'],
    deadline: Date.now() + 15000,
    serverNow: Date.now(),
    players: [],
  });
  await flush();
  env.flushTimers();
  await flush();

  assert(
    env.spoken.some((src) => src.includes('/audio/breast.mp3')),
    '双人听音题也应自动播放对应 MP3'
  );
  console.log('  ✓ 双人对战听音题自动播放发音');

  env.ackHandlers.set('game:answer', () => ({
    ok: true,
    correct: true,
    selectedIndex: 1,
    score: 10,
    locked: true,
    correctIndex: 1,
    reveal: {
      word: 'breast',
      meanings: [
        { pos: 'n.', meaning: '乳房', frequencyRank: 1 },
        { pos: 'n.', meaning: '胸部', frequencyRank: 2 },
      ],
    },
  }));

  env.el('options').children[1]._fire('click');
  await flush();

  assert.equal(env.el('answerReveal').hidden, false, '答完后应展示中文释义');
  assert.equal(env.el('answerReveal').children.length > 0, true, '释义区域应有内容');
  console.log('  ✓ 双人对战答完立即展示中文含义');
}

async function scenarioSoloWrongColoring() {
  console.log('=== 场景 7：单人答错时的着色 ===');
  const env = createEnv({ seedVip: '080323' });
  await flush();
  env.localStorage.setItem(
    'cetArena.wrongBook.v1',
    JSON.stringify({
      version: 1,
      words: [{ word: 'ability', level: 'CET4', streak: 0, wrongCount: 1 }],
    })
  );

  const question = {
    id: 'cet4_0101',
    word: 'ability',
    level: 'CET4',
    type: 'en2zh',
    prompt: 'ability',
    promptLabel: '选择正确的中文释义',
    options: ['n. 能力', 'n. 缺席', 'adj. 绝对的', 'v. 吸收'],
  };

  env.ackHandlers.set('solo:start', () => ({ ok: true, total: 1 }));
  env.ackHandlers.set('solo:next', () => ({ ok: true, question }));
  env.ackHandlers.set('solo:answer', () => ({
    ok: true,
    correct: false,
    word: 'ability',
    correctIndex: 0,
    correctText: 'n. 能力',
    meanings: [{ pos: 'n.', meaning: '能力', frequencyRank: 1 }],
  }));

  env.el('wrongChallengeBtn')._fire('click');
  await flush();

  env.el('soloOptions').children[2]._fire('click');
  await flush();

  const buttons = env.el('soloOptions').children;
  assert(buttons[0].classList.contains('is-correct'), '正确选项应标绿');
  assert(buttons[2].classList.contains('is-wrong'), '点错的选项应标红');
  assert(
    !buttons[0].classList.contains('is-wrong'),
    '正确选项不能同时被标红'
  );
  console.log('  ✓ 答错时错选标红、正确项标绿');
}

async function scenarioVipPaywall() {
  console.log('=== 场景 8：激活码与三档套餐 ===');
  const env = createEnv({
    acks: {
      'vip:verify': () => ({ ok: true, kind: 'once', message: '验证成功' }),
      'room:create': () => ({
        ok: true,
        playerId: 'p1',
        sessionId: 's1',
        room: {
          code: '123456',
          hostId: 'p1',
          level: 'CET4',
          mode: 'quiz',
          status: 'waiting',
          maxPlayers: 2,
          players: [{ id: 'p1', nickname: 'Tester', ready: false, score: 0, connected: true, isHost: true }],
          game: null,
        },
      }),
    },
  });
  await flush();

  env.el('nickname').value = 'Tester';
  env.el('createBtn')._fire('click');
  await flush();

  assert.equal(env.el('vipOverlay').hidden, false, '未激活时应弹出 VIP 遮罩');
  assert.equal(env.el('vipStepCode').hidden, false, '默认显示激活码输入');
  assert.equal(env.el('vipStepPay').hidden, true, '默认不显示套餐页');
  console.log('  ✓ 点「创建房间」弹出全屏激活码遮罩');

  env.el('vipToPayBtn')._fire('click');
  assert.equal(env.el('vipStepPay').hidden, false, '应切到套餐页');
  assert.equal(env.el('vipStepCode').hidden, true);
  assert.equal(env.payButtons.length, 3, '套餐页应有三个购买按钮');
  console.log('  ✓ 三个套餐按钮（19.9 / 29.9 / 59.9）');

  env.payButtons[0]._fire('click');
  assert.equal(
    env.el('vipNotice').textContent,
    '支付通道维护中，请联系站长获取激活码。'
  );
  assert.equal(env.el('vipNotice').hidden, false, '应展示维护提示');
  console.log('  ✓ 点购买只提示维护中，无收款码');

  env.el('vipBackBtn')._fire('click');
  assert.equal(env.el('vipStepCode').hidden, false, '可返回输入激活码');

  env.el('vipCodeInput').value = 'VIP888';
  env.el('vipVerifyBtn')._fire('click');
  await flush();

  assert.equal(env.el('vipOverlay').hidden, true, '验证成功后遮罩应关闭');
  const stored = JSON.parse(env.localStorage.getItem('cetArena.vip.v1'));
  assert.equal(stored.code, 'VIP888', '应写入激活码');
  assert.equal(env.document.body.dataset.view, 'room', '验证后应继续建房进入房间');
  console.log('  ✓ 验证成功后关闭遮罩、写入 localStorage 并继续建房');

  assert.equal(env.el('vipClearBtn').hidden, false, '已激活时首页应显示清除按钮');
  env.el('vipClearBtn')._fire('click');
  await flush();
  assert.equal(env.localStorage.getItem('cetArena.vip.v1'), null, '清除后应移除本地状态');
  assert.equal(env.el('vipClearBtn').hidden, true, '清除后按钮应隐藏');
  env.flushTimers();
  console.log('  ✓ 清除激活状态按钮可用');
}

async function scenarioJoinNeedsCode() {
  console.log('=== 场景 9：加入房间也需要自己的码 ===');
  const env = createEnv({
    acks: {
      'vip:verify': () => ({ ok: true, kind: 'once', message: '验证成功' }),
      'room:join': () => ({
        ok: true,
        playerId: 'p2',
        sessionId: 's2',
        room: {
          code: '123456',
          hostId: 'p1',
          level: 'CET4',
          mode: 'quiz',
          status: 'waiting',
          maxPlayers: 2,
          players: [
            { id: 'p1', nickname: '房主', ready: false, score: 0, connected: true, isHost: true },
            { id: 'p2', nickname: 'Tester', ready: false, score: 0, connected: true, isHost: false },
          ],
          game: null,
        },
      }),
    },
  });
  await flush();

  env.el('nickname').value = 'Tester';
  env.el('roomCode').value = '123456';
  env.el('joinBtn')._fire('click');
  await flush();

  assert.equal(env.el('vipOverlay').hidden, false, '未激活点加入应弹遮罩');
  assert.equal(env.el('vipStepCode').hidden, false, '应显示激活码输入');

  env.el('vipCodeInput').value = 'VIP666';
  env.el('vipVerifyBtn')._fire('click');
  await flush();

  assert.equal(env.el('vipOverlay').hidden, true, '验证后遮罩关闭');
  assert.equal(env.document.body.dataset.view, 'room', '验证后应进入房间');
  console.log('  ✓ 加入房间同样凭自己的激活码入场');
}

async function scenarioResultStoresMistakes() {
  console.log('=== 场景 4：结算页答错的词自动入库 ===');
  const env = createEnv({
    seedVip: '080323',
    acks: { 'vip:verify': () => ({ ok: true, tier: 'super_admin' }) },
  });
  await flush();
  env.el('nickname').value = 'Tester';
  env.ackHandlers.set('room:create', () => ({
    ok: true,
    playerId: 'p1',
    sessionId: 's1',
    room: {
      code: '123456',
      hostId: 'p1',
      level: 'CET4',
      mode: 'quiz',
      status: 'waiting',
      maxPlayers: 2,
      players: [
        { id: 'p1', nickname: 'Tester', ready: false, score: 0, connected: true, isHost: true },
        { id: 'p2', nickname: 'Rival', ready: false, score: 0, connected: true, isHost: false },
      ],
      game: null,
    },
  }));

  env.el('createBtn')._fire('click');
  await flush();

  const final = {
    mode: 'quiz',
    level: 'CET4',
    total: 10,
    tie: false,
    winnerId: 'p1',
    winnerName: 'Tester',
    scores: [
      { id: 'p1', nickname: 'Tester', score: 80 },
      { id: 'p2', nickname: 'Rival', score: 40 },
    ],
    players: [
      { id: 'p1', nickname: 'Tester', score: 80, connected: true },
      { id: 'p2', nickname: 'Rival', score: 40, connected: true },
    ],
    // 注意：这里刻意不带 id —— 服务端 reviewEntry 的真实形状就是没有 id，
    // 这正是之前错词写不进 localStorage 的根因，作为回归用例固定下来。
    review: [
      {
        index: 1,
        word: 'abandon',
        level: 'CET4',
        meanings: [
          { pos: 'vt.', meaning: '丢弃', frequencyRank: 1 },
          { pos: 'vt.', meaning: '放弃', frequencyRank: 2 },
        ],
        primary: { pos: 'vt.', meaning: '丢弃', frequencyRank: 1 },
        correctOption: 'vt. 丢弃',
        statuses: { p1: 'wrong', p2: 'correct' },
        mistakes: { p1: true },
      },
      {
        index: 2,
        word: 'ability',
        level: 'CET4',
        meanings: [
          { pos: 'n.', meaning: '能力', frequencyRank: 1 },
          { pos: 'n.', meaning: '本领', frequencyRank: 2 },
        ],
        primary: { pos: 'n.', meaning: '能力', frequencyRank: 1 },
        correctOption: 'n. 能力',
        statuses: { p1: 'correct', p2: 'wrong' },
        mistakes: { p1: false },
      },
    ],
  };

  env.fire('game:over', final);
  await flush();

  const book = JSON.parse(env.localStorage.getItem('cetArena.wrongBook.v1'));
  assert(book, '应写入错词本');
  assert.equal(book.words.length, 1, '只应记录自己答错的词');
  assert.equal(book.words[0].word, 'abandon', '记录的应是 abandon');
  assert.equal(book.words[0].word, 'abandon');
  assert(
    env.el('reviewSummary').textContent.includes('已存入错词本'),
    '复盘摘要应提示已存入错词本'
  );
  assert.equal(env.el('wrongBookCount').textContent, '1', '首页错词数应更新');
  console.log('  ✓ 只记录自己答错的词，并更新错词本数量');
}

async function scenarioFreeTierLock() {
  console.log('=== 场景 10：免费用户锁错词本 + 闯关第 4 关占位 ===');
  const env = createEnv();
  await flush();

  assert.equal(env.el('wrongBookCount').textContent, '—', '免费用户看不到错词数量');
  assert(
    env.el('wrongBookHint').textContent.includes('VIP 专属'),
    '免费用户应看到「VIP 专属」提示'
  );
  assert(
    env.el('wrongChallengeBtn').classList.contains('is-vip-locked'),
    '错词挑战入口应带锁定样式'
  );

  env.el('wrongChallengeBtn')._fire('click');
  await flush();
  assert.equal(env.el('vipOverlay').hidden, false, '点击应弹出激活码遮罩');
  assert.equal(env.document.body.dataset.view, 'home', '免费用户不应进入挑战页');
  console.log('  ✓ 错词本入口锁定并引导激活');

  env.ackHandlers.set('trial:levels', () => ({
    ok: true,
    levels: [
      { id: 'L1', title: '第 1 关 · 基础闯关', free: true, wordCount: 50, timeLimitMs: 10000 },
      { id: 'L2', title: '第 2 关 · 进阶闯关', free: true, wordCount: 50, timeLimitMs: 7000 },
      { id: 'L3', title: '第 3 关 · 挑战闯关', free: true, wordCount: 50, timeLimitMs: 5000 },
    ],
  }));
  env.el('trialEntryBtn')._fire('click');
  await flush();

  assert.equal(env.document.body.dataset.view, 'levels', '免费用户应能进入关卡列表');
  const cards = env.el('levelGrid').children;
  assert.equal(cards.length, 4, '3 个可玩关卡 + 1 个占位');
  assert.equal(
    cards[3].textContent,
    '第 4 关及后续关卡（开发中...）',
    '占位文案固定'
  );
  assert(cards[3].classList.contains('is-locked'), '占位卡片应有不可点击样式');
  assert(!cards[3]._has('click'), '占位卡片不应绑定点击事件');
  console.log('  ✓ 闯关列表可进，第 4 关为灰色占位');
}

(async () => {
  await scenarioEmptyBook();
  await scenarioMastery();
  await scenarioWrongResetsStreak();
  await scenarioSoloListen();
  await scenarioMultiplayerListen();
  await scenarioSoloWrongColoring();
  await scenarioVipPaywall();
  await scenarioJoinNeedsCode();
  await scenarioResultStoresMistakes();
  await scenarioFreeTierLock();
  console.log('');
  console.log('错词挑战前端集成测试全部通过。');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
