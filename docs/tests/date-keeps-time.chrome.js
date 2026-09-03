// The round trip, in a real browser, with the real edValues.
//
// This is the file that matters, because the whole failure was invisible to unit tests: every
// function returned something sensible and the panel looked correct. Only the browser knows
// that <input type="date"> silently reports value === "" when it is handed
// 2024-10-05T11:37:00.000Z, and only edValues + saveCustom together turn that into a deleted
// answer. So the real dateFieldHtml builds the row, the real edValues reads it back, and the
// assertions are about what a save WOULD write.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/date-keeps-time.chrome.js
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

const START = '  // ---- The date box, and the calendar behind it ----';
const END = '  // ---- Shared inline-edit builders';
const a = js.indexOf(START), b = js.indexOf(END);
if (a < 0 || b < 0) throw new Error('could not find the date/time blocks in index.html');
const block = js.slice(a, b);
if (block.indexOf('function keptStampOf') < 0) throw new Error('keptStampOf is not in the copied region');

function grab(name) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
}
// the real readers, lifted rather than re-typed
const esc = grab('esc'), edDate = grab('edDate'), edValues = grab('edValues');

// real values out of the live database
const FIELDS = [
  { id: 'qc', type: 'date', label: 'Date / Time', stored: '2024-10-05T11:37:00.000Z' },
  { id: 'ms', type: 'date', label: 'Date & Time', stored: '2020-03-28T15:47:00.000Z' },
  { id: 'late', type: 'date', label: 'a late-evening visit', stored: '2024-10-05T23:40:00.000Z' },
  { id: 'early', type: 'date', label: 'a small-hours visit', stored: '2024-10-05T00:20:00.000Z' },
  { id: 'plain', type: 'date', label: 'a plain date', stored: '2026-08-26' },
  { id: 'empty', type: 'date', label: 'never answered', stored: '' }
];

const page = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="host"></div><pre id="out"></pre>
<script>
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra === undefined ? '' : ' -> ' + extra)); }
}
${esc}
${block}
${edDate}
// edValues' other branches are not what is on test here; these keep it honest and unchanged.
function isFileField(f) { return false; }
function isScorerField(f) { return false; }
function edChecksValue(el) { return []; }
var edPhoneReg = {};
${edValues}

var FIELDS = ${JSON.stringify(FIELDS)};
var host = document.getElementById('host');
FIELDS.forEach(function (f) {
  var d = document.createElement('div');
  d.innerHTML = edDate('ed-' + f.id, f.stored);   // exactly what the record panel builds
  host.appendChild(d);
});

// 1. the browser accepts what it was given
FIELDS.forEach(function (f) {
  var inp = document.getElementById('ed-' + f.id);
  var want = f.stored ? f.stored.slice(0, 10) : '';
  ok('the input holds a day the browser accepts: ' + f.label, inp.value === want, JSON.stringify(inp.value) + ' wanted ' + JSON.stringify(want));
});

// 2. the caption still reads right
ok('the caption under a timestamp reads its date',
  document.querySelector('#ed-qc').closest('.dt-wrap').querySelector('.dt-read').textContent === 'Sat, 5 October 2024',
  document.querySelector('#ed-qc').closest('.dt-wrap').querySelector('.dt-read').textContent);

// 3. THE ONE THAT MATTERS: what a save would write, having touched nothing
var got = edValues(FIELDS);
FIELDS.forEach(function (f) {
  ok('an untouched answer is written back exactly as stored: ' + f.label,
    got[f.id] === f.stored, JSON.stringify(got[f.id]) + ' wanted ' + JSON.stringify(f.stored));
});
ok('and so nothing is deleted: no answer came back empty that was not empty',
  FIELDS.every(function (f) { return f.stored === '' || (got[f.id] || '') !== ''; }));

// 4. picking a different day drops the old clock rather than moving it to a day it never had
var inp = document.getElementById('ed-qc');
inp.value = '2024-10-06';
inp.dispatchEvent(new Event('input', { bubbles: true }));
var after = edValues(FIELDS);
ok('changing the day writes the new day and no invented time', after.qc === '2024-10-06', JSON.stringify(after.qc));
ok('the caption follows the new day',
  inp.closest('.dt-wrap').querySelector('.dt-read').textContent === 'Sun, 6 October 2024',
  inp.closest('.dt-wrap').querySelector('.dt-read').textContent);

// 5. putting the same day back brings the stored clock back with it
inp.value = '2024-10-05';
ok('picking the original day again restores the stored timestamp',
  edValues(FIELDS).qc === '2024-10-05T11:37:00.000Z', JSON.stringify(edValues(FIELDS).qc));

// 6. clearing the box really does clear the answer
inp.value = '';
ok('clearing the box clears the answer', edValues(FIELDS).qc === '', JSON.stringify(edValues(FIELDS).qc));

out.push(pass + ' passed, ' + fail + ' failed (the date round trip, in chrome.exe)');
document.getElementById('out').textContent = out.join('\\n');
console.log('@@' + out.join('\\n@@'));
</script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dkt-'));
const f = path.join(dir, 'p.html');
fs.writeFileSync(f, page);
const r = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=5000',
  '--enable-logging=stderr', '--v=0', 'file:///' + f.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 3e7 });
const lines = (r.stderr || '').split('\n').filter(l => l.indexOf('@@') > -1)
  .join('\n').replace(/^.*?"?@@/gm, '').replace(/",? source:.*$/gm, '');
if (!lines.trim()) {
  console.log('FAILED: the page produced no results. Chrome said:');
  console.log((r.stderr || '').split('\n').slice(-20).join('\n'));
  process.exit(1);
}
console.log(lines);
if (/^FAIL/m.test(lines)) process.exitCode = 1;
fs.rmSync(dir, { recursive: true, force: true });
