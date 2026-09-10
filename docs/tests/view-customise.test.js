// "Customize view": what a record's ⋯ menu "View" action shows — a handful of chosen
// fields, read-only, separate from the full editable form Edit opens. Built the same way
// as Customize cards (docs/tests/card-customise.test.js): a made-up table and made-up
// fields, this browser over the table's saved default over a fallback that is never empty.
//
// The one real difference from cards: a file question (the photo) IS offered and can be
// chosen — the whole point of a table like Customer Complaints is showing the photo, not
// hiding it behind a cover the way a card does.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
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

const {
  viewFieldsFor, viewChoosable, cardSave, cardReset, viewReset, cardKey, summaryFields, pseudoCols
} = load('index.html',
     ['VIDEO_EXT', 'IMAGE_EXT', 'PLAY_SVG', 'FILE_SVG'],
     ['viewFieldsFor', 'viewChoosable', 'cardMine', 'cardLocal', 'cardHas', 'cardKey', 'cardSave',
      'prefsClearKeys', 'cardReset', 'viewReset', 'cardChoosable', 'cardPrefs', 'summaryFields',
      'isFileField', 'isScorerField', 'pseudoCols', 'isPseudoCol']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const reset = () => { Object.keys(store).forEach(k => delete store[k]); };

const FIELDS = [
  { id: 'f-name', label: 'Full name', type: 'text' },
  { id: 'f-phone', label: 'Phone', type: 'phone' },
  { id: 'f-note', label: 'Complaint', type: 'long_text' },
  { id: 'f-photo', label: 'Photo', type: 'photo' },
  { id: 'f-followup', label: 'Follow-up', type: 'text', internal: true },
  { id: 'f-score', label: 'Score', type: 'number', options: { score: {} } }
];
const ids = list => list.map(f => f.id);
const here = list => Array.from(list || []);

// ---- offered fields: a file question counts, a scorer question never does ----
t('a file question is offered for View, unlike for the card', () => {
  const offered = ids(viewChoosable(FIELDS));
  assert.ok(offered.includes('f-photo'), 'got: ' + offered.join(','));
});
t('a scorer question is never offered — it is derived, not answerable', () => {
  const offered = ids(viewChoosable(FIELDS));
  assert.ok(!offered.includes('f-score'), 'got: ' + offered.join(','));
});
t('Branch, Country and Submitted are offered same as the card picker', () => {
  const offered = ids(viewChoosable(FIELDS));
  assert.deepStrictEqual(offered.slice(-3), ['__branch', '__country', '__created']);
});

// ---- nothing configured: never an empty quick view ----
t('nothing chosen and no detail_fields: falls back to the card summary fields', () => {
  reset();
  const t1 = { id: 'tbl-1', config: {} };
  assert.deepStrictEqual(ids(viewFieldsFor(t1, FIELDS)), ids(summaryFields(t1, FIELDS)));
});
t('nothing chosen but the table has detail_fields: those win over the card summary', () => {
  reset();
  const t2 = { id: 'tbl-2', config: { detail_fields: ['f-photo', 'f-name', 'f-note'] } };
  assert.deepStrictEqual(ids(viewFieldsFor(t2, FIELDS)), ['f-photo', 'f-name', 'f-note']);
});

// ---- the table's saved default (config.view_fields) ----
t('the saved view fields beat both fallbacks, in the order given', () => {
  reset();
  const t3 = { id: 'tbl-3', config: { view_fields: ['f-photo', 'f-name', 'f-phone', 'f-note'], detail_fields: ['f-name'] } };
  assert.deepStrictEqual(ids(viewFieldsFor(t3, FIELDS)), ['f-photo', 'f-name', 'f-phone', 'f-note']);
});
t('an empty saved list reads as nothing chosen, not as an empty view', () => {
  reset();
  const t4 = { id: 'tbl-4', config: { view_fields: [] } };
  assert.deepStrictEqual(ids(viewFieldsFor(t4, FIELDS)), ids(summaryFields(t4, FIELDS)));
});
t('a saved field that no longer exists is dropped, and the rest still show', () => {
  reset();
  const t5 = { id: 'tbl-5', config: { view_fields: ['f-gone', 'f-photo'] } };
  assert.deepStrictEqual(ids(viewFieldsFor(t5, FIELDS)), ['f-photo']);
});

// ---- this browser ----
t('your own choice beats the table default', () => {
  reset();
  const t6 = { id: 'tbl-6', config: { view_fields: ['f-name'] } };
  cardSave(t6, { viewFields: ['f-photo', 'f-note'] });
  assert.deepStrictEqual(here(viewFieldsFor(t6, FIELDS).map(f => f.id)), ['f-photo', 'f-note']);
});
t('one table\'s choice is not another table\'s', () => {
  reset();
  const a = { id: 'tbl-a2', config: {} }, b = { id: 'tbl-b2', config: {} };
  cardSave(a, { viewFields: ['f-photo'] });
  assert.deepStrictEqual(here(ids(viewFieldsFor(a, FIELDS))), ['f-photo']);
  assert.deepStrictEqual(ids(viewFieldsFor(b, FIELDS)), ids(summaryFields(b, FIELDS)));
});

// ---- Customize cards and Customize view share a row without stepping on each other ----
t('saving your card fields does not touch a view choice already saved on the same table', () => {
  reset();
  const t7 = { id: 'tbl-7', config: {} };
  cardSave(t7, { viewFields: ['f-photo', 'f-note'] });
  cardSave(t7, { fields: ['f-name'] });
  assert.deepStrictEqual(here(ids(viewFieldsFor(t7, FIELDS))), ['f-photo', 'f-note']);
});
t('resetting the CARD choice leaves a saved VIEW choice in place', () => {
  reset();
  const t8 = { id: 'tbl-8', config: {} };
  cardSave(t8, { fields: ['f-name'], viewFields: ['f-photo'] });
  cardReset(t8);
  assert.deepStrictEqual(here(ids(viewFieldsFor(t8, FIELDS))), ['f-photo'], 'view choice must survive a card reset');
  const stillThere = JSON.parse(localStorage.getItem(cardKey(t8)));
  assert.strictEqual(stillThere.fields, undefined, 'the card fields must actually be gone');
});
t('resetting the VIEW choice leaves a saved CARD choice in place', () => {
  reset();
  const t9 = { id: 'tbl-9', config: {} };
  cardSave(t9, { fields: ['f-name'], viewFields: ['f-photo'] });
  viewReset(t9);
  assert.deepStrictEqual(here(ids(summaryFields(t9, FIELDS))), ['f-name'], 'card choice must survive a view reset');
  const stillThere = JSON.parse(localStorage.getItem(cardKey(t9)));
  assert.strictEqual(stillThere.viewFields, undefined, 'the view fields must actually be gone');
});
t('resetting the only choice saved on a table clears the row entirely', () => {
  reset();
  const t10 = { id: 'tbl-10', config: {} };
  cardSave(t10, { viewFields: ['f-photo'] });
  viewReset(t10);
  assert.strictEqual(localStorage.getItem(cardKey(t10)), null);
});

// ---- the page itself ----
const page = fs.readFileSync('index.html', 'utf8');
t('the Customize view button and panel exist in the toolbar', () => {
  assert.ok(page.includes('id="view-btn"'), 'no Customize view button');
  assert.ok(page.includes('id="view-panel"'), 'no panel to open');
  assert.ok(/renderViewPanel\(currentCustom\.table, fields\)/.test(page), 'nothing draws the panel');
});
t('the panel is hidden in the grid and shown in cards and list, same as Customize cards', () => {
  assert.ok(/viewWrap\.style\.display = customView === "table" \? "none" : "";/.test(page));
});
t('"Save for everyone" on the view panel is admin-only', () => {
  assert.ok(/isAdmin \? '<button class="linkbtn" id="view-save"/.test(page), 'the shared default is not gated on isAdmin');
});
t('the record menu offers Edit only when mayEdit is passed, next to View', () => {
  assert.ok(/'<li data-act="view">View<\/li>' \+ \(mayEdit \? '<li data-act="edit">Edit<\/li>' : ""\)/.test(page));
});
t('the record menu is wired with an Edit callback for custom tables', () => {
  assert.ok(/wireRecMenu\(el, function \(\) \{ openCustomView\(s, fields\); \}/.test(page), 'View action must open the quick view, not the full form');
  assert.ok(/menuActions, function \(\) \{ openCustomDetail\(s, fields\); \}\);/.test(page), 'Edit callback must open the full form');
});
t('the card/row actions pass mayEdit through to the menu', () => {
  assert.ok(/recMenuHtml\(tableActions\.concat\(slotActions\(s, mayManageTbl\), notifyActions\(currentCustom\.table, s\)\), mayManageTbl, mayEdit\)/.test(page));
});

console.log(n + ' passed');
