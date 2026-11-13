'use strict';

/**
 * 站长后台「卡密列表」渲染测试（假 DOM 真跑 public/admin.js）。
 *
 * 重点回归：只要 revokedDeviceCount > 0，无论状态是 available / used / revoked，
 * 状态列都必须渲染「拉黑 N 台」——否则「允许换机」后站长就看不到历史拉黑记录了。
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const adminSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'admin.js'),
  'utf8'
);

function createElement(id) {
  const listeners = new Map();
  return {
    id,
    hidden: false,
    textContent: '',
    className: '',
    value: '',
    disabled: false,
    dataset: {},
    style: {},
    children: [],
    classList: {
      _set: new Set(),
      add(...names) {
        names.forEach((name) => this._set.add(name));
      },
      remove(...names) {
        names.forEach((name) => this._set.delete(name));
      },
      toggle(name, force) {
        const on = force === undefined ? !this._set.has(name) : Boolean(force);
        if (on) this._set.add(name);
        else this._set.delete(name);
        return on;
      },
      contains(name) {
        return this._set.has(name);
      },
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    focus() {},
    select() {},
    remove() {},
  };
}

function createEnv(codes) {
  const elements = new Map();
  const document = {
    hidden: false,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    createElement(tag) {
      const node = createElement(`created-${tag}`);
      node.tag = tag;
      return node;
    },
    body: {
      appendChild() {},
      removeChild() {},
      classList: { add() {}, remove() {} },
    },
    addEventListener() {},
    removeEventListener() {},
    execCommand() {
      return true;
    },
  };

  const responses = {
    '/api/admin/session': { ok: true, authed: true },
    '/api/admin/state': {
      ok: true,
      codes,
      stats: { total: codes.length, available: 0, used: 0, revoked: 0, unlimited: 0 },
      live: { rooms: 0, players: 0 },
      messages: { total: 0, pending: 0 },
      announcement: { content: '', updatedAt: null },
    },
  };

  const sandbox = {
    console,
    JSON,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    RegExp,
    document,
    location: { search: '', reload() {} },
    navigator: { userAgent: 'node-test' },
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
    setInterval() {
      return 0;
    },
    clearInterval() {},
    fetch: async (url) => {
      const body = responses[String(url)] || { ok: false, message: 'no stub' };
      return {
        ok: body.ok !== false,
        status: body.ok === false ? 400 : 200,
        json: async () => body,
      };
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(adminSource, sandbox, { filename: 'admin.js' });

  return { document, elements };
}

const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** 递归收集节点文本（含子节点）。 */
function textOf(node) {
  if (!node) return '';
  let text = typeof node.textContent === 'string' ? node.textContent : '';
  for (const child of node.children || []) {
    text += ' ' + textOf(child);
  }
  return text;
}

function makeCode(overrides) {
  return {
    code: 'TESTCODE1',
    kind: 'once',
    label: '单人码',
    status: 'available',
    boundDevicePrefix: null,
    boundIp: null,
    lastIp: null,
    usedAt: null,
    revokedAt: null,
    revokedDeviceCount: 0,
    deletable: true,
    ...overrides,
  };
}

(async () => {
  console.log('=== 拉黑数渲染（任何状态都必须显示） ===');
  const cases = [
    { label: '未使用 + 拉黑 1 台', status: 'available', count: 1, expect: '拉黑 1 台' },
    { label: '已绑定 + 拉黑 1 台', status: 'used', count: 1, expect: '拉黑 1 台' },
    { label: '已封禁 + 拉黑 2 台', status: 'revoked', count: 2, expect: '拉黑 2 台' },
  ];

  for (const item of cases) {
    const env = createEnv([
      makeCode({
        status: item.status,
        revokedDeviceCount: item.count,
        boundDevicePrefix: item.status === 'used' ? 'abcd1234' : null,
      }),
    ]);
    await flush();
    const rows = env.document.getElementById('codeRows').children;
    assert.equal(rows.length, 1, `${item.label}: 应渲染 1 行`);
    const rowText = textOf(rows[0]);
    assert(
      rowText.includes(item.expect),
      `${item.label}: 期望包含「${item.expect}」，实际: ${rowText}`
    );
    console.log(`  ✓ ${item.label} → 「${item.expect}」`);
  }

  console.log('=== 未拉黑时不显示提示 ===');
  const envZero = createEnv([makeCode({ revokedDeviceCount: 0 })]);
  await flush();
  const zeroText = textOf(envZero.document.getElementById('codeRows').children[0]);
  assert(!zeroText.includes('拉黑'), `未拉黑不应出现「拉黑」，实际: ${zeroText}`);
  console.log('  ✓ 拉黑 0 台时无提示');

  console.log('=== 操作按钮仍然按状态渲染 ===');
  const envRevoked = createEnv([
    makeCode({ status: 'revoked', revokedDeviceCount: 1 }),
  ]);
  await flush();
  const revokedText = textOf(envRevoked.document.getElementById('codeRows').children[0]);
  assert(revokedText.includes('允许换机'), '封禁行应有「允许换机」');
  assert(revokedText.includes('彻底删除'), '可删码应有「彻底删除」');
  console.log('  ✓ 封禁行含「允许换机」「彻底删除」');

  const envUsed = createEnv([
    makeCode({ status: 'used', boundDevicePrefix: 'abcd1234', revokedDeviceCount: 1 }),
  ]);
  await flush();
  const usedText = textOf(envUsed.document.getElementById('codeRows').children[0]);
  assert(usedText.includes('解绑 / 封禁'), '已绑定行应有「解绑 / 封禁」');
  console.log('  ✓ 已绑定行含「解绑 / 封禁」');

  console.log('');
  console.log('后台列表渲染测试通过。');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
