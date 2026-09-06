// A public form must be filled in as the public, by everybody — including whoever is signed
// into BLKTable in that same browser.
//
// The three public pages live on the same origin as the app (blktable.blk.jo), so they share
// its localStorage, and supabase-js reads the signed-in session out of it by default. A staff
// member who opened /f/?t=<form> therefore asked the API as themselves, not as `anon` — and
// the public-form RLS policy is granted to `anon` only:
//
//   anon_read_public_forms   {anon}            kind = 'form' AND is_active
//   auth read tables         {authenticated}   can_access(id)
//
// So the row came back for a logged-out visitor and did not come back for a staff member
// without access to that table. Zero rows through .single() is a 406, the page treats any
// error as "no such form", and the person reads: "Form not found. This form link is invalid
// or no longer active." On 2026-09-06 that was every one of the 43 non-admin accounts on the
// "No one asked" form, while the same link opened fine for the public — the same request, the
// same second, 200 for one browser and 406 for the next.
//
// This test drives the real page with the real supabase-js and a staff session already in the
// browser, and asserts the request goes out with the anon key. Nothing else can be asserted
// from the source alone: which token is sent is decided inside the library.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/public-form-anon.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
//
// Skipped rather than failed when no Chrome is found, or when the CDN cannot be reached —
// this one needs the genuine library, so a stub would defeat the point of the file.
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

// A staff session as gotrue keeps one: a decodable JWT that expires in 2035, so nothing tries
// to refresh it, and `expires_at` alongside it because that is the field getSession() reads.
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const STAFF_JWT = b64({ alg: 'HS256', typ: 'JWT' }) + '.' +
  b64({ sub: '20b6a375-2b59-4e7a-ad33-bf028f6b502e', role: 'authenticated', aud: 'authenticated', exp: 2069000000 }) +
  '.not-a-real-signature';
const STAFF_SESSION = JSON.stringify({
  access_token: STAFF_JWT, token_type: 'bearer', expires_in: 999999999, expires_at: 2069000000,
  refresh_token: 'staff-refresh-token',
  user: { id: '20b6a375-2b59-4e7a-ad33-bf028f6b502e', aud: 'authenticated', role: 'authenticated' }
});

