// What a save WOULD write, for a phone answer the panel cannot parse.
//
// The bug: parsePhone fell back to { idx: 0 } for any value not starting with 962, 961, 963 or
// 964, so a record holding +971501234567 opened showing a Jordanian flag beside
// 971501234567, and saving wrote +962971501234567. About 600 stored answers carry a code the
// old list could not represent and 33,795 are legacy local numbers, so this was reachable on
// a third of the phone answers in the database.
//
// The real edPhone builds the row, the real wireEdPhone wires it, and the real edValues reads
// it back, because what is on test is the three of them together.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/phone-editor.chrome.js
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

// The generated tables plus the shared lookups, lifted as one slab rather than function by
// function: they are written to be one block and the parity test pins them as one.
const A = js.indexOf('  // ---- BEGIN GENERATED phone data');
const B = js.indexOf('  // ---- END SHARED phone helpers');
if (A === -1 || B === -1 || B < A) throw new Error('could not find the phone block in index.html');
const block = js.slice(A, B);

function grab(name) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('no fn ' + name);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
// placeMenuInView is deliberately not lifted here: it positions with viewport coordinates,
// which is wrong for a menu that is absolutely positioned inside .cc-picker, so wireEdPhone
// does not call it. See the .up class in the CSS instead.
const esc = grab('esc'), edFlagUrl = grab('edFlagUrl'), parsePhone = grab('parsePhone'),
      edPhone = grab('edPhone'), wireEdPhone = grab('wireEdPhone'), edValues = grab('edValues');

