// New record: the rules a record typed by hand follows. They are the public form's rules,
// not new ones — a question that does not apply carries no answer, an empty answer stores no
// key at all, and only the questions actually being asked can be required. The point of
// testing them here is that this path has no form page to eyeball: it writes straight into
// app_submissions, so a record it builds wrongly is a bad row in a live table.
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

// newRecordData leans on the "other" helpers, so they come along by name too — if any of
// them is renamed this file fails loudly instead of quietly testing nothing.
const A = load('index.html', [
  'newRecordVisible', 'newRecordMissing', 'newRecordData',
  'condMet', 'isOtherChoice', 'otherKeyFor'
]);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// A form shaped like the Education details table: a gate, a question behind it, and a
// question behind that one.
const uni    = { id: 'f-uni', label: 'Did you go to university?', type: 'yesno' };
const which  = { id: 'f-which', label: 'Which university?', type: 'short_text', required: true, show_if: { field: 'f-uni', equals: ['Yes'] } };
const gpa    = { id: 'f-gpa', label: 'GPA', type: 'number', required: true, show_if: { field: 'f-which', equals: ['AUB'] } };
const name   = { id: 'f-name', label: 'Name', type: 'short_text', required: true };
const FIELDS = [name, uni, which, gpa];

// ---- which questions are being asked ----
t('a question with no condition is always asked', () => {
  assert.strictEqual(A.newRecordVisible(FIELDS, {})['f-name'], true);
});
t('a gated question is not asked until its answer matches', () => {
  assert.strictEqual(A.newRecordVisible(FIELDS, { 'f-uni': 'No' })['f-which'], false);
  assert.strictEqual(A.newRecordVisible(FIELDS, { 'f-uni': 'Yes' })['f-which'], true);
});
t('a question behind a hidden question is hidden too', () => {
  // 'AUB' is typed, but nobody was ever asked which university — so the GPA is not asked
  const vis = A.newRecordVisible(FIELDS, { 'f-uni': 'No', 'f-which': 'AUB' });
  assert.strictEqual(vis['f-which'], false);
  assert.strictEqual(vis['f-gpa'], false);
});
t('the chain opens all the way when every answer matches', () => {
  const vis = A.newRecordVisible(FIELDS, { 'f-uni': 'Yes', 'f-which': 'AUB' });
  assert.strictEqual(vis['f-which'], true);
  assert.strictEqual(vis['f-gpa'], true);
});
t('a record being created keeps no history: an answer does not hold its question open', () => {
  // the record panel deliberately keeps an answered question visible because the answer is
  // real history. A record that does not exist yet has none, so the gate simply wins.
  assert.strictEqual(A.newRecordVisible(FIELDS, { 'f-uni': 'No', 'f-which': 'Yarmouk' })['f-which'], false);
});

// ---- what must be filled in ----
t('a required question that is being asked and is empty is missing', () => {
  const miss = A.newRecordMissing(FIELDS, {}).map(f => f.id);
  assert.deepStrictEqual(miss, ['f-name']);
});
t('a required question that does not apply is NOT missing', () => {
  // this is the whole reason to compute it this way: requiring a question nobody was asked
  // makes the record impossible to save
  const miss = A.newRecordMissing(FIELDS, { 'f-name': 'Ahmad', 'f-uni': 'No' }).map(f => f.id);
  assert.deepStrictEqual(miss, []);
});
t('a required question that does apply is missing until answered', () => {
  const open = { 'f-name': 'Ahmad', 'f-uni': 'Yes' };
  assert.deepStrictEqual(A.newRecordMissing(FIELDS, open).map(f => f.id), ['f-which']);
  open['f-which'] = 'Yarmouk';
  assert.deepStrictEqual(A.newRecordMissing(FIELDS, open).map(f => f.id), []);
});
t('whitespace is not an answer', () => {
  assert.deepStrictEqual(A.newRecordMissing(FIELDS, { 'f-name': '   ' }).map(f => f.id), ['f-name']);
});
t('a required photo is missing until a file is chosen', () => {
  const shot = { id: 'f-pic', label: 'Photo', type: 'photo', required: true };
  assert.deepStrictEqual(A.newRecordMissing([shot], {}, () => null).map(f => f.id), ['f-pic']);
  assert.deepStrictEqual(A.newRecordMissing([shot], {}, () => ({ name: 'a.jpg' })).map(f => f.id), []);
});
t('an optional question left empty is never missing', () => {
  assert.deepStrictEqual(A.newRecordMissing([uni], {}).map(f => f.id), []);
});

// ---- the row that gets stored ----
t('an empty answer stores no key at all', () => {
  const d = A.newRecordData(FIELDS, { 'f-name': 'Ahmad', 'f-uni': '' });
  assert.deepStrictEqual(Object.keys(d), ['f-name']);
});
t('answers are trimmed', () => {
  assert.strictEqual(A.newRecordData(FIELDS, { 'f-name': '  Ahmad  ' })['f-name'], 'Ahmad');
});
t('an answer to a question that does not apply is dropped, not stored', () => {
  // Yes, then No: the "which university" typed in between must not travel with the record
  const d = A.newRecordData(FIELDS, { 'f-name': 'Ahmad', 'f-uni': 'No', 'f-which': 'Yarmouk' });
  assert.deepStrictEqual(Object.keys(d).sort(), ['f-name', 'f-uni']);
});
t('a photo is stored as the path it uploaded to', () => {
  const shot = { id: 'f-pic', label: 'Photo', type: 'photo' };
  const d = A.newRecordData([name, shot], { 'f-name': 'Ahmad' }, { 'f-pic': 'photos/abc.jpg' });
  assert.strictEqual(d['f-pic'], 'photos/abc.jpg');
});
t('a photo field with no file stores nothing', () => {
  const shot = { id: 'f-pic', label: 'Photo', type: 'photo' };
  const d = A.newRecordData([name, shot], { 'f-name': 'Ahmad' }, { 'f-pic': null });
  assert.deepStrictEqual(Object.keys(d), ['f-name']);
});

