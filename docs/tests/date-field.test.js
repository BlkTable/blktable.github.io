// The date box: the rules underneath it, pulled out of both pages by name. The dashboard
// and the public form each carry a copy of this calendar, so every rule here is asserted
// against both -- a form that reads "05/03" as the 3rd of May while the review panel reads
// it as the 5th of March is the failure this file exists to catch.
//
// What is NOT here: the popup itself. Opening it, clicking a day and the value landing in
// the input is browser work, and it is covered by date-field.chrome.js.
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
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const NAMES = ['pad2', 'dateParts', 'isoOf', 'fmtDateLong', 'parseTypedDate', 'calGrid', 'inRange'];
const DASH = load('index.html', NAMES);
const FORM = load('f/index.html', NAMES);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
// every rule has to answer the same on both pages
const both = (name, fn) => {
  t(name + ' (dashboard)', () => fn(DASH));
  t(name + ' (public form)', () => fn(FORM));
};
const hasAll = (s, parts) => parts.every(p => String(s).indexOf(p) !== -1);
// The page runs in its own vm, so an object it built carries that realm's prototype and
// deepStrictEqual refuses it however equal the contents are. Copied out field by field.
const plain = p => p == null ? p : { y: p.y, m: p.m, d: p.d };

// ---- dateParts: what counts as a date at all ----
both('an ordinary date reads as its three numbers', A =>
  assert.deepStrictEqual(plain(A.dateParts('2026-09-12')), { y: 2026, m: 9, d: 12 }));
both('a date-time is read as its date', A =>
  assert.deepStrictEqual(plain(A.dateParts('2026-09-12T18:30:00')), { y: 2026, m: 9, d: 12 }));
both('a space-separated date-time is read as its date', A =>
  assert.deepStrictEqual(plain(A.dateParts('2026-09-12 18:30')), { y: 2026, m: 9, d: 12 }));
// The 31st of February is not a date. JavaScript rolls it over to the 3rd of March, and
// telling somebody their shift is on the 3rd because the 31st was stored is worse than
// admitting the stored value is not a date.
both('the 31st of February is not a date', A => assert.strictEqual(A.dateParts('2026-02-31'), null));
both('the 29th of February is not a date in an ordinary year', A =>
  assert.strictEqual(A.dateParts('2026-02-29'), null));
both('the 29th of February is a date in a leap year', A =>
  assert.deepStrictEqual(plain(A.dateParts('2024-02-29')), { y: 2024, m: 2, d: 29 }));
both('a 13th month is not a date', A => assert.strictEqual(A.dateParts('2026-13-01'), null));
both('a zeroth month is not a date', A => assert.strictEqual(A.dateParts('2026-00-10'), null));
both('a zeroth day is not a date', A => assert.strictEqual(A.dateParts('2026-09-00'), null));
both('the 31st of a 30-day month is not a date', A => assert.strictEqual(A.dateParts('2026-09-31'), null));
both('words are not a date', A => assert.strictEqual(A.dateParts('next Thursday'), null));
both('an empty answer is not a date', A => assert.strictEqual(A.dateParts(''), null));
both('a missing answer is not a crash', A => assert.strictEqual(A.dateParts(null), null));
both('an undefined answer is not a crash', A => assert.strictEqual(A.dateParts(undefined), null));

// ---- pad2 / isoOf: what the box stores ----
both('a single-digit day and month are padded', A => assert.strictEqual(A.isoOf(2026, 9, 5), '2026-09-05'));
both('a two-digit day and month are left alone', A => assert.strictEqual(A.isoOf(2026, 12, 25), '2026-12-25'));
both('padding a single digit', A => assert.strictEqual(A.pad2(5), '05'));
both('padding a number that needs none', A => assert.strictEqual(A.pad2(12), '12'));

// ---- fmtDateLong: the readout that kills 09/01 vs 01/09 ----
// The whole point of the readout is that it says the month in words, so it cannot be read
// two ways -- and that it says the same words on every machine, whatever the browser's
// locale is set to. That is why the locale is named rather than left to the browser.
both('the readout names the month in words', A =>
  assert.ok(hasAll(A.fmtDateLong('2026-08-20'), ['20', 'August', '2026']), A.fmtDateLong('2026-08-20')));
both('the readout names the weekday', A =>
  assert.ok(A.fmtDateLong('2026-08-20').indexOf('Thu') !== -1, A.fmtDateLong('2026-08-20')));
