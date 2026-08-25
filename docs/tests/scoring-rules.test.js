// What a score means. Every case here is a way the arithmetic could be wrong about
// somebody's work: a question they were never asked counting against them, a question
// they skipped quietly forgiven, or a total that moves when nothing about the form did.
//
// The rule, decided 2026-08-25: a question that was never asked leaves the total, whether
// it was hidden by "ask only if" or answered N/A. A question that was asked and missed
// stays in the total and earns nothing.
//
// These rules are mirrored in SQL by score_submission() in docs/sql/scoring.sql, because
// the browser needs them for the live breakdown and the database needs them so that a
// public submit, a staff edit, an added record and an import all agree. If the two ever
// disagree, both have to be fixed: the SQL is what is stored, the JS is what people see.
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

// naChoices and condMet are not tested directly, but questionApplies calls both, so they
// have to come along or the whole file dies on a ReferenceError rather than a failed assert.
const API = load('index.html',
  ['choicePoints', 'questionMaxPoints', 'naChoices', 'questionApplies', 'questionEarned',
   'scorecardTotals', 'condMet']);
const { choicePoints, questionMaxPoints, questionApplies, questionEarned, scorecardTotals } = API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// Objects built inside the vm carry that realm's prototype, so deepStrictEqual rejects
// them against a literal on reference-equality alone. Compare the shape instead.
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg ||
  ('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)));

// A scored yes/no worth 4, and a priced three-way choice worth 3 at most.
const Q_CLEAN = { id: 'q1', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 4 } };
const Q_RATE = {
  id: 'q2', type: 'dropdown', scoring: { rule: 'choices' },
  options: [{ en: 'Excellent', points: 3 }, { en: 'Acceptable', points: 1 }, { en: 'Poor', points: 0 }]
};
const Q_PLAIN = { id: 'q3', type: 'short_text' };   // no scoring: an ordinary question

// ---- one question at a time ----
t('a priced choice list is worth its dearest choice', () => {
  assert.strictEqual(questionMaxPoints(Q_RATE), 3);
});
t('a flat question is worth what it says', () => {
  assert.strictEqual(questionMaxPoints(Q_CLEAN), 4);
});
t('an unscored question is worth nothing', () => {
  assert.strictEqual(questionMaxPoints(Q_PLAIN), 0);
});
t('each choice earns its own price', () => {
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Excellent' }), 3);
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Acceptable' }), 1);
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Poor' }), 0);
});
t('the earning answer takes the points and the other does not', () => {
  assert.strictEqual(questionEarned(Q_CLEAN, { q1: 'Yes' }), 4);
  assert.strictEqual(questionEarned(Q_CLEAN, { q1: 'No' }), 0);
});
t('a choice nobody priced earns nothing rather than NaN', () => {
  const q = { id: 'q', type: 'dropdown', scoring: { rule: 'choices' }, options: [{ en: 'Fine' }] };
  assert.strictEqual(questionEarned(q, { q: 'Fine' }), 0);
  assert.strictEqual(questionMaxPoints(q), 0);
});
t('an answer that is not one of the choices earns nothing', () => {
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Something the form never offered' }), 0);
});

// ---- multi-select adds up, and can reach full marks ----
const Q_MULTI = {
  id: 'm', type: 'multi_select', scoring: { rule: 'choices' },
  options: [{ en: 'Gloves', points: 2 }, { en: 'Hairnet', points: 1 }, { en: 'Apron', points: 1 }]
};
t('a multi-select is worth all its priced choices together', () => {
  assert.strictEqual(questionMaxPoints(Q_MULTI), 4);
});
t('ticking some earns those', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: 'Gloves, Apron' }), 3);
});
t('ticking everything is full marks', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: 'Gloves, Hairnet, Apron' }), 4);
});
t('ticking nothing earns nothing', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: '' }), 0);
});

// ---- a number over or under a line ----
const Q_FRIDGE = { id: 'f', type: 'number', scoring: { rule: 'threshold', op: '<', value: 5, points: 2 } };
t('a number under the line earns the points', () => {
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '3' }), 2);
});
t('a number over the line earns nothing', () => {
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '7' }), 0);
});
t('a blank number earns nothing rather than passing as zero', () => {
  // Airtable read an empty number as 0 and gave the point away. Deliberately not copied:
  // this is a new form and a non-answer should not pass.
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '' }), 0);
});

