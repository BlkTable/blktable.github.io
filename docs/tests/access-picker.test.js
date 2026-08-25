// The access picker — one searchable list used both ways round: "which tables can this
// person see" (New/Edit user) and "who can see this table" (Share). Before it, both modals
// printed every row with three checkboxes and no search, so granting one table out of 118
// meant scrolling 118 rows, and the level was two dependent tickboxes rather than one word.
//
// The rules worth protecting are the ones where a wrong answer changes somebody's
// permissions: the level a stored grant reads as, and — the one that matters most — that a
// row the admin did not touch is written back exactly as it was stored. Collapsing three
// checkboxes into one level means "manager" now implies "can edit"; rows written before that
// (manager without edit, if any exist) must not be silently widened by an admin who opened
// the modal to change somebody's name.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
function load(names){const js=scripts('index.html');const body=names.map(n=>grab(js,n)).join('\n');const ctx={console,crypto:require('crypto').webcrypto};vm.createContext(ctx);new vm.Script('(function(){'+body+'\nthis.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}
const API = load(['accessLevelOf','accessGrantFor','pickerMatch','pickerRows','pickerCountText','newTempPassword','inviteText']);
const asWritten = o => JSON.parse(JSON.stringify(o));
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- What a stored grant reads as -------------------------------------------------
t('a plain grant is view', () => {
  assert.strictEqual(API.accessLevelOf({ can_edit: false, can_manage: false }), 'view');
});
t('can_edit reads as edit', () => {
  assert.strictEqual(API.accessLevelOf({ can_edit: true, can_manage: false }), 'edit');
});
t('can_manage reads as manager whatever can_edit says', () => {
  assert.strictEqual(API.accessLevelOf({ can_edit: true, can_manage: true }), 'manage');
  assert.strictEqual(API.accessLevelOf({ can_edit: false, can_manage: true }), 'manage');
});
t('a row with no grant at all is view, not a crash', () => {
  assert.strictEqual(API.accessLevelOf(null), 'view');
  assert.strictEqual(API.accessLevelOf({}), 'view');
});
t('postgres text t/f is not read as two trues', () => {
  // .select() returns booleans, but a hand-written row or a changed driver could hand
  // back 'f', which is truthy in JS and would promote every viewer to a manager.
  assert.strictEqual(API.accessLevelOf({ can_edit: 'f', can_manage: 'f' }), 'view');
});

// ---- What gets written back -------------------------------------------------------
t('choosing manager grants edit too', () => {
  assert.deepStrictEqual(asWritten(API.accessGrantFor('manage', null)), { can_edit: true, can_manage: true });
});
t('choosing edit does not grant manage', () => {
  assert.deepStrictEqual(asWritten(API.accessGrantFor('edit', null)), { can_edit: true, can_manage: false });
});
t('choosing view clears both', () => {
  assert.deepStrictEqual(asWritten(API.accessGrantFor('view', { can_edit: true, can_manage: true })), { can_edit: false, can_manage: false });
});
t('an untouched manager row is written back exactly as stored', () => {
  // The row already says manager-without-edit. The admin did not touch it. Re-deriving
  // the grant from the level would hand that person edit rights nobody granted.
  const stored = { can_edit: false, can_manage: true };
  assert.deepStrictEqual(asWritten(API.accessGrantFor('manage', stored)), { can_edit: false, can_manage: true });
});
t('changing a manager row to edit does re-derive it', () => {
  const stored = { can_edit: false, can_manage: true };
  assert.deepStrictEqual(asWritten(API.accessGrantFor('edit', stored)), { can_edit: true, can_manage: false });
});
t('an untouched view row stays a view row', () => {
  const stored = { can_edit: false, can_manage: false };
  assert.deepStrictEqual(asWritten(API.accessGrantFor('view', stored)), { can_edit: false, can_manage: false });
});

// ---- Searching --------------------------------------------------------------------
const ITEMS = [
  { key: 'a', name: 'Job Applications' },
  { key: 'b', name: 'Handover Sheet', alt: 'كشف التسليم' },
  { key: 'c', name: 'BLK Casting' },
  { key: 'd', name: 'Ali Najjar', sub: 'a.najjar@blk.jo' }
];
t('an empty query matches everything', () => {
  assert.strictEqual(ITEMS.filter(i => API.pickerMatch(i, '')).length, 4);
  assert.strictEqual(ITEMS.filter(i => API.pickerMatch(i, '   ')).length, 4);
});
t('a query matches part of a name, ignoring case', () => {
  assert.deepStrictEqual(ITEMS.filter(i => API.pickerMatch(i, 'HAND')).map(i => i.key), ['b']);
});
t('the second line is searchable too, so an email finds a person', () => {
  assert.deepStrictEqual(ITEMS.filter(i => API.pickerMatch(i, 'najjar@blk')).map(i => i.key), ['d']);
});
t('an arabic name finds its table', () => {
  assert.deepStrictEqual(ITEMS.filter(i => API.pickerMatch(i, 'التسليم')).map(i => i.key), ['b']);
});
t('a query that matches nothing matches nothing', () => {
  assert.strictEqual(ITEMS.filter(i => API.pickerMatch(i, 'payroll')).length, 0);
});

// ---- Ordering ---------------------------------------------------------------------
t('what is already picked is listed first', () => {
  const rows = API.pickerRows(ITEMS, { c: { level: 'view' } }, '');
  assert.deepStrictEqual(rows.map(r => r.key), ['c', 'a', 'b', 'd']);
});
t('order is otherwise left alone', () => {
  // The list arrives in the order the sidebar shows; re-sorting it alphabetically would
  // shuffle 118 tables out from under somebody who knows where theirs sits.
  assert.deepStrictEqual(API.pickerRows(ITEMS, {}, '').map(r => r.key), ['a', 'b', 'c', 'd']);
});
t('a picked row that the search excludes stays hidden', () => {
  // Otherwise "select all 3 matches" would be sitting under a list of 4.
  const rows = API.pickerRows(ITEMS, { a: { level: 'view' } }, 'casting');
  assert.deepStrictEqual(rows.map(r => r.key), ['c']);
});

// ---- The count line ---------------------------------------------------------------
t('nothing picked says so in words', () => {
  assert.strictEqual(API.pickerCountText(0, 118, 'tables'), 'No tables selected');
});
t('the count names the total, so the list length is never a surprise', () => {
  assert.strictEqual(API.pickerCountText(3, 118, 'tables'), '3 of 118 tables selected');
  assert.strictEqual(API.pickerCountText(1, 118, 'tables'), '1 of 118 tables selected');
});
t('the noun is the caller\'s, because the same list holds people', () => {
  assert.strictEqual(API.pickerCountText(2, 9, 'people'), '2 of 9 people selected');
  assert.strictEqual(API.pickerCountText(0, 9, 'people'), 'No people selected');
});

// ---- The temporary password -------------------------------------------------------
t('a generated password clears the eight-character floor', () => {
  for (let i = 0; i < 50; i++) assert.ok(API.newTempPassword().length >= 8, 'too short');
});
t('two generated passwords are not the same password', () => {
  const seen = {}; for (let i = 0; i < 50; i++) seen[API.newTempPassword()] = 1;
  assert.ok(Object.keys(seen).length > 45, 'generator repeats itself');
});
t('a generated password holds nothing that reads two ways over WhatsApp', () => {
  // It is read off a screen and typed by somebody else. l/1/I/O/0 are the whole reason
  // a "wrong password" support message happens.
  for (let i = 0; i < 50; i++) assert.ok(!/[lI1O0]/.test(API.newTempPassword()), 'ambiguous character');
});

// ---- The invite ------------------------------------------------------------------
t('the invite carries the two things they cannot log in without', () => {
  const txt = API.inviteText('Sara', 'sara@blk.jo', 'Kfz-4821', 'https://blktable.blk.jo');
  assert.ok(txt.indexOf('sara@blk.jo') > -1, 'no email');
  assert.ok(txt.indexOf('Kfz-4821') > -1, 'no password');
  assert.ok(txt.indexOf('https://blktable.blk.jo') > -1, 'no address to log in at');
});
t('the invite is addressed to the person', () => {
  assert.ok(API.inviteText('Sara', 'sara@blk.jo', 'x', 'y').indexOf('Sara') > -1);
});
t('a nameless account still produces a sendable invite', () => {
  const txt = API.inviteText('', 'sara@blk.jo', 'Kfz-4821', 'https://blktable.blk.jo');
  assert.ok(txt.indexOf('undefined') === -1 && txt.indexOf('null') === -1, 'placeholder leaked');
  assert.ok(txt.indexOf('Kfz-4821') > -1);
});

// ---- Read the page as source ------------------------------------------------------
// A helper nobody calls is a feature nobody has: these assert the two modals actually
// went through the picker, and that the old hand-rolled lists are gone rather than left
// beside it, quietly answering first.
const SRC = fs.readFileSync('index.html', 'utf8');
t('both lists are built by the one picker', () => {
  const calls = (SRC.match(/accessPicker\(/g) || []).length;
  assert.ok(calls >= 3, 'expected the definition plus both callers, found ' + calls);
});
t('the old per-row checkbox classes are gone', () => {
  ['u-acc', 'u-can-edit', 'u-can-manage', 'sh-acc', 'sh-edit', 'sh-manage'].forEach(function (c) {
    assert.strictEqual(SRC.indexOf(c), -1, c + ' still in the page');
  });
});
t('the user modal reads its access out of the picker', () => {
  assert.ok(/uPicker\s*(&&\s*uPicker)?\.value\(\)/.test(SRC), 'user modal does not read uPicker.value()');
});
t('the share modal reads its rows out of the picker', () => {
  assert.ok(/sharePicker\s*(&&\s*sharePicker)?\.value\(\)/.test(SRC), 'share modal does not read sharePicker.value()');
});
t('creating an account no longer ends in a browser alert', () => {
  // The alert said "share the temporary password" and gave nothing to copy.
  assert.strictEqual(SRC.indexOf('Account created for'), -1, 'the old alert is still there');
});
t('the search box is in the picker rather than in one modal', () => {
  // Two search inputs written by hand is how the two lists drift apart again.
  assert.strictEqual((SRC.match(/class="ap-search"/g) || []).length, 1);
});

if (!process.exitCode) console.log('ok ' + n + ' tests');
