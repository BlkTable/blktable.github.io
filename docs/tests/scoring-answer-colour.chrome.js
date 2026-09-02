// The colour on a Shop Audit answer, in a real browser.
//
// scoring-answer-colour.test.js covers the rule and pins the wiring. This covers the thing
// itself, because the failure it exists to catch was never arithmetic: scoreRowMeta had been
// right about an imported scorecard for months while Shop Audit's 68 rules-priced questions
// rendered completely plain. Every function returned a sensible value and the page showed
// nothing, which is the exact shape of bug a unit test cannot see.
//
// So the assertions here are about pixels: that the row carries a border the browser will
// actually paint, on all four sides rather than down one edge, in three colours a reader can
// tell apart, and that answering a question repaints it live.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/scoring-answer-colour.chrome.js
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

const fns = [
  // the colour itself, both engines and the packer they share
  'scoreMetaOf', 'scoreRowMeta', 'scoreRuleMeta', 'scoreMetaPack', 'scoreClassOf',
  'scoreChipLabel', 'scoreChipTitle', 'scorerMaxPoints', 'scoreRulePoints',
  // the rules engine underneath it
  'choicePoints', 'questionMaxPoints', 'naChoices', 'questionApplies', 'questionEarned',
  'scorecardTotals', 'condMet', 'scoreRollup', 'questionScorerMap', 'scoreTint',
  // the live repaint, which is the whole point of driving a real DOM
  'paintScoreRows', 'scoreLiveTotal',
  // the editor rows it repaints
  'esc', 'edValues', 'edRow', 'edFieldRowHtml', 'edText', 'edSelect', 'edChecks',
  'edChecksValue', 'edDate', 'edTime', 'edNum', 'choiceList', 'fieldHasOther',
  'isOtherChoice', 'otherKeyFor', 'isFileField', 'filePaths', 'fileLabel', 'ageText',
  'isScorerField', 'isChoiceField'
].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="review" class="m-grid"></div>
<div id="host" class="m-grid"></div>
<div id="ed-live-score" class="sc-live"></div>
<pre id="out"></pre>
<script>
window.onerror = function (m, s, l) {
  document.getElementById('out').textContent = 'RESULT 0 passed, 1 failed\\nFAIL page threw: ' + m + ' (line ' + l + ')';
};
${fns}
var edPhoneReg = {};
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

// ---- Shop Audit in miniature: five questions, priced by rules, no scorer columns ----
// This is the shape that lost its colour on 2026-09-01. config.scorecard is what says so.
var table = { id: 'shop-audit', config: { scorecard: true, score_field: 'pct' } };
var fields = [
  { id: 'q-clean', label: 'Is the shop floor clean?', type: 'yesno',
    scoring: { rule: 'equals', earn: ['Yes'], points: 4 } },
  { id: 'q-rate',  label: 'Overall presentation', type: 'dropdown', scoring: { rule: 'choices' },
    options: [{ en: 'Excellent', points: 3 }, { en: 'Acceptable', points: 1 }, { en: 'Poor', points: 0 }] },
  { id: 'q-uni',   label: 'Uniform worn correctly?', type: 'yesno',
    scoring: { rule: 'equals', earn: ['Yes'], points: 2 } },
  { id: 'q-kitch', label: 'Kitchen surfaces', type: 'dropdown', scoring: { rule: 'choices' },
    options: [{ en: 'Clean', points: 2 }, { en: 'Dirty', points: 0 }, { en: 'No kitchen here', na: true }] },
  { id: 'q-note',  label: 'Anything else', type: 'short_text' }        // not scored at all
];
// A finished inspection: one right, one half-right, one wrong, one that does not apply.
var d = { 'q-clean': 'Yes', 'q-rate': 'Acceptable', 'q-uni': 'No',
          'q-kitch': 'No kitchen here', 'q-note': 'busy morning' };

