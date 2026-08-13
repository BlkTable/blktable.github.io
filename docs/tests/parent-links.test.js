// Parent-scoped form links: one public link per RECORD of another table, so one signup form
// can serve many events. The link is the whole handle — the page shows nothing about the
// parent record without a valid token — so these tests cover the two things the browser
// decides for itself: how the link is built, and how the parent's details are read back.
//
// What the server decides (does this token belong to this form's parent table, and is a
// scoped form allowed to accept a submission with no token) is in
// 10-parent-scoped-form-links.sql and is checked by the queries at the foot of that file.
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
function load(file, names, extra) {
  const js = scripts(file);
  const ctx = Object.assign({ console }, extra || {});
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const DASH = load('index.html', ['publicFormLink', 'recordFormLink', 'childTableOf'],
  { customTables: [] });
const FORM = load('f/index.html', ['fmtParentValue']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- building the link ----
t('a record link is the ordinary form link plus the token', () => {
  assert.strictEqual(
    DASH.recordFormLink('event-signup', 'abc123'),
    'https://blktable.blk.jo/f/?t=event-signup&e=abc123');
});
t('the token is url-encoded, so a token can never break the link', () => {
  // the minted alphabet is url-safe, but a token that ever contained a + or / must not
  // silently become a space or a path
  assert.strictEqual(DASH.recordFormLink('s', 'a+b/c=').split('&e=')[1], 'a%2Bb%2Fc%3D');
});
t('the slug is url-encoded too', () => {
  assert.ok(DASH.recordFormLink('a b', 'x').indexOf('t=a%20b') !== -1);
});
t('it is the same page as every other form, not a new one', () => {
  // the whole point: nothing new is deployed for a per-record link
  assert.ok(DASH.recordFormLink('s', 'x').indexOf(DASH.publicFormLink('s')) === 0);
});

// ---- finding the child table ----
// customTables is the dashboard's loaded list; childTableOf reads the children rather than
// storing a pointer on the parent, so declaring a parent is one edit and not two that can
// disagree with each other.
const parent = { id: 'p-1', name: 'Events' };
const child = { id: 'c-1', name: 'Event signups', slug: 'event-signup', config: { parent: { table: 'p-1' } } };
function withTables(list, fn) {
  const api = load('index.html', ['publicFormLink', 'recordFormLink', 'childTableOf'], { customTables: list });
  return fn(api);
}
t('a table with a child finds it', () => {
  withTables([child], api => assert.strictEqual(api.childTableOf(parent).id, 'c-1'));
});
t('a table with no child finds nothing', () => {
  withTables([child], api => assert.strictEqual(api.childTableOf({ id: 'other' }), null));
});
t('a table whose config has no parent key is not anyone\'s child', () => {
  withTables([{ id: 'x', config: {} }, { id: 'y' }], api => assert.strictEqual(api.childTableOf(parent), null));
});
t('no open table means no child', () => {
  withTables([child], api => assert.strictEqual(api.childTableOf(null), null));
});
t('a child pointing at a different table is not this one\'s', () => {
  const other = { id: 'c-2', config: { parent: { table: 'p-9' } } };
  withTables([other], api => assert.strictEqual(api.childTableOf(parent), null));
});

// ---- reading the parent's details on the public page ----
// Asserted by parts rather than as one string: the exact punctuation of a locale format
// varies with the ICU build, and a test that pins it would fail on a different machine
// without anything being wrong.
const hasAll = (s, parts) => parts.every(p => String(s).indexOf(p) !== -1);
t('a date reads the way a person reads one', () => {
  const out = FORM.fmtParentValue({ type: 'date', value: '2026-08-20' });
  assert.ok(hasAll(out, ['Thursday', '20', 'August', '2026']), out);
  assert.ok(out.indexOf('2026-08-20') === -1, 'still showing the raw ISO date: ' + out);
});
t('a date-time still reads as its date', () => {
  const out = FORM.fmtParentValue({ type: 'date', value: '2026-08-20T18:00:00' });
  assert.ok(hasAll(out, ['Thursday', '20', 'August', '2026']), out);
});
t('a value that is not a date is left exactly as it was answered', () => {
  assert.strictEqual(FORM.fmtParentValue({ type: 'short_text', value: 'Abdoun, next to the park' }),
    'Abdoun, next to the park');
});
t('a date field holding something that is not a date is not mangled', () => {
  // an imported answer can be anything; showing it as typed beats showing "Invalid Date"
  assert.strictEqual(FORM.fmtParentValue({ type: 'date', value: 'next Thursday' }), 'next Thursday');
});
t('an impossible date is left as written rather than rolled over', () => {
  assert.strictEqual(FORM.fmtParentValue({ type: 'date', value: '2026-02-31' }), '2026-02-31');
});
t('a missing value reads as empty, not as "null"', () => {
  assert.strictEqual(FORM.fmtParentValue({ type: 'short_text', value: null }), '');
  assert.strictEqual(FORM.fmtParentValue({}), '');
});

console.log(n + ' parent-link tests passed');
