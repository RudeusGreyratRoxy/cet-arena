'use strict';

/**
 * 前端契约测试：app.js 里引用的每个 DOM id 都必须真实存在于 index.html，
 * 否则页面运行到一半会抛 TypeError（这类错误很难靠肉眼发现）。
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const { APP_VERSION } = require('../src/version');

const htmlIds = new Set();
for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
  htmlIds.add(match[1]);
}

const referenced = new Set();
for (const match of app.matchAll(/getElementById\('([^']+)'\)/g)) {
  referenced.add(match[1]);
}

const missing = [...referenced].filter((id) => !htmlIds.has(id));
assert.deepEqual(missing, [], `app.js 引用了不存在的 DOM id：${missing.join(', ')}`);

// 关键交互元素必须存在，防止改名后静默失效。
const required = [
  'wrongChallengeBtn',
  'wrongBookCount',
  'wrongBookHint',
  'view-solo',
  'soloPlay',
  'soloSummary',
  'soloOptions',
  'soloFeedback',
  'soloReveal',
  'answerReveal',
  'vipClearBtn',
  'soloDots',
  'soloStreakValue',
  'soloExitBtn',
  'soloAgainBtn',
  'soloHomeBtn',
  'soloSpeakBtn',
  'audioUnlockBtn',
  'contactFab',
  'contactOverlay',
  'contactInput',
  'contactSubmitBtn',
  'contactCount',
];
const absent = required.filter((id) => !htmlIds.has(id));
assert.deepEqual(absent, [], `错词挑战缺少必要 DOM 节点：${absent.join(', ')}`);

// wrongbook.js 必须在 app.js 之前加载。
const wrongbookIndex = html.indexOf('/wrongbook.js');
const appIndex = html.indexOf('/app.js');
assert(wrongbookIndex > -1, 'index.html 未加载 wrongbook.js');
assert(appIndex > -1, 'index.html 未加载 app.js');
assert(wrongbookIndex < appIndex, 'wrongbook.js 必须在 app.js 之前加载');

// 静态资源必须带版本参数，且与后端 APP_VERSION 一致，
// 否则浏览器会继续用 7 天缓存里的旧脚本（曾导致「点创建房间没弹 VIP 遮罩」）。
const assetVersions = [...html.matchAll(/\?v=([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
assert(assetVersions.length >= 3, 'index.html 的静态资源应带 ?v= 版本参数');
assert(
  assetVersions.every((version) => version === APP_VERSION),
  `静态资源版本必须与 APP_VERSION 一致：${assetVersions.join(',')} vs ${APP_VERSION}`
);

console.log(`  ✓ ${referenced.size} 个 DOM id 引用全部存在`);
console.log('  ✓ 错词挑战关键节点齐全');
console.log('  ✓ 脚本加载顺序正确');
console.log(`  ✓ 静态资源版本一致（${APP_VERSION}）`);
console.log('');
console.log('前端契约测试通过。');
