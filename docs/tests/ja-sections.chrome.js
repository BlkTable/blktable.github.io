// Pressing Approved, in a browser, on the page's own markup.
//
// ja-sections.test.js calls setSection() directly, so it proves the loader asks the database
// for the open tab — but it never touches the button. The bug people actually saw was "I press
// Approved and there is nobody there", and between the button and the loader sits a click
// listener that used to call renderApps(). A node test that calls past it would have stayed
// green with the listener still re-rendering the same 500 unreviewed rows.
//
// So this file lifts the real tabs/list/count markup and the real listener out of index.html,
// stubs only the database (with a scope far bigger than one page, the shape the live table is
// in), CLICKS the button, and reads the cards and the count line off the rendered DOM.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/ja-sections.chrome.js
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
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([^)]*\\)[^\\n]*\\}[^\\n]*\\r?\\n', '')) ||
            js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
}
function grabVar(name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' =[\\s\\S]*?;[^\\n]*\\r?\\n', ''));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
// The page's own markup, verbatim: the tabs, the list, the "show more" line and the empty
// state. A hand-written pair of buttons here would keep passing after data-s was renamed.
const tabs = (src.match(/<div class="seg tabs" id="ja-tabs">[\s\S]*?<div id="ja-empty"[\s\S]*?<\/div>/) || [])[0];
if (!tabs) throw new Error('could not find the Job Applications tabs/list markup in index.html');
// and the page's own click listener, which is the half a node test cannot reach
const listener = (js.match(/\n  document\.getElementById\("ja-tabs"\)\.addEventListener[\s\S]*?\n  \}\);/) || [])[0];
if (!listener) throw new Error('could not find the ja-tabs click listener in index.html');

const fns = ['esc', 'jaScoped', 'loadFacets', 'loadApps', 'searchApps', 'setSection', 'filterApps',
  'sectionCounts', 'recordNumber', 'calcAge', 'ageFlag', 'phoneCountry', 'waEligible',
  'fmtInterview', 'renderApps'].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<span class="base-count" id="ja-count">—</span>
<input type="search" id="ja-search">
${tabs}
<pre id="out"></pre>
<script>
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

${grabVar('JA_PAGE')}
${grabVar('JA_RENDER_STEP')}
${grabVar('COUNTRIES')}
${grabVar('WA_DIAL')}
var section = 'new', allApps = [], jaView = 'cards', jaRenderCap = JA_RENDER_STEP, jaServerSearch = false;
var jaScope = { year: 2026, country: null };
var jaFacets = { years: {}, countries: {}, statuses: {}, total: 0, unsent: 0 };
var jobFV = {};
// Stubbed because they are not what this file is about — each has its own tests.
function passesFilters() { return true; }
function canManage() { return true; }
function starHtmlFor() { return ''; }
function wireStar() {}
function setThumb() {}
function renderScopeBar() {}
function buildFilterPanel() {}
function openDetail() {}
function openSchedule() {}
function reject() {}
function sendWhatsApp() {}
function setStatus() {}
function deletePermanent() {}

// ---- the table, in the shape the live one is in: 11,042 rows in scope, the newest page of
// them entirely unreviewed, the reviewed people sitting hundreds to thousands of rows deep.
var ROWS = [];
(function () {
  var t = Date.parse('2026-08-30T12:00:00Z');
  function push(status, n, name) {
    for (var i = 0; i < n; i++) {
      ROWS.push({ id: status + '-' + i, seq: ROWS.length + 1, full_name: name + ' ' + i,
        phone: '+96279' + (1000000 + ROWS.length), living_area: 'Amman', status: status,
        message_sent: false, interview_at: null, photo_path: null, date_of_birth: '2000-01-01',
        created_at: new Date(t -= 60000).toISOString() });
    }
  }
  push('new', JA_PAGE + 20, 'Unreviewed');
  push('approved', 46, 'Approved person');
  push('rejected', 8, 'Rejected person');
})();
var COUNTS = { new: JA_PAGE + 20, approved: 46, rejected: 8 };

