// The countries under a table, drawn and pressed in a real browser.
//
// country-rail.test.js covers WHICH countries belong on the rail. This covers the two things
// that are DOM and events, and that are why a rail the page was perfectly capable of drawing
// showed nothing:
//
//   1. THE FOLD WAS FLIPPED BY OPENING THE TABLE. A custom table's sidebar line has its own
//      click handler (openCustomTable), and it runs before the delegated one on #side-tables.
//      So by the time the delegated handler asked "is this the table I am already looking
//      at?", currentCustom was ALREADY the table just pressed — the answer was always yes,
//      every press was a toggle, and the branch meant for "opening a different table" could
//      never run. Open a table, and its countries folded away every other time.
//   2. THE FOLD HAD NO HANDLE. The Job Applications line carries a caret; a custom table's
//      line carried nothing at all, so a folded rail and a table with no countries looked
//      exactly alike.
//
// Both are reproduced here on the real functions and the real handler, lifted out of
// index.html as source — nothing is reimplemented.
//
// Needs headless Chrome, so it skips rather than fails when Chrome is not installed:
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/country-rail.chrome.js
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
function grabVar(name) {
  const m = js.match(new RegExp('var ' + name + ' = \\[[\\s\\S]*?\\n  \\];'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
const fns = ['esc', 'flagImg', 'countryLabel', 'tableCountries', 'scopeCountryCodes',
             'countryFlag', 'paintSideCaret', 'renderCustomScope'].map(grab).join('\n') +
            '\n' + grabVar('DEFAULT_COUNTRIES') + '\n' + grabVar('COUNTRIES') + '\n';

// The real handler, not a retyped one: this is the block whose ORDER was the bug, so a test
// that wrote its own version would prove nothing about the page.
const handler = (js.match(/  \/\/ Pressing the line of the table you are already looking at[\s\S]*?\r?\n  \}\);\r?\n/) || [])[0];
if (!handler) throw new Error('could not find the #side-tables fold handler in index.html');
// Pressing a country is the other half of the rail, and the same rule applies: it is the
// page's own handler or it proves nothing.
const kidsHandler = (js.match(/  \/\/ the children under a table in the sidebar[\s\S]*?\r?\n  \}\);\r?\n/) || [])[0];
if (!kidsHandler) throw new Error('could not find the #custom-kids handler in index.html');

// The real rail markup, and two table lines that behave like the real ones: a custom table's
// line sets currentCustom in its OWN click handler, synchronously, exactly as openCustomTable
// does — which is the whole reason the delegated handler was looking at the wrong answer.
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<nav class="side-list" id="side-tables">
  <button class="side-item" data-view="job_applications"><span class="side-label">Job Applications</span><span class="side-caret" id="ja-caret">&#9656;</span><span class="side-gear">&#8943;</span></button>
  <div class="side-kids" id="ja-kids" style="display:none;"></div>
  <div class="side-kids" id="custom-kids" style="display:none;"></div>
  <span id="custom-tables-slot"></span>
</nav>
<input id="custom-search" type="search">
<pre id="out"></pre>
<script>
${fns}
var COUNTRY_LIST = DEFAULT_COUNTRIES.slice();
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

// ---- the app's own state, as renderCustomScope reads it ----
var SHOP_AUDIT = { id: 't-audit', name: 'Shop Audit', config: { countries: ['jo', 'lebanon'] } };
var COMPLAINTS = { id: 't-comp', name: 'Customer Complaints', config: { countries: ['jo', 'lebanon'] } };
var ONE_COUNTRY = { id: 't-one', name: 'Wastage', config: { countries: ['jo'] } };
var currentCustom = null;
var customFacets = { branches: {}, countries: {}, statuses: {}, total: 0, all_total: 0 };
var customViews = [], viewFind = '';
var customKidsOpen = true;
function viewsHtml() { return ''; }              // saved views are their own rail and their own test
function loadCustomSubs() { loaded++; }          // pressing a country reloads the rows
function applyView() {}                          // the view half of the same handler
function deleteView() {}
var loaded = 0;

