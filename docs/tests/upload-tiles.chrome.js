// Attaching photos, seeing them, and taking one back off — driven in a real browser.
//
// upload-tiles.test.js covers the rules (identity, adding, the cap, what a tile draws).
// None of that touches the DOM, and the complaint that started this work was entirely
// about the DOM: a filename and a green tick told somebody nothing about WHICH photo they
// had attached, and there was no way to remove one picked by mistake.
//
// So this file does the thing a person does. It builds a real photo question out of the
// real f/index.html, puts real File objects into the real <input type="file"> through a
// DataTransfer — the only way to hand a browser a FileList from script — clicks the ✕ on
// the middle tile, and then reads back what the control says it would UPLOAD. That last
// step is the one that matters: tiles disappearing from the screen while the submission
// still carries the removed photo would look fixed and be broken.
//
// Needs headless Chrome, so it skips rather than fails when Chrome is not installed:
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/upload-tiles.chrome.js
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

const src = fs.readFileSync('f/index.html', 'utf8');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in f/index.html');
// The page's own script, whole. Nothing is reimplemented here: buildField and every helper
// it leans on are the ones that ship.
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
// The page's own markup, so #form, #fields and #submit-btn are the real ones.
const body = (src.match(/<body>([\s\S]*?)<script/) || [])[1];
if (!body) throw new Error('could not lift the body markup out of f/index.html');

// Loaded with no ?t= slug, so the page short-circuits to "Form not found" and asks the
// database for nothing. Every function is still defined, which is all this test wants.
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
${body}
<pre id="out"></pre>
<script>
  var noop = { then: function (f) { try { f({ data: [], error: null }); } catch (e) {} return noop; }, catch: function () { return noop; } };
  var chain = { select: function () { return chain; }, eq: function () { return chain; }, limit: function () { return chain; },
                maybeSingle: function () { return noop; }, then: noop.then, catch: noop.catch };
  window.supabase = { createClient: function () {
    return { from: function () { return chain; }, rpc: function () { return noop; },
             storage: { from: function () { return { upload: function () { return noop; } }; } } };
  } };
<\/script>
<script>
${js}
<\/script>
<script>
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

// A real 1x1 PNG, so a preview is a picture a browser actually decodes rather than a blob
// of nothing that would silently fail to paint.
var PNG = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==');
function bytes(str) { var a = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i); return a; }
function photo(name, when) {
  return new File([bytes(PNG)], name, { type: 'image/jpeg', lastModified: when || 1 });
}
// Big enough to be over a photo question's 10 MB ceiling, and nothing else about it matters.
function huge(name) {
  return new File([new Uint8Array(11 * 1024 * 1024)], name, { type: 'image/jpeg', lastModified: 2 });
}
function doc(name) { return new File([bytes('%PDF-1.4')], name, { type: '', lastModified: 3 }); }

// The only way to hand a file input a FileList from script.
function pick(input, files) {
  var dt = new DataTransfer();
  files.forEach(function (f) { dt.items.add(f); });
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
}

var host = document.getElementById('fields');
function question(f) {
  controls.length = 0;
  host.innerHTML = '';
  host.appendChild(buildField(f));
  return {
    input: host.querySelector('input[type="file"]'),
    ctl: controls[controls.length - 1],
    tiles: function () { return [].slice.call(host.querySelectorAll('.file-tile')); },
    caps: function () { return [].slice.call(host.querySelectorAll('.ft-cap')).map(function (c) { return c.textContent; }); },
    names: function () { return controls[controls.length - 1].files().map(function (f) { return f.name; }); },
    btn: function () { return host.querySelector('.file-btn').textContent; },
    row: function () { return host.querySelector('.file-name').textContent; },
    hint: function () { return host.querySelector('.hint').textContent; },
    ticked: function () { return host.querySelector('.file-check').style.display === 'flex'; },
    del: function (i) { host.querySelectorAll('.ft-del')[i].click(); }
  };
}

// ---- three photos, seen ------------------------------------------------------
var q = question({ id: 'q1', label: 'Photo of Maestro', type: 'photo', required: true });
ok('a fresh question shows no tiles and offers to choose', q.tiles().length === 0 && q.btn() === 'Choose photos', q.btn());
pick(q.input, [photo('one.jpg', 11), photo('two.jpg', 12), photo('three.jpg', 13)]);
ok('three photos draw three tiles', q.tiles().length === 3, String(q.tiles().length));
ok('every tile shows a picture, not a filename',
   q.tiles().every(function (t) { var i = t.querySelector('img.ft-shot'); return i && i.src.indexOf('blob:') === 0; }));
ok('every tile is captioned with its own filename', q.caps().join(',') === 'one.jpg,two.jpg,three.jpg', q.caps().join(','));
ok('every tile carries its own remove', host.querySelectorAll('.ft-del').length === 3);
ok('the remove says what it removes',
   host.querySelector('.ft-del').getAttribute('aria-label') === 'Remove one.jpg',
   String(host.querySelector('.ft-del').getAttribute('aria-label')));
