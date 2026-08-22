// "Customize cards": which file question is the cover, cropped or fitted, which fields the
// card carries and in what order, and whether their names show. Airtable puts that behind a
// panel on a gallery view; here it is one rule for every table, so these tests are written
// with a made-up table and made-up fields — the day it is pointed at a real one they still
// describe the rule rather than the form that happened to need it first.
//
// The rule has three levels and the whole point is which one wins: this browser (localStorage)
// over the table's saved default (app_tables.config) over the behaviour every card had before
// the panel existed (first file question as cover, first three answers as fields). Nearly
// every test below is one of those precedences, because getting one wrong silently changes
// what 226 live tables look like.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
// Brace-matched (as in media-field.test.js), so a one-line function is taken whole instead of
// running on to the next "\n  }" and dragging whatever sits between them into the sandbox.
function grab(js, name) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('could not find function ' + name);
  const open = js.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') { depth--; if (!depth) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
function grabVar(js, name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [\\s\\S]*?;(?=\\r?\\n)'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
// A localStorage stub, because the per-browser half of the rule is the half most likely to
// break and testing it through a try/catch that swallows everything proves nothing.
const store = {};
const localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
function load(file, vars, fns) {
  const js = scripts(file);
  const code = vars.map(v => grabVar(js, v)).join('\n') + '\n' + fns.map(f => grab(js, f)).join('\n');
  const ctx = { console, localStorage };
  vm.createContext(ctx);
  new vm.Script('(function(){var cardServerPrefs={};\n' + code + '\n this.API={' + fns.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const { cardPrefs, summaryFields, cardChoosable, cardSave, cardKey, coverHtml } =
  load('index.html',
       ['VIDEO_EXT', 'IMAGE_EXT', 'PLAY_SVG', 'FILE_SVG'],
       ['cardPrefs', 'cardLocal', 'cardMine', 'cardHas', 'cardKey', 'cardSave', 'cardChoosable',
        'summaryFields', 'isFileField', 'coverHtml', 'isVideoPath', 'isImagePath']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const reset = () => { Object.keys(store).forEach(k => delete store[k]); };

const T = { id: 'tbl-1', config: {} };
const FIELDS = [
  { id: 'f-name', label: 'Full name', type: 'text' },
  { id: 'f-city', label: 'City', type: 'dropdown' },
  { id: 'f-note', label: 'Notes', type: 'long_text' },
  { id: 'f-age', label: 'Age', type: 'number' },
  { id: 'f-photo', label: 'Photo', type: 'photo' },
  { id: 'f-cv', label: 'CV', type: 'file' }
];
const ids = list => list.map(f => f.id);
// The page runs in a vm realm, so a list it built is not reference-equal to a list built here
// even when the contents match. Copied into this realm before comparing.
const here = list => Array.from(list || []);

// ---- the behaviour every card had before the panel existed ----
// This is the test that protects 226 live tables: with nothing configured and nothing chosen,
// a card must look exactly as it did — or this feature is a silent redesign of every table.
t('nothing chosen: first three non-file answers, first file question as cover, cropped, names on', () => {
  reset();
  const p = cardPrefs(T, FIELDS);
  assert.strictEqual(p.fields, null, 'no field list means the built-in default, not an empty card');
  assert.deepStrictEqual(ids(summaryFields(T, FIELDS)), ['f-name', 'f-city', 'f-note']);
  assert.strictEqual(p.cover, 'f-photo');
  assert.strictEqual(p.fit, 'crop');
  assert.strictEqual(p.labels, true);
});

// ---- the table's saved default ----
t('the saved fields beat the built-in default, in the order given', () => {
  reset();
  const tt = { id: 'tbl-2', config: { card_fields: ['f-age', 'f-name'] } };
  assert.deepStrictEqual(ids(summaryFields(tt, FIELDS)), ['f-age', 'f-name']);
});
t('a saved cover names the file question it means, not the first one', () => {
  reset();
  const tt = { id: 'tbl-3', config: { card_cover: 'f-cv' } };
  assert.strictEqual(cardPrefs(tt, FIELDS).cover, 'f-cv');
});
t('a saved fit and a saved names-off are read', () => {
  reset();
  const tt = { id: 'tbl-4', config: { card_cover_fit: 'fit', card_labels: false } };
  const p = cardPrefs(tt, FIELDS);
  assert.strictEqual(p.fit, 'fit');
  assert.strictEqual(p.labels, false);
});
// config.card_no_cover is what the tables that wanted no cover already carry. It has to keep
// meaning "no cover" or those tables grow one back on deploy.
t('the old card_no_cover flag still means no cover', () => {
  reset();
  assert.strictEqual(cardPrefs({ id: 'tbl-5', config: { card_no_cover: true } }, FIELDS).cover, null);
});
// The new key is the one the panel writes, so where a table carries both it decides — otherwise
// choosing a cover on a table that once opted out could never take effect.
t('card_cover outranks card_no_cover where a table carries both', () => {
  reset();
  const tt = { id: 'tbl-6', config: { card_no_cover: true, card_cover: 'f-photo' } };
  assert.strictEqual(cardPrefs(tt, FIELDS).cover, 'f-photo');
});

// ---- this browser ----
t('your own choice beats the saved default', () => {
  reset();
  const tt = { id: 'tbl-7', config: { card_fields: ['f-age'], card_cover: 'f-photo', card_cover_fit: 'crop', card_labels: true } };
  cardSave(tt, { fields: ['f-city', 'f-note'], cover: 'f-cv', fit: 'fit', labels: false });
  const p = cardPrefs(tt, FIELDS);
  assert.deepStrictEqual(here(p.fields), ['f-city', 'f-note']);
  assert.strictEqual(p.cover, 'f-cv');
  assert.strictEqual(p.fit, 'fit');
  assert.strictEqual(p.labels, false);
});
t('one table choice is not another table choice', () => {
  reset();
  const a = { id: 'tbl-a', config: {} }, b = { id: 'tbl-b', config: {} };
  cardSave(a, { cover: '' });
  assert.strictEqual(cardPrefs(a, FIELDS).cover, null);
  assert.strictEqual(cardPrefs(b, FIELDS).cover, 'f-photo', 'b must be untouched by the choice made on a');
  assert.notStrictEqual(cardKey(a), cardKey(b));
});
t('cardSave keeps the choices already made instead of replacing them', () => {
  reset();
  const tt = { id: 'tbl-8', config: {} };
  cardSave(tt, { fit: 'fit' });
  cardSave(tt, { labels: false });
  const p = cardPrefs(tt, FIELDS);
  assert.strictEqual(p.fit, 'fit', 'the second save must not wipe the first');
  assert.strictEqual(p.labels, false);
});
// "No cover" is a decision. Stored as "" it is falsy, so anything that tests the value rather
// than the presence of the key hands the card its cover straight back.
t('choosing None survives, rather than falling back to the first file question', () => {
  reset();
  const tt = { id: 'tbl-9', config: { card_cover: 'f-photo' } };
  cardSave(tt, { cover: '' });
  assert.strictEqual(cardPrefs(tt, FIELDS).cover, null);
});
t('Reset — removing your choice — goes back to the saved default, not to nothing', () => {
  reset();
  const tt = { id: 'tbl-10', config: { card_fields: ['f-age'], card_cover: 'f-cv' } };
  cardSave(tt, { fields: ['f-name'], cover: '' });
  localStorage.removeItem(cardKey(tt));
  const p = cardPrefs(tt, FIELDS);
  assert.deepStrictEqual(here(p.fields), ['f-age']);
  assert.strictEqual(p.cover, 'f-cv');
});
// A browser that refuses storage (private mode, storage full) must still draw cards.
t('unreadable storage falls back rather than throwing', () => {
  reset();
  store[cardKey(T)] = '{not json';
  const p = cardPrefs(T, FIELDS);
  assert.strictEqual(p.cover, 'f-photo');
  assert.strictEqual(p.fields, null);
});

// ---- a table whose fields have moved on ----
// Questions get deleted and retyped. A cover pointing at a question that is gone must not
// leave a permanently blank grey box that nobody can explain.
t('a cover naming a deleted question falls back to the default file question', () => {
  reset();
  const tt = { id: 'tbl-11', config: { card_cover: 'f-gone' } };
  assert.strictEqual(cardPrefs(tt, FIELDS).cover, 'f-photo');
});
t('a cover naming a question that is not a file at all is refused', () => {
  reset();
  const tt = { id: 'tbl-12', config: { card_cover: 'f-name' } };
  assert.strictEqual(cardPrefs(tt, FIELDS).cover, 'f-photo');
});
t('a table with no file question has no cover to fall back to', () => {
  reset();
  const plain = FIELDS.filter(f => f.type !== 'photo' && f.type !== 'file');
  assert.strictEqual(cardPrefs({ id: 'tbl-13', config: { card_cover: 'f-photo' } }, plain).cover, null);
});
t('a chosen field that no longer exists is dropped, and the rest still show', () => {
  reset();
  const tt = { id: 'tbl-14', config: { card_fields: ['f-gone', 'f-name'] } };
  assert.deepStrictEqual(ids(summaryFields(tt, FIELDS)), ['f-name']);
});
// An empty list is "nothing chosen", not "show no fields": the first chosen field IS the card's
// title, so an empty list would leave a card with no name and the panel with nothing to untick.
t('an empty list reads as nothing chosen, not as an empty card', () => {
  reset();
  const tt = { id: 'tbl-15', config: { card_fields: [] } };
  assert.strictEqual(cardPrefs(tt, FIELDS).fields, null);
  assert.strictEqual(summaryFields(tt, FIELDS).length, 3);
});

// ---- the two columns that are not answers ----
// The record's branch and its submitted date are columns on the row, not questions in it. The
// cards already understood them; the panel has to offer them or they are unreachable.
t('Branch and Submitted are offered, and survive being chosen', () => {
  reset();
  const offered = cardChoosable(FIELDS).map(f => f.id);
  assert.ok(offered.includes('__branch') && offered.includes('__created'), 'got: ' + offered.join(','));
  const tt = { id: 'tbl-16', config: { card_fields: ['__branch', 'f-name', '__created'] } };
  const got = summaryFields(tt, FIELDS);
  assert.deepStrictEqual(ids(got), ['__branch', 'f-name', '__created']);
  assert.strictEqual(got[0].label, 'Branch');
  assert.strictEqual(got[2].label, 'Submitted');
});
// A file question is the cover, not a line of text on the card — offering it as a field would
// print an R2 object key under the picture it is already showing.
t('a file question is never offered as a card field', () => {
  const offered = cardChoosable(FIELDS).map(f => f.id);
  assert.ok(!offered.includes('f-photo') && !offered.includes('f-cv'), 'got: ' + offered.join(','));
});

// ---- crop or fit ----
t('fit adds the class that changes the shape, crop is the plain cover', () => {
  assert.ok(/class="photo fit"/.test(coverHtml('a/b_pic.jpg', 'fit')), coverHtml('a/b_pic.jpg', 'fit'));
  assert.ok(/class="photo"/.test(coverHtml('a/b_pic.jpg', 'crop')));
  // every call written before the shape existed passes one argument and must stay cropped
  assert.ok(/class="photo"/.test(coverHtml('a/b_pic.jpg')));
});
t('only a real value counts as fit — anything else is crop', () => {
  reset();
  const tt = { id: 'tbl-17', config: { card_cover_fit: 'contain' } };
  assert.strictEqual(cardPrefs(tt, FIELDS).fit, 'crop');
});
// A video shows a play mark and a document a file mark: both are centred glyphs with nothing
// to crop, so the shape must not turn them into something else.
t('the shape does not touch a video or a document cover', () => {
  assert.ok(coverHtml('a/b_clip.mp4', 'fit').includes('is-video'));
  assert.ok(!coverHtml('a/b_clip.mp4', 'fit').includes('photo fit'));
  assert.ok(coverHtml('a/b_doc.pdf', 'fit').includes('is-file'));
});

// ---- the page itself ----
// The classes and the panel only work if they exist in the stylesheet and the toolbar, and a
// helper tested in isolation says nothing about whether anybody calls it (payroll.test.js).
const page = fs.readFileSync('index.html', 'utf8');
t('the fit class is a real rule in the stylesheet', () => {
  assert.ok(/\.ja-card \.photo\.fit \{[^}]*background-size: contain/.test(page));
});
t('the panel and its button exist in the toolbar', () => {
  assert.ok(page.includes('id="card-btn"'), 'no Customize cards button');
  assert.ok(page.includes('id="card-panel"'), 'no panel to open');
  assert.ok(/renderCardPanel\(currentCustom\.table, fields\)/.test(page), 'nothing draws the panel');
});
t('the cards read the chosen cover and shape rather than the first file question', () => {
  assert.ok(/var photoField = cardCfg\.cover \?/.test(page), 'cover is still hard-coded');
  assert.ok(/coverHtml\(d\[photoField\.id\], cardCfg\.fit\)/.test(page), 'the shape never reaches the cover');
  assert.ok(/cardCfg\.labels \? '<div class="k">/.test(page), 'field names are not switchable');
});
// Writing the default for everybody is a table-wide act, and the column picker beside it is
// admin-only for the same reason.
t('"Save for everyone" is admin-only', () => {
  assert.ok(/isAdmin \? '<button class="linkbtn" id="card-save"/.test(page), 'the shared default is not gated on isAdmin');
});
// Both keys said the same thing; a table left carrying the old one as well is a table where
// the panel and the card can disagree.
t('saving the default retires the old flag', () => {
  assert.ok(/delete cfg\.card_no_cover;/.test(page));
});
// The grid shows every column and has its own picker; the panel belongs to the two views drawn
// from a handful of fields.
t('the panel is hidden in the grid and shown in cards and list', () => {
  assert.ok(/cardWrap\.style\.display = customView === "table" \? "none" : "";/.test(page));
});

console.log(n + ' passed');