// One field per stored shape that exists in the database.
const FIELDS = [
  { id: 'jo', label: 'a number we can read', type: 'phone', stored: '+962791234567' },
  { id: 'ae', label: 'a foreign number we could not read before', type: 'phone', stored: '+971501234567' },
  { id: 'junk', label: 'a code that is not a country', type: 'phone', stored: '+0091234' },
  { id: 'legacy', label: 'a legacy local number', type: 'phone', stored: '0791234567' },
  { id: 'blank', label: 'no answer at all', type: 'phone', stored: '' },
  { id: 'nanp', label: 'a NANP number, a real code that still recomposes identically', type: 'phone', stored: '+170123' },
  // A readable number stored with formatting. splitPhone strips it to parse the digits, so
  // recomposing from the cleaned local box would silently normalise the punctuation away.
  // Only data-kept, returned untouched, can give this one back byte identical.
  { id: 'fmt', label: 'a readable number stored with spaces in it', type: 'phone', stored: '+962 79 123 4567' }
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
${edFlagUrl}
var edPhoneReg = {};
${parsePhone}
${edPhone}
${wireEdPhone}
// edValues' other branches are not on test here; these keep it honest and unchanged.
function isFileField(f) { return false; }
function isScorerField(f) { return false; }
function edChecksValue(el) { return []; }
function dtmValueOf(el) { return el.value; }
function keptStampOf(v) { return v; }
${edValues}

var FIELDS = ${JSON.stringify(FIELDS)};
var host = document.getElementById('host');
FIELDS.forEach(function (f) {
  var d = document.createElement('div');
  d.innerHTML = edPhone('ed-' + f.id, f.stored);   // exactly what the record panel builds
  host.appendChild(d);
  wireEdPhone('ed-' + f.id);
});
function rowOf(id) { return document.getElementById('ed-' + id + '-row'); }
function dialOf(id) { return document.getElementById('ed-' + id + '-dial').textContent.trim(); }
function inputOf(id) { return document.getElementById('ed-' + id); }

// 1. what the panel shows
ok('a readable number splits into its country and its local part',
  dialOf('jo') === '+962' && inputOf('jo').value === '791234567',
  dialOf('jo') + ' / ' + inputOf('jo').value);
ok('a foreign number shows ITS country, not Jordan',
  dialOf('ae') === '+971' && inputOf('ae').value === '501234567',
  dialOf('ae') + ' / ' + inputOf('ae').value);
ok('a code that is not a country is shown raw rather than guessed at',
  dialOf('junk') === '+ ?' && inputOf('junk').value === '+0091234',
  dialOf('junk') + ' / ' + inputOf('junk').value);
ok('a legacy local number is shown raw',
  dialOf('legacy') === '+ ?' && inputOf('legacy').value === '0791234567',
  dialOf('legacy') + ' / ' + inputOf('legacy').value);
ok('a real NANP code (+1) resolves to a country, unlike the unknown-code case above',
  dialOf('nanp') === '+1' && inputOf('nanp').value === '70123',
  dialOf('nanp') + ' / ' + inputOf('nanp').value);
ok('a formatted number still parses to its country and clean local part',
  dialOf('fmt') === '+962' && inputOf('fmt').value === '791234567',
  dialOf('fmt') + ' / ' + inputOf('fmt').value);

// 2. THE ONE THAT MATTERS: what a save would write, having touched nothing.
var got = edValues(FIELDS);
FIELDS.forEach(function (f) {
  var want = f.stored === '' ? null : f.stored;
  ok('an untouched answer is written back exactly as stored: ' + f.label,
    got[f.id] === want, JSON.stringify(got[f.id]) + ' wanted ' + JSON.stringify(want));
});

// 3. and the raw value is not a trap: editing it still works
var el = inputOf('legacy');
el.value = '791234567';
el.dispatchEvent(new Event('input', { bubbles: true }));
// Still no country on the row, so the edited value goes back as typed rather than being
// silently given a Jordanian code nobody chose.
ok('editing an unparsed number writes what was typed',
  edValues(FIELDS).legacy === '791234567', JSON.stringify(edValues(FIELDS).legacy));

// 4. choosing a country for it composes a real number
(function () {
  var btn = document.getElementById('ed-legacy-btn');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  var s = document.getElementById('ed-legacy-search');
  s.value = 'jordan'; s.dispatchEvent(new Event('input', { bubbles: true }));
  var li = document.getElementById('ed-legacy-list').querySelector('li');
  li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  ok('picking a country for a legacy number composes it properly',
    edValues(FIELDS).legacy === '+962791234567', JSON.stringify(edValues(FIELDS).legacy));
})();

// 5. the picker searches, in the panel as well as on the form
// "german" rather than "ger": the shorter substring also lands inside Algeria, Niger and
// Nigeria, which is correct search behaviour, not a bug, but would leave more than one row.
(function () {
  document.getElementById('ed-jo-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  var s = document.getElementById('ed-jo-search');
  s.value = 'german'; s.dispatchEvent(new Event('input', { bubbles: true }));
  var rows = document.getElementById('ed-jo-list').querySelectorAll('li');
  ok('searching the panel picker finds one country', rows.length === 1, rows.length + ' rows');
  rows[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  ok('and picking it recomposes the number under the new code',
    dialOf('jo') === '+49' && edValues(FIELDS).jo === '+49791234567',
    dialOf('jo') + ' / ' + JSON.stringify(edValues(FIELDS).jo));
})();

// 6. clearing a box clears the answer, because half an answer is not one
(function () {
  var e2 = inputOf('ae');
  e2.value = '';
  e2.dispatchEvent(new Event('input', { bubbles: true }));
  ok('clearing the box clears the answer', edValues(FIELDS).ae === null, JSON.stringify(edValues(FIELDS).ae));
})();

// 7. the menu flips above the button when there is not enough room below, and never asks
// placeMenuInView (which writes viewport coordinates) to do it
(function () {
  var row = rowOf('nanp');
  row.style.position = 'fixed'; row.style.bottom = '4px'; row.style.left = '10px';
  var btn = document.getElementById('ed-nanp-btn');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  var menu = document.getElementById('ed-nanp-menu');
  ok('a picker with no room below flips above the button',
    menu.classList.contains('up'), menu.className);
})();

out.push(pass + ' passed, ' + fail + ' failed (the phone round trip, in chrome.exe)');
document.getElementById('out').textContent = out.join('\\n');
console.log('@@' + out.join('\\n@@'));
</script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-phed-'));
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
