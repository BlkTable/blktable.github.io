// An event's status is worked out from its own data, never pressed. The rule exists twice —
// here and as event_time_phase() in 17-automatic-status.sql — because the server has to
// refuse a late signup on its own authority and the page has to say so before anyone tries.
// Two copies is the same arrangement condMet has, and the reason this file exists: they must
// answer the same, and a wrong answer either closes a form early or takes signups for a shift
// that already happened.
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
  const ctx = { console, Date };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const A = load('index.html', ['eventWindow', 'eventPhase']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// the config as 14/17 write it: field ids for the numbers and for the window
const CAP = { slots: 'f-slots', backup: 'f-backup',
              window: { date: 'f-date', start: 'f-start', end: 'f-end' } };
const ev = (over) => Object.assign(
  { 'f-date': '2099-06-01', 'f-start': '10:00', 'f-end': '14:00', 'f-slots': '8', 'f-backup': '2' }, over);
const past = (over) => ev(Object.assign({ 'f-date': '2020-06-01' }, over));

// ---- no window means nothing changes for the other 226 tables ----
t('a table with no window declared returns null, leaving the stored status in charge', () => {
  assert.strictEqual(A.eventPhase({ slots: 'f-slots' }, ev()), null);
  assert.strictEqual(A.eventPhase({}, ev()), null);
  assert.strictEqual(A.eventPhase(CAP, null), null);
});

// ---- where the clock puts it ----
t('an event in the future with room is open', () => {
  assert.strictEqual(A.eventPhase(CAP, ev(), 0, 0), 'open');
});
t('an event whose end has passed is done', () => {
  assert.strictEqual(A.eventPhase(CAP, past(), 0, 0), 'done');
});
t('done beats full: an event that is over is over', () => {
  // a finished event must not read "Filled", which sounds like it is still coming
  assert.strictEqual(A.eventPhase(CAP, past(), 8, 2), 'done');
});

// ---- fullness ----
t('every place gone, and not started, is filled', () => {
  assert.strictEqual(A.eventPhase(CAP, ev(), 8, 2), 'filled');
});
t('places left is open, even with the backup list started', () => {
  assert.strictEqual(A.eventPhase(CAP, ev(), 7, 0), 'open');
  assert.strictEqual(A.eventPhase(CAP, ev(), 8, 1), 'open', 'a backup place is still a place');
});
t('no capacity number means no limit, so it never reads as filled', () => {
  // an empty Places box is "no limit" everywhere else in the engine; it must not become
  // "filled" here and quietly close a form nobody meant to cap
  assert.strictEqual(A.eventPhase(CAP, ev({ 'f-slots': '' }), 99, 99), 'open');
  assert.strictEqual(A.eventPhase(CAP, ev({ 'f-slots': 'eight' }), 99, 99), 'open');
});
t('a missing backup number counts as zero, not as no limit', () => {
  assert.strictEqual(A.eventPhase(CAP, ev({ 'f-backup': '' }), 8, 0), 'filled');
});
t('more signups than places still reads as filled, never as open', () => {
  assert.strictEqual(A.eventPhase(CAP, ev({ 'f-slots': '2', 'f-backup': '0' }), 5, 0), 'filled');
});

// ---- the window itself ----
t('a date with no usable time still gives a window', () => {
  // start defaults to midnight and end to the day's close, so a half-filled event is
  // "coming up" rather than an error
  const w = A.eventWindow(CAP, ev({ 'f-start': '', 'f-end': '' }));
  assert.ok(w, 'no window built');
  assert.strictEqual(w.start.getHours(), 0);
  assert.strictEqual(w.end.getHours(), 23);
});
t('an unparseable date gives no window at all', () => {
  // and therefore no phase: better to fall back than to invent a day
  assert.strictEqual(A.eventWindow(CAP, ev({ 'f-date': 'next Thursday' })), null);
  assert.strictEqual(A.eventPhase(CAP, ev({ 'f-date': '' }), 0, 0), null);
});
// The one place the two copies deliberately DIFFER, checked against the live function on
// 2026-08-13 and recorded here so it does not read as an accident:
//
//   unparseable date  ->  SQL: 'before' (keeps accepting)   JS: null (shows no pill)
//
// The server has to answer the question "may this person sign up", and there is no safe
// silence — it errs open, because closing a form over a typo is the worse failure. The
// dashboard has the option of saying nothing, and takes it: a status it cannot compute is
// better left blank than guessed at. Every other case answers identically:
//   future -> before/open · past -> after/done · no times -> before/open ·
//   end-before-start -> before/open · seconds on a time -> before/open
t('the fallback is the safe direction on both sides', () => {
  // JS shows nothing rather than claiming a status
  assert.strictEqual(A.eventPhase(CAP, ev({ 'f-date': 'rubbish' }), 0, 0), null);
  // and it never returns a phase that would read as closed off bad input
  ['', 'rubbish', '21-08-2026', '2026/08/21'].forEach(function (d) {
    var ph = A.eventPhase(CAP, ev({ 'f-date': d }), 0, 0);
    assert.ok(ph === null || ph === 'open', d + ' gave ' + ph);
  });
});
t('an end time before its own start is treated as the end of the day', () => {
  // 19:00 to 09:00 is a typo, and honouring it literally would mark the event finished
  // before it began
  const w = A.eventWindow(CAP, ev({ 'f-start': '19:00', 'f-end': '09:00' }));
  assert.strictEqual(w.end.getHours(), 23);
  assert.ok(w.end > w.start);
});
t('seconds on a time are tolerated', () => {
  const w = A.eventWindow(CAP, ev({ 'f-start': '10:30:45' }));
  assert.strictEqual(w.start.getHours(), 10);
  assert.strictEqual(w.start.getMinutes(), 30);
});

// ---- running: built from the clock, so it is computed relative to now ----
t('an event that started but has not ended is running', () => {
  const now = new Date();
  const d = new Date(now.getTime() - 60 * 60 * 1000);   // started an hour ago
  const e = new Date(now.getTime() + 60 * 60 * 1000);   // ends in an hour
  const pad = (x) => String(x).padStart(2, '0');
  const data = {
    'f-date': d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
    'f-start': pad(d.getHours()) + ':' + pad(d.getMinutes()),
    'f-end': pad(e.getHours()) + ':' + pad(e.getMinutes()),
    'f-slots': '8', 'f-backup': '2'
  };
  // only meaningful when both ends land on the same calendar day
  if (d.getDate() === e.getDate()) {
    assert.strictEqual(A.eventPhase(CAP, data, 0, 0), 'running');
    assert.strictEqual(A.eventPhase(CAP, data, 8, 2), 'running', 'running beats filled');
  } else { n--; console.log('  (skipped running case: the hour either side crosses midnight)'); n++; }
});

console.log(n + ' event-phase tests passed');