// ---- the free text behind an "other" choice ----
const src = { id: 'f-src', label: 'How did you hear?', type: 'dropdown',
              options: [{ en: 'Instagram' }, { en: 'Something else', other: true }] };
t('free text is kept when the choice is an "other" choice', () => {
  const d = A.newRecordData([src], { 'f-src': 'Something else' }, {}, { 'f-src': 'a friend' });
  assert.strictEqual(d[A.otherKeyFor(src)], 'a friend');
});
t('free text is dropped when the choice moves off "other"', () => {
  const d = A.newRecordData([src], { 'f-src': 'Instagram' }, {}, { 'f-src': 'a friend' });
  assert.strictEqual(d[A.otherKeyFor(src)], undefined);
  assert.strictEqual(d['f-src'], 'Instagram');
});

// ---- the shapes that must not throw ----
// (objects crossing the vm boundary have a different Object.prototype, so these compare
//  keys rather than using deepStrictEqual, which would fail on reference-equality alone)
t('a table with no fields builds an empty row', () => {
  assert.deepStrictEqual(Object.keys(A.newRecordData([], {})), []);
  assert.strictEqual(A.newRecordMissing([], {}).length, 0);
});
t('missing arguments do not throw', () => {
  assert.deepStrictEqual(Object.keys(A.newRecordData(null, null)), []);
  assert.strictEqual(A.newRecordMissing(null, null).length, 0);
  assert.deepStrictEqual(Object.keys(A.newRecordVisible(null, null)), []);
});
t('a condition pointing at a deleted field hides the question, as on the public form', () => {
  // Not the behaviour I first assumed. A condition names a field id; if that field is
  // deleted from the table, every question gated on it is hidden and cannot be answered.
  // The public form's computeVisible does exactly the same — it only ever reads answers for
  // questions it rendered — and the two copies of this rule agreeing matters more than
  // either one being cleverer. Worth knowing when deleting a field from a table that has
  // conditional questions.
  const orphan = { id: 'f-x', type: 'short_text', show_if: { field: 'f-gone', equals: ['Yes'] } };
  assert.strictEqual(A.newRecordVisible([orphan], {})['f-x'], false);
  assert.strictEqual(A.newRecordVisible([orphan], { 'f-gone': 'Yes' })['f-x'], false);
});

// ---- What the label says, and that it is not printed as markup ------------
// Reported from the screen: the create panel showed
//   Event name <span style="color:var(--silver);">*</span>
// as words. The marker was being appended to the label STRING, and edRow escapes the
// label — as it must, since a question's name is typed by a person. Passed as a flag
// instead, so the marker is markup and the name is still escaped.
const SRC = fs.readFileSync('index.html', 'utf8');
const ER = (function () {
  const js = scripts('index.html');
  const ctx = { console, esc: s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) };
  vm.createContext(ctx);
  new vm.Script('(function(){' + grab(js, 'edRow', 'index.html') + '\n this.edRow = edRow;}).call(this)')
    .runInContext(ctx);
  return ctx.edRow;
})();

t('a required question is marked, and the marker is markup rather than words', () => {
  const h = ER('Event name', '<input>', false, null, false, true);
  assert.ok(/<span class="k-req">required<\/span>/.test(h), h);
  assert.ok(!/&lt;span/.test(h), 'the marker must not come out escaped');
});
t('an optional question carries no marker at all', () => {
  const h = ER('Description', '<input>', false, null, false, false);
  assert.ok(!/k-req/.test(h), h);
  assert.ok(!/required/.test(h), h);
});
t('the label itself is STILL escaped — a question name is typed by a person', () => {
  const h = ER('<img src=x onerror=1>', '<input>', false, null, false, true);
  assert.ok(!/<img/.test(h), 'the fix must not have turned the label into raw markup');
  assert.ok(/&lt;img/.test(h));
});
t('no marker text is ever appended to the label string', () => {
  // The shape of the original bug: `label += '<span ...>'`.
  assert.ok(!/label \+= ['"] ?<span/.test(SRC),
    'appending markup to an escaped label is what printed it as words');
});
t('the marker is passed as a flag from edFieldRowHtml', () => {
  assert.ok(/return edRow\(label, inner,[\s\S]{0,120}?mustAnswer\)/.test(SRC),
    'edRow must receive the required flag, not a pre-marked label');
});
t('only the create panel marks required, because only it refuses a save', () => {
  assert.ok(/opts\.stars && f\.required/.test(SRC),
    'the record panel autosaves and never refuses, so a marker there would be a lie');
});
t('the marker has a style rule, or it renders as unstyled text', () => {
  assert.ok(/\.m-field \.k \.k-req \{/.test(SRC), 'no CSS for .k-req');
});

console.log(n + ' new-record tests passed');
