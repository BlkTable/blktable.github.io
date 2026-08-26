// The photos come back — on the real pages, in a real browser, across a real reload.
//
// form-draft-files.test.js covers the storage layer against an IndexedDB written for the
// tests. This covers the thing somebody actually does: attach a photo to a form, lose the
// page, open it again, and find the photo still attached. Nothing here is reimplemented — it
// is f/index.html and apply/index.html, served over http and reloaded by the browser itself,
// so the second load reads what the first one wrote.
//
// It exists because everything else in this pair can pass while the feature does nothing. The
// rows can be written, the functions can be right, the wiring can be present in the source,
// and the tile can still not come back: a control built before draftK is known, a restore that
// runs before the questions exist, a File the browser will not hand back through a structured
// clone. This is the only test here that would notice.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/form-draft-files.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
//
// The pages are served rather than opened from disk because a file:// page has no origin and
// Chrome refuses it IndexedDB — which is the whole subject. supabase-js is stubbed in place of
// the CDN's, so there is no network and no live form; every other line is the deployed one.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), http = require('http');

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log('SKIPPED: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run this file.');
  process.exit(0);
}

// ---- the database, stubbed in place of the CDN ---------------------------
// Every call either page makes on the way up answers from here: for /f one table with a text
// question and a photo question, and for /apply nothing at all, which is what its two boot
// calls are already written to survive.
const STUB = `<script>
(function () {
  var TABLE = { id: 't1', name: 'Shop check', name_ar: '', slug: 'demo', is_active: true, kind: 'form', config_public: {} };
  var FIELDS = [
    { id: 'q-note', table_id: 't1', label: 'Anything to add', label_ar: '', type: 'long_text', position: 1, required: false, options: null, internal: false },
    { id: 'q-photo', table_id: 't1', label: 'Photo of the counter', label_ar: '', type: 'photo', position: 2, required: true, options: null, internal: false }
  ];
  function chain(data) {
    var res = { data: data, error: null }, c = {};
    ['select', 'eq', 'order', 'single', 'limit', 'in', 'is'].forEach(function (m) { c[m] = function () { return c; }; });
    c.then = function (f, r) { return Promise.resolve(res).then(f, r); };
    c.catch = function (f) { return Promise.resolve(res).catch(f); };
    return c;
  }
  window.supabase = { createClient: function () {
    return {
      from: function (t) { return chain(t === 'app_tables' ? TABLE : t === 'app_fields' ? FIELDS : []); },
      rpc: function () { return Promise.resolve({ data: null, error: null }); },
      storage: { from: function () { return { upload: function () { return Promise.resolve({ data: { path: 'x' }, error: null }); } }; } }
    };
  } };
})();
</script>`;

