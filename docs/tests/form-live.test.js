// Is a public form's link live? `app_tables.is_active` decides it, and it is read in four
// places that must agree: the two anon RLS policies, the lookup in f/index.html, and
// submit_public_form(). Nothing in the app ever wrote it, so on 2026-08-17 the Contact Us
// link answered "Form not found" on launch day — along with 176 other non-archived form
// tables — while the Form tab happily drew a link and a QR code for every one of them.
//
// The control that fixes it shipped in #37 with no tests. These are those tests. They cover
// the reading of the flag, the copy shown next to the link, and the wiring — because a switch
// that silently does nothing is exactly how this went unnoticed for a month.
//
// Note the deliberate asymmetry in linkLive(): MISSING counts as live. Every table created
// before the column was read has `undefined` in the page's copy of the row, and treating that
// as "off" would have shown a false dead-link warning on every form in the app.
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

const API = load('index.html', ['linkLive']);
const SRC = scripts('index.html');
const FORM = scripts('f/index.html');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- reading the flag ----
t('a table with is_active true is live', () => {
  assert.strictEqual(API.linkLive({ is_active: true }), true);
});
t('the imported tables, which carry false, are not live', () => {
  // this is the state 177 non-archived form tables were in on 2026-08-17
  assert.strictEqual(API.linkLive({ is_active: false }), false);
});
t('a missing flag counts as LIVE, not as off', () => {
  // the whole point of `!== false`: a row the page loaded before the column was selected, or
  // a table created by older code, must not be reported as a dead link
  assert.strictEqual(API.linkLive({}), true);
  assert.strictEqual(API.linkLive({ is_active: undefined }), true);
  assert.strictEqual(API.linkLive({ is_active: null }), true);
});
t('no table at all is live rather than throwing', () => {
  // the Form tab paints on every table open, including before anything is loaded
  assert.strictEqual(API.linkLive(null), true);
  assert.strictEqual(API.linkLive(undefined), true);
});
t('the answer is always a boolean', () => {
  // it drives a class toggle and a label; a truthy object or string would print
  [{}, null, { is_active: true }, { is_active: false }, { is_active: 'f' }].forEach(v => {
    assert.strictEqual(typeof API.linkLive(v), 'boolean', 'not a boolean for ' + JSON.stringify(v));
  });
});
t('the postgres text "f" reads as live, which is why the boolean column must be selected', () => {
  // a guard on the shape of the data rather than on the function: 'f' is truthy in JS, so if
  // the row ever arrives with text instead of a boolean this silently reports the wrong state
  assert.strictEqual(API.linkLive({ is_active: 'f' }), true);
});

