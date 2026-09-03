// The time box: the rules underneath it, pulled out of both pages by name and asserted
// against each, the same way date-field.test.js does — the public form and the review panel
// each carry a copy, and a form that reads "9:30" as half past nine at night while the panel
// reads half past nine in the morning is the failure this file exists to catch.
//
// What is NOT here: the popup itself. Opening it, picking a time and the value landing in
// the input is browser work, and it is covered by time-field.chrome.js.
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

const NAMES = ['pad2', 'timeParts', 'parseTypedTime', 'fmtTimeLong', 'timeOptions'];
const DASH = load('index.html', NAMES);
const FORM = load('f/index.html', NAMES);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const both = (name, fn) => {
  t(name + ' (dashboard)', () => fn(DASH));
  t(name + ' (public form)', () => fn(FORM));
};
// the page runs in its own vm, so an object it built carries that realm's prototype
const plain = p => p == null ? p : { h: p.h, m: p.m };

// ---- timeParts: what counts as a time at all ----
both('an ordinary time reads as its two numbers', A =>
  assert.deepStrictEqual(plain(A.timeParts('14:30')), { h: 14, m: 30 }));
both('seconds on the end are ignored', A =>
  assert.deepStrictEqual(plain(A.timeParts('14:30:00')), { h: 14, m: 30 }));
both('midnight is a time', A => assert.deepStrictEqual(plain(A.timeParts('00:00')), { h: 0, m: 0 }));
both('one minute to midnight is a time', A =>
  assert.deepStrictEqual(plain(A.timeParts('23:59')), { h: 23, m: 59 }));
// 24:00 is how some systems write midnight; it is not a time this app stores.
both('a 24th hour is not a time', A => assert.strictEqual(A.timeParts('24:00'), null));
both('a 60th minute is not a time', A => assert.strictEqual(A.timeParts('09:60'), null));
both('words are not a time', A => assert.strictEqual(A.timeParts('half nine'), null));
both('an empty answer is not a time', A => assert.strictEqual(A.timeParts(''), null));
both('a missing answer is not a crash', A => assert.strictEqual(A.timeParts(null), null));

// ---- parseTypedTime: what a person is allowed to type ----
// A shift is spoken as "nine" or "half nine" and typed in a hurry. Anything that can only
// mean one time is taken.
both('a bare hour means the top of it', A => assert.strictEqual(A.parseTypedTime('9'), '09:00'));
both('a padded bare hour too', A => assert.strictEqual(A.parseTypedTime('09'), '09:00'));
both('four digits are hours and minutes', A => assert.strictEqual(A.parseTypedTime('0930'), '09:30'));
both('three digits are too', A => assert.strictEqual(A.parseTypedTime('930'), '09:30'));
both('a colon is the obvious way to write it', A => assert.strictEqual(A.parseTypedTime('9:30'), '09:30'));
both('a dot is accepted', A => assert.strictEqual(A.parseTypedTime('9.30'), '09:30'));
both('the 24-hour clock is accepted as written', A => assert.strictEqual(A.parseTypedTime('21:30'), '21:30'));
both('surrounding spaces are ignored', A => assert.strictEqual(A.parseTypedTime('  9:05 '), '09:05'));
both('pm moves the hour', A => assert.strictEqual(A.parseTypedTime('9:30 pm'), '21:30'));
both('pm with no space', A => assert.strictEqual(A.parseTypedTime('9:30PM'), '21:30'));
both('am leaves a morning hour alone', A => assert.strictEqual(A.parseTypedTime('9:30 am'), '09:30'));
both('a bare hour with pm', A => assert.strictEqual(A.parseTypedTime('7pm'), '19:00'));
// The two that are always got wrong: 12 AM is midnight, 12 PM is noon.
both('12 am is midnight', A => assert.strictEqual(A.parseTypedTime('12:00 am'), '00:00'));
both('12 pm is noon', A => assert.strictEqual(A.parseTypedTime('12:00 pm'), '12:00'));
both('a bare 12 am is midnight', A => assert.strictEqual(A.parseTypedTime('12am'), '00:00'));
// 13:00 pm cannot mean anything. Worth knowing why this one case does not prove the guard
// is there: the range check at the end of parseTypedTime refuses it on its own, because pm
// turns 13 into 25 and 25 is past 23. The two below are the ones only the guard catches.
// Without it '13:30 am' reads as half past one in the afternoon and '0:30 am' as half past
// midnight, and nobody typed either.
both('an afternoon hour with pm on it is refused', A => assert.strictEqual(A.parseTypedTime('13:00 pm'), null));
both('an afternoon hour with am on it is refused', A => assert.strictEqual(A.parseTypedTime('13:30 am'), null));
both('a zeroth hour with am on it is refused', A => assert.strictEqual(A.parseTypedTime('0:30 am'), null));
both('a 24th hour is refused', A => assert.strictEqual(A.parseTypedTime('24:00'), null));
both('a 60th minute is refused', A => assert.strictEqual(A.parseTypedTime('9:60'), null));
both('words are refused', A => assert.strictEqual(A.parseTypedTime('half nine'), null));
both('an empty box is refused', A => assert.strictEqual(A.parseTypedTime(''), null));
both('a missing value is not a crash', A => assert.strictEqual(A.parseTypedTime(null), null));

