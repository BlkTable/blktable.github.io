// The date box, driven in a real browser — because "the function returns the right string"
// is not the thing that was broken. What was broken was that clicking a date field opened
// nothing, and no amount of checking the markup would have said so.
//
// So this file lifts the real stylesheet and the real date block out of index.html —
// functions AND the delegated listeners, so what is under test is the wiring and not a
// re-typed copy of it — renders a date field with the app's own builder, and then presses
// the button, clicks days, types dates and hits Escape the way a person would.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/date-field.chrome.js
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

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in index.html');

// The whole date section, lifted whole: the helpers, the builder, and the listeners the app
// actually attaches to the document. A harness that wires its own click handler would prove
// the calendar draws and say nothing about whether pressing the button opens it.
const START = '  // ---- The date box, and the calendar behind it ----';
const END = '  // ---- Shared inline-edit builders';
const a = js.indexOf(START), b = js.indexOf(END);
if (a < 0 || b < 0) throw new Error('could not find the date block in index.html');
const dateBlock = js.slice(a, b);
function grab(name) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
}
// esc, because dateFieldHtml builds markup with it
const esc = grab('esc');
// The app's own date row, lifted rather than re-typed: if edDate ever stops going through
// dateFieldHtml, this test has to notice.
const edDate = grab('edDate');
if (dateBlock.indexOf('function dateFieldHtml') === -1) throw new Error('dateFieldHtml is not in the date block');

const page = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${style}</style></head><body>
<div class="m-field"><div class="k">Start date</div><div id="host"></div></div>
<div class="m-field"><div class="k">Date of birth</div><div id="host-dob"></div></div>
<div class="m-field"><div class="k">When</div><div id="host-dt"></div></div>
<pre id="out"></pre>
<script>
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra === undefined ? '' : ' -> ' + extra)); }
}
${esc}
${dateBlock}
${edDate}

// ---- rendered by the app's own builder ----
document.getElementById('host').innerHTML = edDate('ed-start', '2026-09-12');
var wrap = document.querySelector('#host .dt-wrap');
var inp = document.getElementById('ed-start');
var btn = wrap.querySelector('.dt-btn');

ok('the date field is still a native date input', inp && inp.type === 'date', inp && inp.type);
ok('and it still carries the id everything reads it by', !!document.getElementById('ed-start'));
ok('and the value is still the ISO date that gets saved', inp.value === '2026-09-12', inp.value);

// The button is the whole point: it is there whatever the browser, where showPicker() was not.
var bs = getComputedStyle(btn);
ok('there is a calendar button', !!btn);
ok('and it is actually visible', bs.display !== 'none' && bs.visibility !== 'hidden' && btn.offsetWidth > 0,
   bs.display + '/' + btn.offsetWidth);

// The readout is what stops 09/01 being read as the wrong month.
var read = wrap.querySelector('.dt-read');
ok('the date is spelled out underneath', /September/.test(read.textContent), read.textContent);
ok('and the readout says the year', /2026/.test(read.textContent), read.textContent);

// ---- pressing the button ----
ok('no calendar before the button is pressed', document.querySelectorAll('.cal').length === 0);
btn.click();
var cal = document.querySelector('.cal');
ok('pressing the button opens a calendar', !!cal);
ok('the week starts on Monday', cal && cal.querySelector('.cal-wd span').textContent === 'Mon',
   cal && cal.querySelector('.cal-wd span').textContent);
ok('it opens on the month the field already holds',
   cal && cal.querySelector('.cal-m').value === '9' && cal.querySelector('.cal-y').value === '2026',
   cal && (cal.querySelector('.cal-m').value + '/' + cal.querySelector('.cal-y').value));
ok('the day already chosen is marked', cal && cal.querySelector('.cal-day.on') &&
   cal.querySelector('.cal-day.on').getAttribute('data-iso') === '2026-09-12',
   cal && cal.querySelector('.cal-day.on') && cal.querySelector('.cal-day.on').getAttribute('data-iso'));

// ---- picking a day ----
// The events matter as much as the value: autosave, the conditional questions and the saved
// draft all listen for them, so a date picked here has to look exactly like one typed.
var changes = 0, inputs = 0;
inp.addEventListener('change', function () { changes++; });
inp.addEventListener('input', function () { inputs++; });
cal.querySelector('.cal-day[data-iso="2026-09-24"]').click();
ok('clicking a day writes it into the field', inp.value === '2026-09-24', inp.value);
ok('and says so, so autosave hears it', changes === 1 && inputs === 1, changes + '/' + inputs);
ok('and the calendar closes behind it', document.querySelectorAll('.cal').length === 0);
ok('and the readout follows', /24 September/.test(read.textContent), read.textContent);

// ---- the button toggles ----
btn.click();
ok('the button opens it again', document.querySelectorAll('.cal').length === 1);
btn.click();
ok('and pressing it again closes it', document.querySelectorAll('.cal').length === 0);

// ---- Escape, and clicking away ----
btn.click();
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
ok('Escape closes it', document.querySelectorAll('.cal').length === 0);
btn.click();
document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
ok('clicking away closes it', document.querySelectorAll('.cal').length === 0);

