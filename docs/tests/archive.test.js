// Archiving a table instead of deleting it. The whole feature is one flag in the table's own
// config, so the tests are about that flag: that setting it never disturbs anything else in
// the config, that clearing it leaves nothing behind, and that "is this archived" answers the
// same way for the 219 imported tables that were flagged long before there was a menu for it.
//
// The write itself (one PostgREST update of app_tables.config) is not tested here; what is
// tested is the object handed to it, because a config rebuilt carelessly is how a table loses
// its columns, stages or capacity window while being tidied away.
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

const API = load('index.html', ['isArchived', 'archivedConfig', 'archiveConfirmText']);
const SRC = scripts('index.html');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- reading the flag ----
t('a table with no config at all is not archived', () => {
  assert.strictEqual(API.isArchived({ id: 'x' }), false);
  assert.strictEqual(API.isArchived({ id: 'x', config: null }), false);
  assert.strictEqual(API.isArchived({ id: 'x', config: {} }), false);
});
t('no table is not archived either, rather than throwing', () => {
  // the sidebar paints before anything is loaded and the header reads it on every open
  assert.strictEqual(API.isArchived(null), false);
  assert.strictEqual(API.isArchived(undefined), false);
});
t('the flag the imported tables already carry still reads as archived', () => {
  // 219 migrated Airtable tables were flagged before this menu existed; the menu must not
  // introduce a second, different way of saying the same thing
  assert.strictEqual(API.isArchived({ config: { archived: true } }), true);
});
t('archived: false is not archived', () => {
  assert.strictEqual(API.isArchived({ config: { archived: false } }), false);
});
t('the answer is a boolean, not the flag itself', () => {
  // it is used in string concatenation and class names; a truthy object would print
  assert.strictEqual(API.isArchived({ config: { archived: 'yes' } }), true);
});

// ---- building the new config ----
const RICH = Object.freeze({
  table_columns: ['f1', 'f2'], statuses: [{ k: 'new' }], capacity: { places: 20 },
  parent: { table: 'p-1' }, branch: 'Abdoun'
});
t('archiving keeps every other key exactly as it was', () => {
  const out = API.archivedConfig(RICH, true, '2026-08-15T10:00:00.000Z', 'u-1');
  assert.deepStrictEqual(out.table_columns, ['f1', 'f2']);
  assert.deepStrictEqual(out.statuses, [{ k: 'new' }]);
  assert.deepStrictEqual(out.capacity, { places: 20 });
  assert.deepStrictEqual(out.parent, { table: 'p-1' });
  assert.strictEqual(out.branch, 'Abdoun');
});
t('archiving sets the flag, the time and who did it', () => {
  const out = API.archivedConfig({}, true, '2026-08-15T10:00:00.000Z', 'u-1');
  assert.strictEqual(out.archived, true);
  assert.strictEqual(out.archived_at, '2026-08-15T10:00:00.000Z');
  assert.strictEqual(out.archived_by, 'u-1');
});
t('the config passed in is never mutated', () => {
  // the caller keeps its object on t.config until the write comes back; mutating it would
  // leave the page showing a table as archived even when the database refused
  const before = { table_columns: ['f1'] };
  const out = API.archivedConfig(before, true, '2026-08-15T10:00:00.000Z', 'u-1');
  assert.strictEqual(before.archived, undefined);
  assert.notStrictEqual(out, before);
});
t('a table that never had a config can still be archived', () => {
  assert.strictEqual(API.archivedConfig(null, true, '2026-08-15T10:00:00.000Z', 'u-1').archived, true);
  assert.strictEqual(API.archivedConfig(undefined, true, null, null).archived, true);
});
t('a missing time or user writes no key rather than a null one', () => {
  // config is read by SQL as well as by the page; "archived_at": null reads as a recorded
  // absence of a time, which is not what an old browser failing to give one means
  const out = API.archivedConfig({}, true, null, null);
  assert.ok(!('archived_at' in out));
  assert.ok(!('archived_by' in out));
});

