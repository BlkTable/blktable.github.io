// The date-and-time box, driven in a real browser. This is the file that says whether the
// thing that was asked for actually happens: press the calendar button, pick the day, and the
// TIME LIST is what you are looking at next -- not a closed popup and a 09:00 nobody chose.
//
// Lifts the real stylesheet and the real date/time block, listeners included, so the two-step
// hand-off is the app's own code doing it.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/datetime-field.chrome.js
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
if (block.indexOf('function dtmFieldHtml') < 0) throw new Error('the datetime block is not in the copied region');

function grab(name) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
}
const esc = grab('esc'), edDateTime = grab('edDateTime'), edDate = grab('edDate'), edValues = grab('edValues');

const page = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${style}</style></head><body>
<div class="m-field"><div class="k">Interview date &amp; time</div><div id="host"></div></div>
<div class="m-field"><div class="k">Visit date</div><div id="hostd"></div></div>
<pre id="out"></pre>
<script>
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra === undefined ? '' : ' -> ' + extra)); }
}
${esc}
${block}
${edDateTime}
${edDate}
function isFileField(f) { return false; }
function isScorerField(f) { return false; }
function edChecksValue(el) { return []; }
var edPhoneReg = {};
${edValues}

// an imported answer, exactly as the live database holds it
document.getElementById('host').innerHTML = edDateTime('ed-when', '2024-10-05T11:37:00.000Z');
document.getElementById('hostd').innerHTML = edDate('ed-day', '2026-09-03');
var inp = document.getElementById('ed-when');
var day = document.getElementById('ed-day');
var wrap = inp.closest('.dt-wrap');
function readout() { return wrap.querySelector('.dt-read').textContent; }

var heard = [];
function hit(sel) { var el = document.querySelector(sel); if (!el) throw new Error('nothing matched ' + sel); el.click(); return el; }
inp.addEventListener('input', function () { heard.push('input'); });
inp.addEventListener('change', function () { heard.push('change'); });

// ---- what an imported answer looks like before anything is touched ----
ok('the element holds a value the browser accepts', inp.value === '2024-10-05T11:37', JSON.stringify(inp.value));
ok('the readout says the day and the time', readout() === 'Sat, 5 October 2024 · 11:37 AM', JSON.stringify(readout()));
ok('an untouched answer would be saved exactly as stored',
  edValues([{ id: 'when', type: 'datetime' }]) && true);
(function () {
  var got = edValues([{ id: 'when', type: 'datetime' }]);
  ok('...and that value is the original timestamp', got.when === '2024-10-05T11:37:00.000Z', JSON.stringify(got.when));
})();

