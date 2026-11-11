'use strict';

/**
 * 错词本纯逻辑测试：不依赖浏览器，直接 require 前端模块。
 * 注意：错词本以「单词」为唯一键（服务端复盘只下发 word，没有 id）。
 */

const assert = require('assert/strict');
const WrongBook = require('../public/wrongbook');

let passed = 0;
function ok(label, condition) {
  assert(condition, label);
  passed += 1;
  console.log('  ✓ ' + label);
}

console.log('=== 1. 基础读写 ===');
ok('空存储返回空错词本', WrongBook.count(WrongBook.load(null)) === 0);
ok('损坏的 JSON 视为空错词本', WrongBook.count(WrongBook.parse('{not json')) === 0);
ok('非数组结构视为空错词本', WrongBook.count(WrongBook.parse('{"words":"oops"}')) === 0);

const storage = (() => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
})();

console.log('=== 2. 答错入库（回归：复盘条目没有 id 也要能存） ===');
// 这是服务端真实下发的复盘条目形状：没有 id，只有 word。
const serverReviewEntry = {
  index: 1,
  word: 'breast',
  level: 'CET4',
  meanings: [
    { pos: 'n.', meaning: '胸部', frequencyRank: 1 },
    { pos: 'n.', meaning: '胸怀', frequencyRank: 2 },
  ],
  primary: { pos: 'n.', meaning: '胸部', frequencyRank: 1 },
  correctOption: 'n. 胸部',
  statuses: { p1: 'wrong' },
  mistakes: { p1: true },
};

const first = WrongBook.addMistakes(WrongBook.emptyBook(), [
  { word: serverReviewEntry.word, level: serverReviewEntry.level },
  { word: 'ability', level: 'CET4' },
]);
ok('无 id 的复盘条目能正常入库', WrongBook.count(first.book) === 2);
ok('added 计数为 2', first.added === 2 && first.updated === 0);
ok('按单词能查到条目', WrongBook.has(first.book, 'breast'));
ok(
  '入库后序列化形如 {"version":1,"words":[...]}',
  JSON.parse(WrongBook.serialize(first.book)).words.length === 2
);

const again = WrongBook.addMistakes(first.book, [
  { word: 'breast', level: 'CET4' },
]);
ok('重复答错不新增词条', WrongBook.count(again.book) === 2);
ok('重复答错计入 updated', again.added === 0 && again.updated === 1);
ok(
  '重复答错后连对清零且错误次数累加',
  WrongBook.get(again.book, 'breast').wrongCount === 2 &&
    WrongBook.get(again.book, 'breast').streak === 0
);
ok('大小写不敏感（Breast 视为同一个词）', WrongBook.has(first.book, 'Breast'));

console.log('=== 3. 连对计数与掌握移除 ===');
let book = WrongBook.addMistakes(WrongBook.emptyBook(), [
  { word: 'abandon', level: 'CET4' },
]).book;

const c1 = WrongBook.markCorrect(book, 'abandon');
ok('第 1 次答对：streak=1 且未掌握', c1.streak === 1 && c1.mastered === false);
const c2 = WrongBook.markCorrect(c1.book, 'abandon');
ok('第 2 次答对：streak=2 且未掌握', c2.streak === 2 && c2.mastered === false);
ok('第 2 次答对后单词仍在错词本', WrongBook.has(c2.book, 'abandon'));
const c3 = WrongBook.markCorrect(c2.book, 'abandon');
ok('第 3 次答对：判定掌握', c3.streak === 3 && c3.mastered === true);
ok('掌握后从错词本移除', WrongBook.has(c3.book, 'abandon') === false);
ok('掌握移除后错词本为空', WrongBook.count(c3.book) === 0);

console.log('=== 4. 中途答错清零 ===');
let b2 = WrongBook.addMistakes(WrongBook.emptyBook(), [
  { word: 'absence', level: 'CET4' },
]).book;
b2 = WrongBook.markCorrect(b2, 'absence').book;
b2 = WrongBook.markCorrect(b2, 'absence').book;
ok('先连对 2 次', WrongBook.get(b2, 'absence').streak === 2);
const w1 = WrongBook.markWrong(b2, 'absence');
ok('答错后 streak 归零', w1.streak === 0 && WrongBook.get(w1.book, 'absence').streak === 0);
ok('答错后单词仍在错词本', WrongBook.has(w1.book, 'absence'));
const c4 = WrongBook.markCorrect(w1.book, 'absence');
ok('清零后重新累计为 1，而不是 3', c4.streak === 1 && c4.mastered === false);

console.log('=== 5. 存储适配 ===');
WrongBook.save(storage, c1.book);
ok('save/load 往返一致', WrongBook.count(WrongBook.load(storage)) === 1);
ok('存储键名固定', WrongBook.STORAGE_KEY === 'cetArena.wrongBook.v1');
ok('掌握门槛为 3', WrongBook.MASTERY_STREAK === 3);

console.log('=== 6. 边界情况 ===');
ok('未知单词答对不崩溃', WrongBook.markCorrect(c1.book, 'nope').mastered === false);
ok('未知单词答错不崩溃', WrongBook.markWrong(c1.book, 'nope').streak === 0);
ok('无效条目被忽略', WrongBook.addMistakes(WrongBook.emptyBook(), [null, {}, { word: '' }]).added === 0);
ok(
  '同一批重复单词只入一条',
  WrongBook.count(
    WrongBook.addMistakes(WrongBook.emptyBook(), [
      { word: 'test', level: 'CET4' },
      { word: 'Test', level: 'CET4' },
    ]).book
  ) === 1
);
ok(
  '兼容旧版字符串数组格式',
  WrongBook.count(WrongBook.parse('{"version":1,"words":["breast","abandon"]}')) === 2
);
ok(
  '兼容旧版带 id 的对象格式',
  WrongBook.count(
    WrongBook.parse('{"version":1,"words":[{"id":"cet4_0001","word":"abandon"}]}')
  ) === 1
);

console.log('');
console.log(`错词本测试全部通过（${passed} 项断言）。`);