var db = {
  from: function () {
    var q = {
      _tests: [], _limit: null, _desc: true,
      select: function () { return this; },
      eq: function (c, v) { this._tests.push(function (r) { return String(r[c]) === String(v); }); return this; },
      gte: function (c, v) { this._tests.push(function (r) { return String(r[c]) >= String(v); }); return this; },
      lt: function (c, v) { this._tests.push(function (r) { return String(r[c]) < String(v); }); return this; },
      is: function (c, v) { this._tests.push(function (r) { return r[c] === v; }); return this; },
      or: function (s) {
        var term = (/full_name\\.ilike\\.%([^%]*)%/.exec(s) || [])[1] || '';
        this._tests.push(function (r) { return r.full_name.toLowerCase().indexOf(term.toLowerCase()) !== -1; });
        return this;
      },
      order: function () { return this; },
      limit: function (n) { this._limit = n; return this; },
      then: function (res) {
        var tests = this._tests;
        var rows = ROWS.filter(function (r) { return tests.every(function (f) { return f(r); }); });
        if (this._limit) rows = rows.slice(0, this._limit);   // ROWS is already newest-first
        return Promise.resolve({ data: rows }).then(res);
      }
    };
    return q;
  },
  rpc: function () {
    return Promise.resolve({ data: { years: { 2026: ROWS.length }, countries: {},
      statuses: { new: COUNTS.new, approved: COUNTS.approved, rejected: COUNTS.rejected },
      total: ROWS.length, unsent: 0 } });
  }
};

${fns}
${listener}

function cards() { return document.querySelectorAll('#ja-list .ja-card').length; }
function names() {
  return [].map.call(document.querySelectorAll('#ja-list .ja-card .name'), function (e) { return e.textContent; });
}
function press(tab) { document.querySelector('#ja-tabs button[data-s="' + tab + '"]').click(); }
function settle() { return new Promise(function (r) { setTimeout(r, 40); }); }

(async function () {
  await loadApps(); await settle();
  // A page is loaded (JA_PAGE) but only JA_RENDER_STEP of it is drawn, with "Show more"
  // for the rest — that part of the board was never broken and must stay as it is.
  ok('New opens on the unreviewed, a screenful at a time',
     cards() === JA_RENDER_STEP && allApps.length === JA_PAGE, cards() + ' cards, ' + allApps.length + ' loaded');
  ok('and offers the rest of the page it already holds',
     document.getElementById('ja-more').style.display === 'block' &&
     /200 more loaded/.test(document.getElementById('ja-more-note').textContent),
     JSON.stringify(document.getElementById('ja-more-note').textContent));

  // ---- the bug, through the button ----
  press('approved');
  await settle();
  ok('pressing Approved shows the approved people', cards() === 46, cards() + ' cards');
  ok('and they really are the approved ones',
     names().length > 0 && names().every(function (n) { return n.indexOf('Approved person') !== -1; }),
     JSON.stringify(names().slice(0, 2)));
  ok('the count line agrees with the tab instead of "showing 0 of 46"',
     document.getElementById('ja-count').textContent === '46 applicants',
     JSON.stringify(document.getElementById('ja-count').textContent));
  ok('the empty state is not showing over them',
     document.getElementById('ja-empty').style.display === 'none',
     document.getElementById('ja-empty').style.display);
  ok('and nothing offers to load "the rest" that is already there',
     document.getElementById('ja-more').style.display === 'none');
  ok('the tab count still reads from the database',
     document.getElementById('cnt-approved').textContent === '(46)',
     JSON.stringify(document.getElementById('cnt-approved').textContent));
  ok('the button pressed is the one marked active',
     document.querySelector('#ja-tabs button.active').getAttribute('data-s') === 'approved');

  press('rejected');
  await settle();
  ok('Rejected shows its 8, which sit deeper still', cards() === 8, cards() + ' cards');

  press('new');
  await settle();
  ok('and New comes back to the unreviewed', cards() === JA_RENDER_STEP && allApps.length === JA_PAGE,
     cards() + ' cards, ' + allApps.length + ' loaded');

  // ---- a search carried across tabs ----
  document.getElementById('ja-search').value = 'Approved person 4';
  press('approved');
  await settle();
  ok('a search typed before the tab change is still applied after it',
     cards() > 0 && cards() < 46 && names().every(function (n) { return n.indexOf('Approved person 4') !== -1; }),
     cards() + ' cards: ' + JSON.stringify(names().slice(0, 3)));

  out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
  document.getElementById('out').textContent = out.join('\\n');
})();
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-ja-sections-')), 'ja.html');
fs.writeFileSync(file, page);
const url = 'file:///' + file.replace(/\\/g, '/');
const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', url],
                         { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dom = run.stdout || '';
const block = (dom.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (!block || !/RESULT/.test(block)) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 2000));
  process.exitCode = 1;
} else {
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  console.log(result.replace('RESULT ', '') + ' (job application tabs, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
