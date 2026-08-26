// Typing a new record, losing the panel, and coming back to it — in a real browser.
//
// new-record-draft.test.js covers the helpers, and it can pass in full while the panel does
// nothing at all: the whole restore is one argument handed to edFieldRowHtml, and the whole
// save hangs off listeners on a grid that has to exist. None of that is reachable from node.
// So the whole of index.html is loaded unmodified apart from two stubs (the supabase client,
// and a localStorage the test can look inside), the real openNewRecord is opened on a made-up
// table, and the answers are read back out of the boxes the panel drew.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/new-record-draft.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
//
// Skipped rather than failed when no Chrome is found, the way the other .chrome.js files are.
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
if (!/cdn\.jsdelivr\.net/.test(src)) throw new Error('index.html no longer loads supabase from a CDN; update this stub');

// The client and the browser's storage, and nothing else. The page is opened from a file://
// URL, so it is handed a localStorage the test can see inside — the same API, seeded with the
// two things this browser is pretending to have been carrying already.
const STUB = `
window.__store = { map: {}, writes: 0 };
// a new-record draft for a table nobody went back to, left a month ago, and a public form's
// draft, which belongs to another page and must survive this one's sweep
window.__store.map['blk_nrdraft_tbl-forgotten__u-test'] = JSON.stringify({ v: 1, at: Date.now() - 30 * 86400000, a: { x: '1' } });
window.__store.map['blk_draft_health-certificate'] = JSON.stringify({ v: 1, at: Date.now() - 30 * 86400000, a: { x: '1' } });
window.__store.map['blk_device'] = 'device-id-that-must-survive';
try {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    get length() { return Object.keys(window.__store.map).length; },
    key: function (i) { return Object.keys(window.__store.map)[i]; },
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(window.__store.map, k) ? window.__store.map[k] : null; },
    setItem: function (k, v) { window.__store.writes++; window.__store.map[k] = String(v); },
    removeItem: function (k) { delete window.__store.map[k]; }
  } });
} catch (e) { window.__storeFailed = String(e && e.message); }
window.__rpc = null;
window.supabase = { createClient: function () {
  function chain() {
    var o = {};
    ['select', 'eq', 'in', 'is', 'neq', 'gt', 'gte', 'lt', 'lte', 'or', 'order', 'limit', 'range',
     'insert', 'update', 'upsert', 'delete'].forEach(function (m) { o[m] = function () { return o; }; });
    o.single = function () { return o; };
    o.maybeSingle = function () { return o; };
    o.then = function (f) { return Promise.resolve(f({ data: [], error: null })); };
    return o;
  }
  return {
    from: function () { return chain(); },
    rpc: function (name, payload) {
      window.__rpc = { name: name, payload: payload };
      return Promise.resolve({ data: 'new-record-id', error: null });
    },
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
      getUser: function () { return Promise.resolve({ data: { user: null }, error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signInWithPassword: function () { return Promise.resolve({ data: {}, error: null }); },
      signOut: function () { return Promise.resolve({ error: null }); }
    },
    storage: { from: function () { return { upload: function () { return Promise.resolve({ data: {}, error: null }); },
                                           getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
    functions: { invoke: function () { return Promise.resolve({ data: {}, error: null }); } },
    channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
    removeChannel: function () {}
  };
} };
`;