// The two lines in the rail, each wired the way loadCustomTables wires a real one.
var slot = document.getElementById('custom-tables-slot');
function line(t) {
  var b = document.createElement('button');
  b.className = 'side-item';
  b.setAttribute('data-custom', t.id);
  b.innerHTML = '<span class="side-label">' + esc(t.name) + '</span>' +
    (tableCountries(t).length > 1 ? '<span class="side-caret">' + (customKidsOpen ? '\\u25be' : '\\u25b8') + '</span>' : '') +
    '<span class="side-gear">\\u22ef</span>';
  b.addEventListener('click', function () { openTable(t); });
  slot.parentNode.insertBefore(b, slot);
  return b;
}
// What openCustomTable does that matters here: currentCustom is set synchronously, then the
// rows and facets come back and the rail is drawn.
function openTable(t) {
  currentCustom = { table: t, subs: [], branch: null, country: null };
  customFacets = FACETS[t.id];
  renderCustomScope();
}
var FACETS = {
  't-audit': { countries: { jo: 23, lebanon: 2 }, all_total: 25 },
  't-comp':  { countries: { jo: 1327, __none: 116 }, all_total: 1443 },
  't-one':   { countries: { jo: 40 }, all_total: 40 }
};
var auditLine = line(SHOP_AUDIT), compLine = line(COMPLAINTS), oneLine = line(ONE_COUNTRY);

${kidsHandler}
${handler}

function press(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
function railRows() {
  return [].slice.call(document.querySelectorAll('#custom-kids .side-kid[data-c]'))
    .map(function (b) { return b.getAttribute('data-c') + ':' + b.querySelector('.kid-n').textContent; });
}
function railShown() {
  var cy = document.querySelector('#custom-kids .side-kid-countries');
  return !!cy && cy.style.display !== 'none';
}
function caret(el) { var c = el.querySelector('.side-caret'); return c ? c.textContent : null; }

// ---- 1. what the rail says -------------------------------------------------------------
press(auditLine);
ok('a table with records in two countries lists both, under All countries',
   railRows().join(' ') === ':25 jo:23 lebanon:2', railRows().join(' '));
ok('and the rail is on screen', railShown());
ok('each country carries its flag',
   document.querySelectorAll('#custom-kids .side-kid img').length === 2,
   String(document.querySelectorAll('#custom-kids .side-kid img').length));
ok('Lebanon is spelled from the countries table, not from its code',
   /Lebanon/.test(document.getElementById('custom-kids').innerHTML));

press(compLine);
ok('a table ticked for two countries lists both before the second has any records',
   railRows().join(' ') === ':1443 jo:1327 lebanon:0 __none:116', railRows().join(' '));
ok('the empty country reads 0 rather than undefined',
   !/undefined/.test(document.getElementById('custom-kids').innerHTML));
ok('records with no country come last',
   railRows()[railRows().length - 1].indexOf('__none') === 0, railRows().join(' '));

press(oneLine);
ok('a table ticked for one country has no rail at all', railRows().length === 0, railRows().join(' '));
ok('and no caret, because there is nothing under it to open', caret(oneLine) === null);

// ---- 2. the fold ------------------------------------------------------------------------
press(auditLine);
ok('opening a table shows its countries straight away', railShown());
ok('and its line carries an open caret', caret(auditLine) === '\\u25be', String(caret(auditLine)));

// THE BUG: this press is a different table being OPENED, not a fold being asked for.
press(compLine);
ok('opening ANOTHER table does not fold the rail away', railShown());
ok('and that line reads as open too', caret(compLine) === '\\u25be', String(caret(compLine)));

// Pressing the line of the table already open is the fold, and it still works both ways.
press(compLine);
ok('pressing the open table\\'s own line folds its countries away', !railShown());
ok('and the caret turns', caret(compLine) === '\\u25b8', String(caret(compLine)));
press(compLine);
ok('pressing it again brings them back', railShown());
ok('and the caret turns back', caret(compLine) === '\\u25be', String(caret(compLine)));

// A fold is remembered, but it must not follow you onto a table you are only just opening.
press(compLine);                       // folded
press(auditLine);                      // a different table
ok('a folded rail stays folded when another table is opened', !railShown());
press(auditLine);
ok('and the fold reopens on the table you are now looking at', railShown());

// ---- 3. the gear is not the line --------------------------------------------------------
press(auditLine);                      // known open
var gearBefore = railShown();
press(auditLine.querySelector('.side-gear'));
ok('the \\u22ef menu does not fold the rail', railShown() === gearBefore);

// ---- 4. pressing a country scopes the table ---------------------------------------------
var before = loaded;
press(document.querySelector('#custom-kids .side-kid[data-c="lebanon"]'));
ok('pressing a country reloads the rows scoped to it',
   currentCustom.country === 'lebanon' && loaded === before + 1,
   String(currentCustom.country) + '/' + loaded);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-country-rail-')), 'rail.html');
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
  console.log(result.replace('RESULT ', '') + ' (country rail, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
