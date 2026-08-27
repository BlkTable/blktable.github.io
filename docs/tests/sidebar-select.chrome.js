// Select mode in the rail, CLICKED — in a real browser, on the real markup and the real
// stylesheet.
//
// sidebar-select.test.js covers the helpers and the two writes. Every rule that file cannot
// reach is a rule about CSS or about a press, and each one is a way the feature ships looking
// finished and doing nothing:
//
//   * the tick boxes never becoming visible, because `#side-tables.selecting .side-chk` and
//     the `.side-gear` display rule sit at equal specificity and whichever is later wins —
//     a mode you switch on and see no change from reads as a dead button,
//   * every table name jumping 20px right on entering select mode, which is the whole reason
//     the tick box stands IN the colour mark's slot rather than beside it,
//   * a table line still OPENING when you meant to tick it, which navigates away mid-selection,
//   * the bar not appearing, or appearing at zero,
//   * and a row still lifting as a drag when the press was meant to be a tick.
//
// Needs headless Chrome, so it skips rather than fails when Chrome is not installed:
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/sidebar-select.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in index.html');

let pass = 0, fail = 0;
function src_ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
// The one thing this rail must never grow, asserted with or without Chrome.
src_ok('the bulk bar offers no delete',
       !/delete/i.test((src.match(/<div class="side-selbar"[\s\S]*?\n\s*<\/div>\s*\n\s*<\/div>/) || [''])[0]));

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log(pass + ' source checks passed, ' + fail + ' failed. SKIPPED the browser half: no Chrome or Edge found (set CHROME=<path>).');
  process.exit(fail ? 1 : 0);
}

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
const fns = ['sideSelPrune', 'sideSelTables', 'sideSelSummary', 'sideSelBarText', 'isArchived',
  'toggleSideSel', 'paintSideSel', 'setSideSelMode'].map(grab).join('\n');
