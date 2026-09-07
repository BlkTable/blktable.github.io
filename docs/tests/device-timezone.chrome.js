// The timezone header, in a real browser, because the unit test cannot see the thing that
// would actually hurt: `createClient` now takes a THIRD argument, and it is the first line of
// the page's only script. Get that shape wrong and every public form is a blank screen — no
// error anybody sees, no submission, on all 226 of them. A test that only checks the two
// helper functions return the right strings passes happily while the page is dead.
//
// So this file loads the whole real `f/index.html`, lets it boot, and asks three things:
// did the page finish, was the header attached to the client, and is the value the browser's
// own zone rather than something invented.
//
// What this file deliberately does NOT do is vary the zone. Chrome on Windows ignores the
// `TZ` environment variable — measured, it reports the OS zone whatever TZ says — so
// "a device in Beirut reports Beirut" is only testable against a stubbed Intl, and it lives
// in device-timezone.test.js. Pretending to cover it here would be the more dangerous kind
// of green.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/device-timezone.chrome.js
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

const PAGE = fs.readFileSync('f/index.html', 'utf8');
const CDN = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^>]*><\/script>/;
if (!CDN.test(PAGE)) throw new Error('could not find the supabase CDN script tag to stub');

// Stands in for the CDN bundle. Records what createClient was handed and returns just enough
// of a client that the page can boot; with no ?t= slug the page short-circuits to
// "Form not found" and makes no reads, so nothing else is needed.
const STUB = `<script>
  window.__calls = [];
  window.__pageError = null;
  window.onerror = function (m, u, l) { window.__pageError = m + ' (line ' + l + ')'; };
  var dead = function () { return { error: { message: 'stub' }, data: null }; };
  window.supabase = {
    createClient: function (url, key, opts) {
      window.__calls.push({ url: url, hasKey: !!key, opts: opts || null });
      var q = {};
      ['select','eq','order','single','limit','is','in'].forEach(function (m) {
        q[m] = function () { return q; };
      });
      q.then = function (res) { return Promise.resolve(dead()).then(res); };
      q.catch = function () { return q; };
      return {
        from: function () { return q; },
        rpc: function () { return q; },
        storage: { from: function () { return { upload: function () { return Promise.resolve(dead()); } }; } }
      };
    }
  };
</script>`;

// Runs after the page's own script, so everything it declares is in scope.
const CHECKS = `<pre id="out">pending</pre>
<script>
  var out = [], pass = 0, fail = 0;
  function t(name, fn) {
    try {
      var why = fn();
      if (why) { fail++; out.push('FAIL ' + name + ' -> ' + why); } else { pass++; }
    } catch (e) { fail++; out.push('FAIL ' + name + ' -> threw ' + e.message); }
  }

  t('the page boots with the new third argument to createClient', function () {
    if (window.__pageError) return 'the page threw: ' + window.__pageError;
    if (window.__calls.length !== 1) return 'createClient called ' + window.__calls.length + ' times, expected 1';
  });
  t('the page reached a terminal state rather than hanging', function () {
    // No ?t= slug, so "Form not found" is the correct end. If the page died on line one
    // this is still display:none and nothing above would have caught it.
    var nf = document.getElementById('notfound');
    if (!nf) return 'no #notfound element';
    if (!nf.offsetParent && nf.style.display === 'none') return 'the page never finished booting';
  });
  t('the client was given the header', function () {
    var o = window.__calls[0] && window.__calls[0].opts;
    if (!o) return 'createClient got no third argument at all';
    if (!o.global || !o.global.headers) return 'no global.headers in ' + JSON.stringify(o);
    if (!('x-blk-tz' in o.global.headers)) return 'no x-blk-tz in ' + JSON.stringify(o.global.headers);
  });
  t('the header carries this browser\\'s own zone', function () {
    var sent = window.__calls[0].opts.global.headers['x-blk-tz'];
    var real = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (sent !== real) return 'sent ' + JSON.stringify(sent) + ' but the browser says ' + JSON.stringify(real);
  });
  t('the zone is READ from the browser rather than baked into the page', function () {
    // The check above cannot see a hardcoded zone on a machine that happens to sit in it —
    // measured: hardcoding "Asia/Amman" passed every other test in this file, because the
    // machine these run on is in Amman. So swap the browser's Intl out from under the page
    // and require the answer to follow it. This is the assertion that holds anywhere.
    var realIntl = window.Intl;
    try {
      window.Intl = { DateTimeFormat: function () {
        return { resolvedOptions: function () { return { timeZone: 'Antarctica/Troll' }; } };
      } };
      var h = tzHeaders();
      if (h['x-blk-tz'] !== 'Antarctica/Troll') {
        return 'the page ignored the browser and answered ' + JSON.stringify(h);
      }
    } finally { window.Intl = realIntl; }
  });
  t('a real browser produces a real zone through the page\\'s own function', function () {
    // The unit test feeds deviceZone a fake Intl. This is the one place it meets the real one.
    var z = deviceZone();
    if (typeof z !== 'string' || !z) return 'deviceZone() returned ' + JSON.stringify(z);
    if (!/^[A-Za-z0-9_+\\/-]{1,64}$/.test(z)) return 'deviceZone() returned something unusable: ' + z;
  });
  t('exactly one header, so nothing else rode along', function () {
    var ks = Object.keys(window.__calls[0].opts.global.headers);
    if (ks.length !== 1) return 'headers were ' + JSON.stringify(ks);
  });

  out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
  document.getElementById('out').textContent = out.join('\\n');
</script>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-tz-'));
const file = path.join(dir, 'index.html');
fs.writeFileSync(file, PAGE.replace(CDN, STUB) + CHECKS);

const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files',
  '--virtual-time-budget=6000', '--dump-dom', 'file:///' + file.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const block = ((run.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (block === undefined) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 2000));
  process.exitCode = 1;
} else {
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing (page never finished)';
  console.log(result.replace('RESULT ', '') + ' (device-timezone, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
