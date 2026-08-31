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
// The branch list the picker groups by country. Real names, so a change to the grouping
// shows up as the wrong heading rather than as nothing at all.
var allBranches = [
  { name: 'Khalda', list_key: 'jo' },
  { name: 'Muqabalein', list_key: 'jo' },
  { name: 'Muqabalein 5B', list_key: 'jo' },
  { name: 'Sweileh', list_key: 'jo' }
];
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

// ---- the branch limit, and the staff-fields limit ----
// A branch account is the whole point of this control: it must appear ONLY on a table
// that actually asks a branch question, because the read policy only limits those.
var host3 = document.createElement('div'); document.body.appendChild(host3);
var BR_ITEMS = [
  { key: 'ms', name: 'Mystery Shopper' },      // asks a branch question
  { key: 'cc', name: 'Customer Complaints' },  // asks a branch question
  { key: 'nb', name: 'Contact Us' }            // does NOT
];
var BR_LIST = ['Khalda', 'Muqabalein', 'Muqabalein 5B', 'Sweileh'];
var P3 = accessPicker(host3, {
  items: BR_ITEMS,
  initial: [{ key: 'cc', can_edit: true, can_manage: false, countries: [], branches: ['Khalda'], fieldsInternal: true }],
  noun: 'tables', scope: true, fieldLimit: true,
  branchesFor: function (it) { return it.key === 'nb' ? [] : BR_LIST; }
});
function row3(k) { return host3.querySelector('.ap-row[data-key="' + k + '"]'); }
function val3(k) { return P3.value().filter(function (v) { return v.key === k; })[0]; }
function keys3() { return [].slice.call(host3.querySelectorAll('.ap-row')).map(function (r) { return r.getAttribute('data-key'); }); }
function pick3(k, level) { var s = row3(k).querySelector('.ap-level'); s.value = level; s.dispatchEvent(new Event('change', { bubbles: true })); }
function tickBranch(k, name) {
  var b = row3(k).querySelector('.ap-br-box[value="' + name + '"]');
  b.checked = !b.checked; b.dispatchEvent(new Event('change', { bubbles: true }));
}

ok('a table with no branch question offers no branch limit', !row3('nb').querySelector('.ap-br'));
ok('a table that asks one does offer it', !!row3('ms').querySelector('.ap-br'));
ok('the branch limit is hidden until the table is granted', !shown(row3('ms').querySelector('.ap-br')));
ok('a stored branch is read back and shown', shown(row3('cc').querySelector('.ap-br')) &&
   row3('cc').querySelector('.ap-br-box[value="Khalda"]').checked === true);
ok('one branch is named in the summary', /Khalda/.test(row3('cc').querySelector('.ap-br-sum').textContent),
   row3('cc').querySelector('.ap-br-sum').textContent);
ok('a stored staff-fields limit is read back', row3('cc').querySelector('.ap-fl').checked === true);
ok('and it is written back out', val3('cc').fieldsInternal === true);

// grant a new table and limit it to two shops
tick(row3('ms').querySelector('.ap-box'));
ok('a freshly granted row starts on every branch',
   /Every branch/.test(row3('ms').querySelector('.ap-br-sum').textContent),
   row3('ms').querySelector('.ap-br-sum').textContent);
ok('and writes no branch limit at all', val3('ms').branches.length === 0);
tickBranch('ms', 'Muqabalein');
tickBranch('ms', 'Muqabalein 5B');
ok('two shops are counted, not listed one by one',
   /2 branches/.test(row3('ms').querySelector('.ap-br-sum').textContent),
   row3('ms').querySelector('.ap-br-sum').textContent);
ok('and both are written back', val3('ms').branches.sort().join('|') === 'Muqabalein|Muqabalein 5B',
   val3('ms').branches.join('|'));

// the staff-fields limit only means anything with edit rights
ok('staff-fields is hidden on a view-only row', !shown(row3('ms').querySelector('.ap-fields')));
pick3("ms", "edit");
ok('and appears once the row can edit', shown(row3('ms').querySelector('.ap-fields')));
tick(row3('ms').querySelector('.ap-fl'));
ok('ticking it is written back', val3('ms').fieldsInternal === true);
// dropping back to view must not leave a limit set that can never apply
pick3("ms", "view");
ok('dropping back to view clears the staff-fields limit', val3('ms').fieldsInternal === false);
ok('and the box is unticked too', row3('ms').querySelector('.ap-fl').checked === false);

// the branch list has its own search, separate from the picker's table search
var pop = row3('ms').querySelector('.ap-br-pop');
row3('ms').querySelector('.ap-br-open').click();
ok('Change opens the branch list', pop.classList.contains('open'));
var bq = pop.querySelector('.ap-br-q');
bq.value = 'muq'; bq.dispatchEvent(new Event('input', { bubbles: true }));
var visible = [].slice.call(pop.querySelectorAll('.ap-br-list label')).filter(shown).length;
ok('searching inside the branch list narrows it', visible === 2, 'visible=' + visible);
ok('and does not touch the table list above it', keys3().length === 3, keys3().join(','));
bq.value = ''; bq.dispatchEvent(new Event('input', { bubbles: true }));
ok('clearing the branch search brings them all back',
   [].slice.call(pop.querySelectorAll('.ap-br-list label')).filter(shown).length === 4);

// un-granting a row must not leave its branch limit behind to be re-saved later
tick(row3('cc').querySelector('.ap-box'));
tick(row3('cc').querySelector('.ap-box'));
ok('re-granting a row starts clean, with no branch carried over',
   val3('cc').branches.length === 0 && val3('cc').fieldsInternal === false,
   JSON.stringify(val3('cc')));

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