// The mode flag and the selection itself are `var`s, not functions, and a test that re-typed
// them would go on passing after the page changed its mind about either.
function grabVar(name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
const vars = ['sideSelMode', 'sideSel'].map(grabVar).join('\n');

// The real markup, lifted out of index.html rather than re-typed: the Workspace header with
// its Select button, and the bar at the foot of the rail. A hand-written copy here would go on
// passing after the page renamed an id.
function lift(re, what) {
  const m = src.match(re);
  if (!m) throw new Error('could not find ' + what + ' in index.html');
  return m[0];
}
const header = lift(/<div class="side-hd">[\s\S]*?<\/button>\s*\n\s*<\/div>/, 'the Workspace header');
const bar = lift(/<div class="side-selbar"[\s\S]*?\n\s*<\/div>\s*\n\s*<\/div>/, 'the selection bar');

// A rail that looks like a real one: two built-ins with no tick box of their own, four custom
// tables of which one is already archived, and one of them inside a category fold.
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div class="workspace"><aside class="sidebar"><div class="side-scroll"><div class="side-group">
${header}<nav class="side-list side-list-x show-gears" id="side-tables">
  <button class="side-item" data-view="job_applications"><span class="tmark">J</span><span class="side-label">Job Applications</span><span class="side-gear">⋯</span></button>
  <button class="side-item" data-view="casting"><span class="tmark">B</span><span class="side-label">BLK Casting</span><span class="side-gear">⋯</span></button>
  <span id="custom-tables-slot">
    <button class="side-item" data-custom="t-a"><span class="side-chk" aria-hidden="true"></span><span class="tmark">A</span><span class="side-label">Alpha</span><span class="side-gear">⋯</span></button>
    <button class="side-item" data-custom="t-b"><span class="side-chk" aria-hidden="true"></span><span class="tmark">B</span><span class="side-label">Beta</span><span class="side-gear">⋯</span></button>
    <button class="side-item is-archived" data-custom="t-c"><span class="side-chk" aria-hidden="true"></span><span class="tmark">C</span><span class="side-label">Wastage</span><span class="side-arch-tag">archived</span><span class="side-gear">⋯</span></button>
    <button class="side-item side-cat"><span class="side-fold">▸</span><span class="side-label">QC</span></button>
    <span class="side-cat-items"><button class="side-item" data-custom="t-d"><span class="side-chk" aria-hidden="true"></span><span class="tmark">D</span><span class="side-label">QC one</span><span class="side-gear">⋯</span></button></span>
  </span>
</nav></div></div>
<div class="side-foot">${bar}</div></aside></div>
<pre id="out"></pre>
<script>
var isAdmin = true;
var customTables = [
  { id: 't-a', name: 'Alpha', config: {} },
  { id: 't-b', name: 'Beta', config: {} },
  { id: 't-c', name: 'Wastage', config: { archived: true } },
  { id: 't-d', name: 'QC one', config: {} }
];
${vars}
${fns}
// A page that throws prints a blank <pre>, which reads as "Chrome is missing" rather than
// as the one line that broke. Put the error where the results go.
window.onerror = function (msg, f, l) {
  var p = document.getElementById('out');
  p.textContent = (p.textContent ? p.textContent + '\\n' : '') + 'FAIL threw: ' + msg + ' (line ' + l + ')' +
    '\\nRESULT 0 passed, 1 failed';
  return true;
};
var opened = [];
function openCustomTable(t) { opened.push(t.id); }
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
// The real click handler sideItem installs, wired to these rows the same way.
[].slice.call(document.querySelectorAll('#side-tables .side-item[data-custom]')).forEach(function (el) {
  var t = customTables.filter(function (x) { return x.id === el.getAttribute('data-custom'); })[0];
  el.addEventListener('click', function () {
    if (sideSelMode) { toggleSideSel(t); return; }
    openCustomTable(t);
  });
  el.draggable = true;
});
document.getElementById('side-select-toggle').addEventListener('click', function (e) {
  e.stopPropagation(); setSideSelMode(!sideSelMode);
});
document.getElementById('ssel-clear').addEventListener('click', function () { setSideSelMode(false); });

var row = function (id) { return document.querySelector('#side-tables .side-item[data-custom="' + id + '"]'); };
var shown = function (el) { return el && getComputedStyle(el).display !== 'none'; };
var labelX = function (id) { return Math.round(row(id).querySelector('.side-label').getBoundingClientRect().left); };
var toggle = document.getElementById('side-select-toggle');
var selbar = document.getElementById('side-selbar');

// ---- before anything is pressed ---------------------------------------------
var xBefore = labelX('t-a');
ok('no tick box is drawn before select mode is on', !shown(row('t-a').querySelector('.side-chk')));
ok('and the bar is not on the screen', !shown(selbar));
ok('the toggle reads Select', toggle.textContent === 'Select', toggle.textContent);

// ---- pressing a table opens it, as it always has ----------------------------
row('t-a').click();
ok('pressing a table opens it while not selecting', opened.join(',') === 't-a', opened.join(','));

// ---- Select ------------------------------------------------------------------
toggle.click();
ok('the toggle now reads Done', toggle.textContent === 'Done', toggle.textContent);
ok('every custom table grows a visible tick box', shown(row('t-a').querySelector('.side-chk')) &&
   shown(row('t-d').querySelector('.side-chk')), 'the tick boxes are still display:none');
ok('the colour mark gives up its slot rather than sharing the row',
   !shown(row('t-a').querySelector('.tmark')));
ok('so the table names do not move a pixel', labelX('t-a') === xBefore, xBefore + ' -> ' + labelX('t-a'));
ok('the ⋯ is out of the way while you are ticking', !shown(row('t-a').querySelector('.side-gear')));
ok('a built-in table has no tick box to grow', !row('job_applications'));
ok('rows stop lifting as drags', row('t-a').draggable === false);
ok('the bar is still off with nothing ticked', !shown(selbar));

// ---- ticking -----------------------------------------------------------------
var openedBefore = opened.length;
row('t-a').click();
ok('pressing a table now ticks it instead of opening it',
   opened.length === openedBefore, 'it opened ' + opened.join(','));
ok('and the tick is drawn', row('t-a').querySelector('.side-chk').textContent === '✓');
ok('the row reads as picked', row('t-a').classList.contains('side-picked'));
ok('the bar comes on', shown(selbar));
ok('and counts one, in the singular',
   document.getElementById('ssel-n').textContent === '1 table selected',
   document.getElementById('ssel-n').textContent);
ok('one live table offers Archive and not Restore',
   shown(document.getElementById('ssel-archive')) && !shown(document.getElementById('ssel-restore')));
ok('and Archive is not qualified by a count when it covers the whole selection',
   document.getElementById('ssel-archive').textContent === 'Archive',
   document.getElementById('ssel-archive').textContent);

row('t-d').click();
ok('a table inside a category fold ticks like any other',
   row('t-d').classList.contains('side-picked'));
ok('two selected reads as plural',
   document.getElementById('ssel-n').textContent === '2 tables selected',
   document.getElementById('ssel-n').textContent);

// ---- a mixed selection -------------------------------------------------------
row('t-c').click();
ok('an archived table can be ticked alongside live ones',
   row('t-c').classList.contains('side-picked'));
ok('a mixed selection offers both actions',
   shown(document.getElementById('ssel-archive')) && shown(document.getElementById('ssel-restore')));
ok('and each names what it would actually touch, so neither looks like it does nothing',
   document.getElementById('ssel-archive').textContent === 'Archive 2' &&
   document.getElementById('ssel-restore').textContent === 'Restore 1',
   document.getElementById('ssel-archive').textContent + ' / ' + document.getElementById('ssel-restore').textContent);

// ---- unticking ---------------------------------------------------------------
row('t-c').click();
ok('pressing a ticked table unticks it', !row('t-c').classList.contains('side-picked'));
ok('and Restore goes away with it', !shown(document.getElementById('ssel-restore')));

// ---- leaving ------------------------------------------------------------------
document.getElementById('ssel-clear').click();
ok('Clear leaves select mode', toggle.textContent === 'Select', toggle.textContent);
ok('and drops the ticks', !row('t-a').classList.contains('side-picked') &&
   !row('t-d').classList.contains('side-picked'));
ok('the bar goes with it', !shown(selbar));
ok('the colour marks come back', shown(row('t-a').querySelector('.tmark')));
ok('the names are back where they started', labelX('t-a') === xBefore, xBefore + ' -> ' + labelX('t-a'));
ok('and the rows lift again', row('t-a').draggable === true);
opened = [];
row('t-a').click();
ok('pressing a table opens it once more', opened.join(',') === 't-a', opened.join(','));

// ---- a reviewer cannot get into select mode at all ---------------------------
isAdmin = false;
setSideSelMode(true);
ok('select mode refuses a non-admin, whose every action would be a no-op',
   toggle.textContent === 'Select' && !document.getElementById('side-tables').classList.contains('selecting'));

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
<\/script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-sidebar-select-')), 'rail.html');
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
  const m = result.match(/(\d+) passed, (\d+) failed/) || [0, 0, 1];
  pass += Number(m[1]); fail += Number(m[2]);
  console.log(pass + ' passed, ' + fail + ' failed (rail select mode, in ' + path.basename(chrome) + ')');
  if (fail) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