try {
// ---- STEP ONE: the calendar button opens the calendar ----
wrap.querySelector('.dt-btn').click();
var cal = document.querySelector('.cal:not(.tml)');
ok('the button opens a calendar', !!cal);
ok('the calendar is on the stored month', !!document.querySelector('.cal-day.on'),
  (document.querySelector('.cal-day.on') || {}).textContent);

// ---- STEP TWO: picking the day hands straight on to the time list ----
heard = [];
var d6 = [].slice.call(document.querySelectorAll('.cal-day')).filter(function (b) {
  return b.textContent.trim() === '6' && !b.disabled;
})[0];
d6.click();
var tml = document.querySelector('.cal.tml');
ok('picking a day takes you to the time list, it does not just close', !!tml);
ok('the calendar itself is gone', !document.querySelector('.cal:not(.tml)'));
ok('the day landed and the old clock came with it', inp.value === '2024-10-06T11:37', JSON.stringify(inp.value));
ok('and the day said so out loud, so autosave hears it', heard.indexOf('input') > -1 && heard.indexOf('change') > -1, JSON.stringify(heard));
ok('an off-quarter time highlights nothing, because no option is exactly it',
  !document.querySelector('.tml-opt.on'));
ok('but the list still opens at the nearest quarter rather than at midnight',
  document.querySelector('.tml-list').scrollTop > 0,
  'scrollTop ' + document.querySelector('.tml-list').scrollTop);
ok('and the nearest quarter to 11:37 is 11:30',
  !!nearestOptIn(document.querySelector('.cal.tml'), '11:37') &&
  nearestOptIn(document.querySelector('.cal.tml'), '11:37').getAttribute('data-t') === '11:30',
  (nearestOptIn(document.querySelector('.cal.tml'), '11:37') || {}).getAttribute
    ? nearestOptIn(document.querySelector('.cal.tml'), '11:37').getAttribute('data-t') : 'nothing matched');
ok('23:58 clamps to the last option of the day rather than off the end',
  nearestOptIn(document.querySelector('.cal.tml'), '23:58').getAttribute('data-t') === '23:45',
  nearestOptIn(document.querySelector('.cal.tml'), '23:58').getAttribute('data-t'));

// ---- and picking the time finishes the answer ----
heard = [];
document.querySelector('.tml-opt[data-t="18:45"]').click();
ok('picking a time keeps the day that was just chosen', inp.value === '2024-10-06T18:45', JSON.stringify(inp.value));
ok('both popups are closed once the answer is whole', !document.querySelector('.cal'));
ok('the readout says both halves', readout() === 'Sun, 6 October 2024 · 6:45 PM', JSON.stringify(readout()));
ok('the time said so out loud too', heard.indexOf('input') > -1 && heard.indexOf('change') > -1, JSON.stringify(heard));
(function () {
  var got = edValues([{ id: 'when', type: 'datetime' }]);
  ok('a save now writes what was chosen, not the stored stamp', got.when === '2024-10-06T18:45', JSON.stringify(got.when));
})();

// ---- typing a time into the list works on a datetime too ----
wrap.querySelector('.dt-btn').click();                       // calendar
document.querySelector('.cal-day.on').click();               // same day -> time list
var typeBox = document.querySelector('.cal.tml .cal-type');
typeBox.value = '7pm';
typeBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok('typing 7pm into a date-and-time box keeps the day', inp.value === '2024-10-06T19:00', JSON.stringify(inp.value));

// ---- the date box beside it is untouched: three syncs, one wrapper class ----
ok('the date box keeps its own value', day.value === '2026-09-03', JSON.stringify(day.value));
ok('the date box keeps its own readout, not the datetime one',
  day.closest('.dt-wrap').querySelector('.dt-read').textContent === 'Thu, 3 September 2026',
  day.closest('.dt-wrap').querySelector('.dt-read').textContent);

// ---- clearing ----
wrap.querySelector('.dt-btn').click();
document.querySelector('.cal-day.on').click();               // -> time list
document.querySelector('.cal.tml .tml-clear').click();
ok('clearing the time clears the whole answer, because half of one is not an answer', inp.value === '', JSON.stringify(inp.value));
ok('and the readout goes quiet', readout() === '', JSON.stringify(readout()));

// ---- a BARE DATE in a date-and-time box: Shop Audit's 36, Delivery Orders' 1,030 ----
// A datetime-local cannot hold a date with no time, so the box renders empty -- and empty
// is what clearing looks like too. Without the kept value and the touched flag a save here
// deletes the answer, which is the bug the previous commit exists to stop.
document.getElementById('host').innerHTML = edDateTime('ed-bare', '2026-08-26');
var bare = document.getElementById('ed-bare');
ok('a bare date leaves the element empty, because it cannot hold one', bare.value === '', JSON.stringify(bare.value));
ok('but the stored date is kept beside it', bare.getAttribute('data-kept') === '2026-08-26', bare.getAttribute('data-kept'));
ok('and the readout still says the date', bare.closest('.dt-wrap').querySelector('.dt-read').textContent === 'Wed, 26 August 2026', bare.closest('.dt-wrap').querySelector('.dt-read').textContent);
ok('SO AN UNTOUCHED SAVE KEEPS IT rather than deleting it', dtmValueOf(bare) === '2026-08-26', JSON.stringify(dtmValueOf(bare)));
// and once somebody actually answers it, what they chose wins
bare.closest('.dt-wrap').querySelector('.dt-btn').click();
ok('its calendar opens on the day it already had, not on today',
  (document.querySelector('.cal-day.on') || {}).textContent &&
  document.querySelector('.cal-day.on').textContent.trim() === '26',
  (document.querySelector('.cal-day.on') || {}).textContent);
hit('.cal-day.on');                                   // the 26th -> the time list
hit('.tml-opt[data-t="14:30"]');
ok('answering a bare-date question writes the whole date and time', bare.value === '2026-08-26T14:30', JSON.stringify(bare.value));
ok('and the save writes that, not the bare date it started as', dtmValueOf(bare) === '2026-08-26T14:30', JSON.stringify(dtmValueOf(bare)));
// clearing it on purpose still clears it
bare.closest('.dt-wrap').querySelector('.dt-btn').click();
hit('.cal-day.on');
hit('.cal.tml .tml-clear');
ok('clearing a touched box really clears it', dtmValueOf(bare) === '', JSON.stringify(dtmValueOf(bare)));

// ---- a question that was never answered ----
document.getElementById('host').innerHTML = edDateTime('ed-new', '');
var fresh = document.getElementById('ed-new');
ok('an unanswered box is empty, with no invented time', fresh.value === '', JSON.stringify(fresh.value));
fresh.closest('.dt-wrap').querySelector('.dt-btn').click();
ok('and its calendar still opens', !!document.querySelector('.cal:not(.tml)'));
var some = [].slice.call(document.querySelectorAll('.cal-day')).filter(function (b) { return !b.disabled; })[0];
some.click();
ok('picking a day on a fresh box hands on to the time list as well', !!document.querySelector('.cal.tml'));
ok('and it defaults to 09:00 rather than midnight, until a time is picked',
  /T09:00$/.test(fresh.value), JSON.stringify(fresh.value));

} catch (err) { fail++; out.push('FAIL threw part way through -> ' + err.message); }
out.push(pass + ' passed, ' + fail + ' failed (the date-and-time box, in chrome.exe)');
document.getElementById('out').textContent = out.join('\\n');
console.log('@@' + out.join('\\n@@'));
</script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-'));
const f = path.join(dir, 'p.html');
fs.writeFileSync(f, page);
const r = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=6000',
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
