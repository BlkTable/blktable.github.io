// The time box, driven in a real browser — same reasoning as date-field.chrome.js. What was
// broken was never the formatting; it was that clicking a time field opened nothing on any
// browser without showPicker(), silently, inside a try/catch.
//
// Lifts the real stylesheet and the real date+time block out of index.html, listeners
// included, then presses the button, picks times off the list, types them, and checks the
// two controls do not tread on each other — they share a wrapper and a readout line.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/time-field.chrome.js
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

// both blocks, whole: the date one too, because the time popup registers itself in the same
// calNow slot and relies on the date block's Escape and click-away handlers
const START = '  // ---- The date box, and the calendar behind it ----';
const END = '  // ---- Shared inline-edit builders';
const a = js.indexOf(START), b = js.indexOf(END);
if (a < 0 || b < 0) throw new Error('could not find the date/time blocks in index.html');
const block = js.slice(a, b);
if (block.indexOf('function openTimeList') < 0) throw new Error('the time block is not in the copied region');
function grab(name) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
}
// the app's own row builders, lifted rather than re-typed
const edTime = grab('edTime'), edDate = grab('edDate'), esc = grab('esc');

const page = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${style}</style></head><body>
<div class="m-field"><div class="k">Shift starts</div><div id="host"></div></div>
<div class="m-field"><div class="k">Start date</div><div id="hostd"></div></div>
<pre id="out"></pre>
<script>
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra === undefined ? '' : ' -> ' + extra)); }
}
${esc}
${block}
${edTime}
${edDate}

document.getElementById('host').innerHTML = edTime('ed-shift', '14:30');
var wrap = document.querySelector('#host .dt-wrap');
var inp = document.getElementById('ed-shift');
var btn = wrap.querySelector('.tm-btn');
var read = wrap.querySelector('.dt-read');

ok('the time field is still a native time input', inp && inp.type === 'time', inp && inp.type);
ok('and it still carries the id everything reads it by', !!document.getElementById('ed-shift'));
ok('and the value is still the HH:MM that gets saved', inp.value === '14:30', inp.value);
var bs = getComputedStyle(btn);
ok('there is a clock button', !!btn);
ok('and it is actually visible', bs.display !== 'none' && btn.offsetWidth > 0, bs.display + '/' + btn.offsetWidth);
ok('the time is spelled out underneath', read.textContent === '2:30 PM', read.textContent);

// ---- pressing the button ----
ok('nothing is open to begin with', document.querySelectorAll('.cal').length === 0);
btn.click();
var tml = document.querySelector('.cal.tml');
ok('pressing the button opens the time list', !!tml);
ok('the list offers every quarter of an hour', tml && tml.querySelectorAll('.tml-opt').length === 96,
   tml && String(tml.querySelectorAll('.tml-opt').length));
ok('the time already chosen is marked', tml && tml.querySelector('.tml-opt.on') &&
   tml.querySelector('.tml-opt.on').getAttribute('data-t') === '14:30',
   tml && tml.querySelector('.tml-opt.on') && tml.querySelector('.tml-opt.on').getAttribute('data-t'));
ok('and the list is written the way a time is spoken',
   tml && tml.querySelector('.tml-opt.on').textContent === '2:30 PM',
   tml && tml.querySelector('.tml-opt.on').textContent);
ok('midnight is offered as 12:00 AM, not 0:00',
   tml && tml.querySelector('.tml-opt[data-t="00:00"]').textContent === '12:00 AM',
   tml && tml.querySelector('.tml-opt[data-t="00:00"]').textContent);
ok('noon is offered as 12:00 PM',
   tml && tml.querySelector('.tml-opt[data-t="12:00"]').textContent === '12:00 PM',
   tml && tml.querySelector('.tml-opt[data-t="12:00"]').textContent);

