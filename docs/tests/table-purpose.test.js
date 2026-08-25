// What a table is for, asked once at creation. The picker is the whole point of this
// feature: it is the moment somebody finds out that a checklist has no public link and a
// scorecard has points. These tests hold the mapping steady, because the type decides
// which parts of the builder somebody is shown, and getting it wrong is a table built
// with the wrong half of the editor.
//
// The marker is config.scorecard, deliberately NOT config.scored, because the old
// imported engine reads app_tables.config ? 'scoring' and two keys one letter apart is a
// trap. apply_scores() and score_submission() therefore cannot see each other's tables.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  (?:var ' + name + ' = \\[[\\s\\S]*?\\n  \\];|function ' + name + '\\s*\\([\\s\\S]*?\\n  \\})', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find ' + name + ' in ' + file);
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

const { TABLE_PURPOSES, purposeOf, purposeConfig } =
  load('index.html', ['TABLE_PURPOSES', 'purposeOf', 'purposeConfig']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg ||
  ('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)));

t('three types are offered', () => {
  assert.strictEqual(TABLE_PURPOSES.length, 3);
});
t('every type says what it is in plain words', () => {
  TABLE_PURPOSES.forEach(p => {
    assert.ok(p.label && p.blurb, 'a type with no label or blurb teaches nobody: ' + JSON.stringify(p));
    assert.ok(!/—/.test(p.label + p.blurb), 'house style: no em-dashes in copy');
  });
});
t('a plain form is what the app already made', () => {
  same(purposeConfig('form'), { kind: 'form', scorecard: false });
});
t('a scorecard is a form that scores', () => {
  same(purposeConfig('scorecard'), { kind: 'form', scorecard: true });
});
t('a checklist is a task and has no public form', () => {
  same(purposeConfig('checklist'), { kind: 'task', scorecard: false });
});
t('an unknown type falls back to a plain form rather than nothing', () => {
  same(purposeConfig('nonsense'), { kind: 'form', scorecard: false });
  assert.strictEqual(purposeOf('nonsense').v, 'form');
});
t('the fallback also covers an empty pick', () => {
  assert.strictEqual(purposeOf('').v, 'form');
  assert.strictEqual(purposeOf(undefined).v, 'form');
});
t('the marker is scorecard, never scored, so the old engine cannot see it', () => {
  assert.ok(!('scored' in purposeConfig('scorecard')),
    'config.scored is one letter from the old engine config.scoring: use scorecard');
});

if (!process.exitCode) console.log(n + ' passed');