// ---- the denominator rule ----
t('a question that was asked and missed stays in the total and earns nothing', () => {
  assert.strictEqual(questionApplies(Q_CLEAN, {}), true);
  assert.strictEqual(questionEarned(Q_CLEAN, {}), 0);
});
t('an N/A answer takes the question out of the total', () => {
  const q = {
    id: 'k', type: 'dropdown', scoring: { rule: 'choices' },
    options: [{ en: 'Clean', points: 2 }, { en: 'Not applicable', na: true }]
  };
  assert.strictEqual(questionApplies(q, { k: 'Not applicable' }), false);
  assert.strictEqual(questionApplies(q, { k: 'Clean' }), true);
});
t('a question hidden by "ask only if" leaves the total', () => {
  const q = { id: 'k', type: 'yesno', show_if: { field: 'g', equals: ['Yes'] },
              scoring: { rule: 'equals', earn: ['Yes'], points: 5 } };
  assert.strictEqual(questionApplies(q, { g: 'No' }), false, 'hidden question must leave the total');
  assert.strictEqual(questionApplies(q, { g: 'Yes' }), true);
});
t('an unscored question never enters the total, answered or not', () => {
  assert.strictEqual(questionApplies(Q_PLAIN, { q3: 'anything' }), false);
});
t('a multi-select answered only with N/A choices leaves the total', () => {
  const q = {
    id: 'm2', type: 'multi_select', scoring: { rule: 'choices' },
    options: [{ en: 'Gloves', points: 2 }, { en: 'Not applicable', na: true }]
  };
  assert.strictEqual(questionApplies(q, { m2: 'Not applicable' }), false);
  assert.strictEqual(questionApplies(q, { m2: 'Gloves, Not applicable' }), true);
});

// ---- the whole record ----
t('the worked example: 60 of 64 reads as 94%', () => {
  // 20 questions worth 3 each, plus one worth 4, is 64. Answering the 4 and 56 of the 60.
  const fields = [Q_CLEAN];
  const data = { q1: 'Yes' };
  for (let i = 0; i < 20; i++) {
    const id = 'r' + i;
    fields.push({ id, type: 'dropdown', scoring: { rule: 'choices' },
                  options: [{ en: 'Full', points: 3 }, { en: 'Part', points: 1 }, { en: 'None', points: 0 }] });
    // 18 full (54) + 2 part (2) = 56, plus the 4 above = 60
    data[id] = i < 18 ? 'Full' : 'Part';
  }
  const r = scorecardTotals(fields, data);
  assert.strictEqual(r.possible, 64, 'total should be 64, got ' + r.possible);
  assert.strictEqual(r.earned, 60, 'earned should be 60, got ' + r.earned);
  assert.strictEqual(Math.round(r.earned / r.possible * 100), 94);
});
t('an N/A question shrinks the total for that record only', () => {
  const na = { id: 'na', type: 'dropdown', scoring: { rule: 'choices' },
               options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] };
  const fields = [Q_CLEAN, na];
  same(scorecardTotals(fields, { q1: 'Yes', na: 'Clean' }), { earned: 7, possible: 7 });
  same(scorecardTotals(fields, { q1: 'Yes', na: 'Not applicable' }), { earned: 4, possible: 4 });
});
t('a record where everything was N/A produces no total, not a divide by zero', () => {
  const na = { id: 'na', type: 'dropdown', scoring: { rule: 'choices' },
               options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] };
  const r = scorecardTotals([na], { na: 'Not applicable' });
  assert.strictEqual(r.possible, 0);
  assert.strictEqual(r.earned, 0);
});
t('a table with no scored questions at all totals nothing', () => {
  same(scorecardTotals([Q_PLAIN], { q3: 'hello' }), { earned: 0, possible: 0 });
});
t('renaming a choice keeps its price, because the price is on the choice', () => {
  const renamed = JSON.parse(JSON.stringify(Q_RATE));
  renamed.options[0].en = 'Outstanding';
  assert.strictEqual(questionMaxPoints(renamed), 3);
  assert.strictEqual(questionEarned(renamed, { q2: 'Outstanding' }), 3);
});
t('no fields and no data is a total of nothing, not a crash', () => {
  same(scorecardTotals(null, null), { earned: 0, possible: 0 });
});

if (!process.exitCode) console.log(n + ' passed');