// ---- picking one ----
var changes = 0, inputs = 0;
inp.addEventListener('change', function () { changes++; });
inp.addEventListener('input', function () { inputs++; });
tml.querySelector('.tml-opt[data-t="09:15"]').click();
ok('picking a time writes it into the field', inp.value === '09:15', inp.value);
ok('and says so, so autosave hears it', changes === 1 && inputs === 1, changes + '/' + inputs);
ok('and the list closes behind it', document.querySelectorAll('.cal').length === 0);
ok('and the readout follows', read.textContent === '9:15 AM', read.textContent);

// ---- the button toggles, Escape and clicking away close ----
btn.click();
ok('the button opens it again', document.querySelectorAll('.cal').length === 1);
btn.click();
ok('and pressing it again closes it', document.querySelectorAll('.cal').length === 0);
btn.click();
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
ok('Escape closes it', document.querySelectorAll('.cal').length === 0);
btn.click();
document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
ok('clicking away closes it', document.querySelectorAll('.cal').length === 0);

// ---- typing ----
btn.click();
var typ = document.querySelector('.cal.tml .cal-type');
ok('there is a box to type a time into', !!typ);
typ.value = '7pm';
typ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok('a typed time is taken', inp.value === '19:00', inp.value);
ok('and the readout says it back', read.textContent === '7:00 PM', read.textContent);

btn.click();
typ = document.querySelector('.cal.tml .cal-type');
typ.value = '9:30';
typ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok('a time off the quarter-hour can still be typed', inp.value === '09:30', inp.value);

btn.click();
typ = document.querySelector('.cal.tml .cal-type');
typ.value = '25:00';
typ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok('an impossible typed time is refused', inp.value === '09:30', inp.value);
ok('and the box says so', typ.classList.contains('bad'));
ok('and the list stays open to be corrected', document.querySelectorAll('.cal').length === 1);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

// ---- Now and Clear ----
btn.click();
document.querySelector('.tml-clear').click();
ok('Clear empties the field', inp.value === '', inp.value);
ok('and the readout goes with it', read.textContent === '', read.textContent);
btn.click();
document.querySelector('.tml-now').click();
ok('Now fills in a time', /^\\d{2}:\\d{2}$/.test(inp.value), inp.value);

// ---- a date box and a time box do not tread on each other ----
// They share a wrapper class and a readout line, so this is the thing most likely to break:
// syncing one must not empty the other.
document.getElementById('hostd').innerHTML = edDate('ed-start', '2026-09-12');
var dInp = document.getElementById('ed-start');
var dRead = document.querySelector('#hostd .dt-read');
ok('the date box has its own readout', dRead.textContent.indexOf('September') !== -1, dRead.textContent);
inp.value = '14:30'; tmSync(inp); dtSync(inp);
ok('syncing a time box does not empty the date box', dRead.textContent.indexOf('September') !== -1, dRead.textContent);
ok('and the time box keeps its own words', read.textContent === '2:30 PM', read.textContent);
dtSync(dInp); tmSync(dInp);
ok('syncing a date box does not empty its own readout', dRead.textContent.indexOf('September') !== -1, dRead.textContent);
ok('and does not empty the time box either', read.textContent === '2:30 PM', read.textContent);

// only one popup at a time, since both use the same slot
document.querySelector('#hostd .dt-btn').click();
ok('opening the calendar works alongside a time box', document.querySelectorAll('.cal').length === 1);
btn.click();
ok('and opening the time list closes the calendar', document.querySelectorAll('.cal').length === 1 &&
   document.querySelectorAll('.cal.tml').length === 1);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-time-')), 'time.html');
fs.writeFileSync(file, page);
const url = 'file:///' + file.replace(/\\/g, '/');
const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', url],
                         { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dom = run.stdout || '';
const outBlock = (dom.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (!outBlock || !/RESULT/.test(outBlock)) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 2000));
  process.exitCode = 1;
} else {
  const lines = outBlock.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  console.log(result.replace('RESULT ', '') + ' (in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
