// The builder's two new sections, clicked.
//
// form-country.test.js and decision-flow.test.js cover the rules from source. This covers
// the thing itself: ticking a country and reading what builderScope() gives back, the note
// changing between one country and two, turning the decision on and watching the three
// stages appear, and a round trip through setDecisionInputs/serializeDecision.
//
// It is worth its own file because every one of those is an id in the markup matching a
// getElementById in the JS, and a mismatch there passes every source-level test in this
// folder while the section does nothing at all. The markup is lifted out of index.html
// rather than retyped, so a renamed id fails here instead of in a browser.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/builder-scope.chrome.js
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
  const multi = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}'));
  if (multi) return multi[0];
  const one = js.match(new RegExp('\\n  function ' + name + '\\s*\\(.*'));
  if (one) return one[0];
  throw new Error('could not find function ' + name);
}
function grabVar(name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [\\s\\S]*?;(?=\\r?\\n)'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
// The REAL markup, cut out of the page between two landmarks it is written between. Retyping
// it here is what would let a renamed id pass.
function markup(fromRe, toRe, what) {
  const a = src.search(fromRe);
  if (a === -1) throw new Error('could not find the start of ' + what);
  const b = src.slice(a).search(toRe);
  if (b === -1) throw new Error('could not find the end of ' + what);
  return src.slice(a, a + b);
}
const scopeHtml = markup(/<div class="fp-label" id="bld-scope-lab"/, /<div class="fp-label" id="bld-q-lab"/, 'the country section');
const decHtml = markup(/<div class="bld-decision-wrap" id="bld-decision-wrap">/, /<div class="bld-actions-wrap"/, 'the decision section');

const fns = ['esc', 'countryLabel', 'builderScope', 'scopeCountry', 'scopeAsks', 'fillBuilderCountries',
  'syncScopeNote', 'slugify', 'addStageRow', 'serializeStages', 'serializeDecision', 'setDecisionInputs',
  'syncDecisionRows', 'decisionCfg'].map(grab).join('\n');
const vars = [grabVar('STAGE_COLORS'), grabVar('DECISION_STAGES')].join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
${scopeHtml}
<div id="bld-stages"></div>
${decHtml}
<pre id="out"></pre>
<script>
${fns}
${vars}
var COUNTRY_LIST = [
  { code: 'jo', name_en: 'Jordan' },
  { code: 'lebanon', name_en: 'Lebanon' },
  { code: 'iraq', name_en: 'Iraq' },
  { code: 'syria', name_en: 'Syria' }
];
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function shown(el) { return !!(el && el.getClientRects().length); }
function byId(id) { return document.getElementById(id); }
function tick(el, on) { el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); }
function co(code) { return document.querySelector('.bld-co[value="' + code + '"]'); }
function note() { return byId('bld-scope-note').textContent; }
function stageLabels() {
  return [].slice.call(document.querySelectorAll('#bld-stages .bld-stage .st-label')).map(function (i) { return i.value; });
}
// The page wires these two itself; the harness has no listener block to lift, so it wires
// the same two here. Everything else is the page's own code.
byId('bld-countries').addEventListener('change', syncScopeNote);
byId('bld-dec-on').addEventListener('change', syncDecisionRows);
byId('bld-dec-sched').addEventListener('change', syncDecisionRows);

// ---- the country ticks ----
fillBuilderCountries([]);
ok('every country on file gets a tick', document.querySelectorAll('.bld-co').length === 4,
   String(document.querySelectorAll('.bld-co').length));
ok('nothing is pre-ticked', builderScope().countries.length === 0, JSON.stringify(builderScope()));
ok('and the note says so', /No country/.test(note()), note());

tick(co('jo'), true);
ok('ticking one is read back', builderScope().countries.join(',') === 'jo', JSON.stringify(builderScope()));
ok('one country is stamped, not asked', scopeAsks(builderScope().countries) === false);
ok('and config.country is that country', scopeCountry(builderScope().countries) === 'jo');
ok('the note names it and says the form stays silent',
   /Jordan/.test(note()) && /does not ask/.test(note()), note());