ok('the row counts them', /^3 photos · /.test(q.row()), q.row());
ok('the tick is shown', q.ticked());
ok('the button now offers to add rather than replace', q.btn() === 'Add photos', q.btn());
ok('three photos is a valid answer', q.ctl.validate() === true);

// ---- taking the middle one back off -----------------------------------------
// The heart of it. Removing by position rather than identity is what would take the wrong
// photo off here, and it would take the RIGHT one off if the test only ever removed the last.
q.del(1);
ok('removing the middle tile leaves two', q.tiles().length === 2, String(q.tiles().length));
ok('and they are the first and the third, in order', q.caps().join(',') === 'one.jpg,three.jpg', q.caps().join(','));
// What would actually be submitted.
ok('what would be uploaded is exactly those two', q.names().join(',') === 'one.jpg,three.jpg', q.names().join(','));
ok('the row agrees', /^2 photos · /.test(q.row()), q.row());

// ---- a removed photo can be chosen again ------------------------------------
// The input still holding a removed file is why this used to be impossible: picking it
// again fires no change event at all, so nothing happens and the person tries twice.
pick(q.input, [photo('two.jpg', 12)]);
ok('the photo that was removed can be attached again', q.names().join(',') === 'one.jpg,three.jpg,two.jpg', q.names().join(','));

// ---- a phone picker handing back what was already ticked ---------------------
pick(q.input, [photo('one.jpg', 11), photo('four.jpg', 14)]);
ok('a photo already attached is not attached twice',
   q.names().join(',') === 'one.jpg,three.jpg,two.jpg,four.jpg', q.names().join(','));
ok('and the form says so rather than looking like the pick did nothing', /already attached/.test(q.hint()), q.hint());

// ---- emptying it entirely ----------------------------------------------------
while (host.querySelectorAll('.ft-del').length) q.del(0);
ok('removing every photo leaves no tiles', q.tiles().length === 0);
ok('the row goes back to saying nothing is chosen', q.row() === 'No photos chosen', q.row());
ok('the button goes back to offering to choose', q.btn() === 'Choose photos', q.btn());
ok('the tick goes away', !q.ticked());
ok('and a required question is unanswered again', q.ctl.validate() === false);

// ---- the ten-file ceiling ----------------------------------------------------
var many = [];
for (var i = 0; i < 13; i++) many.push(photo('p' + i + '.jpg', 100 + i));
var q2 = question({ id: 'q2', label: 'Shelf photos', type: 'photo' });
pick(q2.input, many);
ok('a pick over the cap is trimmed to the cap', q2.tiles().length === MAX_FILES, String(q2.tiles().length));
ok('and it says how many did not fit', /3 of them were not added/.test(q2.hint()), q2.hint());
ok('a trimmed selection is still a legal answer, not a blocked form', q2.ctl.validate() === true);
ok('the ones kept are the first ten chosen', q2.names()[0] === 'p0.jpg' && q2.names()[9] === 'p9.jpg', q2.names().join(','));

// ---- one file over the size ceiling -----------------------------------------
var q3 = question({ id: 'q3', label: 'Photo', type: 'photo' });
pick(q3.input, [photo('small.jpg', 21), huge('enormous.jpg')]);
ok('the file that is too big is marked on its own tile',
   q3.tiles().filter(function (t) { return t.className.indexOf('invalid') !== -1; }).length === 1,
   q3.tiles().map(function (t) { return t.className; }).join('|'));
ok('the good photo is not marked', q3.tiles()[0].className.indexOf('invalid') === -1);
ok('the hint names the file that is too big', /enormous\\.jpg/.test(q3.hint()), q3.hint());
ok('and the question refuses to submit while it is there', q3.ctl.validate() === false);
// The fix is now something a person can actually carry out, which it was not before: the
// only way out of an over-size pick used to be choosing everything again from scratch.
q3.del(1);
ok('removing the oversize file clears the refusal', q3.ctl.validate() === true);
ok('and leaves the photo that was fine', q3.names().join(',') === 'small.jpg', q3.names().join(','));

// ---- a question that takes any file at all ----------------------------------
var q4 = question({ id: 'q4', label: 'CV', type: 'file' });
pick(q4.input, [doc('contract.pdf')]);
ok('a document gets a badge rather than a broken picture',
   host.querySelectorAll('.ft-glyph').length === 1 && host.querySelector('.ft-glyph').textContent === 'PDF',
   String(host.querySelector('.ft-glyph') && host.querySelector('.ft-glyph').textContent));
ok('a file question offers to add files', q4.btn() === 'Add files', q4.btn());
ok('one file still reads as its name and size', /^contract\\.pdf · /.test(q4.row()), q4.row());

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
<\/script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-upload-tiles-')), 'tiles.html');
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
  console.log(result.replace('RESULT ', '') + ' (upload tiles, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