// ---- the driver -----------------------------------------------------------
// One script for both pages; which page it is on decides what it does. Every stage reports and
// then navigates, so the reload is the browser's own. Killing the browser between two separate
// runs instead would lose whatever it had not yet flushed, and the answers — which are in
// localStorage, not in this feature at all — would go missing for an unrelated reason.
const DRIVER = `<script>
(function () {
  var stage = new URLSearchParams(location.search).get('stage');
  var out = [];
  function say(name, cond, extra) { out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond || extra == null ? '' : ' -> ' + extra)); }
  function send(next) {
    var posted = fetch('/result', { method: 'POST', body: JSON.stringify({ stage: stage, lines: out }) });
    if (next) posted.then(function () { location.href = next; }, function () { location.href = next; });
  }
  function until(test, ms, then) {
    var t0 = Date.now();
    (function tick() {
      if (test()) return then(true);
      if (Date.now() - t0 > ms) return then(false);
      setTimeout(tick, 50);
    })();
  }
  function jpg(name, bytes) { return new File([bytes], name, { type: 'image/jpeg' }); }
  function attach(input, files) {
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function noteEn() { var n = document.getElementById('draft-note-en'); return n ? n.textContent : ''; }
  function noteShown() { var n = document.getElementById('draft-note'); return !!n && n.style.display === 'block'; }

  // ---- /f: a custom form, more than one photo on one question ----
  function fPick() {
    var ta = document.querySelector('#fields textarea');
    ta.value = 'counter was clean';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    attach(document.querySelector('#fields input[type="file"]'),
           [jpg('front.jpg', 'hello world'), jpg('back.jpg', 'second one!')]);
    say('two photos are on the form before the reload', document.querySelectorAll('#fields .file-tile').length === 2);
    setTimeout(function () {
      readDraftFiles(draftK, Date.now()).then(function (by) {
        var n = (by['q-photo'] || []).length;
        say('both are in this browser', n === 2, n + ' rows');
        send('/f/?t=demo&stage=fcheck');
      });
    }, 800);
  }
  function fCheck() {
    setTimeout(function () {
      var t = document.querySelectorAll('#fields .file-tile');
      say('/f: the photos came back on their own', t.length === 2, t.length + ' tiles');
      var caps = [].slice.call(t).map(function (x) { return (x.querySelector('.ft-cap') || {}).textContent; });
      say('/f: under the names they were attached with, in the order chosen',
          caps.join(',') === 'front.jpg,back.jpg', caps.join(','));
      var img = t[0] && t[0].querySelector('img.ft-shot');
      say('/f: with a picture in the tile, not an empty frame', !!img && /^blob:/.test(img.src), img ? img.src.slice(0, 12) : 'no img');
      var nm = document.querySelector('#fields .file-name');
      say('/f: the row says two photos are attached', /2 photo/.test(nm.textContent), nm.textContent);
      say('/f: the typed answer came back too', (document.querySelector('#fields textarea') || {}).value === 'counter was clean');
      say('/f: the note is shown', noteShown(), noteEn());
      say('/f: and it does not ask for the photos again', noteShown() && !/choosing again/.test(noteEn()), noteEn());
      say('/f: it says the files were kept', /and the files/.test(noteEn()), noteEn());
      // Submit uploads what the control is holding, so tiles alone prove nothing: they have to
      // be real files, with their bytes, or the submission carries two empty photos.
      var held = null, ctl = null;
      try { ctl = controls.filter(function (c) { return c.isPhoto; })[0]; held = ctl.files(); } catch (e) {}
      say('/f: the control is holding two real files', !!held && held.length === 2 && held[0].size === 11,
          held ? held.length + ' files, first ' + held[0].size + ' bytes' : 'none');
      say('/f: so the required question passes and Submit is not refused', !!ctl && ctl.validate());
      clearDraftFiles(draftK).then(function () { return readDraftFiles(draftK, Date.now()); }).then(function (by) {
        say('/f: "Start over" leaves no photos behind', Object.keys(by).length === 0, JSON.stringify(Object.keys(by)));
        send('/apply/?stage=apick');
      });
    }, 1200);
  }

  // ---- /apply: the job application, one photo through one input ----
  function aPick() {
    var nm = document.getElementById('full_name');
    nm.value = 'Ahmad';
    nm.dispatchEvent(new Event('input', { bubbles: true }));
    attach(document.getElementById('photo'), [jpg('me.jpg', 'a face here')]);
    say('/apply: the photo is on the form before the reload',
        document.getElementById('file-name').textContent.indexOf('me.jpg') === 0,
        document.getElementById('file-name').textContent);
    setTimeout(function () { send('/apply/?stage=acheck'); }, 800);
  }
  function aCheck() {
    setTimeout(function () {
      var nm = document.getElementById('file-name');
      say('/apply: the photo came back on its own', nm.textContent.indexOf('me.jpg') === 0, nm.textContent);
      say('/apply: the row is ticked', document.getElementById('file-check').style.display === 'flex');
      say('/apply: and offers to change it rather than choose one',
          document.getElementById('file-btn').textContent === 'Change photo', document.getElementById('file-btn').textContent);
      var held = null;
      try { held = chosenPhoto(); } catch (e) {}
      say('/apply: the form is holding the real file, which is what Submit uploads',
          !!held && held.name === 'me.jpg' && held.size === 11, held ? held.name + ' ' + held.size : 'none');
      say('/apply: the typed answer came back too', document.getElementById('full_name').value === 'Ahmad');
      say('/apply: the note does not ask for the photo again', noteShown() && !/choosing again/.test(noteEn()), noteEn());
      // The input itself is still empty — no page may put a file in one — which is exactly why
      // the validation and the upload have to ask chosenPhoto() rather than the element.
      say('/apply: and the input is still empty, as it has to be',
          document.getElementById('photo').files.length === 0);
      send(null);
    }, 1200);
  }

  var ON_APPLY = location.pathname.indexOf('/apply/') === 0;
  var ready = ON_APPLY ? function () { return document.getElementById('photo'); }
                       : function () { return document.querySelector('#fields input[type="file"]'); };
  until(ready, 8000, function (up) {
    if (!up) { say(location.pathname + ' rendered', false, 'nothing to attach a photo to after 8s'); return send(null); }
    if (stage === 'fpick') return fPick();
    if (stage === 'fcheck') return fCheck();
    if (stage === 'apick') return aPick();
    return aCheck();
  });
})();
</script>`;

function build(rel) {
  const src = fs.readFileSync(rel, 'utf8');
  if (!/cdn\.jsdelivr\.net/.test(src)) throw new Error(rel + ' no longer loads supabase-js from a CDN — the stub has nothing to replace');
  return src.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, STUB)
            .replace('</body>', DRIVER + '\n</body>');
}
const PAGES = { '/f/': build('f/index.html'), '/apply/': build('apply/index.html') };

// ---- serve them, and let one browser walk through -------------------------
const results = new Map();
let onResult = () => {};
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (req.method === 'POST' && p === '/result') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(204).end();
      let got;
      try { got = JSON.parse(body); } catch (e) { got = { stage: '?', lines: ['FAIL unreadable result'] }; }
      results.set(got.stage, got.lines);
      onResult();
    });
    return;
  }
  const page = PAGES[p] || PAGES[p.replace(/index\.html$/, '')];
  if (page) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page); return; }
  res.writeHead(404).end();
});

const STAGES = ['fpick', 'fcheck', 'apick', 'acheck'];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-draft-files-'));

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const kid = cp.spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, 'http://127.0.0.1:' + port + '/f/?t=demo&stage=fpick'], { stdio: 'ignore' });
  let ended = false;
  const timer = setTimeout(function () {
    finish('the browser stopped reporting after [' + [...results.keys()].join(', ') + ']');
  }, 60000);
  function finish(why) {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    try { kid.kill(); } catch (e) {}
    let pass = 0, fail = 0;
    if (why) { console.log('FAILED: ' + why); fail++; }
    STAGES.forEach(s => {
      (results.get(s) || ['FAIL ' + s + ' produced no results']).forEach(l => {
        if (l.startsWith('ok')) pass++; else { fail++; console.log(l); }
      });
    });
    console.log(pass + ' passed, ' + fail + ' failed (the real pages, in ' + path.basename(chrome) + ')');
    if (fail) process.exitCode = 1;
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  onResult = () => { if (results.has('acheck')) finish(null); };
});
