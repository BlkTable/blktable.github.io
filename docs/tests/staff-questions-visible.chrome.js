// The record panel a store leader opens on a complaint that arrived an hour ago.
//
// staff-questions-visible.test.js covers the rule. This covers the thing itself, in a real DOM,
// because the property that matters is not "showsOn returned true" — it is that the follow-up
// questions exist as form controls the shop can type into, and that edValues() then FINDS them
// so the save carries the answers. A rule that returns true while the row is never built, or is
// built with no input in it, reads as fixed and does nothing.
//
// The record here is the one the bug made unworkable: the customer's side answered, every
// staff-only question empty, because the customer never saw them.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/staff-questions-visible.chrome.js
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
// showsOn and the follow-up set live inside openCustomDetail(), so they come out by source
// text. CRLF-tolerant: index.html is CRLF and a \n-only anchor silently finds nothing.
const followUp = (js.match(/\r?\n {4}var followUpIds = \{\};\r?\n {4}\(fields \|\| \[\]\)\.forEach\([^\r\n]*\r?\n/) || [])[0];
if (!followUp) throw new Error('could not find the followUpIds construction');
const showsOn = (js.match(/\r?\n {4}function showsOn\(f, d, forEdit\) \{[\s\S]*?\r?\n {4}\}\r?\n/) || [])[0];
if (!showsOn) throw new Error('could not find showsOn()');

const fns = [
  'esc', 'branchFillableIds', 'lockedAnswerHtml', 'customCellText', 'edValues', 'edRow',
  'edFieldRowHtml', 'edText', 'edSelect', 'edChecks', 'edChecksValue', 'edDate', 'edTime',
  'edNum', 'choiceList', 'fieldHasOther', 'isOtherChoice', 'otherKeyFor', 'isFileField',
  'filePaths', 'fileLabel', 'ageText', 'condMet', 'isScorerField', 'isChoiceField'
].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="host" class="m-grid"></div><div id="ro" class="m-grid"></div><pre id="out"></pre>
<script>
window.onerror = function (m, s, l) {
  document.getElementById('out').textContent = 'RESULT 0 passed, 1 failed\\nFAIL page threw: ' + m + ' (line ' + l + ')';
};
${fns}
var edPhoneReg = {};
function scoreMetaOf() { return null; }   // the row painter, not under test here
function recordOptsFor() { return {}; }
function edChecksKeyed() { return ''; }
function branchDropdownOptions() { return []; }
function branchScopeKeys() { return []; }
function countryAnswerIn() { return null; }
function countryChoiceNames() { return []; }
function edPhone(id, v) { return edText(id, v, false); }
function wireEdPhone() {}
function parsePhone(v) { return { cc: '962', local: String(v || '') }; }
function edFlagUrl() { return ''; }

var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

// Customer Complaints after migration 60, in miniature.
var fields = [
  { id: 'q-name',   label: 'Customer Name',        type: 'short_text', internal: false },
  { id: 'q-what',   label: 'Your Complaint',       type: 'long_text',  internal: false },
  { id: 'q-called', label: 'First Contact',        type: 'yesno',      internal: true, branch_edit: true },
  { id: 'q-fix',    label: 'How was it resolved?', type: 'long_text',  internal: true, branch_edit: true },
  { id: 'q-who',    label: 'Who is responsible?',  type: 'long_text',  internal: true, branch_edit: true },
  { id: 'q-email',  label: 'Email',                type: 'email',      internal: true, branch_edit: false },
  { id: 'q-star',   label: 'Star for later',       type: 'short_text', internal: true, branch_edit: false }
];
// The complaint as it exists the moment the customer presses submit.
var d = { 'q-name': 'Layla', 'q-what': 'the drink arrived cold' };

// openCustomDetail's own locals, so the extracted rule runs against what it expects.
var scoreSlot = null, detailShowAll = false;
var currentCustom = { table: { id: 't1', config: {} } };
var pickedIds = null, curated = false;
${followUp}
${showsOn}

// ---- render the editable panel exactly the way the record panel does, as a branch login ----
var fillable = branchFillableIds(fields);
var host = document.getElementById('host');
host.innerHTML = fields.map(function (f) {
  if (!showsOn(f, d, true)) return '';
  return fillable[f.id] ? edFieldRowHtml(f, d, { fields: fields }) : lockedAnswerHtml(f, d);
}).join('');

function el(id) { return document.getElementById('ed-' + id); }
function shown(e) { return !!(e && e.getClientRects().length); }

// ---- the bug, stated as assertions ----
ok('the follow-up questions are ON THE PAGE on a brand-new complaint',
   host.querySelectorAll('.m-field').length === 5, String(host.querySelectorAll('.m-field').length));
ok('First Contact is a control the shop can use', !!el('q-called') && shown(el('q-called')));
ok('the resolution box is a control the shop can use', !!el('q-fix') && shown(el('q-fix')));
ok('and so is "who is responsible"', !!el('q-who') && shown(el('q-who')));
ok('every follow-up row is actually visible, not merely in the DOM',
   [].slice.call(host.querySelectorAll('.m-field')).every(shown));

// ---- and the things that must NOT have changed ----
ok('the customer\\'s words are locked, not editable', el('q-what') === null);
ok('the customer\\'s name is locked too', el('q-name') === null);
ok('there are exactly two locked rows, the customer\\'s two answers',
   host.querySelectorAll('.m-field.locked').length === 2,
   String(host.querySelectorAll('.m-field.locked').length));
ok('a locked row still shows what the customer wrote',
   host.textContent.indexOf('the drink arrived cold') > -1);
ok('an empty staff question nobody nominated is not drawn at all',
   el('q-email') === null && el('q-star') === null &&
   host.textContent.indexOf('Star for later') === -1);

// ---- the part that makes it a fix rather than a rendering ----
// A row on screen with no input, or an input edValues cannot find, saves nothing.
// Guarded: with the old rule these rows do not exist, and an unguarded .value = throws,
// which replaces every result above with one "page threw" line and hides what broke.
function type(id, v) {
  var e = el(id);
  if (!e) { ok('a control exists to type "' + id + '" into', false, 'no input was rendered'); return; }
  e.value = v;
}
type('q-fix', '  called her and replaced the drink  ');
type('q-who', 'Ahmad');
type('q-called', 'Yes');
var cur = edValues(fields);
ok('edValues finds the answers the shop just typed',
   cur['q-fix'] === 'called her and replaced the drink' && cur['q-who'] === 'Ahmad',
   JSON.stringify(cur));
ok('and reads back ONLY the follow-up questions',
   Object.keys(cur).sort().join(',') === 'q-called,q-fix,q-who', Object.keys(cur).sort().join(','));
ok('the customer\\'s answers are not among them',
   !('q-what' in cur) && !('q-name' in cur));

// saveCustom's merge, run here rather than called, because the real one talks to the database.
var nd = {}; Object.keys(d).forEach(function (k) { nd[k] = d[k]; });
fields.forEach(function (f) {
  if (!Object.prototype.hasOwnProperty.call(cur, f.id)) return;
  var v = cur[f.id];
  if (v == null || v === '') delete nd[f.id]; else nd[f.id] = v;
});
ok('the follow-up reaches the record', nd['q-fix'] === 'called her and replaced the drink' && nd['q-called'] === 'Yes');
ok('and the customer\\'s complaint survives it byte for byte', nd['q-what'] === 'the drink arrived cold');

// ---- a second render, now that the follow-up HAS answers ----
// The questions must stay put; this is the case that worked before and must keep working.
host.innerHTML = fields.map(function (f) {
  if (!showsOn(f, nd, true)) return '';
  return fillable[f.id] ? edFieldRowHtml(f, nd, { fields: fields }) : lockedAnswerHtml(f, nd);
}).join('');
ok('an answered follow-up is still drawn',
   !!el('q-fix') && String(el('q-fix').value).indexOf('replaced the drink') > -1);

// ---- the read-only panel: someone with access but no can_edit ----
// showsOn is called without forEdit there, and an empty follow-up must stay out: a reader
// cannot fill it and a column of "—" tells them nothing.
var ro = document.getElementById('ro');
ro.innerHTML = fields.map(function (f) {
  if (!showsOn(f, d, undefined)) return '';
  return lockedAnswerHtml(f, d);
}).join('');
ok('a read-only viewer sees only the answered questions',
   ro.querySelectorAll('.m-field').length === 2, String(ro.querySelectorAll('.m-field').length));
ok('and no follow-up prompt they cannot act on',
   ro.textContent.indexOf('How was it resolved?') === -1);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

function runPage(html, name) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-staff-visible-')), 'page.html');
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

runPage(page, 'a new complaint, opened by a shop');
