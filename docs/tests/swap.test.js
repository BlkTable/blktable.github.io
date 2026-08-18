// Moving somebody between confirmed and backup. What is testable here is what the dashboard
// offers and shows; the two rules that actually protect the count live in the database
// (13-swap-and-promote.sql) and are called out at the bottom of this file.
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

const A = load('index.html', ['slotPillHtml', 'slotActions', 'slotCountText']);
const SRC = scripts('index.html');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- the pill ----
t('a record with no place shows no pill at all', () => {
  // every one of the 226 existing tables is this case
  assert.strictEqual(A.slotPillHtml({ id: 'x' }), '');
  assert.strictEqual(A.slotPillHtml({ id: 'x', slot: null }), '');
  assert.strictEqual(A.slotPillHtml(null), '');
});
t('confirmed and backup do not read alike', () => {
  const c = A.slotPillHtml({ slot: 'confirmed' }), b = A.slotPillHtml({ slot: 'backup' });
  assert.ok(/Confirmed/.test(c), c);
  assert.ok(/Backup/.test(b), b);
  assert.notStrictEqual(c, b);
  // different colour, not just different words, so a wall of cards reads at a glance
  assert.ok(/good/.test(c) && /warn/.test(b), c + ' / ' + b);
});
t('the pill uses classes that exist in the stylesheet', () => {
  // .sc-gold does not exist; .pill good / .pill warn do. A pill with no rule is invisible.
  ['pill good', 'pill warn'].forEach(cls => {
    const sel = '.' + cls.split(' ').join('.');
    assert.ok(SRC.indexOf(sel) !== -1 || fs.readFileSync('index.html', 'utf8').indexOf(sel) !== -1,
      'no CSS rule for ' + sel);
  });
});

// ---- what the kebab offers ----
t('nothing is offered on a record that holds no place', () => {
  assert.deepStrictEqual(A.slotActions({ id: 'x' }, true).length, 0);
});
t('nothing is offered to somebody who cannot manage the table', () => {
  // the RPC refuses them anyway; offering it is a worse way to say no
  assert.strictEqual(A.slotActions({ slot: 'confirmed' }, false).length, 0);
});
t('a confirmed person can only be moved to backup', () => {
  const a = A.slotActions({ slot: 'confirmed' }, true);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].slot, 'backup');
  assert.strictEqual(a[0].type, 'slot');
});
t('a backup person can only be given a place', () => {
  const a = A.slotActions({ slot: 'backup' }, true);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].slot, 'confirmed');
});
t('the move you are already on is never offered', () => {
  assert.ok(A.slotActions({ slot: 'confirmed' }, true).every(x => x.slot !== 'confirmed'));
  assert.ok(A.slotActions({ slot: 'backup' }, true).every(x => x.slot !== 'backup'));
});
t('every action carries a label, so the menu never renders a blank row', () => {
  ['confirmed', 'backup'].forEach(slot => {
    A.slotActions({ slot }, true).forEach(a => assert.ok(a.label && a.label.length > 3, slot));
  });
});
t('a place move is intercepted before the WhatsApp/Call/Email dispatcher', () => {
  // it is carried as an ordinary record action to reuse the menu, so the handler MUST branch
  // on the type or "Move to backup" would try to send a message. Notify (2026-08-18) rides in
  // the same menu the same way, so the check is on the ORDER of the branches rather than on
  // one exact line — adding a third pseudo-action must not be able to silently reorder them.
  const m = SRC.match(/function \(a\) \{[\s\S]{0,400}?doRecordAction\(a, s, fields\);/);
  assert.ok(m, 'the record-menu dispatcher was not found');
  const body = m[0], send = body.indexOf('doRecordAction');
  assert.ok(body.includes('a.type === "slot"') && body.indexOf('a.type === "slot"') < send,
    'the slot action is not intercepted before doRecordAction');
  assert.ok(body.includes('a.type === "notify"') && body.indexOf('a.type === "notify"') < send,
    'the notify action is not intercepted before doRecordAction');
});

// ---- the count line ----
t('a table where nothing holds a place adds nothing to the count', () => {
  assert.strictEqual(A.slotCountText([]), '');
  assert.strictEqual(A.slotCountText([{ id: 1 }, { id: 2 }]), '');
  assert.strictEqual(A.slotCountText(null), '');
});
t('confirmed and backup are counted separately', () => {
  const subs = [{ slot: 'confirmed' }, { slot: 'confirmed' }, { slot: 'backup' }];
  assert.strictEqual(A.slotCountText(subs), ' · 2 confirmed · 1 backup');
});
t('no backup means the backup half is left off entirely', () => {
  assert.strictEqual(A.slotCountText([{ slot: 'confirmed' }]), ' · 1 confirmed');
});
t('rows with no place do not count towards either', () => {
  const subs = [{ slot: 'confirmed' }, { id: 'no slot' }, { slot: null }, { slot: 'backup' }];
  assert.strictEqual(A.slotCountText(subs), ' · 1 confirmed · 1 backup');
});
t('a backup with no confirmed still reports honestly', () => {
  assert.strictEqual(A.slotCountText([{ slot: 'backup' }]), ' · 0 confirmed · 1 backup');
});

// ---- what is NOT tested here, on purpose ----
// 1. The trigger promotes the OLDEST backup on a delete, and fires on DELETE ONLY — if it
//    also fired on a manual demotion it would re-promote the oldest backup into the place
//    just freed and Faisal could never swap A out for B.
// 2. set_signup_slot REFUSES a promotion into a full set of places, under a lock on the
//    event so it cannot race a signup arriving on the public form.
// Both are database behaviour with no browser half to reach from here, and both are checked
// by the queries at the foot of 13-swap-and-promote.sql.

console.log(n + ' swap tests passed');