// ---- jumping a year, which the browser's own calendar cannot do ----
btn.click();
cal = document.querySelector('.cal');
var ysel = cal.querySelector('.cal-y');
ok('every year back to 1920 is offered', ysel.querySelector('option[value="1920"]') !== null);
ysel.value = '1990';
ysel.dispatchEvent(new Event('change', { bubbles: true }));
cal = document.querySelector('.cal');
ok('choosing a year redraws the month there',
   /^1990-/.test(cal.querySelector('.cal-day').getAttribute('data-iso')),
   cal.querySelector('.cal-day').getAttribute('data-iso'));
var msel = cal.querySelector('.cal-m');
msel.value = '3';
msel.dispatchEvent(new Event('change', { bubbles: true }));
cal = document.querySelector('.cal');
ok('and choosing a month goes there in one step',
   /^1990-03-/.test(cal.querySelector('.cal-day').getAttribute('data-iso')),
   cal.querySelector('.cal-day').getAttribute('data-iso'));
// 1 March 1990 was a Thursday, so Monday-first leaves three blanks before it.
ok('the 1st lands under its own weekday',
   cal.querySelectorAll('.cal-days > span').length === 3,
   String(cal.querySelectorAll('.cal-days > span').length));

// ---- the month arrows ----
cal.querySelector('.cal-nav[data-step="-1"]').click();
cal = document.querySelector('.cal');
ok('the back arrow steps a month', cal.querySelector('.cal-m').value === '2', cal.querySelector('.cal-m').value);
cal.querySelector('.cal-nav[data-step="-1"]').click();
cal = document.querySelector('.cal');
ok('and stepping back from January rolls the year over',
   cal.querySelector('.cal-m').value === '1' && cal.querySelector('.cal-y').value === '1990',
   cal.querySelector('.cal-m').value + '/' + cal.querySelector('.cal-y').value);

// ---- typing a date ----
var typ = cal.querySelector('.cal-type');
ok('there is a box to type a date into', !!typ);
typ.value = '05/03/1990';
typ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok('a typed date is taken day-first', inp.value === '1990-03-05', inp.value);
ok('and typing one closes the calendar too', document.querySelectorAll('.cal').length === 0);

btn.click();
cal = document.querySelector('.cal');
typ = cal.querySelector('.cal-type');
typ.value = '31/02/1990';
typ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok('an impossible typed date is refused', inp.value === '1990-03-05', inp.value);
ok('and the box says so', typ.classList.contains('bad'));
ok('and the calendar stays open to be corrected', document.querySelectorAll('.cal').length === 1);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

// ---- Today and Clear ----
btn.click();
document.querySelector('.cal-today').click();
ok('Today fills in today', inp.value === todayIso(), inp.value);
btn.click();
document.querySelector('.cal-clear').click();
ok('Clear empties the field', inp.value === '', inp.value);
ok('and the readout goes with it', read.textContent === '', read.textContent);

// ---- a date of birth cannot be in the future ----
document.getElementById('host-dob').innerHTML = dateFieldHtml('ed-dob', '', 'ed-in', ' max="' + todayIso() + '"');
var dobInp = document.getElementById('ed-dob');
document.querySelector('#host-dob .dt-btn').click();
var dcal = document.querySelector('.cal');
var t = dateParts(todayIso());
var future = dcal.querySelector('.cal-day[data-iso="' + isoOf(t.y, t.m, 28) + '"]');
// only meaningful when the 28th of this month is still ahead of us
if (t.d < 28) {
  ok('a day still to come cannot be picked as a birth date', future && future.disabled === true,
     future && String(future.disabled));
} else {
  ok('a day still to come cannot be picked as a birth date (not applicable this late in the month)', true);
}
ok('the year list for a birth date stops at this year',
   dcal.querySelector('.cal-y').querySelector('option[value="' + (t.y + 1) + '"]') === null);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

// ---- a date-time keeps its time ----
// Picking the day on a schedule box must not quietly move a 6pm interview to midnight.
document.getElementById('host-dt').innerHTML =
  '<div class="dt-wrap"><input type="datetime-local" id="ed-when" class="ed-in dt-in" value="2026-09-12T18:30">' +
  '<button type="button" class="dt-btn"></button><div class="dt-read"></div></div>';
var dtInp = document.getElementById('ed-when');
document.querySelector('#host-dt .dt-btn').click();
document.querySelector('.cal .cal-day[data-iso="2026-09-15"]').click();
ok('picking a day on a date-time keeps the time it had', dtInp.value === '2026-09-15T18:30', dtInp.value);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-date-')), 'date.html');
fs.writeFileSync(file, page);
const url = 'file:///' + file.replace(/\\/g, '/');
const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', url],
                         { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dom = run.stdout || '';
const block = (dom.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (!block || !/RESULT/.test(block)) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 2000));
  process.exitCode = 1;
} else {
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  console.log(result.replace('RESULT ', '') + ' (in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
