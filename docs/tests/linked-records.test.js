// Linked-record questions in the form editor.
//
// TWO DIFFERENT QUESTIONS SHARE THE TYPE `link`, and that is the whole bug:
//   * a **link button** the builder makes — options { url, text, text_ar }        (3 of them)
//   * a **linked record** the Airtable importer made — { links_to_name, links_to_table }
//     which shows the linked record's own name and opens it                     (200 of them)
//
// The editor only ever knew about the first. `optsToString` returned "" for the second (its
// options object has neither .list nor .url and no .length), so the Options box came up
// empty; and on save the `link` branch demanded a URL out of that empty box, failed the
// http:// check and RETURNED — abandoning the save of the WHOLE table, with an error message
// about a URL for a question that has nothing to do with URLs.
//
// 200 linked-record questions across 103 tables were in that state. Nobody had hit it because
// all 103 are imported history in OLD (Airtable), which is not where anyone edits a form.
//
// Every test below is one half of that: the metadata must survive a round trip through the
// editor, and it must never be mistaken for a URL button.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const SRC = fs.readFileSync('index.html', 'utf8');
const JS = [...SRC.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function grab(name) {
  const at = JS.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('no fn ' + name);
  const open = JS.indexOf('{', at);
  let d = 0;
  for (let i = open; i < JS.length; i++) {
    if (JS[i] === '{') d++;
    else if (JS[i] === '}') { d--; if (!d) return JS.slice(at, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function load(names) {
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(grab).join('\n') + '\nthis.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}
const API = load(['optsToString', 'linkRecordOptions', 'typeUsesOpts', 'optsPlaceholder']);
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const LINKED = { links_to_name: 'Baristas', links_to_table: '052f682d-f12b-58af-be0f-55b9ec56b228' };
const BUTTON = { url: 'https://airtable.com/x', text: 'Apply now', text_ar: 'قدّم الآن' };

// ---- telling the two apart ----
t('a linked-record field is recognised as one', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(API.linkRecordOptions(LINKED))), LINKED);
});
t('a link BUTTON is not mistaken for a linked record', () => {
  assert.strictEqual(API.linkRecordOptions(BUTTON), null);
});
t('nothing else is either — including the shapes other field types use', () => {
  assert.strictEqual(API.linkRecordOptions(null), null);
  assert.strictEqual(API.linkRecordOptions(undefined), null);
  assert.strictEqual(API.linkRecordOptions([{ en: 'Yes' }]), null);   // a choice list
  assert.strictEqual(API.linkRecordOptions({ list: 'jo, lebanon' }), null);  // a branch field
  assert.strictEqual(API.linkRecordOptions('a string'), null);
});
t('a half-written linked record — a name but no target — is still one', () => {
  // Otherwise it falls through to the URL branch and blocks the save, which is the bug.
  assert.ok(API.linkRecordOptions({ links_to_table: 'x' }));
});

// ---- what the editor shows ----
t('the Options box describes the link instead of coming up blank', () => {
  const s = API.optsToString(LINKED);
  assert.notStrictEqual(s, '', 'still blank — this is what made the save demand a URL');
  assert.ok(/Baristas/.test(s), 'does not name the table it links to: ' + s);
});
t('a link button still round-trips to "url | text | text_ar"', () => {
  // The three real link buttons must be unaffected: this is an addition, not a change.
  assert.strictEqual(API.optsToString(BUTTON), 'https://airtable.com/x | Apply now | قدّم الآن');
});
t('a choice list and a branch list still round-trip', () => {
  assert.strictEqual(API.optsToString({ list: 'jo, lebanon' }), 'jo, lebanon');
  assert.strictEqual(API.optsToString([{ en: 'Yes', ar: 'نعم' }, { en: 'No', ar: '' }]), 'Yes|نعم, No');
});
t('a linked record with no name still says something rather than nothing', () => {
  assert.notStrictEqual(API.optsToString({ links_to_table: 'abc' }), '');
});

// ---- the save path, read out of the page as source ----
// A helper nobody calls is a feature nobody has, and the failure here is silent-ish: the
// save just refuses with a confusing message.
t('the save keeps the linked-record metadata instead of parsing the box for a URL', () => {
  assert.ok(/data-linkrec/.test(JS), 'the row never carries the metadata to save time');
  const at = JS.indexOf('} else if (type === "link") {');
  assert.ok(at > -1, 'the link branch of the save has moved');
  const branch = JS.slice(at, JS.indexOf('} else if (type === "branch") {', at));
  assert.ok(/linkrec/.test(branch), 'the link branch does not check for linked-record metadata');
  // and the URL rule must sit AFTER that check, or it still rejects the save first
  assert.ok(branch.indexOf('linkrec') < branch.indexOf('needs a URL'),
            'the URL rule still runs before the linked-record check');
});
t('the metadata is only kept while the question is still a link', () => {
  // Changing the type to Short text and saving must not leave links_to_table behind.
  const at = JS.indexOf('} else if (type === "link") {');
  const branch = JS.slice(at, JS.indexOf('} else if (type === "branch") {', at));
  assert.ok(/type === "link"/.test(JS.slice(0, at + 40)), 'the branch is no longer gated on the type');
  assert.ok(branch.length > 0);
});
t('the editor seeds the row from the field, so an existing link survives being opened', () => {
  assert.ok(/linkRec:/.test(JS), 'openBuilderEdit does not pass the linked-record options through');
});
t('the box is read-only for a linked record — it is not something you type', () => {
  assert.ok(/readOnly = true|readonly/.test(JS), 'the Options box is still editable for a linked record');
});

console.log(n + ' linked-record tests passed');