both('the long form spells the weekday out', A =>
  assert.ok(A.fmtDateLong('2026-08-20', true).indexOf('Thursday') !== -1, A.fmtDateLong('2026-08-20', true)));
both('the readout never shows the raw ISO date', A =>
  assert.strictEqual(A.fmtDateLong('2026-08-20').indexOf('2026-08-20'), -1));
both('an unset date has no readout', A => assert.strictEqual(A.fmtDateLong(''), ''));
both('an impossible date has no readout', A => assert.strictEqual(A.fmtDateLong('2026-02-31'), ''));
// A date is read day-first here, so the readout must not lead with the month.
both('the readout puts the day before the month', A => {
  const out = A.fmtDateLong('2026-08-20');
  assert.ok(out.indexOf('20') < out.indexOf('August'), out);
});

// ---- parseTypedDate: what a person is allowed to type ----
both('a typed date is read day first', A => assert.strictEqual(A.parseTypedDate('12/09/2026'), '2026-09-12'));
both('dashes are accepted', A => assert.strictEqual(A.parseTypedDate('12-9-2026'), '2026-09-12'));
both('dots are accepted', A => assert.strictEqual(A.parseTypedDate('12.9.2026'), '2026-09-12'));
both('single digits are accepted', A => assert.strictEqual(A.parseTypedDate('5/3/2026'), '2026-03-05'));
both('surrounding spaces are ignored', A => assert.strictEqual(A.parseTypedDate('  12/09/2026 '), '2026-09-12'));
// The box itself shows a four-digit year first on some machines, so what it shows has to
// be typeable back into it.
both('a year-first date is accepted as written', A =>
  assert.strictEqual(A.parseTypedDate('2026-09-12'), '2026-09-12'));
both('a year-first date with slashes is accepted', A =>
  assert.strictEqual(A.parseTypedDate('2026/09/12'), '2026-09-12'));
both('a two-digit year in this century', A => assert.strictEqual(A.parseTypedDate('5/3/26'), '2026-03-05'));
both('a two-digit year that must mean the last century', A =>
  assert.strictEqual(A.parseTypedDate('5/3/75'), '1975-03-05'));
both('an impossible typed date is refused', A => assert.strictEqual(A.parseTypedDate('31/02/2026'), null));
both('a half-typed date is refused', A => assert.strictEqual(A.parseTypedDate('12/09'), null));
both('words are refused', A => assert.strictEqual(A.parseTypedDate('tomorrow'), null));
both('an empty box is refused', A => assert.strictEqual(A.parseTypedDate(''), null));
both('a missing value is not a crash', A => assert.strictEqual(A.parseTypedDate(null), null));

// ---- calGrid: the month as the calendar draws it ----
// Monday first, because that is how a week is read here. The leading blanks are what put
// the 1st under its own weekday; get them wrong and every day in the month is on the
// wrong column.
both('a month starting on a Tuesday has one blank', A => {
  const g = A.calGrid(2026, 9);              // 1 September 2026 is a Tuesday
  assert.strictEqual(g.length, 31);
  assert.strictEqual(g[0], null);
  assert.strictEqual(g[1], 1);
  assert.strictEqual(g[g.length - 1], 30);
});
both('a month starting on a Monday has no blanks', A => {
  const g = A.calGrid(2026, 6);              // 1 June 2026 is a Monday
  assert.strictEqual(g.length, 30);
  assert.strictEqual(g[0], 1);
});
both('a month starting on a Sunday has six blanks', A => {
  const g = A.calGrid(2026, 2);              // 1 February 2026 is a Sunday
  assert.strictEqual(g.length, 34);
  assert.strictEqual(g[5], null);
  assert.strictEqual(g[6], 1);
  assert.strictEqual(g[g.length - 1], 28);
});
both('February has 29 days in a leap year', A => {
  const g = A.calGrid(2024, 2);
  assert.strictEqual(g[g.length - 1], 29);
});
both('a 31-day month ends on the 31st', A =>
  assert.strictEqual(A.calGrid(2026, 12).slice(-1)[0], 31));
both('every blank comes before every day', A => {
  const g = A.calGrid(2026, 9);
  assert.strictEqual(g.indexOf(null), 0);
  assert.strictEqual(g.filter(c => c === null).length, g.findIndex(c => c !== null));
});

