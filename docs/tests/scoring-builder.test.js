// The builder's own arithmetic. The total under the question list is the number somebody
// is really building, and it has to be right while they are still typing: a total that
// only becomes true on save is a total nobody can trust.
//
// builderTotalPoints takes the same {type, options, scoring} shape the save writes and the
// database stores, so the number on screen and the number behind the percentage are
// produced by one function rather than by two that agree only by luck.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const { builderTotalPoints, scoringToInputs } =
  load('index.html', ['builderTotalPoints', 'scoringToInputs', 'questionMaxPoints', 'choicePoints']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

t('the total is the sum of every question maximum', () => {
  const rows = [
    { type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 4 } },
    { type: 'dropdown', scoring: { rule: 'choices' },
      options: [{ en: 'Excellent', points: 3 }, { en: 'Poor', points: 0 }] }
  ];
  assert.strictEqual(builderTotalPoints(rows), 7);
});
t('unpriced questions add nothing', () => {
  assert.strictEqual(builderTotalPoints([{ type: 'short_text' }]), 0);
});
t('an empty form totals zero rather than NaN', () => {
  assert.strictEqual(builderTotalPoints([]), 0);
  assert.strictEqual(builderTotalPoints(null), 0);
});
t('an N/A choice does not raise the maximum', () => {
  const rows = [{ type: 'dropdown', scoring: { rule: 'choices' },
                  options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] }];
  assert.strictEqual(builderTotalPoints(rows), 3);
});
t('a multi-select contributes all its priced choices', () => {
  const rows = [{ type: 'multi_select', scoring: { rule: 'choices' },
                  options: [{ en: 'A', points: 2 }, { en: 'B', points: 1 }] }];
  assert.strictEqual(builderTotalPoints(rows), 3);
});

// ---- filling a saved question back into the row ----
t('a saved rule comes back as inputs', () => {
  const i = scoringToInputs({ rule: 'threshold', op: '<', value: 5, points: 2, section: 'Kitchen' });
  assert.strictEqual(i.points, 2);
  assert.strictEqual(i.op, '<');
  assert.strictEqual(i.value, 5);
  assert.strictEqual(i.section, 'Kitchen');
});
t('no rule at all comes back as an empty points box, not a zero', () => {
  // A zero in the box would read as "this question is worth nothing", which is a rule.
  // No rule at all has to come back blank or every unscored question becomes scored.
  const i = scoringToInputs(null);
  assert.strictEqual(i.points, '');
});
t('a choices rule has no points of its own, because the choices carry them', () => {
  assert.strictEqual(scoringToInputs({ rule: 'choices' }).points, '');
});
t('the answer that earns comes back for a yes/no', () => {
  assert.strictEqual(scoringToInputs({ rule: 'equals', earn: ['Yes'], points: 4 }).earn, 'Yes');
});

if (!process.exitCode) console.log(n + ' passed');
