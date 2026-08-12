// The red mark on a record worth noticing: app_tables.config.flag = {field, equals, label}.
// The rule is table-agnostic — its first use flags "not a university student" on Education
// details, but nothing in flagTagHtml knows that, and these tests are written the same way:
// a made-up table and a made-up field, so the day the config points somewhere else the tests
// still describe the rule rather than the one form that happened to need it first.
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

// flagTagHtml escapes with esc(), so esc comes along or the label test proves nothing.
const { flagTagHtml } = load('index.html', ['flagTagHtml', 'esc']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const FIELD = 'f-student';
const table = { config: { flag: { field: FIELD, equals: ['No'], label: 'Not a student' } } };

// ---- when the mark applies ----
t('the flagged answer gets the tag', () => {
  const h = flagTagHtml(table, { [FIELD]: 'No' });
  assert.ok(h.includes('flag-tag'), 'expected a flag-tag span, got: ' + h);
  assert.ok(h.includes('Not a student'), 'expected the configured label, got: ' + h);
});
t('any answer in the list counts, not just the first', () => {
  const many = { config: { flag: { field: FIELD, equals: ['No', 'Left', 'Unknown'], label: 'Check' } } };
  assert.ok(flagTagHtml(many, { [FIELD]: 'Left' }).includes('flag-tag'));
});
// A "no" that arrived through an import is the same answer as a "No" typed into the form.
t('matching ignores case', () => {
  assert.ok(flagTagHtml(table, { [FIELD]: 'no' }).includes('flag-tag'));
  assert.ok(flagTagHtml(table, { [FIELD]: 'NO' }).includes('flag-tag'));
});

// ---- when it does not ----
t('the other answer gets nothing', () => assert.strictEqual(flagTagHtml(table, { [FIELD]: 'Yes' }), ''));
// The mark means "this answer needs noticing", so no answer is not the mark. An unanswered
// question would otherwise flag every record that simply has not been filled in yet.
t('a blank answer never trips it', () => {
  assert.strictEqual(flagTagHtml(table, { [FIELD]: '' }), '');
  assert.strictEqual(flagTagHtml(table, { [FIELD]: null }), '');
  assert.strictEqual(flagTagHtml(table, {}), '');
});
t('no flag configured = no tag on any record', () => {
  assert.strictEqual(flagTagHtml({ config: {} }, { [FIELD]: 'No' }), '');
  assert.strictEqual(flagTagHtml({ config: { flag: {} } }, { [FIELD]: 'No' }), '');
});
// Every table written before this existed has no config.flag, and the record panel calls this
// with a null table while a table is still loading — neither may throw.
t('a null table and null data are answers, not crashes', () => {
  assert.strictEqual(flagTagHtml(null, { [FIELD]: 'No' }), '');
  assert.strictEqual(flagTagHtml(table, null), '');
});

// ---- the label is admin-typed text, so it is escaped ----
t('the label cannot inject markup', () => {
  const evil = { config: { flag: { field: FIELD, equals: ['No'], label: '<img src=x onerror=alert(1)>' } } };
  const h = flagTagHtml(evil, { [FIELD]: 'No' });
  assert.ok(!h.includes('<img'), 'raw markup survived escaping: ' + h);
  assert.ok(h.includes('&lt;img'), 'expected the label escaped, got: ' + h);
});
t('a flag with no label still says something', () => {
  const bare = { config: { flag: { field: FIELD, equals: ['No'] } } };
  assert.ok(flagTagHtml(bare, { [FIELD]: 'No' }).includes('Flagged'));
});

console.log(n + ' tests passed');
