// A half-filled public form survives a refresh. Answers used to live only in the DOM, so
// anything that reloaded the page emptied it — pull-to-refresh, a dropped connection, the
// back button, and the one nobody chooses: a phone discarding the tab while the camera app
// is open, which is exactly what a photo question asks people to do.
//
// What is worth pinning down here is not "it saves", it is the ways a draft can do harm:
// a stale one filling a form somebody thought was fresh, one surviving a submission (the
// next person on a shop tablet would inherit it), one written before anything was typed,
// and a browser that refuses storage taking the form down with it.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
// Pulled out of the page rather than restated here, so a test cannot quietly use a different
// storage key or a different age limit than the page does. Multi-line values (COUNTRIES) end
// at their own closing bracket, single-line ones at the newline.
function grabVar(js, name, file) {
  const multi = js.match(new RegExp('\\n  var ' + name + ' = \\[\\r?\\n[\\s\\S]*?\\n  \\];'));
  if (multi) return multi[0];
  const one = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!one) throw new Error('could not find var ' + name + ' in ' + file);
  return one[0];
}
function load(file, names, vars, extra) {
  const js = scripts(file);
  const ctx = Object.assign({ console }, extra || {});
  vm.createContext(ctx);
  new vm.Script('(function(){' + (vars || []).map(v => grabVar(js, v, file)).join('\n') + '\n' +
    names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

// A localStorage that behaves like the real one, including the browsers that refuse.
function fakeStore(mode) {
  const map = new Map();
  return {
    map,
    get length() { if (mode === 'blocked') throw new Error('denied'); return map.size; },
    key(i) { return [...map.keys()][i]; },
    getItem(k) { if (mode === 'blocked') throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (mode === 'blocked' || mode === 'full') throw new Error('QuotaExceeded'); map.set(k, String(v)); },
    removeItem(k) { if (mode === 'blocked') throw new Error('denied'); map.delete(k); }
  };
}
function api(store) {
  return load('f/index.html',
    ['draftKey', 'draftFresh', 'readDraft', 'writeDraft', 'clearDraft', 'draftAnswers', 'restoreAnswers', 'splitPhone', 'sweepDrafts'],
    ['DRAFT_PREFIX', 'DRAFT_MAX_AGE_MS', 'COUNTRIES'],
    { window: { localStorage: store } });
}

// Objects built inside the vm are not this realm's Object, so deepStrictEqual would fail on
// two identical answer maps. The values are all strings; comparing the JSON is the same test.
const same = (got, exp, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), exp, msg);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + (e && e.message)); process.exitCode = 1; } };

const NOW = 1756000000000;
const DAY = 24 * 60 * 60 * 1000;
const F = api(fakeStore());

// ---- which draft belongs to which form ----
t('a draft is keyed to the form', () => {
  assert.strictEqual(F.draftKey('health-certificate-rfil', ''), 'blk_draft_health-certificate-rfil');
});
t('a parent-scoped link drafts per record, not per form', () => {
  // two events sharing one signup form are two different forms to the person filling them in
  const a = F.draftKey('event-signup', 'tok-a'), b = F.draftKey('event-signup', 'tok-b');
  assert.notStrictEqual(a, b);
  assert.ok(a.indexOf('event-signup') !== -1 && a.indexOf('tok-a') !== -1, a);
});
t('no form means no key, and nothing is ever written under one', () => {
  assert.strictEqual(F.draftKey('', 'tok'), '');
  assert.strictEqual(F.draftKey(null, null), '');
  assert.strictEqual(F.writeDraft('', { a: '1' }, NOW), false);
  assert.strictEqual(F.readDraft('', NOW), null);
});
t('the key is namespaced so it cannot collide with the device id', () => {
  assert.ok(/^blk_draft_/.test(F.draftKey('x', '')));
  assert.notStrictEqual(F.draftKey('device', ''), 'blk_device');
});

