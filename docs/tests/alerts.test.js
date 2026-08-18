// An answer somebody has to be TOLD about: app_tables.config.alerts = [{field, equals,
// label, template, contacts}]. The first use is "Status = Rejected" on Kitchen food safety,
// but nothing below knows that — the rule is table-agnostic, so the tests are written with a
// made-up table and a made-up field. The day the config points somewhere else they still
// describe the rule rather than the one form that happened to need it first.
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
// Same loader the other suites use, plus a seed: these functions read page globals
// (currentCustom) and a couple of formatters, so the ones that are not under test are
// stubbed rather than dragged in with their whole dependency tree.
function load(file, names, seed) {
  const js = scripts(file);
  const ctx = Object.assign({ console }, seed || {});
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const FIELD = 'f-status';
const table = { config: { alerts: [{ field: FIELD, equals: ['Rejected'], label: 'Rejected batch' }] } };

const API = load('index.html',
  ['alertRules', 'answerHits', 'alertsFor', 'alertLabel', 'alertTagHtml', 'notifyActions',
   'alertBannerHtml', 'notifyText', 'notifyDefaultText', 'fillTemplate', 'waDigits',
   'isFileField', 'esc'],
  {
    currentCustom: { table: { name: 'Kitchen food safety' } },
    customCellText: (f, d) => (d[f.id] == null || d[f.id] === '' ? '—' : String(d[f.id])),
    recordNumber: () => '#41',
    fmtDate: () => '18 Aug 2026',
  });
const { alertRules, answerHits, alertsFor, alertTagHtml, notifyActions, alertBannerHtml,
        notifyText, notifyDefaultText, waDigits } = API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- which records trip a rule ----
t('the configured answer trips the rule', () => {
  assert.strictEqual(alertsFor(table, { [FIELD]: 'Rejected' }).length, 1);
});
t('the other answer does not', () => {
  assert.strictEqual(alertsFor(table, { [FIELD]: 'Accepted' }).length, 0);
});
// An imported "rejected" is the same answer as a "Rejected" chosen on the form.
t('matching ignores case and surrounding space', () => {
  assert.strictEqual(alertsFor(table, { [FIELD]: 'rejected' }).length, 1);
  assert.strictEqual(alertsFor(table, { [FIELD]: '  Rejected ' }).length, 1);
});
// A blank is not an answer. Without this every unfilled record would shout.
t('a blank answer never trips it', () => {
  assert.strictEqual(alertsFor(table, { [FIELD]: '' }).length, 0);
  assert.strictEqual(alertsFor(table, { [FIELD]: null }).length, 0);
  assert.strictEqual(alertsFor(table, {}).length, 0);
  assert.strictEqual(alertsFor(table, undefined).length, 0);
});
t('a table with no alerts declares none', () => {
  assert.strictEqual(alertRules({ config: {} }).length, 0);
  assert.strictEqual(alertRules(null).length, 0);
  assert.strictEqual(alertsFor({ config: {} }, { [FIELD]: 'Rejected' }).length, 0);
});
// config written by hand can be malformed; a broken rule must not take the record panel down.
t('a rule with no field is ignored', () => {
  assert.strictEqual(alertsFor({ config: { alerts: [{ equals: ['Rejected'] }] } }, { [FIELD]: 'Rejected' }).length, 0);
  assert.strictEqual(alertsFor({ config: { alerts: 'not an array' } }, { [FIELD]: 'Rejected' }).length, 0);
});
// A multi-select answer is an array, and a checkbox list arrives comma-joined: the match is
// over the parts, so one bad choice among several still raises the alert.
t('one part of a multi-answer is enough', () => {
  assert.ok(answerHits(['Clean', 'Rejected'], ['Rejected']));
  assert.ok(answerHits('Clean, Rejected', ['Rejected']));
  assert.ok(!answerHits(['Clean', 'Accepted'], ['Rejected']));
});
t('any value in the list counts, not just the first', () => {
  const many = { config: { alerts: [{ field: FIELD, equals: ['Rejected', 'مرفوض'], label: 'Rejected' }] } };
  assert.strictEqual(alertsFor(many, { [FIELD]: 'مرفوض' }).length, 1);
});
// "Rejected" must not fire on "Rejected by supplier" — a substring is not the answer.
t('a longer answer containing the word does not trip it', () => {
  assert.strictEqual(alertsFor(table, { [FIELD]: 'Rejected by supplier' }).length, 0);
});

// ---- the mark on the record ----
t('a tripped record is marked with its own label', () => {
  const h = alertTagHtml(table, { [FIELD]: 'Rejected' });
  assert.ok(h.includes('alert-tag'), 'expected an alert-tag span, got: ' + h);
  assert.ok(h.includes('Rejected batch'), 'expected the configured label, got: ' + h);
});
t('an untripped record is marked with nothing', () => {
  assert.strictEqual(alertTagHtml(table, { [FIELD]: 'Accepted' }), '');
});
t('the label is escaped', () => {
  const evil = { config: { alerts: [{ field: FIELD, equals: ['Rejected'], label: '<img src=x>' }] } };
  assert.ok(!alertTagHtml(evil, { [FIELD]: 'Rejected' }).includes('<img'));
});
t('a rule with no label still reads as something', () => {
  const bare = { config: { alerts: [{ field: FIELD, equals: ['Rejected'] }] } };
  assert.ok(alertTagHtml(bare, { [FIELD]: 'Rejected' }).includes('Alert'));
});

// ---- the menu entry ----
// Notify is on every record, rule or no rule: a record nobody wrote a rule for still has to
// be sendable, or the feature only works on the one form somebody configured.
t('a tripped record offers one entry per alert', () => {
  const two = { config: { alerts: [
    { field: FIELD, equals: ['Rejected'], label: 'QC' },
    { field: FIELD, equals: ['Rejected'], label: 'Kitchen' }] } };
  const acts = notifyActions(two, { data: { [FIELD]: 'Rejected' } });
  assert.strictEqual(acts.length, 2);
  assert.ok(acts[0].label.includes('QC') && acts[1].label.includes('Kitchen'));
  assert.ok(acts.every(a => a.type === 'notify' && a.rule));
});
t('an untripped record still offers a plain notify', () => {
  const acts = notifyActions(table, { data: { [FIELD]: 'Accepted' } });
  assert.strictEqual(acts.length, 1);
  assert.strictEqual(acts[0].rule, null);
  assert.strictEqual(acts[0].type, 'notify');
});

// ---- the banner ----
t('the banner appears only on a tripped record', () => {
  assert.ok(alertBannerHtml(table, { data: { [FIELD]: 'Rejected' } }).includes('rec-alert'));
  assert.strictEqual(alertBannerHtml(table, { data: { [FIELD]: 'Accepted' } }), '');
});
t('the banner counts the saved contacts, and says so when there are none', () => {
  const withC = { config: { alerts: [{ field: FIELD, equals: ['Rejected'], label: 'QC',
    contacts: [{ name: 'A', phone: '+962791111111' }, { name: 'B', phone: '+962792222222' }, { name: 'C' }] }] } };
  const h = alertBannerHtml(withC, { data: { [FIELD]: 'Rejected' } });
  assert.ok(h.includes('2 contacts'), 'a contact with no number is not a contact: ' + h);
  assert.ok(alertBannerHtml(table, { data: { [FIELD]: 'Rejected' } }).includes('No contacts saved yet'));
});
// Two rules, two buttons, each carrying its own index — one ambiguous button would send the
// wrong message to the wrong people.
t('each banner button names its own rule', () => {
  const two = { config: { alerts: [
    { field: FIELD, equals: ['Rejected'], label: 'QC' },
    { field: FIELD, equals: ['Rejected'], label: 'Kitchen' }] } };
  const h = alertBannerHtml(two, { data: { [FIELD]: 'Rejected' } });
  assert.ok(h.includes('data-ai="0"') && h.includes('data-ai="1"'));
});

// ---- the message ----
const FIELDS = [
  { id: 'f-prod', label: 'Product name', type: 'short_text' },
  { id: FIELD, label: 'Status', type: 'dropdown' },
  { id: 'f-batch', label: 'Batch #', type: 'short_text' },
  { id: 'f-test', label: 'The Test', type: 'file' },
  { id: 'f-note', label: 'Internal note', type: 'long_text', internal: true },
];
const REC = { created_at: '2026-08-18T09:00:00Z', data: {
  'f-prod': 'Hummus', [FIELD]: 'Rejected', 'f-batch': 'B-77', 'f-test': 'k/photo.jpg', 'f-note': 'do not send' } };

t('a rule with a template writes the message from the answers', () => {
  const r = { field: FIELD, equals: ['Rejected'], label: 'QC',
              template: 'Batch {Batch #} of {Product name} was rejected' };
  assert.strictEqual(notifyText(REC, FIELDS, r), 'Batch B-77 of Hummus was rejected');
});
t('a rule with no template still produces a readable message', () => {
  const msg = notifyDefaultText(REC, FIELDS, { label: 'Rejected batch' });
  assert.ok(msg.includes('Rejected batch'), msg);
  assert.ok(msg.includes('Kitchen food safety'), 'the form is named: ' + msg);
  assert.ok(msg.includes('Product name: Hummus'), msg);
  assert.ok(msg.includes('#41'), 'the record number travels with it: ' + msg);
  assert.ok(msg.includes('blktable.blk.jo'), 'and a way back to the record: ' + msg);
});
// A signed R2 url dies in an hour, so an upload is named, never linked.
t('an upload is named rather than linked', () => {
  const msg = notifyDefaultText(REC, FIELDS, null);
  assert.ok(msg.includes('The Test: (attached'), msg);
  assert.ok(!msg.includes('photo.jpg'), 'no storage path in a WhatsApp message: ' + msg);
});
// An internal question is for reviewers, not for whoever receives the message.
t('an internal answer is left out', () => {
  assert.ok(!notifyDefaultText(REC, FIELDS, null).includes('do not send'));
});
t('an unanswered question is left out', () => {
  const thin = { created_at: '2026-08-18T09:00:00Z', data: { 'f-prod': 'Hummus' } };
  const msg = notifyDefaultText(thin, FIELDS, null);
  assert.ok(msg.includes('Product name: Hummus'));
  assert.ok(!msg.includes('Batch #'), 'a blank answer is not a line: ' + msg);
});
// A 177-question form would otherwise produce a message nobody reads.
t('the message stops at eight answers', () => {
  const many = [], data = {};
  for (let i = 0; i < 30; i++) { many.push({ id: 'q' + i, label: 'Q' + i, type: 'short_text' }); data['q' + i] = 'a' + i; }
  const msg = notifyDefaultText({ created_at: '2026-08-18T09:00:00Z', data: data }, many, null);
  assert.ok(msg.includes('Q7: a7'), msg);
  assert.ok(!msg.includes('Q8: a8'), 'nine answers is too many: ' + msg);
});
t('a very long answer is cut, not sent whole', () => {
  const long = { created_at: '2026-08-18T09:00:00Z', data: { 'f-prod': 'x'.repeat(200) } };
  const line = notifyDefaultText(long, FIELDS, null).split('\n').filter(l => l.indexOf('Product name:') === 0)[0];
  assert.ok(line.length < 100, 'expected a truncated line, got ' + line.length + ' chars');
});

// ---- the number ----
t('a number is reduced to digits for wa.me', () => {
  assert.strictEqual(waDigits('+962 79 123 4567'), '962791234567');
  assert.strictEqual(waDigits('(0796) 12-3456'), '0796123456');
  assert.strictEqual(waDigits(null), '');
});

if (!process.exitCode) console.log('alerts: ' + n + ' tests passed');