// ---- the review grid ----
// Built the way openCustomDetail builds it. That source line is pinned character by
// character in scoring-answer-colour.test.js ("the review grid asks the dispatcher"), so
// what is left to prove here is that the classes it emits actually paint.
document.getElementById('review').innerHTML = fields.map(function (f) {
  var sm = scoreMetaOf(f, null, d);
  return '<div class="m-field' + (sm ? ' sc-' + sm.cls : '') + '"><div class="k">' +
    esc(f.label) + (sm ? sm.chip : '') + '</div><div class="v">' + esc(String(d[f.id] || '')) + '</div></div>';
}).join('');

function row(i) { return document.getElementById('review').children[i]; }
function cs(e) { return getComputedStyle(e); }
// A border the browser will not paint is the failure that looks like success in the DOM.
function painted(e) {
  var s = cs(e), c = s.borderTopColor;
  return parseFloat(s.borderTopWidth) > 0 && c !== 'transparent' &&
    !/rgba\\([^)]*,\\s*0\\)/.test(c) && c !== s.backgroundColor;
}
function sides(e) {
  var s = cs(e);
  return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(parseFloat);
}

ok('the right answer is boxed green', row(0).classList.contains('sc-plus'), row(0).className);
ok('the half-right answer is boxed yellow', row(1).classList.contains('sc-part'), row(1).className);
ok('the wrong answer is boxed red', row(2).classList.contains('sc-zero'), row(2).className);
ok('the question that does not apply is grey, not red', row(3).classList.contains('sc-na'), row(3).className);
ok('an unscored question is left alone entirely',
   !/sc-/.test(row(4).className), row(4).className);

// The user asked for a border around the answer, not a bar beside it. A leading-edge band
// passes every class assertion above and is not what was asked for.
ok('the scored answer carries a border on all four sides',
   sides(row(0)).every(function (w) { return w > 0; }), JSON.stringify(sides(row(0))));
ok('and so does the wrong one', sides(row(2)).every(function (w) { return w > 0; }),
   JSON.stringify(sides(row(2))));
ok('the border is one the browser actually paints, not a transparent placeholder',
   painted(row(0)) && painted(row(1)) && painted(row(2)),
   [cs(row(0)).borderTopColor, cs(row(1)).borderTopColor, cs(row(2)).borderTopColor].join(' / '));

var colours = [row(0), row(1), row(2)].map(function (e) { return cs(e).borderTopColor; });
ok('green, yellow and red are three different colours on screen',
   new Set(colours).size === 3, colours.join(' / '));
ok('the green one really is the greenest of the three', (function () {
  var rgb = colours.map(function (c) { return c.match(/\\d+/g).map(Number); });
  return rgb[0][1] > rgb[0][0] && rgb[2][0] > rgb[2][1];      // green: G>R, red: R>G
})(), colours.join(' / '));
ok('the grey row is not wearing one of the traffic-light colours',
   cs(row(3)).borderTopColor !== colours[0] && cs(row(3)).borderTopColor !== colours[2],
   cs(row(3)).borderTopColor);

// The chip beside the label carries the number the colour cannot.
ok('the green row shows what it earned', row(0).querySelector('.k .qp').textContent === '+4',
   row(0).querySelector('.k .qp').textContent);
ok('the yellow row shows the part it earned', row(1).querySelector('.k .qp').textContent === '+1',
   row(1).querySelector('.k .qp').textContent);
ok('the red row shows a nought rather than nothing',
   row(2).querySelector('.k .qp').textContent === '0', row(2).querySelector('.k .qp').textContent);
ok('every chip is visible in review, the grey one included',
   [].slice.call(document.getElementById('review').querySelectorAll('.k .qp'))
     .every(function (c) { return c.getClientRects().length > 0; }));
ok('the chip says in words what the colour says in colour',
   /Partly right/.test(row(1).querySelector('.k .qp').title), row(1).querySelector('.k .qp').title);