// ---- inRange: which days a field will accept ----
// A date of birth cannot be in the future, and a filter can be given either end. Both ends
// are inclusive: "on or before the 12th" has to include the 12th.
both('no limits accepts any date', A => assert.strictEqual(A.inRange('2026-09-12', '', ''), true));
both('a date past the latest allowed is refused', A =>
  assert.strictEqual(A.inRange('2026-09-12', '', '2026-09-11'), false));
both('the latest allowed date is itself allowed', A =>
  assert.strictEqual(A.inRange('2026-09-12', '', '2026-09-12'), true));
both('a date before the earliest allowed is refused', A =>
  assert.strictEqual(A.inRange('2026-09-12', '2026-09-13', ''), false));
both('the earliest allowed date is itself allowed', A =>
  assert.strictEqual(A.inRange('2026-09-12', '2026-09-12', ''), true));
both('a date inside both ends is allowed', A =>
  assert.strictEqual(A.inRange('2026-09-12', '2026-01-01', '2026-12-31'), true));
both('a missing limit is not a limit', A =>
  assert.strictEqual(A.inRange('2026-09-12', null, undefined), true));

// ---- the two copies are one copy ----
// The rules above are checked against both pages, but only for the cases written down here.
// This is the stronger claim: the whole date block is the same text on both, so a rule
// nobody thought to test cannot be right on one page and wrong on the other.
const START = '  // ---- The date box, and the calendar behind it ----';
const END_APP = '  // ---- Shared inline-edit builders';
function dateBlock(file, end) {
  const js = scripts(file);
  const a = js.indexOf(START);
  if (a < 0) throw new Error('no date block in ' + file);
  const b = js.indexOf(end, a);
  if (b < 0) throw new Error('could not find the end of the date block in ' + file);
  return js.slice(a, b);
}
t('the public form carries the same date block as the dashboard, character for character', () => {
  // Line endings are not code. The two files carry different mixes of LF and CRLF depending
  // on how git checked them out — on the deployed copies index.html comes down with CRLF on
  // 15,043 lines and f/index.html on 2,322 — so comparing the raw text reports a drift that
  // is nothing but carriage returns. Stripped before comparing, which leaves every character
  // that actually is code.
  const strip = s => s.replace(/\r/g, '');
  const app = strip(dateBlock('index.html', END_APP));
  // in the public form the block is followed by the parent-link formatter
  const form = strip(dateBlock('f/index.html', '  // What this link\'s record says'));
  assert.strictEqual(form, app);
});

// ---- what the old way left behind ----
// A date input that opens the browser's own picker on click is the thing being replaced: it
// opened nothing at all where showPicker() does not exist, and it made the box impossible to
// click into and type. A time box may still do it -- a clock has no year to jump to.
const appSrc = fs.readFileSync('index.html', 'utf8');
const formSrc = fs.readFileSync('f/index.html', 'utf8');
t('only a time box asks the browser to open a picker of its own', () => {
  [['index.html', appSrc], ['f/index.html', formSrc]].forEach(([name, src]) => {
    const calls = [...src.matchAll(/\.showPicker\(\)/g)].length;
    assert.strictEqual(calls, 1, name + ' makes ' + calls + ' showPicker() calls; only the time box should');
  });
});
t('every date box in the dashboard is built through dateFieldHtml', () => {
  // A date input written out by hand somewhere else is one with no calendar button beside
  // it, which is exactly how the filter's date box came to be unopenable. The one inside
  // dateFieldHtml is the one that is meant to be there, so it is taken out first.
  const js = scripts('index.html');
  const rest = js.split(grab(js, 'dateFieldHtml', 'index.html')).join('');
  // quoted, so that a comment saying the words "<input type=\"date\">" is not mistaken for one
  const stray = [...rest.matchAll(/['"`]<input [^>]*type="date"/g)].length;
  assert.strictEqual(stray, 0, 'found ' + stray + ' date inputs built outside dateFieldHtml');
});
t('the public form builds its date fields through dateFieldHtml too', () => {
  assert.ok(formSrc.indexOf('dateFieldHtml(id, "", "")') !== -1,
    'the public form no longer routes its date fields through dateFieldHtml');
});
t('every date box carries the class the calendar opens from', () => {
  // dateFieldHtml is the only thing that should be writing one, and it always adds dt-in.
  const wraps = [...appSrc.matchAll(/class="dt-wrap"/g)].length;
  assert.ok(wraps >= 2, 'expected the two schedule boxes to be wrapped too, found ' + wraps);
});

console.log('date-field: ' + n + ' checks passed');
