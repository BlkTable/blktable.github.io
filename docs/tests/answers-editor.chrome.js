// The answers editor: one row per answer, with its own points box.
//
// Before this, a choice question's answers were typed into one free-text box as
// "Excellent|ممتاز|pts:3" — the price, the N/A flag and the "other" flag all hidden inside a
// string syntax the placeholder never mentioned. Nobody could price an answer without being
// told the syntax, which is the whole reason a scorecard was hard to build.
//
// This drives the real thing: addBuilderField out of index.html, in a real browser, with the
// real stylesheet. The assertions are about what the row GIVES BACK — rowFieldShape and the
// options serializeFields would write — because an editor that looks right and hands the
// save the wrong options is the failure that matters.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/answers-editor.chrome.js
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
// Brace-matched, so a one-line function comes out whole.
function grab(name) {
  const at = js.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('could not find function ' + name);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
const NAMES = ['esc', 'choicePoints', 'questionMaxPoints', 'builderTotalPoints', 'scoringToInputs',
  'bldHost', 'bldGrow', 'wireBldGrow', 'typeUsesOpts', 'typeUsesAnswers', 'optsPlaceholder',
  'parseChoice', 'parseChoiceList', 'pastedAnswers', 'optsToString', 'linkRecordOptions',
  'condSelectHtml', 'refreshCondSelect', 'syncCondRow', 'afterFieldSelectHtml',
  'bldScoreVisibility', 'rowFieldShape', 'rowScoring', 'refreshBuilderTotal',
  'addAnswerRow', 'setAnswerLine', 'ensureTrailingAnswer', 'answersChanged',
  'renderAnswers', 'rowAnswers', 'rowDraftAnswers', 'syncRowOptsUi',
  'rowOptionsForSave', 'addBuilderField'];
const fns = NAMES.map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="bld-body"><div class="bld-fields" id="bld-fields"></div><div id="bld-total"></div></div>
<pre id="out"></pre>
<script>
var FIELD_TYPES = [
  { v: "short_text", label: "Short text" }, { v: "number", label: "Number" },
  { v: "yesno", label: "Yes / No" }, { v: "dropdown", label: "Dropdown" },
  { v: "multi_select", label: "Multi-select" }, { v: "link", label: "Link (button)" }
];
var bldRowSeq = 0, bldDragEl = null, builderMode = 'create';
// Not the editor's business here: the draft is its own test, and the builder host in this
// page has no name box to serialize.
function saveDraft() {}
${fns}
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function same(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}
function scored(on) { document.getElementById('bld-body').classList.toggle('scored-build', on); }
function answerLines(row) { return [].slice.call(row.querySelectorAll('.bld-answer')); }
function typeIn(el, v) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function shown(el) { return !!el && el.offsetParent !== null; }

try {
// ---- a saved priced question opens as one line per answer ----
scored(true);
var row = addBuilderField({
  label: 'Fridge condition', type: 'dropdown',
  opts: 'Spotless|نظيف تماما|pts:3, Acceptable|مقبول|pts:1, Not applicable|لا ينطبق|na',
  scoring: { rule: 'choices' }
});
var lines = answerLines(row);
ok('one line per saved answer', lines.length === 3, 'got ' + lines.length);
ok('the English answer is in its own box', lines[0].querySelector('.ans-en').value === 'Spotless',
   lines[0].querySelector('.ans-en').value);
ok('the Arabic answer is in its own box', lines[0].querySelector('.ans-ar').value === 'نظيف تماما',
   lines[0].querySelector('.ans-ar').value);
ok('the price is in its own box', lines[0].querySelector('.ans-pts').value === '3',
   lines[0].querySelector('.ans-pts').value);
ok('N/A is a tick box, not a word typed into the answer', lines[2].querySelector('.ans-na').checked === true);
ok('an N/A answer keeps its own name', lines[2].querySelector('.ans-en').value === 'Not applicable');

// ---- the list says what it is ----
// The whole point of the change is that nobody should have to be told how to price an answer,
// so an unlabelled column of numbers would only move the problem.
ok('the answers are captioned', /answer/i.test(row.querySelector('.ans-head').textContent),
   row.querySelector('.ans-head').textContent);
ok('a scorecard says the answers carry points', shown(row.querySelector('.ans-head-pts')));
scored(false);
ok('an ordinary table does not mention points', !shown(row.querySelector('.ans-head-pts')));
ok('an ordinary table still captions the answers', shown(row.querySelector('.ans-head')));
scored(true);

// ---- the row still gives the save the same options ----
same('the options handed to the save are unchanged', rowFieldShape(row).options,
  [{ en: 'Spotless', ar: 'نظيف تماما', points: 3 },
   { en: 'Acceptable', ar: 'مقبول', points: 1 },
   { en: 'Not applicable', ar: 'لا ينطبق', na: true }]);
same('the question is still priced by its choices', rowFieldShape(row).scoring, { rule: 'choices' });
ok('the maximum is the best answer', questionMaxPoints(rowFieldShape(row)) === 3);

// ---- the points box is scorecard-only ----
ok('a scorecard shows the points box', shown(lines[0].querySelector('.ans-pts')));
ok('a scorecard shows the N/A tick', shown(lines[0].querySelector('.ans-na')));
ok('every table shows the answer itself', shown(lines[0].querySelector('.ans-en')));
scored(false);
ok('an ordinary table hides the points box', !shown(lines[0].querySelector('.ans-pts')));
ok('an ordinary table hides the N/A tick', !shown(lines[0].querySelector('.ans-na')));
ok('an ordinary table still shows the answer', shown(lines[0].querySelector('.ans-en')));
scored(true);

// ---- pricing an answer moves the maximum and the total ----
typeIn(lines[1].querySelector('.ans-pts'), '5');
ok('repricing an answer raises the maximum', questionMaxPoints(rowFieldShape(row)) === 5,
   String(questionMaxPoints(rowFieldShape(row))));
ok('the maximum is shown on the row', /max 5/.test(row.querySelector('.qmax').textContent),
   row.querySelector('.qmax').textContent);
ok('the builder total follows', /\\b5\\b/.test(document.getElementById('bld-total').textContent),
   document.getElementById('bld-total').textContent);

// ---- an answer with a comma in it is one answer ----
typeIn(lines[1].querySelector('.ans-en'), 'Clean, tidy and stocked');
same('a comma inside an answer does not split it', rowFieldShape(row).options.map(function (o) { return o.en; }),
  ['Spotless', 'Clean, tidy and stocked', 'Not applicable']);

// ---- adding and removing answers ----
var before = answerLines(row).length;
row.querySelector('.ans-add').click();
ok('Add answer appends a line', answerLines(row).length === before + 1);
same('an empty line is not an answer', rowFieldShape(row).options.length, 3);
typeIn(answerLines(row)[3].querySelector('.ans-en'), 'Filthy');
typeIn(answerLines(row)[3].querySelector('.ans-pts'), '0');
same('a new answer joins the options', rowFieldShape(row).options[3], { en: 'Filthy', ar: '', points: 0 });
ok('a zero-point answer does not raise the maximum', questionMaxPoints(rowFieldShape(row)) === 5);
answerLines(row)[3].querySelector('.ans-rm').click();
same('removing a line removes the answer', rowFieldShape(row).options.length, 3);

// ---- typing in the last line opens the next one ----
var n = answerLines(row).length;
typeIn(answerLines(row)[n - 1].querySelector('.ans-en'), 'Not applicable at all');
ok('typing in the last answer opens a fresh one beneath it', answerLines(row).length === n + 1,
   'got ' + answerLines(row).length);
ok('typing in a middle answer opens nothing', (function () {
  var m = answerLines(row).length;
  typeIn(answerLines(row)[0].querySelector('.ans-en'), 'Spotless!');
  return answerLines(row).length === m;
})());

// ---- a pasted list becomes lines ----
var r2 = addBuilderField({ label: 'Areas checked', type: 'multi_select', opts: 'Floor|الأرضية|pts:2' });
var first = answerLines(r2)[0].querySelector('.ans-en');
first.focus();
var dt = new DataTransfer();
dt.setData('text/plain', 'Counter|الكاونتر\\nFridge|الثلاجة\\nStore|المخزن');
first.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
same('a pasted list becomes one answer per line', rowFieldShape(r2).options.map(function (o) { return o.en; }),
  ['Counter', 'Fridge', 'Store']);
ok('a pasted list keeps its Arabic', rowFieldShape(r2).options[0].ar === 'الكاونتر',
   rowFieldShape(r2).options[0].ar);
ok('a multi-select adds up all its priced answers', (function () {
  var ls = answerLines(r2);
  typeIn(ls[0].querySelector('.ans-pts'), '2');
  typeIn(ls[1].querySelector('.ans-pts'), '3');
  return questionMaxPoints(rowFieldShape(r2)) === 5;
})(), String(questionMaxPoints(rowFieldShape(r2))));

// ---- the editor belongs to choice questions only ----
var r3 = addBuilderField({ label: 'Manager', type: 'short_text' });
ok('a text question has no answers editor', !shown(r3.querySelector('.bld-answers')));
ok('a text question has no options box either', !shown(r3.querySelector('.opts')));
var typeSel = r3.querySelector('.ftype');
typeIn(typeSel, 'dropdown');
ok('switching to Dropdown opens the answers editor', shown(r3.querySelector('.bld-answers')));
ok('a dropdown does not show the free-text options box', !shown(r3.querySelector('.opts')));
ok('a fresh dropdown starts with an empty answer waiting', answerLines(r3).length >= 1);
typeIn(typeSel, 'link');
ok('a link question keeps the free-text box', shown(r3.querySelector('.opts')));
ok('a link question has no answers editor', !shown(r3.querySelector('.bld-answers')));
typeIn(typeSel, 'yesno');
ok('a Yes/No question keeps its own points box', shown(r3.querySelector('.fpts')));

// ---- what the save is handed ----
// rowOptionsForSave is the seam the table save reads through, so the options that reach the
// database are the answers on screen and not a re-parse of a box nobody types in any more.
var r4 = addBuilderField({ label: 'Fridge', type: 'dropdown',
  opts: 'Spotless|نظيف|pts:3, Not applicable|لا ينطبق|na' });
same('the save is handed the answers on screen', rowOptionsForSave(r4).options,
  [{ en: 'Spotless', ar: 'نظيف', points: 3 }, { en: 'Not applicable', ar: 'لا ينطبق', na: true }]);
ok('a choice question with no answers is refused', (function () {
  var r = addBuilderField({ label: 'Empty', type: 'dropdown' });
  var got = rowOptionsForSave(r);
  return !!got.error && /answer/i.test(got.error);
})());
ok('a link question is still read from its own box', (function () {
  var r = addBuilderField({ label: 'Apply', type: 'link', opts: 'https://x.test | Apply now | قدّم' });
  return rowOptionsForSave(r).options.url === 'https://x.test';
})());
ok('a link question with no URL is refused', (function () {
  var r = addBuilderField({ label: 'Apply', type: 'link', opts: 'not a url' });
  return /URL/.test(rowOptionsForSave(r).error || '');
})());
ok('a text question has no options at all', (function () {
  var r = addBuilderField({ label: 'Name', type: 'short_text' });
  var got = rowOptionsForSave(r);
  return got.options === null && !got.error;
})());

// ---- the draft ----
// A half-built scorecard has to survive a refresh, and what has to survive is the answers,
// not a string they were once typed into.
var r5 = addBuilderField({ label: 'Counter', type: 'dropdown',
  answers: [{ en: 'Clean, tidy', ar: 'نظيف', points: 2 }] });
var carried = rowDraftAnswers(r5);
same('the draft carries the answers as answers', carried, [{ en: 'Clean, tidy', ar: 'نظيف', points: 2 }]);
var restored = addBuilderField({ label: 'Counter', type: 'dropdown', answers: carried });
same('a restored draft brings the answers back whole', rowFieldShape(restored).options, carried);
ok('a restored draft brings the price back', answerLines(restored)[0].querySelector('.ans-pts').value === '2',
   answerLines(restored)[0].querySelector('.ans-pts').value);
same('a draft written before the answers editor still restores',
  rowFieldShape(addBuilderField({ label: 'Old', type: 'dropdown', opts: 'Yes|نعم|pts:1, No' })).options,
  [{ en: 'Yes', ar: 'نعم', points: 1 }, { en: 'No', ar: '' }]);
} catch (e) {
  // A throw part-way through leaves the rest untested, and a silent one leaves an empty page
  // that reads as a pass. Say what broke and where.
  fail++;
  out.push('FAIL the page threw -> ' + (e && e.message) + '\\n' + (e && e.stack));
}
document.getElementById('out').textContent =
  out.join('\\n') + '\\n\\n' + pass + ' passed, ' + fail + ' failed';
</script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-answers-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page, 'utf8');
const dump = cp.execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=3000', '--dump-dom', 'file:///' + file.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
const m = dump.match(/<pre id="out">([\s\S]*?)<\/pre>/);
const text = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
// An empty box is the dangerous result: the page loaded, nothing ran, and every assertion
// went unmade. That has to be a failure rather than a quiet pass.
if (!text.trim()) {
  console.log('FAIL: the page produced no results — the script did not reach the end');
  process.exitCode = 1;
} else {
  console.log(text);
  if (/FAIL/.test(text) || /\b0 passed/.test(text)) process.exitCode = 1;
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