// ---- what counts as a usable draft ----
t('a draft written just now is fresh', () => {
  assert.strictEqual(F.draftFresh({ v: 1, at: NOW - 1000, a: { q: 'x' } }, NOW), true);
});
t('a draft from last month is not offered', () => {
  assert.strictEqual(F.draftFresh({ v: 1, at: NOW - 30 * DAY, a: { q: 'x' } }, NOW), false);
});
t('the age limit is a week', () => {
  assert.strictEqual(F.draftFresh({ v: 1, at: NOW - 7 * DAY + 1000, a: { q: 'x' } }, NOW), true);
  assert.strictEqual(F.draftFresh({ v: 1, at: NOW - 7 * DAY - 1000, a: { q: 'x' } }, NOW), false);
});
t('a shape this page does not recognise is not a draft', () => {
  [null, undefined, 'x', 42, {}, { v: 2, at: NOW, a: {} }, { v: 1, at: NOW }, { v: 1, at: NOW, a: 'x' },
   { v: 1, a: { q: 'x' } }, { v: 1, at: 'soon', a: { q: 'x' } }].forEach(bad => {
    assert.strictEqual(F.draftFresh(bad, NOW), false, JSON.stringify(bad));
  });
});
t('a timestamp from the future is refused rather than trusted forever', () => {
  // a phone whose clock was wrong when the draft was written would otherwise never expire
  assert.strictEqual(F.draftFresh({ v: 1, at: NOW + 5 * DAY, a: { q: 'x' } }, NOW), false);
});

// ---- the round trip ----
t('what was written comes back', () => {
  const s = fakeStore(), A = api(s), k = A.draftKey('t', '');
  assert.strictEqual(A.writeDraft(k, { q1: 'Ahmad', q2: 'Yes' }, NOW), true);
  same(A.readDraft(k, NOW + 1000), { q1: 'Ahmad', q2: 'Yes' });
});
t('nothing typed yet is not a draft', () => {
  // else every link ever opened leaves a row in this browser and a "we kept your answers"
  // line above an empty form
  const s = fakeStore(), A = api(s), k = A.draftKey('t', '');
  assert.strictEqual(A.writeDraft(k, {}, NOW), false);
  assert.strictEqual(s.map.size, 0);
  assert.strictEqual(A.readDraft(k, NOW), null);
});
t('emptying the last answer removes the draft rather than leaving a stale one', () => {
  const s = fakeStore(), A = api(s), k = A.draftKey('t', '');
  A.writeDraft(k, { q1: 'Ahmad' }, NOW);
  A.writeDraft(k, {}, NOW + 500);
  assert.strictEqual(s.map.size, 0);
});
t('a stale draft is dropped on read, not merely ignored', () => {
  const s = fakeStore(), A = api(s), k = A.draftKey('t', '');
  A.writeDraft(k, { q1: 'Ahmad' }, NOW - 30 * DAY);
  assert.strictEqual(A.readDraft(k, NOW), null);
  assert.strictEqual(s.map.size, 0, 'a form left a month ago should not sit in the browser');
});
t('rubbish in storage reads as no draft instead of taking the form down', () => {
  const s = fakeStore(), A = api(s), k = A.draftKey('t', '');
  s.map.set(k, '{not json');
  assert.strictEqual(A.readDraft(k, NOW), null);
});
t('clearing is what a submitted form does, and it really clears', () => {
  const s = fakeStore(), A = api(s), k = A.draftKey('t', '');
  A.writeDraft(k, { q1: 'Ahmad' }, NOW);
  A.clearDraft(k);
  assert.strictEqual(s.map.size, 0);
  assert.strictEqual(A.readDraft(k, NOW), null);
});
t('a browser that refuses storage still fills forms in', () => {
  // private mode, storage switched off, an embedded webview: the form must behave exactly
  // as it always did rather than throw on the first keystroke
  const A = api(fakeStore('blocked')), k = A.draftKey('t', '');
  assert.strictEqual(A.writeDraft(k, { q1: 'Ahmad' }, NOW), false);
  assert.strictEqual(A.readDraft(k, NOW), null);
  assert.doesNotThrow(() => A.clearDraft(k));
});
t('storage that is full fails the save, not the form', () => {
  const A = api(fakeStore('full')), k = A.draftKey('t', '');
  assert.strictEqual(A.writeDraft(k, { q1: 'Ahmad' }, NOW), false);
});

