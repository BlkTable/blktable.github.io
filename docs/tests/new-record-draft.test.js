// A half-filled New record panel survives a stray click. Every answer used to live only in
// the DOM, and the modal backdrop closes on any click outside the frame, so one misplaced
// click emptied a record somebody had spent ten minutes typing. Creating an event is the
// place it hurt most, but the panel is the same one for every table.
//
// What is worth pinning down here is not "it saves", it is the ways a kept draft can do
// harm: one restored into a panel somebody thought was fresh, one written before anything
// was typed, one belonging to the person who used this browser before you, one surviving a
// record that was actually created, this page eating the public forms' drafts, and a browser
// that refuses storage taking the panel down with it.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
// Pulled out of the page rather than restated here, so a test cannot quietly use a different
// storage key or a different age limit than the page does. A function written on one line
// ends at that newline; a multi-line one at its own closing brace.
function grab(js, name, file) {
  const multi = js.match(new RegExp('\\n  function ' + name + '\\s*\\([^\\n]*\\{\\r?\\n[\\s\\S]*?\\n  \\}'));
  if (multi) return multi[0];
  const one = js.match(new RegExp('\\n  function ' + name + '\\s*\\([^\\n]*\\}'));
  if (!one) throw new Error('could not find function ' + name + ' in ' + file);
  return one[0];
}
function grabVar(js, name, file) {
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
  return load('index.html',
    ['nrDraftKey', 'nrDraftFresh', 'nrReadDraft', 'nrWriteDraft', 'nrClearDraft',
     'nrDraftAnswers', 'nrSweepDrafts', 'nrKeepsPanelOpen', 'otherKeyFor'],
    ['NR_DRAFT_PREFIX', 'NR_DRAFT_MAX_AGE_MS'],
    { window: { localStorage: store } });
}
function prefixes() {
  const inner = load('index.html', ['nrDraftKey'], ['NR_DRAFT_PREFIX'], { window: { localStorage: fakeStore() } });
  const publicPrefix = grabVar(scripts('f/index.html'), 'DRAFT_PREFIX', 'f/index.html')
    .match(/"([^"]*)"/)[1];
  return { nr: inner.nrDraftKey('@', '').replace('@', ''), pub: publicPrefix };
}

const NOW = 1755000000000;   // a fixed clock; the page reads Date.now(), the tests never do
const WEEK = 7 * 24 * 60 * 60 * 1000;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('new-record draft: whose draft is it');

// A draft belongs to one table and one person. Both halves matter: an office laptop is one
// browser used by several people, and the answers to "New event" must never turn up in
// "New complaint" because they happened to be the last thing typed.
test('a table and a person get their own key', () => {
  const A = api(fakeStore());
  assert.notStrictEqual(A.nrDraftKey('tbl-events', 'u1'), A.nrDraftKey('tbl-complaints', 'u1'));
  assert.notStrictEqual(A.nrDraftKey('tbl-events', 'u1'), A.nrDraftKey('tbl-events', 'u2'));
  assert.strictEqual(A.nrDraftKey('tbl-events', 'u1'), A.nrDraftKey('tbl-events', 'u1'));
});

// The table is named by id rather than by slug, so renaming a table does not orphan the
// draft of the record somebody is halfway through typing into it.
test('nothing is kept when there is no table to key it on', () => {
  const A = api(fakeStore());
  assert.strictEqual(A.nrDraftKey('', 'u1'), '');
  assert.strictEqual(A.nrDraftKey(null, 'u1'), '');
});

// index.html and f/index.html are the same origin, so they share one localStorage and each
// sweeps its own family on load. Overlapping prefixes would have one page quietly deciding
// the fate of the other's drafts.
test('this page and the public forms cannot sweep each other clean', () => {
  const p = prefixes();
  assert.ok(p.nr && p.pub, 'both prefixes should be readable from their pages');
  assert.ok(p.nr.indexOf(p.pub) !== 0, p.nr + ' starts with the public prefix ' + p.pub);
  assert.ok(p.pub.indexOf(p.nr) !== 0, p.pub + ' starts with this page\'s prefix ' + p.nr);
});

console.log('new-record draft: what comes back out of storage');

test('a draft from last month is not put back', () => {
  const A = api(fakeStore());
  assert.strictEqual(A.nrDraftFresh({ v: 1, at: NOW - WEEK - 1, a: { q1: 'x' } }, NOW), false);
  assert.strictEqual(A.nrDraftFresh({ v: 1, at: NOW - 60000, a: { q1: 'x' } }, NOW), true);
});

