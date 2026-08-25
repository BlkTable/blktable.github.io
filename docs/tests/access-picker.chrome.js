// The access picker, clicked.
//
// access-picker.test.js covers the rules — what a stored grant reads as, what gets written
// back, what the search matches. This covers the thing itself: typing in the search box,
// ticking a row, changing a level, "Select all", Clear, the country line that only appears
// on a row that has been granted. None of that is reachable from node, because it is DOM and
// it is events, and a picker whose search box quietly stopped filtering would pass every
// other test in this folder while showing an admin all 118 rows again.
//
// Like card-panel.chrome.js it needs headless Chrome, and is skipped rather than failed when
// there is none:
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/access-picker.chrome.js
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
// The level list is the page's own — a test that spelled the three levels itself would keep
// passing after somebody added a fourth.
const levels = (js.match(/\n  var AP_LEVELS = [\s\S]*?\];/) || [])[0];
if (!levels) throw new Error('could not find AP_LEVELS');
const fns = ['esc', 'accessLevelOf', 'accessGrantFor', 'pickerMatch', 'pickerRows', 'pickerCountText', 'accessPicker'].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="host"></div><pre id="out"></pre>
<script>
${fns}
${levels}
var COUNTRY_LIST = [{ code: 'jo', name_en: 'Jordan' }, { code: 'lebanon', name_en: 'Lebanon' }];
var ITEMS = [
  { key: 'a', name: 'Job Applications' },
  { key: 'b', name: 'Handover Sheet', alt: 'كشف التسليم' },
  { key: 'c', name: 'BLK Casting' },
  { key: 'd', name: 'Casting Callbacks' }
];
// 'b' is the row written before levels existed: manager, but without can_edit.
var INITIAL = [{ key: 'b', can_edit: false, can_manage: true, countries: ['jo'] }];
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
var host = document.getElementById('host');
var P = accessPicker(host, { items: ITEMS, initial: INITIAL, noun: 'tables', placeholder: 'Search tables…', scope: true });
function keys() { return [].slice.call(host.querySelectorAll('.ap-row')).map(function (r) { return r.getAttribute('data-key'); }); }
function row(k) { return host.querySelector('.ap-row[data-key="' + k + '"]'); }
function val() { return P.value().slice().sort(function (x, y) { return x.key < y.key ? -1 : 1; }); }
function count() { return host.querySelector('.ap-count').textContent; }
function type(t) { var s = host.querySelector('.ap-search'); s.value = t; s.dispatchEvent(new Event('input', { bubbles: true })); }
function tick(el) { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); }
function pick(k, level) { var s = row(k).querySelector('.ap-level'); s.value = level; s.dispatchEvent(new Event('change', { bubbles: true })); }
function shown(el) { return !!(el && el.getClientRects().length); }

// ---- what it opens as ----
ok('every row is listed', keys().length === 4, keys().join(','));
ok('what is already granted is at the top', keys()[0] === 'b', keys().join(','));
ok('the count says how many out of how many', count() === '1 of 4 tables selected', count());
ok('a granted row reads at its stored level', row('b').querySelector('.ap-level').value === 'manage');
ok('an ungranted row cannot be given a level until it is granted', row('a').querySelector('.ap-level').disabled === true);
ok('the country line is hidden on a row nobody granted', !shown(row('a').querySelector('.ap-scope')));
ok('and shown on the row that has one', shown(row('b').querySelector('.ap-scope')));
ok('the stored country is ticked', row('b').querySelector('.ap-co[value="jo"]').checked === true);
ok('Clear is offered because something is selected', shown(host.querySelector('.ap-clear')));
ok('Select all is not offered while nothing is being searched for', !shown(host.querySelector('.ap-all')));

// ---- the search box ----
type('casting');
ok('typing narrows the list to what matches', keys().join(',') === 'c,d', keys().join(','));
ok('the count still names the whole list, not the visible part', count() === '1 of 4 tables selected', count());
ok('Select all appears, naming how many it would add', host.querySelector('.ap-all').textContent === 'Select all 2',
   host.querySelector('.ap-all').textContent);
type('التسليم');
ok('an arabic name finds its table', keys().join(',') === 'b', keys().join(','));
type('nothing here');
ok('a search that matches nothing says so rather than showing an empty box',
   host.querySelector('.ap-empty') !== null && keys().length === 0);
type('');
ok('clearing the search brings everything back, granted first', keys().join(',') === 'b,a,c,d', keys().join(','));

// ---- granting ----
tick(row('a').querySelector('.ap-box'));
ok('ticking a row grants it', val().map(function (v) { return v.key; }).join(',') === 'a,b', JSON.stringify(val()));
ok('and the row does not jump away from under the pointer', keys().join(',') === 'b,a,c,d', keys().join(','));
ok('its level box is live now', row('a').querySelector('.ap-level').disabled === false);
ok('a new grant starts at view', val()[0].can_edit === false && val()[0].can_manage === false, JSON.stringify(val()[0]));
ok('the count moved', count() === '2 of 4 tables selected', count());
ok('the country line appeared with the grant', shown(row('a').querySelector('.ap-scope')));

pick('a', 'manage');
ok('choosing Manager grants edit too', val()[0].can_edit === true && val()[0].can_manage === true, JSON.stringify(val()[0]));
pick('a', 'edit');
ok('going back to Can edit drops the manage right', val()[0].can_edit === true && val()[0].can_manage === false, JSON.stringify(val()[0]));

// The one that matters: 'b' was stored as manager-without-edit and nobody touched it.
ok('a row nobody touched is written back exactly as it was stored',
   val()[1].can_edit === false && val()[1].can_manage === true, JSON.stringify(val()[1]));

tick(row('b').querySelector('.ap-co[value="lebanon"]'));
ok('ticking a second country adds it to the limit', val()[1].countries.join(',') === 'jo,lebanon', JSON.stringify(val()[1].countries));

tick(row('a').querySelector('.ap-box'));
ok('unticking a row revokes it', val().map(function (v) { return v.key; }).join(',') === 'b', JSON.stringify(val()));
ok('and its level box goes back to view rather than keeping the old answer',
   row('a').querySelector('.ap-level').value === 'view' && row('a').querySelector('.ap-level').disabled === true);

// ---- select all, and clear ----
type('casting');
host.querySelector('.ap-all').click();
ok('Select all grants every row the search is showing',
   val().map(function (v) { return v.key; }).join(',') === 'b,c,d', JSON.stringify(val()));
ok('and nothing it is not showing', val().filter(function (v) { return v.key === 'a'; }).length === 0);
ok('Select all goes away once there is nothing left to add', !shown(host.querySelector('.ap-all')));
type('');
host.querySelector('.ap-clear').click();
ok('Clear empties the whole selection', P.value().length === 0, JSON.stringify(P.value()));
ok('Clear then hides itself', !shown(host.querySelector('.ap-clear')));
ok('nothing selected says so in words', count() === 'No tables selected', count());
ok('and the rows are all still there to pick again', keys().length === 4, keys().join(','));

// ---- the empty list ----
var host2 = document.createElement('div'); document.body.appendChild(host2);
accessPicker(host2, { items: [], noun: 'people', empty: 'No reviewer accounts yet.' });
ok('an empty list says what to do about it', host2.querySelector('.ap-empty').textContent === 'No reviewer accounts yet.',
   host2.querySelector('.ap-empty').textContent);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-access-picker-')), 'picker.html');
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
  console.log(result.replace('RESULT ', '') + ' (access picker, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