// ---- the editor: a blank inspection must not open already accusing anybody ----
var host = document.getElementById('host');
var blank = {};
host.innerHTML = fields.map(function (f) {
  return edFieldRowHtml(f, blank, { photo: 'input', answers: blank, fields: fields });
}).join('');

function erow(id) {
  var h = document.getElementById('ed-' + id);
  return h && h.closest ? h.closest('.m-field') : null;
}
ok('every question is drawn in the editor', host.querySelectorAll('.m-field').length === 5,
   String(host.querySelectorAll('.m-field').length));
ok('a blank inspection opens with no red anywhere',
   host.querySelectorAll('.sc-zero, .sc-plus, .sc-part, .sc-neg').length === 0,
   host.innerHTML.slice(0, 200));
ok('and with no chips to read', [].slice.call(host.querySelectorAll('.k .qp'))
   .every(function (c) { return c.getClientRects().length === 0; }));
// A scored question still gets its faint grey box before it is answered -- that is how you
// can see which questions carry points. What it must not have is a verdict.
ok('an unanswered row is boxed in the plain line colour, not a verdict',
   colours.indexOf(cs(erow('q-clean')).borderTopColor) === -1,
   cs(erow('q-clean')).borderTopColor);

// ---- answering one question repaints it, live, before any save ----
// This is what paintScoreRows is for, and what an empty scorer map silently skipped.
function type(id, v) {
  var e = document.getElementById('ed-' + id);
  if (!e) { ok('a control exists for ' + id, false, 'no input rendered'); return; }
  e.value = v;
}
type('q-clean', 'Yes');
type('q-rate', 'Acceptable');
type('q-uni', 'No');
type('q-kitch', 'No kitchen here');
paintScoreRows(table, fields, questionScorerMap(table, fields), edValues(fields), 'ed-live-score');

ok('the right answer goes green the moment it is picked',
   erow('q-clean').classList.contains('sc-plus'), erow('q-clean').className);
ok('the half-right answer goes yellow', erow('q-rate').classList.contains('sc-part'),
   erow('q-rate').className);
ok('the wrong answer goes red', erow('q-uni').classList.contains('sc-zero'),
   erow('q-uni').className);
ok('the one that does not apply stays grey', erow('q-kitch').classList.contains('sc-na'),
   erow('q-kitch').className);
ok('the repainted border is painted for real, not just classed',
   painted(erow('q-clean')) && painted(erow('q-uni')));
ok('the chips appear as the answers do',
   erow('q-clean').querySelector('.k .qp').textContent === '+4' &&
   erow('q-clean').querySelector('.k .qp').getClientRects().length > 0,
   erow('q-clean').querySelector('.k .qp').textContent);
ok('and the one on the question that does not apply stays hidden',
   erow('q-kitch').querySelector('.k .qp').getClientRects().length === 0);

// The running total: a builder-made scorecard has no roll-up rule, so this used to be blank.
var live = document.getElementById('ed-live-score');
ok('the running total appears for a scorecard with no roll-up rule',
   /\\d+%/.test(live.textContent), JSON.stringify(live.textContent));
ok('and it counts 5 of the 9 points that applied, leaving the kitchen out of both',
   live.textContent.indexOf('5 / 9 points') > -1, JSON.stringify(live.textContent));

// Correcting an answer has to move the colour back, or a fixed mistake stays red.
type('q-uni', 'Yes');
paintScoreRows(table, fields, questionScorerMap(table, fields), edValues(fields), 'ed-live-score');
ok('correcting a wrong answer turns the box green again',
   erow('q-uni').classList.contains('sc-plus') && !erow('q-uni').classList.contains('sc-zero'),
   erow('q-uni').className);
ok('and the running total follows it up', live.textContent.indexOf('7 / 9 points') > -1,
   JSON.stringify(live.textContent));

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

function runPage(html, name) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-answer-colour-')), 'page.html');
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

runPage(page, 'a Shop Audit record and its editor');