// The panel is opened directly rather than clicked to through a login and a sidebar: what is
// under test is openNewRecord and the overlay it lives on, both of them the page's own.
const DRIVER = `
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); } else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function finish() {
  out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
  document.getElementById('out').textContent = out.join('\\n');
  document.title = 'done';
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function until(test, ms) {
  var t0 = Date.now();
  return (function again() {
    if (test()) return Promise.resolve(true);
    if (Date.now() - t0 > ms) return Promise.resolve(false);
    return sleep(50).then(again);
  })();
}
function el(id) { return document.getElementById(id); }
function val(id) { var e = el(id); return e ? e.value : null; }
function set(id, v) {
  var e = el(id);
  if (!e) { ok('a box called ' + id + ' exists', false); return; }
  e.value = v;
  e.dispatchEvent(new Event('input', { bubbles: true }));
  e.dispatchEvent(new Event('change', { bubbles: true }));
}
function tick(fieldId, values) {
  [].slice.call(el('ed-' + fieldId).querySelectorAll('input')).forEach(function (i) {
    if (values.indexOf(i.value) !== -1) { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}
function ticked(fieldId) {
  return [].slice.call(el('ed-' + fieldId).querySelectorAll('input'))
    .filter(function (i) { return i.checked; }).map(function (i) { return i.value; }).join(',');
}
function modalOpen() { return el('modal').classList.contains('open'); }
// A click on the backdrop itself, which is what a miss outside the frame is.
function clickBackdrop() { el('modal').click(); }
function draft(key) { return window.__store.map[key]; }

function q(id, type, extra) {
  return Object.assign({ id: id, table_id: 'tbl-events', position: 0, label: id, label_ar: null, type: type,
                         required: false, options: null, internal: false, after_field: null, show_if: null }, extra || {});
}
var EVENTS = { id: 'tbl-events', name: 'Events', slug: 'events', is_active: true, kind: 'table', config: {} };
var COMPLAINTS = { id: 'tbl-complaints', name: 'Complaints', slug: 'complaints', is_active: true, kind: 'table', config: {} };
var FIELDS = [
  q('name', 'short_text'),
  q('why', 'long_text'),
  q('age', 'number'),
  q('when', 'date'),
  q('ok', 'yesno'),
  q('detail', 'short_text', { show_if: { field: 'ok', equals: ['Yes'] } }),
  q('how', 'dropdown', { options: [{ en: 'Instagram' }, { en: 'Something else', other: true }] }),
  q('days', 'multi_select', { options: [{ en: 'Sat' }, { en: 'Sun' }, { en: 'Mon' }] }),
  q('tel', 'phone'),
  q('pic', 'photo')
];
var KEY = 'blk_nrdraft_tbl-events__u-test';

until(function () { return typeof openNewRecord === 'function' && el('modal'); }, 8000).then(function (booted) {
  ok('the page loaded far enough to have a New record panel', booted);
  ok('the page could be given a storage it can see inside', !window.__storeFailed, window.__storeFailed);
  // Sweeping on the way in is the only thing that stops a half-typed record outliving the
  // week it was promised, and the public forms' drafts are not this page's to throw away.
  ok('a month-old new-record draft was swept on the way in',
     !draft('blk_nrdraft_tbl-forgotten__u-test'), JSON.stringify(Object.keys(window.__store.map)));
  ok('a public form draft was left alone, expired or not',
     !!draft('blk_draft_health-certificate'), JSON.stringify(Object.keys(window.__store.map)));
  ok('and this browser kept its device id, which is not a draft',
     window.__store.map['blk_device'] === 'device-id-that-must-survive');

  myUserId = 'u-test';
  customTables = [];
  currentCustom = null;

  // ---- an untouched panel ----
  openNewRecord(EVENTS, FIELDS);
  return until(function () { return el('ed-name'); }, 3000);
}).then(function (drew) {
  ok('the panel drew its questions', drew);
  ok('an untouched panel writes no draft', !draft(KEY), JSON.stringify(Object.keys(window.__store.map)));
  ok('and nothing is offered back, because there is nothing to offer',
     document.querySelector('.nr-kept') === null);
  clickBackdrop();
  ok('a backdrop click closes an untouched panel, exactly as it always did', !modalOpen());

  // ---- typing one ----
  openNewRecord(EVENTS, FIELDS);
  return until(function () { return el('ed-name'); }, 3000);
}).then(function () {
  set('ed-name', 'Autumn Fair');
  set('ed-why', 'the coffee festival asked us');
  set('ed-age', '15');
  set('ed-when', '2026-09-10');
  set('ed-ok', 'Yes');
  set('ed-how', 'Something else');
  tick('days', ['Sat', 'Mon']);
  set('ed-tel', '71234567');
  document.querySelectorAll('#ed-tel-menu li')[1].click();     // Lebanon
  return until(function () { return el('ed-detail') && el('cond-detail').style.display !== 'none'; }, 2000);
}).then(function (asked) {
  ok('the question behind a Yes is being asked', asked);
  set('ed-detail', 'it is the third year running');
  set('ed-how__other', 'a friend told us');
  nrPanel.flush();
  ok('the answers are in this browser under this table and this person\\'s key',
     !!draft(KEY), JSON.stringify(Object.keys(window.__store.map)));
  var a = JSON.parse(draft(KEY) || '{}').a || {};
  ok('every kind of question was kept',
     a.name === 'Autumn Fair' && a.why === 'the coffee festival asked us' && a.age === '15' &&
     a.when === '2026-09-10' && a.ok === 'Yes' && a.detail === 'it is the third year running' &&
     a.how === 'Something else' && a.how__other === 'a friend told us' &&
     a.days === 'Sat, Mon' && a.tel === '+96171234567', JSON.stringify(a));
  ok('the photo was not, because a file cannot be', !('pic' in a), JSON.stringify(a));

  // ---- the stray click that started all this ----
  clickBackdrop();
  ok('a backdrop click does not close a panel with a record in it', modalOpen());
  ok('and the record is still on screen, not redrawn empty', val('ed-name') === 'Autumn Fair', val('ed-name'));
  el('modal-close').click();
  ok('the ✕ still closes it', !modalOpen());

  // ---- coming back to it ----
  openNewRecord(EVENTS, FIELDS);
  return until(function () { return el('ed-name'); }, 3000);
}).then(function () {
  ok('the name came back', val('ed-name') === 'Autumn Fair', val('ed-name'));
  ok('the long answer came back', val('ed-why') === 'the coffee festival asked us', val('ed-why'));
  ok('the number came back', val('ed-age') === '15', val('ed-age'));
  ok('the date came back', val('ed-when') === '2026-09-10', val('ed-when'));
  ok('the yes/no came back', val('ed-ok') === 'Yes', val('ed-ok'));
  ok('the chosen option came back', val('ed-how') === 'Something else', val('ed-how'));
  ok('and the words typed behind it', val('ed-how__other') === 'a friend told us', val('ed-how__other'));
  ok('the box behind the "other" choice is showing, not hidden',
     el('ed-how__other').style.display !== 'none', el('ed-how__other').style.display);
  ok('the ticks came back, and only the ticked ones', ticked('days') === 'Sat,Mon', ticked('days'));
  ok('the phone number came back', val('ed-tel') === '71234567', val('ed-tel'));
  ok('with the country it was typed under, not the default',
     el('ed-tel-dial').textContent === '+961', el('ed-tel-dial').textContent);
  // The one that would have made the whole thing worthless: a question asked only behind a Yes
  // is drawn hidden by default, and must be revealed by the answer that was restored above it.
  ok('a question asked only behind a Yes is asked again, with its answer',
     val('ed-detail') === 'it is the third year running' && el('cond-detail').style.display !== 'none',
     val('ed-detail') + ' | ' + el('cond-detail').style.display);
  ok('the photo did not come back', el('ed-pic').files.length === 0, String(el('ed-pic').files.length));
  ok('and the person is told what was kept, and that a file was not',
     document.querySelector('.nr-kept') !== null &&
     /Kept what you had already filled in/.test(document.querySelector('.nr-kept').textContent) &&
     /Files need choosing again/.test(document.querySelector('.nr-kept').textContent),
     document.querySelector('.nr-kept') && document.querySelector('.nr-kept').textContent);

  // ---- another table is another draft ----
  el('modal-close').click();
  openNewRecord(COMPLAINTS, FIELDS);
  return until(function () { return el('ed-name'); }, 3000);
}).then(function () {
  ok('a different table opens empty rather than wearing the last one\\'s answers',
     val('ed-name') === '' && document.querySelector('.nr-kept') === null, val('ed-name'));
  el('modal-close').click();
  ok('and looking at it wrote nothing of its own', !draft('blk_nrdraft_tbl-complaints__u-test'),
     JSON.stringify(Object.keys(window.__store.map)));
  ok('while the first table\\'s draft is untouched', !!draft(KEY));

  // ---- starting over on purpose ----
  openNewRecord(EVENTS, FIELDS);
  return until(function () { return el('ed-name'); }, 3000);
}).then(function () {
  document.getElementById('nr-blank').click();
  return until(function () { return el('ed-name') && val('ed-name') === ''; }, 2000);
}).then(function (blanked) {
  ok('Start blank empties the panel', blanked, val('ed-name'));
  ok('and takes the draft with it', !draft(KEY), JSON.stringify(Object.keys(window.__store.map)));
  ok('and stops offering to put anything back', document.querySelector('.nr-kept') === null);

  // ---- the record that gets created ----
  set('ed-name', 'Winter Fair');
  set('ed-ok', 'No');
  nrPanel.flush();
  ok('the second attempt is kept too', !!draft(KEY));
  el('nr-save').click();
  return until(function () { return window.__rpc && window.__rpc.name === 'create_record'; }, 8000);
}).then(function (sent) {
  ok('the record was sent', sent, JSON.stringify(window.__rpc));
  ok('carrying what was typed, not blanks',
     window.__rpc.payload.p_data.name === 'Winter Fair' && window.__rpc.payload.p_data.ok === 'No',
     JSON.stringify(window.__rpc.payload.p_data));
  return until(function () { return !modalOpen(); }, 3000);
}).then(function (closed) {
  ok('the panel closed on its own', closed);
  // The panel is still holding every answer in the DOM, so a save on the way out would put
  // them straight back — the reason creating a record cancels the pending save as well.
  ok('a record that exists does not leave its draft behind', !draft(KEY),
     JSON.stringify(Object.keys(window.__store.map)));
  return sleep(600);
}).then(function () {
  ok('and nothing writes it back a moment later', !draft(KEY), JSON.stringify(Object.keys(window.__store.map)));
  finish();
}).catch(function (e) { ok('the driver ran to the end', false, String(e && (e.stack || e.message))); finish(); });
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-nr-draft-'));
const page = src
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^>]*><\/script>/, '<script>' + STUB + '</script>')
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode[^>]*><\/script>/, '<script>window.qrcode = function () { return { addData: function () {}, make: function () {}, createSvgTag: function () { return ""; } }; };</script>')
  .replace('</body>', '<pre id="out"></pre><script>' + DRIVER + '</script></body>');
if (page === src) throw new Error('could not inject the stubs into index.html');
const file = path.join(dir, 'new-record-draft.html');
fs.writeFileSync(file, page);
const url = 'file:///' + file.replace(/\\/g, '/');
const proc = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=60000', '--dump-dom', url],
                          { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const block = ((proc.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (!block) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (proc.stderr || '').slice(0, 3000));
  process.exitCode = 1;
} else {
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  console.log(result.replace('RESULT ', '') + ' (new record draft, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