// ---- the sweep, which is the only thing that ends a draft nobody comes back for ----
t('every expired draft goes, whichever form it belongs to', () => {
  const s = fakeStore(), A = api(s);
  A.writeDraft('blk_draft_qc', { a: '1' }, NOW - 30 * DAY);
  A.writeDraft('blk_draft_casting', { a: '1' }, NOW - 8 * DAY);
  assert.strictEqual(A.sweepDrafts(NOW), 2);
  assert.strictEqual(s.map.size, 0);
});
t('a draft still inside its week is left alone', () => {
  const s = fakeStore(), A = api(s);
  A.writeDraft('blk_draft_qc', { a: '1' }, NOW - 2 * DAY);
  assert.strictEqual(A.sweepDrafts(NOW), 0);
  assert.strictEqual(s.map.size, 1);
});
t('the sweep touches nothing that is not a draft', () => {
  // blk_device is this browser's one-submission-per-form id and must outlive every draft
  const s = fakeStore(), A = api(s);
  s.map.set('blk_device', 'abc');
  s.map.set('blk_cat_collapsed', '["Operate"]');
  A.writeDraft('blk_draft_qc', { a: '1' }, NOW - 30 * DAY);
  A.sweepDrafts(NOW);
  assert.strictEqual(s.map.get('blk_device'), 'abc');
  assert.strictEqual(s.map.get('blk_cat_collapsed'), '["Operate"]');
  assert.ok(!s.map.has('blk_draft_qc'));
});
t('a draft in a shape this page cannot read is swept rather than left forever', () => {
  const s = fakeStore(), A = api(s);
  s.map.set('blk_draft_qc', '{not json');
  assert.strictEqual(A.sweepDrafts(NOW), 1);
  assert.strictEqual(s.map.size, 0);
});
t('a browser with no storage has nothing to sweep and says so quietly', () => {
  const A = api(fakeStore('blocked'));
  assert.doesNotThrow(() => A.sweepDrafts(NOW));
  assert.strictEqual(A.sweepDrafts(NOW), 0);
});

// ---- reading the answers off the form ----
const ctl = (id, value, extra) => Object.assign({ f: { id: id }, value: () => value }, extra || {});
t('only answered questions are kept', () => {
  const got = F.draftAnswers([ctl('a', 'Ahmad'), ctl('b', null), ctl('c', ''), ctl('d', 'No')]);
  same(got, { a: 'Ahmad', d: 'No' });
});
t('a file question is never written to storage', () => {
  // a File cannot be serialised, and a path that looks like an answer would submit a photo
  // nobody chose
  const got = F.draftAnswers([ctl('a', 'Ahmad'), { f: { id: 'p' }, isPhoto: true, file: () => ({ name: 'x.jpg' }) }]);
  same(got, { a: 'Ahmad' });
});
t('a question that collects nothing (a link button) is skipped', () => {
  same(F.draftAnswers([{ f: { id: 'l' } }, ctl('a', 'x')]), { a: 'x' });
});
t('the free text behind an "other" choice is kept with it', () => {
  const got = F.draftAnswers([ctl('a', 'Something else', { otherKey: 'a__other', otherValue: () => 'my own words' })]);
  same(got, { a: 'Something else', a__other: 'my own words' });
});
t('an "other" box that was never opened writes no key', () => {
  const got = F.draftAnswers([ctl('a', 'Yes', { otherKey: 'a__other', otherValue: () => null })]);
  same(got, { a: 'Yes' });
});
t('an answer to a question hidden right now is still kept', () => {
  // the person can change their mind back; the page already decides separately what travels
  // with the submission, and that rule is not this one's business
  const got = F.draftAnswers([ctl('a', 'No'), ctl('b', 'typed before the gate closed')]);
  same(got, { a: 'No', b: 'typed before the gate closed' });
});
t('answers are kept as text, and a numeric 0 is an answer', () => {
  // `if (!v)` here would throw away a real answer to "how many years?"
  same(F.draftAnswers([ctl('a', 0), ctl('b', '5')]), { a: '0', b: '5' });
});

