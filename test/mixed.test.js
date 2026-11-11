'use strict';

const assert = require('assert/strict');
const { loadWords, buildQuestions, assertQuestionShape } = require('../src/wordBank');

const words = loadWords();
const POS_OPTION = /^(?:v|vt|vi|aux|n|pron|num|adj|a|adv|ad|prep|conj|int|art|pl)\.\s/;
const ENGLISH_WORD = /^[a-z]+$/;
const LISTEN_LABEL = '点击喇叭听发音，选择正确的英文单词';

const totals = { en2zh: 0, zh2en: 0, listen: 0 };

function countTypes(questions) {
  return questions.reduce(
    (counts, question) => {
      counts[question.type] += 1;
      return counts;
    },
    { en2zh: 0, zh2en: 0, listen: 0 }
  );
}

for (let round = 0; round < 2000; round += 1) {
  const questions = buildQuestions(words, 10, 'CET4');
  assert.equal(new Set(questions.map((question) => question.word)).size, 10);
  const counts = countTypes(questions);
  assert.equal(counts.en2zh, 5, '10 题局必须固定 5 道英译中');
  assert.equal(counts.zh2en, 3, '10 题局必须固定 3 道中译英');
  assert.equal(counts.listen, 2, '10 题局必须固定 2 道听音选词');

  for (const question of questions) {
    assertQuestionShape(question);
    totals[question.type] += 1;

    if (question.type === 'en2zh') {
      assert(ENGLISH_WORD.test(question.prompt), '英译中题干必须是英文单词');
      assert.equal(question.promptLabel, '选择正确的中文释义');
      assert(question.options.every((option) => POS_OPTION.test(option)));
      assert(question.options.every((option) => !ENGLISH_WORD.test(option)));
    } else if (question.type === 'zh2en') {
      assert(POS_OPTION.test(question.prompt), '中译英题干必须是带词性的中文');
      assert.equal(question.promptLabel, '选择正确的英文单词');
      assert(question.options.every((option) => ENGLISH_WORD.test(option)));
      assert(question.options.every((option) => !POS_OPTION.test(option)));
      assert(question.options.includes(question.word));
    } else {
      assert.equal(question.type, 'listen');
      assert.equal(question.prompt, '', '听音选词不得显示题干文字');
      assert.equal(question.promptLabel, LISTEN_LABEL);
      assert(question.options.every((option) => ENGLISH_WORD.test(option)));
      assert(question.options.every((option) => !POS_OPTION.test(option)));
      assert(question.options.includes(question.word), '发声单词必须在选项中');
      assert.equal(question.correctText, question.word);
    }
  }
}

for (let round = 0; round < 500; round += 1) {
  const questions = buildQuestions(words, 25, 'CET4');
  assert.equal(new Set(questions.map((question) => question.word)).size, 25);
  const counts = countTypes(questions);
  assert.equal(counts.listen, 5, '25 题局必须固定 5 道听音选词');
  assert([12, 13].includes(counts.en2zh), '25 题局英译中数量必须是 12 或 13');
  assert.equal(
    counts.zh2en,
    25 - counts.en2zh - counts.listen,
    '25 题局中译英数量必须与英译中互补'
  );
  questions.forEach(assertQuestionShape);
  totals.en2zh += counts.en2zh;
  totals.zh2en += counts.zh2en;
  totals.listen += counts.listen;
}

const totalQuestions = Object.values(totals).reduce((sum, value) => sum + value, 0);
assert(totalQuestions > 30000);
assert(totals.listen > 0);

console.log(
  `  ✓ 混合题型压力测试：${totalQuestions} 道题（英译中 ${totals.en2zh} / 中译英 ${totals.zh2en} / 听音选词 ${totals.listen}），题干与选项零错配`
);
console.log('  ✓ 10 题固定 5/3/2；25 题固定 5 道听音选词，英译中 12/13 道随机');
console.log('\n混合题型测试全部通过。');
