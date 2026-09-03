// The date-and-time box: one control, two steps. Press the calendar button, pick the day,
// and it hands you straight on to the time list.
//
// Asked for because the questions that want a time are typed `date` and a calendar has no
// clock in it -- "Date / Time" on Shop Audit and QC, "Date & Time" on Mystery Shopper -- and
// because the two date-and-time boxes the app already had (Interview date & time on the job
// application, and the decision modal's) closed after the day and left the time to the
// browser's own segments, which is the thing that opened nothing on half the devices here.
//
// The rules under it are asserted against BOTH pages, like every other rule in the date
// block. Nothing here goes through `new Date()` on a whole stored string: the `Z` on the
// 13,000 imported timestamps is mislabelled, so reading them as instants would shift every
// one by three hours. See date-keeps-time.test.js.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
const NL = String.fromCharCode(10);
// esc is one line in f/index.html, so the brace-in-column-2 grab runs past it; supplied here.
const ESC = 'function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"\']/g, function (c) '
  + '{ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&#39;" }[c]; }); }';
function load(file, names) {
  const js = scripts(file);
  const ctx = { console, CAL_ICON: '<svg></svg>', CLOCK_ICON: '<svg></svg>' };
  vm.createContext(ctx);
  new vm.Script('(function(){' + ESC + NL + names.map(n => grab(js, n, file)).join(NL) +
    NL + ' this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const NAMES = ['pad2', 'dateParts', 'timeParts', 'fmtDateLong', 'fmtTimeLong',
  'dayPartOf', 'timePartOf', 'dtmLocalOf', 'keptStampOf', 'dtmReadout', 'dtmFieldHtml'];
const DASH = load('index.html', NAMES);
const FORM = load('f/index.html', NAMES);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const both = (name, fn) => {
  t(name + ' (dashboard)', () => fn(DASH));
  t(name + ' (public form)', () => fn(FORM));
};

// ---- timePartOf: the clock half, however the value was written ----
both('an imported timestamp gives up its clock', A =>
  assert.strictEqual(A.timePartOf('2024-10-05T11:37:00.000Z'), '11:37'));
both('a zoneless timestamp gives up its clock', A =>
  assert.strictEqual(A.timePartOf('2026-09-03T14:30'), '14:30'));
both('a timestamp written with a space', A =>
  assert.strictEqual(A.timePartOf('2024-10-05 11:37:00'), '11:37'));
both('a bare date has no clock to give', A =>
  assert.strictEqual(A.timePartOf('2026-08-26'), ''));
both('an empty value has no clock', A => assert.strictEqual(A.timePartOf(''), ''));
both('a missing value is not a crash', A => assert.strictEqual(A.timePartOf(null), ''));
// The clock is read where it is written. Shifting it is the three-hour bug.
both('midnight is kept as midnight, not dropped as falsy', A =>
  assert.strictEqual(A.timePartOf('2024-10-05T00:00:00.000Z'), '00:00'));

// ---- dtmLocalOf: what an <input type="datetime-local"> will accept ----
both('an imported timestamp is cut down to what the element takes', A =>
  assert.strictEqual(A.dtmLocalOf('2024-10-05T11:37:00.000Z'), '2024-10-05T11:37'));
both('a bare date gets no invented time', A =>
  assert.strictEqual(A.dtmLocalOf('2026-08-26'), ''));
both('an already-local value is itself', A =>
  assert.strictEqual(A.dtmLocalOf('2026-09-03T14:30'), '2026-09-03T14:30'));
both('an empty value stays empty', A => assert.strictEqual(A.dtmLocalOf(''), ''));
both('words are not a date and time', A => assert.strictEqual(A.dtmLocalOf('tuesday teatime'), ''));

// ---- keptStampOf now answers for a datetime too ----
// The point is the same as for a date: an answer nobody edited goes back byte-identical,
// so a save cannot quietly rewrite 13,000 imported timestamps into a different shape.
both('an untouched imported timestamp goes back exactly as stored', A =>
  assert.strictEqual(A.keptStampOf('2024-10-05T11:37', '2024-10-05T11:37:00.000Z'), '2024-10-05T11:37:00.000Z'));
both('changing the minute writes what was chosen, not the stored value', A =>
  assert.strictEqual(A.keptStampOf('2024-10-05T11:45', '2024-10-05T11:37:00.000Z'), '2024-10-05T11:45'));
both('changing the day writes what was chosen', A =>
  assert.strictEqual(A.keptStampOf('2024-10-06T11:37', '2024-10-05T11:37:00.000Z'), '2024-10-06T11:37'));
both('the date-only rule still holds', A =>
  assert.strictEqual(A.keptStampOf('2024-10-05', '2024-10-05T11:37:00.000Z'), '2024-10-05T11:37:00.000Z'));
both('clearing it clears the answer', A =>
  assert.strictEqual(A.keptStampOf('', '2024-10-05T11:37:00.000Z'), ''));

// ---- dtmFieldHtml: what reaches the browser ----
both('the element is a native datetime-local carrying the id', A => {
  const html = A.dtmFieldHtml('ed-x', '2024-10-05T11:37:00.000Z', 'ed-in');
  assert.ok(html.indexOf('type="datetime-local"') !== -1, 'must stay a native input: ' + html);
  assert.ok(html.indexOf('id="ed-x"') !== -1, 'must carry the id everything reads it by');
});
both('the element gets a value it will accept, not the raw timestamp', A => {
  const html = A.dtmFieldHtml('ed-x', '2024-10-05T11:37:00.000Z', 'ed-in');
  assert.ok(html.indexOf('value="2024-10-05T11:37"') !== -1, 'wanted the trimmed value: ' + html);
  assert.ok(html.indexOf('value="2024-10-05T11:37:00.000Z"') === -1, 'the raw stamp is refused by the element');
});
both('the stored value rides along so a save can put it back', A => {
  const html = A.dtmFieldHtml('ed-x', '2024-10-05T11:37:00.000Z', 'ed-in');
  assert.ok(html.indexOf('data-kept="2024-10-05T11:37:00.000Z"') !== -1, 'wanted data-kept: ' + html);
});
both('the readout spells out the day AND the time', A => {
  const html = A.dtmFieldHtml('ed-x', '2024-10-05T11:37:00.000Z', 'ed-in');
  assert.ok(html.indexOf('Sat, 5 October 2024') !== -1, 'wanted the date in words: ' + html);
  assert.ok(html.indexOf('11:37 AM') !== -1, 'wanted the time in words: ' + html);
});
both('an unanswered box says nothing', A => {
  const html = A.dtmFieldHtml('ed-x', '', 'ed-in');
  assert.ok(html.indexOf('value=""') !== -1, 'empty stays empty: ' + html);
  assert.ok(html.indexOf('data-kept') === -1, 'nothing kept for an empty box');
});
both('it wears the same wrapper and clock the other two boxes use', A => {
  const html = A.dtmFieldHtml('ed-x', '', 'ed-in');
  assert.ok(html.indexOf('dt-wrap') !== -1, 'same wrapper, so the two read as one control');
  assert.ok(html.indexOf('dt-btn') !== -1, 'same button');
  assert.ok(html.indexOf('dtm-in') !== -1, 'its own class, so dtSync and tmSync can tell it apart');
});

// ---- the shape guard: one builder, no bare datetime inputs left ----
const appSrc = fs.readFileSync('index.html', 'utf8');
const formSrc = fs.readFileSync('f/index.html', 'utf8');
t('every date-and-time box in the app is built by dtmFieldHtml', () => {
  // The two the app already had -- Interview date & time, and the decision modal's -- were
  // hand-written markup that closed after the day and left the time to the browser. A bare
  // one left behind is a box with no way to set a time on it.
  // A hand-written one is fine; what is not fine is one still wearing dt-in, because then
  // dtSync writes a date-only caption over a box that holds a time, and it gets none of the
  // date-and-time behaviour.
  const stale = [...appSrc.matchAll(/<input type="datetime-local"[^>]*class="[^"]*dt-in/g)].length;
  assert.strictEqual(stale, 0, 'index.html has ' + stale + ' datetime input(s) still on dt-in');
});
t('the public form has no hand-written datetime input either', () => {
  const stale = [...formSrc.matchAll(/<input type="datetime-local"[^>]*class="[^"]*dt-in/g)].length;
  assert.strictEqual(stale, 0, 'f/index.html has ' + stale + ' datetime input(s) still on dt-in');
});
t('the builder offers the type, or no question can ever be one', () => {
  assert.ok(/\{ v: "datetime", label: "Date and time" \}/.test(appSrc),
    'FIELD_TYPES must offer datetime');
});

// ---- and both pages carry the same block, character for character ----
function scriptsOf(src) {
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function dtBlock(src, end) {
  const js = scriptsOf(src);
  const a = js.indexOf('  // ---- The date box, and the calendar behind it ----');
  const b = js.indexOf(end);
  if (a < 0 || b < 0) throw new Error('markers not found');
  return js.slice(a, b);
}
t('the public form carries the same date/time block as the dashboard, character for character', () => {
  const strip = s => s.replace(/\r/g, '');
  const app = strip(dtBlock(appSrc, '  // ---- Shared inline-edit builders'));
  const form = strip(dtBlock(formSrc, '  // What this link\'s record says'));
  assert.strictEqual(form, app);
});

console.log('datetime-field: ' + n + ' checks passed');