// A clock that was wrong when the draft was written would otherwise make it immortal.
test('a draft stamped in the future is refused', () => {
  const A = api(fakeStore());
  assert.strictEqual(A.nrDraftFresh({ v: 1, at: NOW + 120000, a: { q1: 'x' } }, NOW), false);
});

test('anything that is not this shape reads as no draft at all', () => {
  const A = api(fakeStore());
  [null, {}, { v: 2, at: NOW, a: { q1: 'x' } }, { v: 1, at: 0, a: { q1: 'x' } },
   { v: 1, at: NOW, a: 'x' }, { v: 1, at: NOW }].forEach(rec => {
    assert.strictEqual(A.nrDraftFresh(rec, NOW), false, JSON.stringify(rec) + ' should not be fresh');
  });
});

test('a stale draft is not only ignored, it is thrown away', () => {
  const store = fakeStore(), A = api(store);
  const key = A.nrDraftKey('tbl-events', 'u1');
  store.map.set(key, JSON.stringify({ v: 1, at: NOW - WEEK - 1, a: { q1: 'x' } }));
  assert.strictEqual(A.nrReadDraft(key, NOW), null);
  assert.strictEqual(store.map.has(key), false, 'the stale draft should be gone from storage');
});

test('a garbled value reads as no draft rather than throwing', () => {
  const store = fakeStore(), A = api(store);
  const key = A.nrDraftKey('tbl-events', 'u1');
  store.map.set(key, 'not json at all');
  assert.strictEqual(A.nrReadDraft(key, NOW), null);
});

test('what was written is what comes back', () => {
  const store = fakeStore(), A = api(store);
  const key = A.nrDraftKey('tbl-events', 'u1');
  assert.strictEqual(A.nrWriteDraft(key, { q1: 'Autumn Fair', q2: '2026-09-10' }, NOW), true);
  assert.strictEqual(JSON.stringify(A.nrReadDraft(key, NOW)),
    JSON.stringify({ q1: 'Autumn Fair', q2: '2026-09-10' }));
});

console.log('new-record draft: a draft that should never exist');

// Writing one anyway would leave a row in this browser for every table anybody ever opened
// the panel on, and put "we kept your answers" above an empty panel.
test('an untouched panel writes no draft', () => {
  const store = fakeStore(), A = api(store);
  const key = A.nrDraftKey('tbl-events', 'u1');
  assert.strictEqual(A.nrWriteDraft(key, {}, NOW), false);
  assert.strictEqual(store.map.size, 0);
});

// Emptying every box is how somebody starts over. If that left the old draft in place, the
// answers they just deleted would come back the next time they opened the panel.
test('emptying the last box clears the draft instead of keeping the old one', () => {
  const store = fakeStore(), A = api(store);
  const key = A.nrDraftKey('tbl-events', 'u1');
  A.nrWriteDraft(key, { q1: 'Autumn Fair' }, NOW);
  assert.strictEqual(A.nrWriteDraft(key, {}, NOW), false);
  assert.strictEqual(store.map.has(key), false);
});

test('a browser that refuses storage keeps working instead of taking the panel down', () => {
  ['blocked', 'full'].forEach(mode => {
    const A = api(fakeStore(mode));
    const key = A.nrDraftKey('tbl-events', 'u1');
    assert.strictEqual(A.nrWriteDraft(key, { q1: 'x' }, NOW), false, mode + ': write should report failure');
    assert.strictEqual(A.nrReadDraft(key, NOW), null, mode + ': read should report no draft');
    assert.doesNotThrow(() => A.nrClearDraft(key), mode + ': clearing should not throw');
    assert.doesNotThrow(() => A.nrSweepDrafts(NOW), mode + ': sweeping should not throw');
  });
});

console.log('new-record draft: which answers are worth keeping');

// The answers come from edValues(), which already skips a file question and a computed
// score, so this only has to decide what counts as an answer.
test('an empty or blank answer is not an answer', () => {
  const A = api(fakeStore());
  const kept = A.nrDraftAnswers({ q1: 'Autumn Fair', q2: '', q3: '   ', q4: null, q5: undefined }, {});
  assert.strictEqual(JSON.stringify(kept), JSON.stringify({ q1: 'Autumn Fair' }));
});

test('a number answer is kept rather than dropped for not being a string', () => {
  const A = api(fakeStore());
  assert.strictEqual(JSON.stringify(A.nrDraftAnswers({ q1: 0, q2: 15 }, {})),
    JSON.stringify({ q1: '0', q2: '15' }));
});

// The editor reads the free text behind an "other" choice from `<id>__other`, so that is
// the key it has to be kept under: anything else restores the choice and loses the text.
test('the free text behind an "other" choice is kept under the key the editor reads', () => {
  const A = api(fakeStore());
  const kept = A.nrDraftAnswers({ q1: 'Other' }, { q1: 'a reason nobody listed' });
  assert.strictEqual(kept[A.otherKeyFor({ id: 'q1' })], 'a reason nobody listed');
});

