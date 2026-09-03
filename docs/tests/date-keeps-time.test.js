// A date box handed a stored TIMESTAMP must not throw the answer away.
//
// 13,000-odd answers in the live database are full timestamps sitting in questions typed
// `date` -- "Date / Time" on Shop Audit and QC, "Date & Time" on Mystery Shopper, "Pickup
// Time" on Delivery Orders. An <input type="date"> refuses a value like
// 2024-10-05T11:37:00.000Z outright: the element reports value === "". The caption under the
// box still read correctly, because it is drawn from the stored string, so the panel looked
// right while the input was empty. Then edValues() read "" and saveCustom did
// `delete nd[f.id]` before replacing `data` wholesale -- so opening a QC record and saving it
// deleted that answer, the date along with the time.
//
// The rule this file pins: the element gets a value it will accept, the original is kept
// beside it, and reading the field back returns the ORIGINAL whenever the day was not
// changed. Nothing here parses with `new Date()` on a whole timestamp: the stored `Z` on
// these rows is mislabelled -- Mystery Shopper has 93% of its stored hours between 05:00 and
// 20:00 as written and only 66% if shifted to Amman -- so the wall clock in the string is the
// local time somebody typed, and shifting it would move 13,000 records by three hours.
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
function load(file, names) {
  const js = scripts(file);
  const ctx = { console, CAL_ICON: '<svg></svg>' };
  vm.createContext(ctx);
  new vm.Script('(function(){' + ESC + NL + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

// esc is a single line in f/index.html, so the "closing brace in column 2" grab used by
// the other date tests runs straight past it and swallows the top-level code after it.
// Supplied here rather than lifted, which is honest: nothing about escaping is on test.
const NL = String.fromCharCode(10);
const ESC = "function esc(s) { return (s == null ? \"\" : String(s)).replace(/[&<>\"']/g, function (c) { return { \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]; }); }";
const NAMES = ['pad2', 'dateParts', 'fmtDateLong', 'dayPartOf', 'timePartOf', 'dtmLocalOf', 'keptStampOf', 'dateFieldHtml'];
const DASH = load('index.html', NAMES);
const FORM = load('f/index.html', NAMES);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const both = (name, fn) => {
  t(name + ' (dashboard)', () => fn(DASH));
  t(name + ' (public form)', () => fn(FORM));
};

// ---- dayPartOf: the bit an <input type="date"> will actually accept ----
// Read by character. A whole-timestamp `new Date()` would drag the browser's timezone in.
both('a stored timestamp gives up its day', A =>
  assert.strictEqual(A.dayPartOf('2024-10-05T11:37:00.000Z'), '2024-10-05'));
both('a timestamp with no zone gives up its day', A =>
  assert.strictEqual(A.dayPartOf('2026-09-03T14:30'), '2026-09-03'));
both('a timestamp written with a space', A =>
  assert.strictEqual(A.dayPartOf('2024-10-05 11:37:00'), '2024-10-05'));
both('a bare date is already the day', A =>
  assert.strictEqual(A.dayPartOf('2026-08-26'), '2026-08-26'));
both('an empty value stays empty', A => assert.strictEqual(A.dayPartOf(''), ''));
both('a missing value is not a crash', A => assert.strictEqual(A.dayPartOf(null), ''));
both('words are not a date', A => assert.strictEqual(A.dayPartOf('next tuesday'), ''));
// The late-hour rows are the ones a timezone shift would move onto the wrong DAY, which is
// how a three-hour bug becomes a wrong-date bug.
both('a late-evening timestamp keeps its own day, not the next one', A =>
  assert.strictEqual(A.dayPartOf('2024-10-05T23:40:00.000Z'), '2024-10-05'));
both('a small-hours timestamp keeps its own day, not the previous one', A =>
  assert.strictEqual(A.dayPartOf('2024-10-05T00:20:00.000Z'), '2024-10-05'));

// ---- keptStampOf: reading the field back without losing the clock ----
// The whole point. `kept` is what was stored; `shown` is what the input now holds.
both('an untouched timestamp is returned exactly as it was stored', A =>
  assert.strictEqual(A.keptStampOf('2024-10-05', '2024-10-05T11:37:00.000Z'), '2024-10-05T11:37:00.000Z'));
both('changing the day drops the old clock rather than moving it', A =>
  assert.strictEqual(A.keptStampOf('2024-10-06', '2024-10-05T11:37:00.000Z'), '2024-10-06'));
both('a plain date with nothing kept is itself', A =>
  assert.strictEqual(A.keptStampOf('2026-08-26', ''), '2026-08-26'));
both('clearing the box clears the answer, kept stamp or not', A =>
  assert.strictEqual(A.keptStampOf('', '2024-10-05T11:37:00.000Z'), ''));
both('a kept value that is only a date adds no clock', A =>
  assert.strictEqual(A.keptStampOf('2026-08-26', '2026-08-26'), '2026-08-26'));

// ---- dateFieldHtml: what actually reaches the browser ----
both('the input carries the day, because a date input refuses a timestamp', A => {
  const html = A.dateFieldHtml('ed-x', '2024-10-05T11:37:00.000Z', 'ed-in');
  assert.ok(html.indexOf('value="2024-10-05"') !== -1,
    'the input must carry the day alone; got: ' + html);
  assert.ok(html.indexOf('value="2024-10-05T11:37:00.000Z"') === -1,
    'the raw timestamp must not be the input value, the browser drops it');
});
both('the original timestamp is kept beside the input', A => {
  const html = A.dateFieldHtml('ed-x', '2024-10-05T11:37:00.000Z', 'ed-in');
  assert.ok(html.indexOf('data-kept="2024-10-05T11:37:00.000Z"') !== -1,
    'the stored value must be kept so a save can put it back; got: ' + html);
});
both('a plain date needs nothing kept', A => {
  const html = A.dateFieldHtml('ed-x', '2026-08-26', 'ed-in');
  assert.ok(html.indexOf('value="2026-08-26"') !== -1, 'the date is the value');
  assert.ok(html.indexOf('data-kept') === -1, 'nothing to keep, so no attribute: ' + html);
});
both('the caption still reads the date under a timestamp', A => {
  const html = A.dateFieldHtml('ed-x', '2024-10-05T11:37:00.000Z', 'ed-in');
  assert.ok(html.indexOf('Sat, 5 October 2024') !== -1, 'the readout must survive: ' + html);
});
both('an empty box is still an empty box', A => {
  const html = A.dateFieldHtml('ed-x', '', 'ed-in');
  assert.ok(html.indexOf('value=""') !== -1, 'empty stays empty: ' + html);
  assert.ok(html.indexOf('data-kept') === -1, 'nothing kept for an empty box');
});

console.log('date-keeps-time: ' + n + ' checks passed');