tick(co('iraq'), true);
ok('ticking a second is read back in list order', builderScope().countries.join(',') === 'jo,iraq',
   JSON.stringify(builderScope()));
ok('two countries make the form ask', scopeAsks(builderScope().countries) === true);
ok('and config.country goes null, because it could only be wrong', scopeCountry(builderScope().countries) === null);
ok('the note names both and says the form asks',
   /Jordan/.test(note()) && /Iraq/.test(note()) && /asks which country/.test(note()), note());

tick(co('jo'), false);
ok('unticking drops back to one', builderScope().countries.join(',') === 'iraq', JSON.stringify(builderScope()));
ok('and the form stops asking again', scopeAsks(builderScope().countries) === false);

fillBuilderCountries(['jo', 'syria']);
ok('reopening a saved table ticks what it had', builderScope().countries.join(',') === 'jo,syria',
   JSON.stringify(builderScope()));
fillBuilderCountries([]);
ok('and a table with no country opens with nothing ticked', builderScope().countries.length === 0);

// ---- the decision ----
ok('the decision body is hidden until it is switched on', !shown(byId('bld-dec-body')));
ok('and nothing is written while it is off', serializeDecision().on === false);

tick(byId('bld-dec-on'), true);
ok('switching it on opens the body', shown(byId('bld-dec-body')));
ok('and adds the three stages, because status needs somewhere to be read',
   stageLabels().join(',') === 'New,Approved,Rejected', stageLabels().join(','));
ok('the stages are real editable rows', document.querySelectorAll('#bld-stages .bld-stage .st-color').length === 3);
ok('the date box is hidden until scheduling is asked for', !shown(byId('bld-dec-sched-body')));

tick(byId('bld-dec-sched'), true);
ok('ticking scheduling opens the date box', shown(byId('bld-dec-sched-body')));

tick(byId('bld-dec-on'), false);
tick(byId('bld-dec-on'), true);
ok('switching it off and on again does not add the stages twice',
   stageLabels().join(',') === 'New,Approved,Rejected', stageLabels().join(','));

// ---- a round trip ----
var CFG = { on: true, approve: 'Hire', reject: 'Pass', schedule: true,
            when_label: 'Start date', message: 'Welcome {Full name}, see you {Date}', location: 'Abdoun' };
setDecisionInputs(CFG);
var back = serializeDecision();
ok('everything typed in comes back out', JSON.stringify(back) === JSON.stringify(CFG), JSON.stringify(back));
ok('and reads as a live decision', decisionCfg({ config: { decision: back } }).approve === 'Hire');

setDecisionInputs(null);
ok('a table with no decision opens blank and off',
   serializeDecision().on === false && serializeDecision().message === '', JSON.stringify(serializeDecision()));

// A table that HAD a decision and lost it keeps its wording, so ticking the box back on
// gets it back instead of a blank form to retype.
setDecisionInputs(Object.assign({}, CFG, { on: false }));
ok('an off decision still remembers its labels and message',
   serializeDecision().approve === 'Hire' && /Welcome/.test(serializeDecision().message),
   JSON.stringify(serializeDecision()));

document.getElementById('out').textContent = out.join('\\n') + '\\n' + pass + ' passed, ' + fail + ' failed';
document.title = fail ? 'FAILED' : 'OK';
<\/script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-scope-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page, 'utf8');
const dump = path.join(dir, 'dump.txt');
cp.execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=4000', '--dump-dom', '--window-size=1200,900',
  'file:///' + file.replace(/\\/g, '/')], { stdio: ['ignore', fs.openSync(dump, 'w'), 'ignore'] });
const dom = fs.readFileSync(dump, 'utf8');
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
if (!m) { console.log('FAILED: the page did not run — no output block'); process.exit(1); }
const text = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const bad = text.split('\n').filter(l => l.indexOf('FAIL') === 0);
bad.forEach(l => console.log(l));
console.log(text.split('\n').filter(l => /passed, /.test(l))[0] + ' (builder-scope, in Chrome)');
process.exitCode = bad.length ? 1 : 0;
