// Pressing Submit on a form full of photos, in a real browser.
//
// upload-queue.test.js covers the queue itself. This covers what happens when a person
// actually presses Submit: that the real page walks the photos up in lanes rather than firing
// them all at once, that a refusal from the file server is waited out and the submission still
// lands, that the button says how far along it is, and that a refusal which never clears leaves
// a message telling them to wait rather than "try again".
//
// None of that is reachable from node: it is the page booting, the file inputs holding real
// File objects, and a click. The whole of f/index.html is loaded unmodified apart from two
// stubs (the supabase client and window.fetch), so the code under test is the deployed code.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/upload-queue.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
//
// Skipped rather than failed when no Chrome is found, the way card-panel.chrome.js is.
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

const src = fs.readFileSync('f/index.html', 'utf8');
if (!/cdn\.jsdelivr\.net/.test(src)) throw new Error('f/index.html no longer loads supabase from a CDN; update this stub');

// The client and the network, and nothing else. Everything the test asserts on is the page's.
const STUB = `
window.__log = { uploads: [], refusals: 0, rpc: null, inFlight: 0, peak: 0 };
// How many upload attempts are refused before the server relents. The default is a bad minute
// on a shop connection: enough refusals to prove the wait works, few enough to clear.
var REFUSE = Number(new URLSearchParams(location.search).get('refuse') || 0);
window.supabase = { createClient: function () {
  function chain(rows) {
    var o = {};
    ['select', 'eq', 'order', 'limit'].forEach(function (m) { o[m] = function () { return o; }; });
    o.single = function () { return { then: function (f) { return Promise.resolve(f({ data: rows[0], error: null })); } }; };
    o.then = function (f) { return Promise.resolve(f({ data: rows, error: null })); };
    return o;
  }
  return {
    from: function (t) {
      if (t === 'app_tables') return chain([{ id: 'tbl', name: 'Shop Spot Check (QC)', name_ar: null, slug: 'qc', is_active: true, kind: 'form', config_public: {} }]);
      if (t === 'app_fields') return chain(FIELDS);
      return chain([]);
    },
    rpc: function (name, payload) {
      window.__log.rpc = { name: name, payload: payload };
      return Promise.resolve({ data: {}, error: null });
    }
  };
} };
window.fetch = function (url, opts) {
  if (String(url).indexOf('/r2/upload') === -1) return Promise.reject(new Error('unexpected fetch ' + url));
  var name = ((opts.body.get('file') || {}).name) || '?';
  window.__log.uploads.push(name);
  window.__log.inFlight++;
  window.__log.peak = Math.max(window.__log.peak, window.__log.inFlight);
  return new Promise(function (done) { setTimeout(done, 30); }).then(function () {
    window.__log.inFlight--;
    if (window.__log.refusals < REFUSE) {
      window.__log.refusals++;
      // exactly the shape Kong sends, down to the header the page reads
      return { ok: false, status: 429,
               headers: { get: function (h) { return h === 'RateLimit-Reset' ? '1' : null; } },
               json: function () { return Promise.resolve({ error: 'API rate limit exceeded' }); } };
    }
    return { ok: true, status: 200, headers: { get: function () { return null; } },
             json: function () { return Promise.resolve({ path: 'photos/' + name }); } };
  });
};
var FIELDS = [];
for (var i = 0; i < 8; i++) FIELDS.push({ id: 'p' + i, table_id: 'tbl', position: i, label: 'Photo ' + i, label_ar: null, type: 'photo', required: false, options: null, internal: false, after_field: null, show_if: null });
FIELDS.push({ id: 'note', table_id: 'tbl', position: 9, label: 'TDS Reading', label_ar: null, type: 'short_text', required: false, options: null, internal: false, after_field: null, show_if: null });
`;

// Presses Submit on a fully filled form and reports what the person saw.
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
// A real File in a real input, which is the only way submitForm sees anything to upload.
function fill() {
  var ins = [].slice.call(document.querySelectorAll('#fields input[type=file]'));
  ins.forEach(function (inp, i) {
    var dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(2048)], 'photo' + i + '.jpg', { type: 'image/jpeg' }));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return ins.length;
}
var btn = document.getElementById('submit-btn'), msg = document.getElementById('form-msg');
var seen = [];
new MutationObserver(function () { seen.push(btn.textContent); }).observe(btn, { childList: true, characterData: true, subtree: true });

