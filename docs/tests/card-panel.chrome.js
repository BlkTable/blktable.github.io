// The "Customize cards" panel, driven in a real browser.
//
// card-customise.test.js covers the rule — which of the three levels wins, what a card shows.
// This covers the panel: the arrows, the tick boxes, Crop/Fit, the cover radios and Reset,
// clicked in order, with the answer read back out of storage. None of that is reachable from
// node, because it is DOM and it is events, and a panel whose reorder quietly stopped working
// would pass every other test in this folder.
//
// It is the one test here that needs something beyond node: headless Chrome. Everything else
// runs without it, so this file is skipped rather than failed when Chrome is not found.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/card-panel.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
//
// It builds a page holding the real stylesheet and the real functions lifted out of
// index.html — nothing is reimplemented here — stubs renderCustom to redraw the panel exactly
// as the app's own render does, and reads the results back out of the dumped DOM.
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
const fns = ['esc', 'isFileField', 'cardKey', 'cardLocal', 'cardHas', 'cardPrefs', 'cardSave',
             'cardChoosable', 'summaryFields', 'renderCardPanel'].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div class="cols-panel open" id="card-panel"></div><pre id="out"></pre>
<script>
${fns}
var isAdmin = true;
var redraws = 0;
// what renderCustom does on its way past the panel
function renderCustom() { redraws++; renderCardPanel(T, FIELDS); }
var db = { from: function () { return { update: function () { return { eq: function () { return { then: function () {} }; } }; } }; } };
var T = { id: 'itable', config: { card_fields: ['f-name', 'f-city', 'f-note'] } };
var FIELDS = [
  { id: 'f-name', label: 'Full name', type: 'text' },
  { id: 'f-city', label: 'City', type: 'dropdown' },
  { id: 'f-note', label: 'Notes', type: 'long_text' },
  { id: 'f-age', label: 'Age', type: 'number' },
  { id: 'f-photo', label: 'Photo', type: 'photo' },
  { id: 'f-cv', label: 'CV', type: 'file' }
];
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function stored() { return cardPrefs(T, FIELDS); }
function fieldsNow() { return JSON.stringify(Array.from(stored().fields || [])); }
function rows() {
  return [].slice.call(document.querySelectorAll('#card-panel .card-fld input[data-cf]'))
    .map(function (i) { return i.getAttribute('data-cf'); });
}
function click(sel) {
  var el = document.querySelector(sel);
  if (!el) { out.push('FAIL no element ' + sel); fail++; return; }
  el.click();
}

localStorage.removeItem(cardKey(T));
renderCardPanel(T, FIELDS);

ok('opens on the saved default', JSON.stringify(rows().slice(0, 3)) === '["f-name","f-city","f-note"]', rows().join(','));
ok('the first chosen field is marked as the title', document.querySelector('#card-panel .card-fld .card-title-tag') !== null);

// ---- order ----
click('[data-down="f-name"]');
ok('moving a field down reorders the stored list', fieldsNow() === '["f-city","f-name","f-note"]', fieldsNow());
ok('the panel redrew itself after the move', redraws === 1, 'redraws=' + redraws);
ok('and the new first field carries the title tag',
   document.querySelector('#card-panel .card-fld input[data-cf]').getAttribute('data-cf') === 'f-city');
click('[data-up="f-name"]');
ok('moving it back up restores the order', fieldsNow() === '["f-name","f-city","f-note"]', fieldsNow());
// The ends must not wrap around: a title that jumps to the bottom when you press up again is
// worse than a button that does nothing.
click('[data-up="f-name"]');
ok('up on the first field does nothing', fieldsNow() === '["f-name","f-city","f-note"]', fieldsNow());
click('[data-down="f-note"]');
ok('down on the last field does nothing', fieldsNow() === '["f-name","f-city","f-note"]', fieldsNow());

// ---- which fields ----
click('input[data-cf="f-city"]');
ok('unticking a field drops it', fieldsNow() === '["f-name","f-note"]', fieldsNow());
click('input[data-cf="__branch"]');
ok('ticking a field appends it at the end', fieldsNow() === '["f-name","f-note","__branch"]', fieldsNow());
ok('a chosen column becomes an orderable row', rows().indexOf('__branch') !== -1);
// A card with no fields has no title either, and the panel would have nothing left to tick back on.
click('input[data-cf="f-name"]'); click('input[data-cf="f-note"]'); click('input[data-cf="__branch"]');
ok('the last remaining field cannot be unticked', Array.from(stored().fields || []).length === 1, fieldsNow());
ok('and it is still ticked in the panel', document.querySelector('#card-panel .card-fld input[data-cf]').checked);

// ---- cover and shape ----
click('[data-fit="fit"]');
ok('Fit is stored', stored().fit === 'fit');
ok('and marked in the panel', document.querySelector('[data-fit="fit"]').className.indexOf('on') !== -1);
click('input[name="cardcov"][value="f-cv"]');
ok('choosing the other file question moves the cover', stored().cover === 'f-cv', String(stored().cover));
ok('the shape buttons stay while a cover is chosen', document.querySelector('[data-fit="crop"]') !== null);
click('input[name="cardcov"][value=""]');
ok('choosing None leaves no cover', stored().cover === null, String(stored().cover));
ok('and the shape buttons go with it — there is nothing left to crop', document.querySelector('[data-fit="crop"]') === null);

// ---- names, and starting over ----
click('#card-labels');
ok('field names off is stored', stored().labels === false);
click('#card-reset');
ok('Reset goes back to the saved default rather than to nothing',
   fieldsNow() === '["f-name","f-city","f-note"]' && stored().cover === 'f-photo' &&
   stored().fit === 'crop' && stored().labels === true, JSON.stringify(stored()));
ok('Reset leaves nothing behind in storage', localStorage.getItem(cardKey(T)) === null);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-card-panel-')), 'panel.html');
fs.writeFileSync(file, page);
const url = 'file:///' + file.replace(/\\/g, '/');
const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--dump-dom', url],
                         { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dom = run.stdout || '';
const block = (dom.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (!block) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 2000));
  process.exitCode = 1;
} else {
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  console.log(result.replace('RESULT ', '') + ' (card panel, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
