// What a save must NOT throw away. `app_fields.options` is a shared box: the question
// editor writes a link button's URL, a branch question's shop list and a country scope into
// it, but a scoring rule (`score`, `score_fmt`), a display pairing (`score_of`, `scorer`,
// `score_section`, `score_weight`) and an importer's own metadata live there too — put there
// by SQL the editor has never heard of. The editor rebuilds the whole object from the boxes
// on screen and PATCHes every field on the table, touched or not, so one Save used to erase
// every key it does not itself write.
//
// It did: on 2026-08-31 a save on Shop Audit wiped all 68 of its scoring rules, and the next
// audit submitted (Khalda, the next morning) scored 0 out of 68 with none of the 68 per-answer
// score columns filled. Shop Spot Check (QC) kept its 70 only because nobody opened it.
//
// keptOptions is the half of the fix that is pure: given a field's stored options, what has to
// go back untouched. The other half — that the row carries it and the save hands it over — is
// DOM, and lives in options-kept.chrome.js.
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

const { keptOptions, linkRecordOptions } = load('index.html', ['keptOptions', 'linkRecordOptions']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
// Objects built inside the vm carry that realm's prototype, so deepStrictEqual rejects them
// against a literal written out here. Compare the shape (the same note is in scoring-options).
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg ||
  ('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)));

// ---- the rule the save erased ----
// The exact shape of one of Shop Audit's 68, as compute_scores() reads it.
const scoreRule = { score: { kind: 'match', source: 'a8daced3', expect: 'Yes', points: 1, else: 0 } };
t('a scoring rule is kept', () => same(keptOptions(scoreRule), scoreRule));
t('a percent format is kept', () =>
  same(keptOptions({ score: { kind: 'truthy' }, score_fmt: 'percent' }),
       { score: { kind: 'truthy' }, score_fmt: 'percent' }));
t('a format with no rule beside it is still kept', () =>
  same(keptOptions({ score_fmt: 'percent' }), { score_fmt: 'percent' }));
t('the display pairing is kept', () =>
  same(keptOptions({ score_of: 'q1', score_section: 'Cleanliness', score_weight: 3 }),
       { score_of: 'q1', score_section: 'Cleanliness', score_weight: 3 }));
t('a question pointing at its scorer is kept', () =>
  same(keptOptions({ scorer: 'f9' }), { scorer: 'f9' }));

// ---- what the editor writes for itself, and must be free to rewrite ----
t('a link button is the editor’s own', () =>
  same(keptOptions({ url: 'https://x.test', text: 'Open', text_ar: '' }), null));
t('a branch question’s shop list is the editor’s own', () =>
  same(keptOptions({ list: 'jo' }), null));
t('a country scope is the editor’s own', () => same(keptOptions({ only: ['jo', 'lb'] }), null));
// linkRecordOptions already carries this one on to the row and back; keeping it here too
// would be the same fact in two places, free to disagree.
t('a linked record is left to data-linkrec', () =>
  same(keptOptions({ links_to_name: 'Shops', links_to_table: 'tbl123' }), null));

// ---- answers are a list, and a list holds nothing else ----
// Every reader of a priced choice list does `Array.isArray(f.options) ? f.options : []`, so an
// array is the only shape a choice question can be stored in and there is nothing to keep.
t('answers carry nothing to keep', () =>
  same(keptOptions([{ en: 'Spotless', points: 3 }, { en: 'Filthy', points: 0 }]), null));
t('an empty answer list keeps nothing', () => same(keptOptions([]), null));

// ---- nothing there ----
t('no options keeps nothing', () => same(keptOptions(null), null));
t('undefined keeps nothing', () => same(keptOptions(undefined), null));
t('an empty object keeps nothing rather than an empty object', () => same(keptOptions({}), null));
// null is what the column held before; {} would read as "set" and is a different value.
t('nothing to keep is null, not {}', () => assert.strictEqual(keptOptions({ url: 'https://x.test' }), null));

// ---- mixed ----
t('a rule beside a branch list keeps only the rule', () =>
  same(keptOptions({ score: { kind: 'truthy' }, list: 'jo' }), { score: { kind: 'truthy' } }));
// The editor cannot know what it is looking at, so "not mine" is the whole test. 248 fields
// carry the Airtable importer's own metadata and no code reads it; a save that drops it is
// still a save that destroyed something somebody may need.
t('metadata nobody reads yet is kept', () =>
  same(keptOptions({ operate_qid: 'q7', operate_type: 'photo', allow_photo: true }),
       { operate_qid: 'q7', operate_type: 'photo', allow_photo: true }));
t('a from-parent pointer is kept', () =>
  same(keptOptions({ source: 'f1', from_parent: true, show: ['name'] }),
       { source: 'f1', from_parent: true, show: ['name'] }));

// ---- the page is still holding the object it was given ----
// The field rows loaded into the editor are the same objects the grid renders from, so a
// helper that hands back the stored object lets a later edit reach into live state.
t('the kept options are a copy, not the stored object', () => {
  const stored = { score: { kind: 'truthy' } };
  const got = keptOptions(stored);
  assert.notStrictEqual(got, stored, 'handed back the stored object itself');
  delete got.score;
  same(stored, { score: { kind: 'truthy' } }, 'editing the copy changed the stored options');
});

// ---- the two helpers divide the object between them ----
// A linked record must come out of exactly one of them, or the save writes it twice or not
// at all.
t('linked-record metadata belongs to one helper only', () => {
  const lr = { links_to_name: 'Shops', links_to_table: 'tbl123' };
  assert.ok(linkRecordOptions(lr), 'linkRecordOptions should claim it');
  assert.strictEqual(keptOptions(lr), null, 'keptOptions should not claim it too');
});
// ...but a rule sitting on a linked record is still nobody else's job.
t('a rule on a linked record is still kept', () =>
  same(keptOptions({ links_to_table: 'tbl123', score_fmt: 'percent' }), { score_fmt: 'percent' }));

// ---- a helper nobody calls is a feature nobody has ----
// The rest of this is DOM and is driven in options-kept.chrome.js. What cannot be driven there
// is the editor OPENING: every field row has to be handed what it must keep, or the row carries
// nothing, the save finds nothing to put back, and all of the above passes while a save still
// erases every rule on the table. There are two editors and they are separate code.
const source = fs.readFileSync('index.html', 'utf8');
const opens = [...source.matchAll(/addBuilderField\(\{\s*id: f\.id[\s\S]{0,600}?\}\)/g)].map(m => m[0]);
t('both editors open a saved field', () => assert.strictEqual(opens.length, 2,
  'expected 2 places that open a saved field into the builder, found ' + opens.length));
opens.forEach((call, i) => {
  t('editor ' + (i + 1) + ' carries what it must keep onto the row', () =>
    assert.ok(/keepOpts:\s*keptOptions\(f\.options\)/.test(call),
      'this addBuilderField call does not pass keepOpts: ' + call.slice(0, 160)));
});
// And the save has to read it back rather than writing a bare null over it.
t('the save hands back what it does not own', () =>
  assert.ok(/return \{ options: mergeKept\(row, null\) \};/.test(source),
    'rowOptionsForSave still returns a bare null for every unhandled type'));

if (!process.exitCode) console.log('ok - ' + n + ' assertions');
