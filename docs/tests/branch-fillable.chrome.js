// A branch login's record panel, rendered and then saved.
//
// branch-fillable.test.js covers the rule — which questions are nominated, what a locked row's
// markup looks like. This covers the thing itself, in a real DOM, because the property that
// actually protects the data is not in the markup: it is that edValues() cannot FIND a locked
// question and so saveCustom() leaves its stored value alone.
//
// That is worth a browser rather than a string assertion. The failure it guards against is
// silent and total: a locked phone rendered as a disabled input would still be read, run back
// through the phone formatter, and land in `data` as a different JSON value — and the database
// trigger refuses the whole UPDATE, so a shop filling in its five follow-up questions would be
// told "you may only change the follow-up questions" about a question it never touched, with no
// way to save anything at all.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/branch-fillable.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log('SKIPPED: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run this file.');
  process.exit(0);
}

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in index.html');
function grab(name) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('could not find function ' + name);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
// The page's own COUNTRIES_ED, so the phone formatter under test is the real one.
const countriesEd = (js.match(/\n  var COUNTRIES_ED = [\s\S]*?\n  \];/) || [])[0];
if (!countriesEd) throw new Error('could not find COUNTRIES_ED');

const fns = [
  'esc', 'branchFillableIds', 'lockedAnswerHtml', 'customCellText', 'edValues', 'edRow',
  'edFieldRowHtml', 'edText', 'edSelect', 'edChecks', 'edChecksValue', 'edDate', 'edTime',
  'edNum', 'edPhone', 'wireEdPhone', 'parsePhone', 'edFlagUrl', 'choiceList', 'fieldHasOther',
  'isOtherChoice', 'otherKeyFor', 'isFileField', 'filePaths', 'fileLabel', 'ageText',
  'condMet', 'isScorerField', 'isChoiceField'
].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="host" class="m-grid"></div><pre id="out"></pre>
<script>
// A page that throws produces no <pre> at all, which reads as "Chrome said nothing" and is
// the least useful failure there is. Say what threw instead.
window.onerror = function (m, s, l) {
  document.getElementById('out').textContent = 'RESULT 0 passed, 1 failed\\nFAIL page threw: ' + m + ' (line ' + l + ')';
};
${fns}
${countriesEd}
var edPhoneReg = {};
function scoreMetaOf() { return null; }   // the row painter, not under test here
function recordOptsFor() { return {}; }
function edChecksKeyed() { return ''; }
function branchDropdownOptions() { return []; }
function branchScopeKeys() { return []; }
function countryAnswerIn() { return null; }
function countryChoiceNames() { return []; }

var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

// Customer Complaints in miniature: what the customer typed, the imported clutter, and the
// follow-up questions the shop is meant to answer. The phone and the number are the two that
// a disabled input would silently rewrite, so they are both here on purpose.
var FIELDS = [
  { id: 'q-name',   label: 'Customer Name',  type: 'short_text', internal: false },
  { id: 'q-phone',  label: 'Phone Number',   type: 'phone',      internal: false },
  { id: 'q-type',   label: 'Complaint Type', type: 'dropdown',   internal: false, options: ['Product', 'Service'] },
  { id: 'q-num',    label: 'Complain Number',type: 'number',     internal: true },
  { id: 'q-coupon', label: 'Coupon Code',    type: 'short_text', internal: true },
  { id: 'q-first',  label: 'First Contact',  type: 'yesno',      internal: true, branch_edit: true },
  { id: 'q-fix',    label: 'How was it resolved?', type: 'long_text', internal: true, branch_edit: true },
  { id: 'q-who',    label: 'Who is responsible?',  type: 'long_text', internal: true, branch_edit: true }
];
// The stored record. The phone is stored E.164 and the number as a JSON number — neither is
// the string an input would hand back.
var STORED = {
  'q-name': 'Layla',
  'q-phone': '+962790001234',
  'q-type': 'Product',
  'q-num': 41,
  'q-coupon': 'BLK-2291',
  'q-first': 'Yes',
  'q-fix': '',
  'q-who': ''
};

// ---- render the panel exactly the way the record panel does ----
var fillable = branchFillableIds(FIELDS);
var host = document.getElementById('host');
host.innerHTML = FIELDS.map(function (f) {
  return fillable[f.id] ? edFieldRowHtml(f, STORED, { fields: FIELDS }) : lockedAnswerHtml(f, STORED);
}).join('');
FIELDS.forEach(function (f) { if (f.type === 'phone' && fillable[f.id]) wireEdPhone('ed-' + f.id); });

function el(id) { return document.getElementById('ed-' + id); }
function shown(e) { return !!(e && e.getClientRects().length); }
function rowOf(id) {
  var nodes = [].slice.call(host.querySelectorAll('.m-field'));
  for (var i = 0; i < nodes.length; i++) if (nodes[i].textContent.indexOf(id) > -1) return nodes[i];
  return null;
}