test('an "other" box with nothing typed in it is not kept', () => {
  const A = api(fakeStore());
  const kept = A.nrDraftAnswers({ q1: 'Other' }, { q1: '' });
  assert.strictEqual(JSON.stringify(kept), JSON.stringify({ q1: 'Other' }));
});

console.log('new-record draft: the sweep');

// A draft is only ever read when its own panel is opened again, so one belonging to a table
// nobody goes back to would sit in this browser for good.
test('the sweep takes the expired ones and leaves the rest alone', () => {
  const store = fakeStore(), A = api(store);
  const fresh = A.nrDraftKey('tbl-events', 'u1'), old = A.nrDraftKey('tbl-complaints', 'u1');
  store.map.set(fresh, JSON.stringify({ v: 1, at: NOW - 60000, a: { q1: 'x' } }));
  store.map.set(old, JSON.stringify({ v: 1, at: NOW - WEEK - 1, a: { q1: 'x' } }));
  assert.strictEqual(A.nrSweepDrafts(NOW), 1);
  assert.strictEqual(store.map.has(fresh), true);
  assert.strictEqual(store.map.has(old), false);
});

test('the sweep does not touch a public form draft or anything else in storage', () => {
  const store = fakeStore(), A = api(store);
  const p = prefixes();
  store.map.set(p.pub + 'health-certificate', JSON.stringify({ v: 1, at: NOW - WEEK - 1, a: { q1: 'x' } }));
  store.map.set('blk_device', 'abc123');
  store.map.set('sb-auth-token', '{}');
  assert.strictEqual(A.nrSweepDrafts(NOW), 0);
  assert.strictEqual(store.map.size, 3, 'nothing outside this page\'s own family should be swept');
});

console.log('new-record draft: the stray click that started this');

// The draft makes a stray click survivable; not closing at all is what was actually asked
// for. Only a New record panel with something in it holds its ground, so every other panel
// on this overlay closes on a backdrop click exactly as it did before.
test('a backdrop click does not close a half-filled New record panel', () => {
  const A = api(fakeStore());
  assert.strictEqual(A.nrKeepsPanelOpen(true, { q1: 'Autumn Fair' }), true);
});

test('an untouched New record panel still closes on a backdrop click', () => {
  const A = api(fakeStore());
  assert.strictEqual(A.nrKeepsPanelOpen(true, {}), false);
  assert.strictEqual(A.nrKeepsPanelOpen(true, null), false);
});

test('every other panel closes on a backdrop click as it always did', () => {
  const A = api(fakeStore());
  assert.strictEqual(A.nrKeepsPanelOpen(false, { q1: 'Autumn Fair' }), false);
});

console.log('new-record draft: the wiring, read off the page itself');

// The reason this panel needs no per-question restore code is that edFieldRowHtml already
// fills every question type from a values object, and the panel used to pass it an empty
// one. That single argument is the whole restore, which makes it the one thing a future
// change could silently undo: the answers would still be saved and never come back.
test('the create panel builds its rows from the kept answers, not from an empty object', () => {
  const src = fs.readFileSync('index.html', 'utf8');
  const panel = src.match(/function openNewRecord\([\s\S]*?\n  \}\r?\n/);
  assert.ok(panel, 'openNewRecord should be findable in index.html');
  const rows = panel[0].match(/edFieldRowHtml\(f,\s*([A-Za-z0-9_{}]+)/);
  assert.ok(rows, 'openNewRecord should build its rows with edFieldRowHtml');
  assert.notStrictEqual(rows[1], '{}',
    'openNewRecord passes {} to edFieldRowHtml, so a kept draft would never be put back');
});

test('a record that was actually created does not leave its draft behind', () => {
  const src = fs.readFileSync('index.html', 'utf8');
  const panel = src.match(/function openNewRecord\([\s\S]*?\n  \}\r?\n/)[0];
  assert.ok(/nrClearDraft\(/.test(panel),
    'the create panel should clear its draft; otherwise the next new record starts pre-filled');
});

test('the backdrop click consults the guard rather than closing regardless', () => {
  const src = fs.readFileSync('index.html', 'utf8');
  const handler = src.match(/getElementById\("modal"\)\.addEventListener\("click",[\s\S]*?\n  \}\);/);
  assert.ok(handler, 'the overlay click handler should be findable in index.html');
  assert.ok(/nrKeepsPanelOpen/.test(handler[0]),
    'a backdrop click closes the panel without asking whether a half-filled record is in it');
});

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