until(function () { return document.querySelectorAll('#fields input[type=file]').length > 0; }, 4000)
  .then(function (booted) {
    ok('the form drew its questions', booted);
    ok('eight photo questions and a reading', fill() === 8, String(fill()));
    btn.click();
    return until(function () {
      return document.getElementById('success').style.display === 'block' || msg.textContent !== '';
    }, 30000);
  })
  .then(function () {
    var log = window.__log;
    var refuse = Number(new URLSearchParams(location.search).get('refuse') || 0);
    if (refuse < 40) {
      ok('the submission landed', document.getElementById('success').style.display === 'block', msg.textContent);
      ok('and it carried all eight photos',
         log.rpc && Object.keys(log.rpc.payload.p_data).filter(function (k) { return /^p\\d/.test(k); }).length === 8,
         JSON.stringify(log.rpc && log.rpc.payload.p_data));
      ok('with the path the file server gave, not the file name',
         log.rpc && log.rpc.payload.p_data.p0 === 'photos/photo0.jpg', log.rpc && log.rpc.payload.p_data.p0);
    } else {
      ok('a refusal that never clears is not reported as success',
         document.getElementById('success').style.display !== 'block');
      ok('and the person is told to wait, not to try again',
         /Wait a minute/.test(msg.textContent) && /not sent twice/.test(msg.textContent), msg.textContent);
    }
    // The bug: 8 questions meant 8 simultaneous uploads, and 52 meant 52.
    ok('never more than three uploads are in flight at once', log.peak <= 3, 'peak ' + log.peak);
    var times = {};
    log.uploads.forEach(function (nm) { times[nm] = (times[nm] || 0) + 1; });
    var most = Object.keys(times).reduce(function (a, k) { return Math.max(a, times[k]); }, 0);
    if (refuse < 40) {
      ok('every photo was sent', Object.keys(times).length === 8, Object.keys(times).join(','));
      // The bug behind the bug: a refused photo re-sent from scratch is what kept the bucket
      // full. A refusal costs one more attempt at that photo, never a fresh round of all eight.
      ok('nothing was uploaded beyond the refusals it took',
         log.uploads.length === 8 + log.refusals, log.uploads.length + ' uploads for ' + log.refusals + ' refusals');
    } else {
      ok('a photo is attempted at most UPLOAD_TRIES times before giving up', most <= 4, 'most ' + most);
    }
    ok('the button counted the photos as they went up',
       seen.some(function (s) { return /Uploading photo \\d of 8/.test(s); }), seen.join(' | '));
    ok('and it went back to Submitting before the record was written',
       refuse >= 40 || seen[seen.length - 2] === 'Submitting…' || seen[seen.length - 1] === 'Submitting…', seen.slice(-3).join(' | '));
    finish();
  })
  .catch(function (e) { ok('the driver ran to the end', false, String(e && e.message)); finish(); });
`;

const page = src.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '<script>' + STUB + '</script>')
                .replace('</body>', '<pre id="out"></pre><script>' + DRIVER + '</script></body>');
if (page === src) throw new Error('could not inject the stubs into f/index.html');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-upload-queue-'));
const file = path.join(dir, 'form.html');
fs.writeFileSync(file, page);

// Two runs of the same page: a bad minute that clears, and one that never does.
const cases = [
  ['a bad minute that clears', 'refuse=6'],
  ['a bucket that never clears', 'refuse=99']
];
let failed = 0, total = 0;
for (const [label, query] of cases) {
  const url = 'file:///' + file.replace(/\\/g, '/') + '?t=qc&' + query;
  const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=90000', '--dump-dom', url],
                           { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = run.stdout || '';
  const block = (dom.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
  if (!block) {
    console.log('FAILED (' + label + '): the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 1500));
    failed++; continue;
  }
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(label + ': ' + l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  total += Number((result.match(/(\d+) passed/) || [0, 0])[1]);
  if (!/ 0 failed/.test(result)) failed++;
  console.log('  ' + label + ': ' + result.replace('RESULT ', ''));
}
console.log(total + ' upload-queue browser checks passed (in ' + path.basename(chrome) + ')');
if (failed) process.exitCode = 1;
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