// ---- putting them back ----
function fakeCtl(id, opts) {
  const c = { f: { id: id }, got: null, gotOther: null };
  if (!(opts && opts.noRestore)) c.setDraft = (v, ov) => { c.got = v; c.gotOther = ov; };
  if (opts && opts.other) c.otherKey = id + '__other';
  if (opts && opts.throws) c.setDraft = () => { throw new Error('boom'); };
  return c;
}
t('every answer goes back to its own question', () => {
  const a = fakeCtl('a'), b = fakeCtl('b');
  assert.strictEqual(F.restoreAnswers([a, b], { a: 'Ahmad', b: 'Yes' }), 2);
  assert.strictEqual(a.got, 'Ahmad'); assert.strictEqual(b.got, 'Yes');
});
t('a question with no answer in the draft is left alone', () => {
  const a = fakeCtl('a'), b = fakeCtl('b');
  F.restoreAnswers([a, b], { a: 'Ahmad' });
  assert.strictEqual(b.got, null, 'an untouched question must not be blanked');
});
t('an answer to a question the form no longer asks is dropped', () => {
  // a question renamed or removed since the draft was written
  const a = fakeCtl('a');
  assert.strictEqual(F.restoreAnswers([a], { a: 'x', gone: 'y' }), 1);
});
t('a question that cannot take an answer back is skipped, not guessed at', () => {
  const p = fakeCtl('p', { noRestore: true });
  assert.strictEqual(F.restoreAnswers([p], { p: 'x' }), 0);
});
t('the free text behind "other" is handed over with its choice', () => {
  const a = fakeCtl('a', { other: true });
  F.restoreAnswers([a], { a: 'Something else', a__other: 'my own words' });
  assert.strictEqual(a.got, 'Something else');
  assert.strictEqual(a.gotOther, 'my own words');
});
t('one question that refuses its answer does not stop the rest', () => {
  const bad = fakeCtl('a', { throws: true }), good = fakeCtl('b');
  assert.doesNotThrow(() => F.restoreAnswers([bad, good], { a: 'x', b: 'y' }));
  assert.strictEqual(good.got, 'y');
});
t('no draft restores nothing', () => {
  assert.strictEqual(F.restoreAnswers([fakeCtl('a')], null), 0);
  assert.strictEqual(F.restoreAnswers(null, { a: 'x' }), 0);
});

