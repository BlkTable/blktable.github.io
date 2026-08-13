// The payroll export: pick two dates, get the names and the money. This file exists because
// the output is money somebody is paid — a row quietly dropped is a barista not paid, and a
// row counted twice is money out the door. Every rule here is one of those two failures.
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

const A = load('index.html', ['payrollRows', 'payrollConfig', 'inDateRange', 'payrollNumber']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const CFG = { date: 'e-date', group: 's-name', rate: 'e-rate', only_slot: 'confirmed' };
// two events in August, one in September, all at 15 JD except the last
const EVENTS = [
  { id: 'ev1', data: { 'e-date': '2026-08-05', 'e-rate': '15' } },
  { id: 'ev2', data: { 'e-date': '2026-08-31', 'e-rate': '15' } },
  { id: 'ev3', data: { 'e-date': '2026-09-01', 'e-rate': '20' } }
];
const sign = (ev, name, slot) => ({ parent_id: ev, slot: slot || 'confirmed', data: { 's-name': name } });

// ---- the config gate ----
t('a table with no payroll config offers nothing', () => {
  assert.strictEqual(A.payrollConfig({ config: {} }), null);
  assert.strictEqual(A.payrollConfig({}), null);
  assert.strictEqual(A.payrollConfig(null), null);
});
t('an incomplete payroll config is ignored rather than half-used', () => {
  // no date = no range to filter on; no group = nobody to pay
  const par = { parent: { table: 'p-1' } };
  assert.strictEqual(A.payrollConfig({ config: Object.assign({ payroll: { date: 'd' } }, par) }), null);
  assert.strictEqual(A.payrollConfig({ config: Object.assign({ payroll: { group: 'g' } }, par) }), null);
});
t('payroll needs a parent table, because the date and rate live there', () => {
  // without one the panel would query app_submissions with no table id at all
  assert.strictEqual(A.payrollConfig({ config: { payroll: CFG } }), null);
  assert.ok(A.payrollConfig({ config: { payroll: CFG, parent: { table: 'p-1' } } }));
});

// ---- the date range ----
t('both ends of the range are inclusive', () => {
  // "1 to 31 August" has to include the 31st, or the last day of every month goes unpaid
  assert.strictEqual(A.inDateRange('2026-08-01', '2026-08-01', '2026-08-31'), true);
  assert.strictEqual(A.inDateRange('2026-08-31', '2026-08-01', '2026-08-31'), true);
});
t('outside the range is out', () => {
  assert.strictEqual(A.inDateRange('2026-07-31', '2026-08-01', '2026-08-31'), false);
  assert.strictEqual(A.inDateRange('2026-09-01', '2026-08-01', '2026-08-31'), false);
});
t('a date with a time on it still compares by day', () => {
  assert.strictEqual(A.inDateRange('2026-08-15T22:30:00', '2026-08-01', '2026-08-31'), true);
});
t('no date at all is never in range', () => {
  // an event with no date cannot belong to a pay period; it must not fall into every one
  [null, undefined, '', 'next Thursday', '2026-8-5'].forEach(v => {
    assert.strictEqual(A.inDateRange(v, '2026-08-01', '2026-08-31'), false, String(v));
  });
});
t('an open-ended range still works', () => {
  assert.strictEqual(A.inDateRange('2020-01-01', '', '2026-08-31'), true);
  assert.strictEqual(A.inDateRange('2030-01-01', '2026-08-01', ''), true);
});

// ---- the money ----
t('a rate reads as a number even with units typed into it', () => {
  assert.strictEqual(A.payrollNumber('15'), 15);
  assert.strictEqual(A.payrollNumber('15 JD'), 15);
  assert.strictEqual(A.payrollNumber(15), 15);
});
t('a rate that is not a number is zero, not NaN', () => {
  // NaN would propagate through the total and print "NaN" on a payroll sheet
  [null, undefined, '', 'fifteen', '-'].forEach(v => {
    assert.strictEqual(A.payrollNumber(v), 0, String(v));
  });
});

// ---- the rows ----
t('one person on two events in range is one row, two events, both rates', () => {
  const rows = A.payrollRows([sign('ev1', 'Ahmad'), sign('ev2', 'Ahmad')], EVENTS, CFG, '2026-08-01', '2026-08-31');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].events, 2);
  assert.strictEqual(rows[0].amount, 30);
});
t('the amount sums each event\'s own rate rather than multiplying by one', () => {
  // this is the whole reason rate lives on the event: a rate change must not rewrite history
  const rows = A.payrollRows([sign('ev1', 'Sara'), sign('ev3', 'Sara')], EVENTS, CFG, '', '');
  assert.strictEqual(rows[0].amount, 35, '15 + 20');
});
t('an event outside the range is not paid', () => {
  const rows = A.payrollRows([sign('ev1', 'Ahmad'), sign('ev3', 'Ahmad')], EVENTS, CFG, '2026-08-01', '2026-08-31');
  assert.strictEqual(rows[0].events, 1);
  assert.strictEqual(rows[0].amount, 15);
});
t('a backup who never got promoted is not paid', () => {
  // they did not work; only_slot is the rule that says so
  const rows = A.payrollRows([sign('ev1', 'Ahmad', 'backup')], EVENTS, CFG, '', '');
  assert.strictEqual(rows.length, 0);
});
t('with no only_slot every place counts', () => {
  const cfg = { date: 'e-date', group: 's-name', rate: 'e-rate' };
  const rows = A.payrollRows([sign('ev1', 'Ahmad', 'backup')], EVENTS, cfg, '', '');
  assert.strictEqual(rows.length, 1);
});
t('a signup whose event does not exist earns nothing', () => {
  // a deleted event leaves parent_id pointing nowhere; it must not become free money
  const rows = A.payrollRows([sign('ev-gone', 'Ahmad')], EVENTS, CFG, '', '');
  assert.strictEqual(rows.length, 0);
});
t('two spellings differing only by case or spaces are one person', () => {
  const rows = A.payrollRows([sign('ev1', 'Ahmad'), sign('ev2', ' ahmad ')], EVENTS, CFG, '', '');
  assert.strictEqual(rows.length, 1, 'should be one person');
  assert.strictEqual(rows[0].events, 2);
  assert.strictEqual(rows[0].name, 'Ahmad', 'keeps the first spelling as typed');
});
t('genuinely different spellings stay separate, as decided', () => {
  // names are exported as sent — "Ahmad Ali" and "Ahmad A." are two rows and Faisal reconciles
  const rows = A.payrollRows([sign('ev1', 'Ahmad Ali'), sign('ev2', 'Ahmad A.')], EVENTS, CFG, '', '');
  assert.strictEqual(rows.length, 2);
});
t('a signup with no name is kept, not dropped', () => {
  // it is money somebody is owed; hiding it loses it
  const rows = A.payrollRows([sign('ev1', '')], EVENTS, CFG, '', '');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, '(no name)');
});
t('rows come out sorted by name', () => {
  const rows = A.payrollRows([sign('ev1', 'Sara'), sign('ev1', 'Ahmad'), sign('ev1', 'Omar')], EVENTS, CFG, '', '');
  // joined, because an array built inside the vm has a different Array.prototype and
  // deepStrictEqual fails on reference-equality alone
  assert.strictEqual(rows.map(r => r.name).join(','), 'Ahmad,Omar,Sara');
});
t('nothing in range is an empty list, not a row of zeroes', () => {
  const rows = A.payrollRows([sign('ev1', 'Ahmad')], EVENTS, CFG, '2027-01-01', '2027-01-31');
  assert.strictEqual(rows.length, 0);
});
t('empty and missing inputs do not throw', () => {
  assert.strictEqual(A.payrollRows([], [], CFG, '', '').length, 0);
  assert.strictEqual(A.payrollRows(null, null, CFG, '', '').length, 0);
  assert.strictEqual(A.payrollRows([sign('ev1', 'A')], EVENTS, null, '', '').length, 0);
});
t('a table with no rate config counts events and pays nothing', () => {
  // "how many events did each person work" is a legitimate use on its own
  const cfg = { date: 'e-date', group: 's-name', only_slot: 'confirmed' };
  const rows = A.payrollRows([sign('ev1', 'Ahmad')], EVENTS, cfg, '', '');
  assert.strictEqual(rows[0].events, 1);
  assert.strictEqual(rows[0].amount, 0);
});

console.log(n + ' payroll tests passed');