// ---- restoring ----
t('restoring clears the flag and leaves no trace of it', () => {
  const arch = API.archivedConfig(RICH, true, '2026-08-15T10:00:00.000Z', 'u-1');
  const back = API.archivedConfig(arch, false);
  assert.ok(!('archived' in back), 'archived is still a key');
  assert.ok(!('archived_at' in back), 'archived_at survived the restore');
  assert.ok(!('archived_by' in back), 'archived_by survived the restore');
  assert.strictEqual(API.isArchived({ config: back }), false);
});
// archivedConfig builds its object inside the vm, so a plain deepStrictEqual against an
// object made out here fails on the prototype alone. Compare what would actually be written.
const asWritten = o => JSON.parse(JSON.stringify(o));
t('restoring keeps everything else, so a round trip changes nothing', () => {
  const back = API.archivedConfig(API.archivedConfig(RICH, true, '2026-08-15T10:00:00.000Z', 'u-1'), false);
  assert.deepStrictEqual(asWritten(back), asWritten(RICH));
});
t('restoring a table that was never archived is harmless', () => {
  assert.deepStrictEqual(asWritten(API.archivedConfig(RICH, false)), asWritten(RICH));
  assert.deepStrictEqual(asWritten(API.archivedConfig(null, false)), {});
});

// ---- what the person is told before it happens ----
t('the confirm names the table', () => {
  assert.ok(API.archiveConfirmText({ name: 'Hackthon sign up' }).indexOf('Hackthon sign up') !== -1);
});
t('a nameless table still asks a sentence rather than an empty one', () => {
  assert.ok(API.archiveConfirmText({}).indexOf('this table') !== -1);
  assert.ok(API.archiveConfirmText(null).indexOf('this table') !== -1);
});
t('the confirm promises no deletion and says it is reversible', () => {
  const s = API.archiveConfirmText({ name: 'X' });
  assert.ok(/nothing is deleted/i.test(s), 'does not say nothing is deleted');
  assert.ok(/put it back/i.test(s), 'does not say it can be undone');
});
t('the confirm warns that the public form stays open', () => {
  // the one thing archiving deliberately does not do. Someone tidying a table away would
  // otherwise assume the printed QR code stopped working, and it has not.
  const s = API.archiveConfirmText({ name: 'X' });
  assert.ok(/QR/.test(s) && /keep working/.test(s), 'does not say the link keeps working');
});

// ---- the page wiring, read as source ----
// These are one-line mistakes that a reviewer's eye slides over and that only show up as
// "the button does nothing" or, worse, as a deleted table.
t('archiving is confirmed before it happens, in both menus', () => {
  const calls = SRC.match(/setTableArchived\((?:ctx\.table|t), true\)/g) || [];
  assert.strictEqual(calls.length, 2, 'expected the sidebar menu and the table header menu');
  const guarded = SRC.match(/window\.confirm\(archiveConfirmText\([^)]*\)\)\) setTableArchived\((?:ctx\.table|t), true\)/g) || [];
  assert.strictEqual(guarded.length, 2, 'an archive path runs without asking first');
});
t('restoring is not put behind a confirm', () => {
  // it puts a table back exactly as it was; asking would be noise
  assert.ok(/setTableArchived\(ctx\.table, false\)/.test(SRC));
  assert.ok(/setTableArchived\(t, false\)/.test(SRC));
});
t('archive never falls through to the delete branch', () => {
  assert.ok(/act === "archive"/.test(SRC) && /act === "unarchive"/.test(SRC),
    'the menu actions are not both handled');
});
t('only an admin can archive or restore', () => {
  assert.ok(/function setTableArchived\(t, on\) \{\s*\n\s*if \(!t \|\| !isAdmin\) return;/.test(SRC),
    'setTableArchived is not gated on isAdmin');
});
t('the sidebar and the count read the flag through the same helper', () => {
  // two hand-written copies of `t.config && t.config.archived` is how a table ends up
  // hidden from the list but missing from the Archived count
  assert.strictEqual((SRC.match(/config\.archived/g) || []).length, 1,
    'the flag is read raw somewhere other than isArchived');
});

console.log(n + ' archive tests passed');