// ---- fmtTimeLong: the readout ----
// The box itself shows 12-hour on one machine and 24-hour on the next, because that follows
// the browser's locale and nothing can be done about it. The readout is written by this
// function, so it says the same thing everywhere — and it matches how a date-time already
// reads elsewhere in the app.
both('an afternoon time reads as the afternoon', A => assert.strictEqual(A.fmtTimeLong('14:30'), '2:30 PM'));
both('a morning time reads as the morning', A => assert.strictEqual(A.fmtTimeLong('09:05'), '9:05 AM'));
both('midnight is 12 AM, not 0 AM', A => assert.strictEqual(A.fmtTimeLong('00:00'), '12:00 AM'));
both('noon is 12 PM, not 0 PM', A => assert.strictEqual(A.fmtTimeLong('12:00'), '12:00 PM'));
both('half past midnight', A => assert.strictEqual(A.fmtTimeLong('00:30'), '12:30 AM'));
both('one minute to midnight', A => assert.strictEqual(A.fmtTimeLong('23:59'), '11:59 PM'));
both('an unset time has no readout', A => assert.strictEqual(A.fmtTimeLong(''), ''));
both('an impossible time has no readout', A => assert.strictEqual(A.fmtTimeLong('24:00'), ''));

// ---- timeOptions: the list the popup offers ----
both('a quarter-hour list covers the day', A => assert.strictEqual(A.timeOptions(15).length, 96));
both('a half-hour list covers the day', A => assert.strictEqual(A.timeOptions(30).length, 48));
both('an hourly list covers the day', A => assert.strictEqual(A.timeOptions(60).length, 24));
both('the list starts at midnight', A => assert.strictEqual(A.timeOptions(15)[0], '00:00'));
both('and ends before the next one', A => assert.strictEqual(A.timeOptions(15)[95], '23:45'));
both('the step is the step', A => assert.strictEqual(A.timeOptions(30)[1], '00:30'));
both('every entry is a time the app would accept', A =>
  A.timeOptions(30).forEach(v => assert.ok(A.timeParts(v), v + ' is not a time')));

// ---- the two copies are one copy ----
const START = '  // ---- The time box, and the list it opens ----';
function timeBlock(file, end) {
  const js = scripts(file);
  const a = js.indexOf(START);
  if (a < 0) throw new Error('no time block in ' + file);
  const b = js.indexOf(end, a);
  if (b < 0) throw new Error('could not find the end of the time block in ' + file);
  return js.slice(a, b);
}
t('the public form carries the same time block as the dashboard, character for character', () => {
  // \r stripped first: line endings are not code, and the two files carry different mixes
  // of them depending on how git checked them out.
  const strip = s => s.replace(/\r/g, '');
  const app = strip(timeBlock('index.html', '  // ---- Shared inline-edit builders'));
  const form = strip(timeBlock('f/index.html', '  // What this link\'s record says'));
  assert.strictEqual(form, app);
});

// ---- what the old way left behind ----
const appSrc = fs.readFileSync('index.html', 'utf8');
const formSrc = fs.readFileSync('f/index.html', 'utf8');
t('nothing is left asking the browser to open a picker of its own', () => {
  // This is the whole point. showPicker() is not in every browser people here use, and where
  // it is missing it fails silently inside a try/catch — the field simply does not open. A
  // date box stopped depending on it; a time box was the half that still did.
  [['index.html', appSrc], ['f/index.html', formSrc]].forEach(([name, src]) => {
    const calls = [...src.matchAll(/\.showPicker\(\)/g)].length;
    assert.strictEqual(calls, 0, name + ' still makes ' + calls + ' showPicker() call(s)');
  });
});
t('every time box in the dashboard is built through timeFieldHtml', () => {
  const js = scripts('index.html');
  const rest = js.split(grab(js, 'timeFieldHtml', 'index.html')).join('');
  // quoted, so a comment saying the words is not mistaken for one being built
  const stray = [...rest.matchAll(/['"`]<input [^>]*type="time"/g)].length;
  assert.strictEqual(stray, 0, 'found ' + stray + ' time inputs built outside timeFieldHtml');
});
t('a time box and a date box share the same wrapper and button', () => {
  // One standard, not two that drift. Both build a .dt-wrap with a button inside it.
  const js = scripts('index.html');
  assert.ok(grab(js, 'timeFieldHtml', 'index.html').indexOf('dt-wrap') !== -1,
    'the time box does not use the shared wrapper');
});

console.log('time-field: ' + n + ' checks passed');