// ---- the wiring, read as source ----
t('not just anyone can write the flag', () => {
  // Written when the gate was `!isAdmin`; main widened it to mayModifyTable(), which is
  // "an admin, or the person who created this table". Pinning the old spelling failed a
  // test about permission for a change that ADDED a permission holder deliberately. What
  // must stay true is that the very first thing the function does is refuse someone who
  // may not modify this table — an ungated publish switch is the whole point of the test.
  const fn = grab(SRC, 'setFormLive', 'index.html');
  const first = fn.slice(fn.indexOf('{') + 1).trim().split('\n')[0];
  assert.ok(/^if \(!t \|\|/.test(first), 'setFormLive does not open with a guard: ' + first);
  assert.ok(/return;/.test(first), 'the guard does not return early: ' + first);
  assert.ok(/isAdmin|mayModifyTable/.test(first),
    'the guard does not consult admin rights at all: ' + first);
});
t('the write targets one table by id, never a bare update', () => {
  // an update with no .eq would publish or unpublish every form in the database at once
  assert.ok(/update\(\{ is_active: on \}\)\.eq\("id", t\.id\)/.test(SRC),
    'the is_active update is not scoped to a single table id');
});
t('a failure tells the person the column might be refused by the server', () => {
  // `authenticated` holds UPDATE on this column today, but that is a grant somebody can
  // revoke; a bare "could not" would send them looking in the app instead of at the database
  const m = SRC.match(/function setFormLive\([\s\S]*?\n  \}/);
  assert.ok(m, 'could not find setFormLive');
  assert.ok(/window\.alert/.test(m[0]), 'a failed write says nothing');
  assert.ok(/column/i.test(m[0]), 'the failure does not mention the column being refused');
  assert.ok(/console\.error/.test(m[0]), 'the detail is not sent to the console');
});
t('the local row is updated and the table list reloaded after the write', () => {
  // leaving the cached row stale means the panel disagrees with the switch beside it
  const m = SRC.match(/function setFormLive\([\s\S]*?\n  \}/)[0];
  assert.ok(/t\.is_active = on;/.test(m), 'the loaded row is not updated');
  assert.ok(/loadCustomTables\(\)/.test(m), 'the sidebar list is not reloaded');
});
t('switching a form off is confirmed, switching it on is not', () => {
  // off is the destructive direction: a printed QR code stops working and nobody finds out
  // until somebody scans it. On is instantly visible and trivially reversible.
  assert.ok(/turningOff/.test(SRC), 'there is no separate off path to confirm');
  assert.ok(/setFormLive\(t, !turningOff\)/.test(SRC), 'the call does not derive from the direction');
});
t('the flag is read through linkLive, not by hand', () => {
  // two hand-written copies of `t.is_active !== false` is how the sidebar ends up disagreeing
  // with the Form tab about whether a link works
  const hits = SRC.match(/\bis_active\b/g) || [];
  assert.ok(hits.length <= 6, 'is_active is touched ' + hits.length + ' times — more copies than the helper, the write and the write-back');
  assert.ok(/function linkLive\(t\) \{ return !t \|\| t\.is_active !== false; \}/.test(SRC),
    'linkLive is not the one place the flag is read');
});

// ---- the public page has to agree with the app ----
t('the public page gates on the same flag the app now controls', () => {
  // if the page ever stops filtering on is_active, the switch in the app becomes decoration
  assert.ok(/\.eq\("is_active", true\)/.test(FORM),
    'f/index.html no longer filters the table lookup on is_active');
});
t('a form that is off renders the not-found state, not a broken form', () => {
  // Written when the guard called notFound() inline. Main routes it through
  // resolveAliasOrNotFound(), which forwards a retired slug to its replacement and otherwise
  // falls through to notFound() — a later addition so a printed QR code survives a rename.
  // The rule that matters is unchanged: a row that is absent or not live must never reach
  // the form-drawing code. So the guard is required, and whatever it calls must end at
  // notFound() rather than carrying on.
  const guard = /if \(tRes\.error \|\| !tRes\.data\) \{ (\w+)\(\); return; \}/.exec(FORM);
  assert.ok(guard, 'a missing or not-live table row does not stop the page from drawing a form');
  const called = guard[1];
  if (called !== 'notFound') {
    // brace-matched, and at whatever indent it happens to sit at — the helper is nested
    // inside the load block, not at the top level like the functions grab() expects
    const at = FORM.search(new RegExp('\\bfunction\\s+' + called + '\\s*\\('));
    assert.ok(at > -1, 'the guard calls ' + called + '(), which does not exist');
    let depth = 0, end = at;
    for (let i = FORM.indexOf('{', at); i < FORM.length; i++) {
      if (FORM[i] === '{') depth++;
      else if (FORM[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    assert.ok(/notFound\(\)/.test(FORM.slice(at, end)),
      called + '() is called instead of notFound() but never reaches notFound() itself');
  }
  // and the query must actually ask for live rows only, or the flag decides nothing
  assert.ok(/\.eq\("is_active", true\)/.test(FORM),
    'the lookup no longer filters on is_active, so turning a form off would not hide it');
});
t('the app quotes the words the visitor actually sees', () => {
  // the app and the page must not use two vocabularies for one state — somebody debugging a
  // dead link should be able to search for the same phrase in both
  const heading = fs.readFileSync('f/index.html', 'utf8').match(/<h2>([^<]*not found[^<]*)<\/h2>/i);
  assert.ok(heading, 'could not find the not-found heading in f/index.html');
  assert.ok(SRC.indexOf(heading[1]) !== -1,
    'index.html never mentions "' + heading[1] + '", the message a visitor to a dead link gets');
});

// ---- and it stays independent of archiving ----
t('publishing and archiving are two different flags', () => {
  // archiving hides a table and deliberately LEAVES its form open; this closes the form and
  // leaves the table where it is. restart_form uses is_active to freeze the old copy.
  assert.ok(!/function setFormLive\([\s\S]{0,600}?archived/.test(SRC), 'setFormLive touches the archived flag');
  assert.ok(!/function setTableArchived\([\s\S]{0,600}?is_active/.test(SRC), 'archiving writes is_active');
});
t('the archive confirm still promises the link keeps working', () => {
  // that promise is only true because archiving does not touch is_active — if the two flags
  // are ever merged, this is the test that should fail
  const s = SRC.match(/function archiveConfirmText\([\s\S]*?\n  \}/)[0];
  assert.ok(/keep working/.test(s), 'the archive confirm no longer promises the link keeps working');
});

console.log(n + ' form-live tests passed');
