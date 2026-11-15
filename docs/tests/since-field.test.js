// A "since" question stores a start date and reads as years, months and days up to today.
// Runs the real sinceText from both pages, which must be the same function.
const fs = require('fs'), assert = require('assert');
function grab(file) {
  const s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const start = s.indexOf('  function sinceText(');
  assert(start !== -1, 'sinceText not found in ' + file);
  return s.slice(start, s.indexOf('\n  }\n', start) + 4);
}
const app = grab('index.html'), form = grab('f/index.html');
assert.strictEqual(app, form, 'sinceText differs between index.html and f/index.html');
const RealDate = Date;
function at(today, iso) {
  global.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(today); } };
  try {
    const dateParts = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
    return eval(app + '\n;sinceText')(iso);
  } finally { global.Date = RealDate; }
}
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok - ' + name); }
t('years, months and days', () => assert.strictEqual(at('2026-11-15T12:00', '2024-08-10'), '2 years, 3 months, 5 days'));
t('borrows days from the previous month', () => assert.strictEqual(at('2026-03-05T12:00', '2026-01-20'), '0 years, 1 month, 13 days'));
t('borrows months from the previous year', () => assert.strictEqual(at('2026-02-01T12:00', '2025-11-01'), '0 years, 3 months, 0 days'));
t('a start date today is zero', () => assert.strictEqual(at('2026-11-15T12:00', '2026-11-15'), '0 years, 0 months, 0 days'));
t('a future date or no date reads as nothing', () => {
  assert.strictEqual(at('2026-11-15T12:00', '2027-01-01'), '');
  assert.strictEqual(at('2026-11-15T12:00', ''), '');
});
t('the builder offers it and the form draws a calendar for it', () => {
  assert(/v: "since", label: "Start date \(shows time since\)"/.test(fs.readFileSync('index.html', 'utf8')));
  assert(/isDate = [^;]*"since"/.test(fs.readFileSync('f/index.html', 'utf8')));
});
console.log(n + ' passed');