// ---- what is on screen ----
ok('the three nominated questions are inputs', !!el('q-first') && !!el('q-fix') && !!el('q-who'));
ok('the customer\\'s name is NOT an input', el('q-name') === null);
ok('the customer\\'s phone is NOT an input', el('q-phone') === null);
ok('a staff-only question nobody nominated is NOT an input', el('q-coupon') === null && el('q-num') === null);
ok('every question is still on the page', host.querySelectorAll('.m-field').length === 8,
   String(host.querySelectorAll('.m-field').length));
ok('the locked rows are visible, not hidden',
   [].slice.call(host.querySelectorAll('.m-field.locked')).every(shown));
ok('there are exactly five locked rows', host.querySelectorAll('.m-field.locked').length === 5,
   String(host.querySelectorAll('.m-field.locked').length));
ok('a locked row shows the stored answer', host.textContent.indexOf('BLK-2291') > -1);
ok('a locked row says it is locked', (host.querySelector('.m-field.locked .k-lock') || {}).textContent === 'locked');
ok('no locked row contains a form control at all',
   host.querySelectorAll('.m-field.locked input, .m-field.locked select, .m-field.locked textarea').length === 0,
   String(host.querySelectorAll('.m-field.locked input, .m-field.locked select, .m-field.locked textarea').length));

// ---- and now the part that protects the data ----
// The shop fills in its three questions and saves.
el('q-fix').value = '  we replaced the drink  ';
el('q-who').value = 'Ahmad';
var cur = edValues(FIELDS);

ok('edValues returns ONLY the nominated questions',
   Object.keys(cur).sort().join(',') === 'q-first,q-fix,q-who', Object.keys(cur).sort().join(','));
ok('a locked phone is not read back even though edPhoneReg exists for other rows',
   !('q-phone' in cur));

// saveCustom's merge, run here rather than called, because the real one talks to the database.
// This is the arithmetic that decides what the UPDATE carries.
var nd = {}; Object.keys(STORED).forEach(function (k) { nd[k] = STORED[k]; });
FIELDS.forEach(function (f) {
  if (!Object.prototype.hasOwnProperty.call(cur, f.id)) return;
  var v = cur[f.id];
  if (v == null || v === '') delete nd[f.id]; else nd[f.id] = v;
});

ok('the answer the shop typed is saved, trimmed', nd['q-fix'] === 'we replaced the drink', JSON.stringify(nd['q-fix']));
ok('and the second one too', nd['q-who'] === 'Ahmad');
// These four are the whole point. The trigger compares with "is distinct from", so a value that
// merely CHANGED SHAPE is an illegal edit and the entire save is refused.
ok('the stored phone is unchanged, still E.164 and still a string',
   nd['q-phone'] === '+962790001234', JSON.stringify(nd['q-phone']));
ok('the stored number is unchanged, still a JSON number and not "41"',
   nd['q-num'] === 41 && typeof nd['q-num'] === 'number', JSON.stringify(nd['q-num']));
ok('the customer\\'s name is unchanged', nd['q-name'] === 'Layla');
ok('the coupon code is unchanged', nd['q-coupon'] === 'BLK-2291');
ok('no locked key was dropped from the record',
   Object.keys(nd).indexOf('q-name') > -1 && Object.keys(nd).indexOf('q-num') > -1);

// An empty nominated answer clears its key, the way it does for anyone else.
el('q-who').value = '';
var cur2 = edValues(FIELDS);
var nd2 = {}; Object.keys(STORED).forEach(function (k) { nd2[k] = STORED[k]; });
FIELDS.forEach(function (f) {
  if (!Object.prototype.hasOwnProperty.call(cur2, f.id)) return;
  var v = cur2[f.id];
  if (v == null || v === '') delete nd2[f.id]; else nd2[f.id] = v;
});
ok('clearing a nominated answer removes its key', !('q-who' in nd2));
ok('and still leaves every locked answer alone',
   nd2['q-phone'] === '+962790001234' && nd2['q-num'] === 41 && nd2['q-name'] === 'Layla');

// ---- the stale phone closure ----
// edPhoneReg is keyed by element id and is never cleared, so a closure made for one record
// outlives the panel that made it and still holds that panel's detached input. edValues has to
// check the DOM FIRST or a locked phone row — which has no input at all — would be answered by
// the previous record's number. Simulated here because it takes two records to happen for real.
edPhoneReg['ed-q-phone'] = function () { return '+962799999999'; };
var cur3 = edValues(FIELDS);
ok('a stale phone closure does not answer a locked question', !('q-phone' in cur3),
   JSON.stringify(cur3['q-phone']));
// q-who is still a key here even though it was just emptied: edValues reports what the box
// holds, and it is saveCustom's merge above that turns an empty answer into a deleted key.
ok('and the nominated questions are still read normally',
   Object.keys(cur3).sort().join(',') === 'q-first,q-fix,q-who', Object.keys(cur3).sort().join(','));

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

// ---- page two: the question editor, where a question is nominated in the first place ----
// The checkbox is disabled until staff-only is ticked, and unticking staff-only has to clear
// it rather than leave it checked-but-disabled — a nomination that is on screen but not in
// what the save reads is how a question ends up branch-fillable without anybody choosing it.
const builderFns = [
  'esc', 'bldHost', 'bldGrow', 'wireBldGrow', 'typeUsesOpts', 'typeUsesAnswers', 'optsPlaceholder',
  'questionMaxPoints', 'choicePoints', 'builderTotalPoints',
  'parseChoice', 'parseChoiceList', 'pastedAnswers', 'optsToString', 'linkRecordOptions',
  'condSelectHtml', 'refreshCondSelect', 'syncCondRow', 'afterFieldSelectHtml',
  'bldScoreVisibility', 'scoringToInputs', 'addAnswerRow', 'setAnswerLine',
  'ensureTrailingAnswer', 'answersChanged', 'renderAnswers', 'rowAnswers', 'rowDraftAnswers',
  'syncRowOptsUi', 'addBuilderField'
].map(grab).join('\n');

const builderPage = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="bld-body"><div class="bld-fields" id="bld-fields"></div><div id="bld-total"></div></div>
<pre id="out"></pre>
<script>
window.onerror = function (m, s, l) {
  document.getElementById('out').textContent = 'RESULT 0 passed, 1 failed\\nFAIL page threw: ' + m + ' (line ' + l + ')';
};
var FIELD_TYPES = [
  { v: "short_text", label: "Short text" }, { v: "number", label: "Number" },
  { v: "yesno", label: "Yes / No" }, { v: "dropdown", label: "Dropdown" },
  { v: "multi_select", label: "Multi-select" }, { v: "link", label: "Link (button)" }
];
var bldRowSeq = 0, bldDragEl = null, builderMode = 'edit';
function saveDraft() {}
function refreshBuilderTotal() {}
function rowScoring() { return null; }
function rowFieldShape() { return {}; }
${builderFns}
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function tick(el) { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); }

// a question the customer answers
var pub = addBuilderField({ label: 'Customer Name', type: 'short_text', required: true });
ok('branch-fillable is offered on every question', !!pub.querySelector('.fbr'));
ok('but is dead until the question is staff-only', pub.querySelector('.fbr').disabled === true);
ok('and starts unticked', pub.querySelector('.fbr').checked === false);

// ticking staff-only brings it to life
tick(pub.querySelector('.fint'));
ok('ticking staff-only makes it live', pub.querySelector('.fbr').disabled === false);
tick(pub.querySelector('.fbr'));
ok('and it can then be ticked', pub.querySelector('.fbr').checked === true);

// untick staff-only again: the nomination must go with it
tick(pub.querySelector('.fint'));
ok('unticking staff-only clears the nomination', pub.querySelector('.fbr').checked === false);
ok('and puts the box back out of reach', pub.querySelector('.fbr').disabled === true);

// a saved question opens the way it was stored
var saved = addBuilderField({ label: 'First Contact', type: 'yesno', internal: true, branch_edit: true });
ok('a stored nomination comes back ticked', saved.querySelector('.fbr').checked === true);
ok('and live, because the question is staff-only', saved.querySelector('.fbr').disabled === false);
var plain = addBuilderField({ label: 'Coupon Code', type: 'short_text', internal: true });
ok('a staff-only question nobody nominated comes back unticked', plain.querySelector('.fbr').checked === false);
ok('and its box is live, so it can be nominated', plain.querySelector('.fbr').disabled === false);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

function runPage(html, name) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-branch-fillable-')), 'page.html');
  fs.writeFileSync(file, html);
  const url = 'file:///' + file.replace(/\\/g, '/');
  const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--dump-dom', url],
                           { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const block = ((run.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
  if (!block) {
    console.log('FAILED (' + name + '): the page produced no results. Chrome said:\n' +
                (run.stderr || '').slice(0, 2000));
    process.exitCode = 1;
  } else {
    const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
    lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
    const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
    console.log(result.replace('RESULT ', '') + ' (' + name + ', in ' + path.basename(chrome) + ')');
    if (!/ 0 failed/.test(result)) process.exitCode = 1;
  }
  try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
}

runPage(page, 'branch-fillable panel');
runPage(builderPage, 'branch-fillable question editor');