// Injected ahead of the library, because postgrest-js takes its copy of `fetch` when it is
// evaluated and gotrue reads storage when the client is made. Both have to be in place first.
const PRE = `
window.__seen = [];
window.__sessionRead = 0;
window.__staffToken = ${JSON.stringify(STAFF_JWT)};
// This browser is signed in as a member of staff. Any key ending -auth-token answers with the
// session, so the test does not have to guess how the library names it for this host.
var __map = {};
try {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    get length() { return Object.keys(__map).length; },
    key: function (i) { return Object.keys(__map)[i]; },
    getItem: function (k) {
      if (/-auth-token$/.test(k)) { window.__sessionRead++; return ${JSON.stringify(STAFF_SESSION)}; }
      return Object.prototype.hasOwnProperty.call(__map, k) ? __map[k] : null;
    },
    setItem: function (k, v) { __map[k] = String(v); },
    removeItem: function (k) { delete __map[k]; }
  } });
} catch (e) { window.__storeFailed = String(e && e.message); }

var TABLE = { id: 'tbl', name: 'No one asked', name_ar: null, slug: 'no-one-asked-vccj',
              is_active: true, kind: 'form', config_public: {} };
var FIELDS = [{ id: 'say', table_id: 'tbl', position: 0, label: 'Say it', label_ar: null,
                type: 'long_text', required: false, options: null, internal: false,
                after_field: null, show_if: null }];

// Every call the page makes is answered here, and the token it was sent with is kept. The
// server is not what is under test; which identity the page speaks as is.
window.fetch = function (input, init) {
  var url = String(input && input.url ? input.url : input);
  var h = (init && init.headers) || {};
  var get = function (n) {
    if (typeof h.get === 'function') return h.get(n);
    var k = Object.keys(h).filter(function (x) { return x.toLowerCase() === n.toLowerCase(); })[0];
    return k ? h[k] : null;
  };
  window.__seen.push({ url: url, auth: get('Authorization'), apikey: get('apikey'), accept: get('Accept') });
  // Row-level security, as the live database applies it: the public-form policy is granted to the
  // anon role and to nobody else, so a request carrying a staff token matches no policy on
  // app_tables and comes back with no rows at all. Through .single() PostgREST calls that a
  // 406, which is exactly what the live gateway logged on 2026-09-06 for staff browsers while
  // logged-out ones on the same form in the same minute got 200.
  var visible = get('Authorization') === 'Bearer ' + window.SUPABASE_KEY;
  if (/\\/rest\\/v1\\/app_(tables|fields)/.test(url) && !visible) {
    var singular = /pgrst\\.object/.test(String(get('Accept') || ''));
    return Promise.resolve(new Response(JSON.stringify({
      code: 'PGRST116', details: 'The result contains 0 rows', hint: null,
      message: 'JSON object requested, multiple (or no) rows returned'
    }), { status: singular ? 406 : 200, headers: { 'Content-Type': 'application/json' } }));
  }
  var body = {};
  if (/\\/rest\\/v1\\/app_tables/.test(url)) body = /pgrst\\.object/.test(String(get('Accept') || '')) ? TABLE : [TABLE];
  else if (/\\/rest\\/v1\\/app_fields/.test(url)) body = FIELDS;
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }));
};
`;

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
if (!window.supabase || !window.supabase.createClient) {
  out.push('SKIP the library did not load — this file needs the real supabase-js from the CDN');
  finish();
} else {
until(function () { return window.__seen.length > 0; }, 8000).then(function (asked) {
  ok('the page asked the API for the form', asked, JSON.stringify(window.__seen));
  var rest = window.__seen.filter(function (r) { return /\\/rest\\/v1\\//.test(r.url); });
  ok('a REST call went out', rest.length > 0, JSON.stringify(window.__seen.map(function (r) { return r.url; })));
  var anon = 'Bearer ' + window.SUPABASE_KEY;
  var wrong = rest.filter(function (r) { return r.auth !== anon; });
  // The whole file, in one line.
  ok('every REST call is made as the public, not as whoever is signed in',
     rest.length > 0 && wrong.length === 0,
     wrong.length ? (wrong[0].auth === 'Bearer ' + window.__staffToken
       ? 'sent the signed-in staff token instead of the anon key' : String(wrong[0].auth)) : '');
  ok('the anon key is still sent as the apikey', rest.every(function (r) { return r.apikey === window.SUPABASE_KEY; }),
     JSON.stringify(rest.map(function (r) { return r.apikey; })));
  return until(function () { return document.getElementById('fld-say') ||
                                    document.getElementById('notfound').style.display === 'block'; }, 8000);
}).then(function () {
  // The symptom itself: what the person actually sees.
  ok('the form draws its questions rather than saying the link is invalid',
     !!document.getElementById('fld-say') && document.getElementById('notfound').style.display !== 'block',
     document.getElementById('notfound').style.display === 'block' ? 'the page said "Form not found"' : 'no questions drawn');
  finish();
}).catch(function (e) { ok('the driver ran to the end', false, String(e && e.message)); finish(); });
}
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-anon-'));
let failed = 0, total = 0, skipped = 0;

function run(label, srcFile, query) {
  const src = fs.readFileSync(srcFile, 'utf8');
  const cdn = /<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/.exec(src);
  if (!cdn) throw new Error(srcFile + ' no longer loads supabase from the CDN; update this test');
  const page = src.replace(cdn[0], '<script>' + PRE + '</script>\n' + cdn[0])
                  .replace('</body>', '<pre id="out"></pre><script>' + DRIVER + '</script></body>');
  const file = path.join(dir, label.replace(/\W+/g, '-') + '.html');
  fs.writeFileSync(file, page);
  const url = 'file:///' + file.replace(/\\/g, '/') + query;
  const proc = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=60000', '--dump-dom', url],
                            { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const block = ((proc.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
  if (!block) {
    console.log('FAILED (' + label + '): the page produced no results. Chrome said:\n' + (proc.stderr || '').slice(0, 2000));
    failed++; return;
  }
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").split('\n');
  if (lines.some(l => l.startsWith('SKIP'))) {
    console.log('  ' + label + ': SKIPPED (no CDN reachable)'); skipped++; return;
  }
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(label + ': ' + l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  total += Number((result.match(/(\d+) passed/) || [0, 0])[1]);
  if (!/ 0 failed/.test(result)) failed++;
  console.log('  ' + label + ': ' + result.replace('RESULT ', ''));
}

run('a custom form, opened by a signed-in staff member', 'f/index.html', '?t=no-one-asked-vccj');

if (skipped) console.log('SKIPPED: the real supabase-js could not be fetched from the CDN.');
else console.log(total + ' public-form identity checks passed (in ' + path.basename(chrome) + ')');
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
if (failed) process.exitCode = 1;