// ---- the phone, which is one string on the way out and two controls on the way in ----
t('a stored number splits back into the picker and the box', () => {
  const p = F.splitPhone('+962791234567');
  assert.strictEqual(p.local, '791234567');
  assert.strictEqual(p.i, 0, 'Jordan is the first country in the list');
});
t('a number from another country restores that country, not the default', () => {
  const p = F.splitPhone('+96171234567');
  assert.ok(p, 'Lebanon should resolve');
  assert.strictEqual(p.local, '71234567');
  assert.notStrictEqual(p.i, 0);
});
t('a number this form cannot offer is refused rather than mangled', () => {
  // +44 is not in the picker; silently keeping the digits would submit a Jordanian number
  assert.strictEqual(F.splitPhone('+447700900000'), null);
  assert.strictEqual(F.splitPhone('0791234567'), null);
  assert.strictEqual(F.splitPhone(''), null);
  assert.strictEqual(F.splitPhone(null), null);
});
t('a round trip through the draft leaves the number identical', () => {
  // the dial codes come out of the page, so adding a country cannot pass this test by
  // accident and cannot fail it for being newer than the test
  const CCS = [...scripts('f/index.html').matchAll(/\{ cc: "(\d+)"/g)].map(m => m[1]);
  assert.ok(CCS.length >= 4, 'could not read the dial codes out of the page');
  ['+962791234567', '+9617123456', '+963912345678', '+9647712345678'].forEach(v => {
    const p = F.splitPhone(v);
    assert.ok(p, v);
    assert.strictEqual('+' + CCS[p.i] + p.local, v);
  });
});

// ---- the page itself: the wiring a helper test cannot see ----
const SRC = scripts('f/index.html');
t('the draft is saved when the page is hidden, not only on a timer', () => {
  // the camera app opening is a phone's cue to discard this tab, and "hidden" is the last
  // event it will deliver before it does — the debounce alone would lose the last keystrokes
  assert.ok(/visibilitychange/.test(SRC), 'no visibilitychange handler');
  assert.ok(/pagehide/.test(SRC), 'no pagehide handler');
});
t('a submitted form leaves no draft behind', () => {
  // a shop tablet is one browser used by everybody; the next person must start clean
  assert.ok(/clearDraft\(/.test(SRC));
  const after = SRC.slice(SRC.indexOf('function submitForm'));
  assert.ok(/clearDraft\(/.test(after), 'submitForm never clears the draft');
});
t('every question type that can take an answer back says so', () => {
  // a new field type added without setDraft loses its answer on every refresh, silently.
  // One branch deliberately has none: a link, which collects nothing at all. A file question
  // used to be the second — a chosen file could not be written to storage — and now takes its
  // answer back through setDraftFiles instead, because the files live in IndexedDB rather
  // than in the answers object (form-draft-files.test.js).
  const body = SRC.slice(SRC.indexOf('function buildField'), SRC.indexOf('function markCtl'));
  const pushes = body.split('controls.push({').slice(1).map(p => p.slice(0, p.indexOf('});') + 3));
  assert.ok(pushes.length >= 10, 'expected every field type to push a control, saw ' + pushes.length);
  const without = pushes.filter(p => !/setDraft\b/.test(p) && p.indexOf('setDraftFiles') === -1);
  assert.strictEqual(without.length, 1, 'controls with no way back at all: ' + without.length + ' (expected the link question only)');
  assert.ok(/el: a,/.test(without[0]), 'the one with no way back is not the link question');
  const file = pushes.filter(p => /isPhoto: true/.test(p));
  assert.strictEqual(file.length, 1, 'expected exactly one file control');
  assert.ok(file[0].indexOf('setDraftFiles') !== -1, 'the file question cannot take its files back');
});

// ---- the same rules on the two hand-built forms ----
['apply/index.html', 'cast/index.html'].forEach(file => {
  const S = scripts(file);
  t(file + ' keys its draft the same way', () => {
    assert.ok(/var DRAFT_PREFIX = "blk_draft_"/.test(S), 'different prefix from f/index.html');
  });
  t(file + ' keeps a draft for the same week', () => {
    assert.ok(/var DRAFT_MAX_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000/.test(S), 'different age limit from f/index.html');
  });
  t(file + ' saves when the page is hidden', () => {
    assert.ok(/visibilitychange/.test(S) && /pagehide/.test(S), file + ' does not save on hide');
  });
  t(file + ' clears the draft once the application is in', () => {
    assert.ok(/clearDraft\(/.test(S), file + ' never clears the draft');
  });
  const A = load(file, ['draftFormAnswers', 'restoreFormAnswers'], [], {});
  const el = (id, value, type, tag) => ({ id: id, value: value, type: type || 'text', tagName: tag || 'INPUT' });
  const root = els => ({ querySelectorAll: () => els });
  t(file + ' reads every answered box on the form', () => {
    same(
      A.draftFormAnswers(root([el('full_name', 'Ahmad'), el('why_join', 'coffee', '', 'TEXTAREA'), el('gender', '', '', 'SELECT')])),
      { full_name: 'Ahmad', why_join: 'coffee' });
  });
  t(file + ' never writes the photo to storage', () => {
    same(A.draftFormAnswers(root([el('photo', 'C:\\fakepath\\me.jpg', 'file'), el('full_name', 'Ahmad')])),
      { full_name: 'Ahmad' });
  });
  t(file + ' ignores a box with no id, which is nobody\'s answer', () => {
    same(A.draftFormAnswers(root([el('', 'x'), el('full_name', 'Ahmad')])), { full_name: 'Ahmad' });
  });
  t(file + ' puts the answers back where they came from', () => {
    const boxes = [el('full_name', ''), el('gender', '', '', 'SELECT'), el('photo', '', 'file')];
    assert.strictEqual(A.restoreFormAnswers(root(boxes), { full_name: 'Ahmad', gender: 'Male', photo: 'x.jpg' }), 2);
    assert.strictEqual(boxes[0].value, 'Ahmad');
    assert.strictEqual(boxes[1].value, 'Male');
    assert.strictEqual(boxes[2].value, '', 'a file input must never be filled from a draft');
  });
  t(file + ' leaves a box the draft says nothing about alone', () => {
    const boxes = [el('full_name', 'typed just now')];
    A.restoreFormAnswers(root(boxes), { gender: 'Male' });
    assert.strictEqual(boxes[0].value, 'typed just now');
  });
  t(file + ' restores nothing when there is no draft', () => {
    assert.strictEqual(A.restoreFormAnswers(root([el('a', '')]), null), 0);
    assert.strictEqual(A.restoreFormAnswers(null, { a: 'x' }), 0);
  });
});

if (!process.exitCode) console.log(n + ' form-draft tests passed');
