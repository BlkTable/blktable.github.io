// A save must hand back the options it does not own — driven through the real editor.
//
// `options-kept.test.js` covers keptOptions, which decides WHAT survives. This covers the
// half that made the bug: the row has to carry it and rowOptionsForSave has to hand it over.
// A helper nobody calls is a feature nobody has, and this exact failure — the editor looking
// right while the save writes `options: null` over a scoring rule — is what erased all 68 of
// Shop Audit's rules on 2026-08-31 and left the next audit reading 0 out of 68.
//
// Headless Chrome because rowOptionsForSave reads a DOM row; skipped, not failed, without it.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/options-kept.chrome.js
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
  'keptOptions', 'rowKeptOptions', 'mergeKept',
  'condSelectHtml', 'refreshCondSelect', 'syncCondRow', 'afterFieldSelectHtml',
  'bldScoreVisibility', 'rowFieldShape', 'rowScoring', 'refreshBuilderTotal',
  'addAnswerRow', 'setAnswerLine', 'ensureTrailingAnswer', 'answersChanged',
  'renderAnswers', 'rowAnswers', 'rowDraftAnswers', 'syncRowOptsUi',
  'rowOptionsForSave', 'addBuilderField', 'branchScopeList', 'builderScope'];
const fns = NAMES.map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="bld-body"><div class="bld-fields" id="bld-fields"></div><div id="bld-total"></div></div>
<div id="bld-countries"></div>
<pre id="out"></pre>
<script>
var FIELD_TYPES = [
  { v: "short_text", label: "Short text" }, { v: "number", label: "Number" },
  { v: "yesno", label: "Yes / No" }, { v: "dropdown", label: "Dropdown" },
  { v: "multi_select", label: "Multi-select" }, { v: "link", label: "Link (button)" },
  { v: "branch", label: "Shop" }
];
var bldRowSeq = 0, bldDragEl = null, builderMode = 'edit';
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
function typeIn(el, v) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
// One of Shop Audit's 68, exactly as compute_scores() reads it.
var RULE = { score: { kind: 'match', source: 'a8daced3', expect: 'Yes', points: 1, else: 0 } };

try {
// ---- the regression ----
// "Floors Score": a short_text column whose whole purpose is the rule inside its options. The
// editor shows it as an ordinary question with an empty Options box, and used to save it as
// options: null.
var scoreCol = addBuilderField({
  id: '5b9325bb', label: 'Floors Score', type: 'short_text', keepOpts: keptOptions(RULE) });
same('a scoring rule survives the save', rowOptionsForSave(scoreCol, 'Floors Score').options, RULE);
ok('and the save is not refused', !rowOptionsForSave(scoreCol, 'Floors Score').error);

// The percent column beside it, which decides how the total is printed.
var pct = addBuilderField({ id: '6243fd52', label: 'Final Score %', type: 'number',
  keepOpts: keptOptions({ score: { kind: 'truthy' }, score_fmt: 'percent' }) });
same('the percent format survives too', rowOptionsForSave(pct).options,
  { score: { kind: 'truthy' }, score_fmt: 'percent' });

// ---- a rule is not tied to the type it was written on ----
typeIn(scoreCol.querySelector('.ftype'), 'number');
same('changing a scored question to Number keeps its rule',
  rowOptionsForSave(scoreCol, 'Floors Score').options, RULE);

// ---- an ordinary question is untouched ----
var plain = addBuilderField({ id: 'p1', label: 'What needs focus?', type: 'long_text' });
same('a question with nothing to keep still saves null', rowOptionsForSave(plain).options, null);

// ---- answers are a list, and a list holds nothing else ----
// The new scoring system prices a question through its answers, so this shape must stay a
// bare array: every reader does Array.isArray(f.options) ? f.options : [].
var priced = addBuilderField({ label: 'Fridge condition', type: 'dropdown',
  answers: [{ en: 'Spotless', points: 3 }, { en: 'Filthy', points: 0 }] });
same('a priced answer list is still handed over as a list', rowOptionsForSave(priced).options,
  [{ en: 'Spotless', ar: '', points: 3 }, { en: 'Filthy', ar: '', points: 0 }]);
ok('a priced answer list is an array, not an object',
   Array.isArray(rowOptionsForSave(priced).options));

// Turning a scored column INTO a choice question is the one place a rule cannot follow: the
// answers need the array. It must hand over the answers rather than half of each.
var becomes = addBuilderField({ id: 'b1', label: 'Floors', type: 'short_text', keepOpts: keptOptions(RULE) });
typeIn(becomes.querySelector('.ftype'), 'dropdown');
becomes.querySelector('.ans-en') && typeIn(becomes.querySelector('.ans-en'), 'Clean');
var asChoice = rowOptionsForSave(becomes, 'Floors').options;
ok('a question that becomes a choice hands over its answers', Array.isArray(asChoice),
   JSON.stringify(asChoice));

// ---- a linked record still comes back untouched (it owns its whole object) ----
var lrec = { links_to_name: 'Shops', links_to_table: 'tbl123' };
var linked = addBuilderField({ id: 'l1', label: 'Shop', type: 'link',
  linkRec: linkRecordOptions(lrec), keepOpts: keptOptions(lrec) });
same('linked-record metadata is unchanged', rowOptionsForSave(linked, 'Shop').options, lrec);
ok('a linked record is not refused for having no URL', !rowOptionsForSave(linked, 'Shop').error);

// ---- a link button rewrites its own URL and keeps the rest ----
var btn = addBuilderField({ id: 'l2', label: 'Follow up', type: 'link',
  opts: 'https://old.test | Old', keepOpts: keptOptions({ url: 'https://old.test', text: 'Old', score_fmt: 'percent' }) });
typeIn(btn.querySelector('.opts'), 'https://new.test | New');
same('the URL is replaced and the rest kept', rowOptionsForSave(btn, 'Follow up').options,
  { score_fmt: 'percent', url: 'https://new.test', text: 'New', text_ar: '' });

// ---- what the editor owns is still the editor's ----
var branch = addBuilderField({ id: 'br1', label: 'Shop', type: 'branch',
  opts: 'jo', keepOpts: keptOptions({ list: 'jo' }) });
same('a branch question still saves its own list', rowOptionsForSave(branch, 'Shop').options,
  { list: 'jo' });

// ---- the row is the only place this is remembered ----
// If the attribute is missing (a row added by hand, a question just created) nothing is kept
// and nothing is invented.
var fresh = addBuilderField({ label: 'New question', type: 'short_text' });
same('a brand-new question keeps nothing', rowOptionsForSave(fresh).options, null);
ok('nothing kept is null rather than {}', rowOptionsForSave(fresh).options === null);
} catch (e) {
  fail++;
  out.push('FAIL the page threw -> ' + (e && e.message) + '\\n' + (e && e.stack));
}
document.getElementById('out').textContent =
  out.join('\\n') + '\\n\\n' + pass + ' passed, ' + fail + ' failed';
</script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-optskept-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page, 'utf8');
const dump = cp.execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=3000', '--dump-dom', 'file:///' + file.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
const m = dump.match(/<pre id="out">([\s\S]*?)<\/pre>/);
const text = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
if (!text.trim()) {
  console.log('FAIL: the page produced no results — the script did not reach the end');
  process.exitCode = 1;
} else {
  console.log(text);
  if (/FAIL/.test(text) || /\b0 passed/.test(text)) process.exitCode = 1;
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
