// Tests for: email delivery in the alerts editor — what serializeAlerts WRITES, and the
// address parser under it.
//
// Email is the third channel beside WhatsApp and Slack, and it is built on the Slack half:
// the "message lines" rows ARE the message, the same way they are for Slack. So the
// failures worth catching are the two that already bit Slack, plus the one that is only
// email's. An email rule with no message lines renders an empty body and the drain refuses
// it (`notify_render_email` string_aggs over send.params and nothing else) — same shape as
// the bug that made Customer Complaints mute for five days. An email rule with no
// recipients has nowhere to go. And an address that is not an address must be reported
// while the person is looking at it, because SMTP will only tell us about it an hour later
// in a `last_error` nobody reads.
//
// Built on the same minimal DOM mock as slack-alerts.test.js: serializeAlerts reads from
// nodes addAlertRow builds, so the mock only has to answer the element API it calls.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/email-alerts.test.js
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

// serializeAlerts and parseEmailLines run inside a vm context, so the arrays they build
// carry that realm's Array prototype and assert.deepStrictEqual refuses them as "not
// reference-equal" however identical the contents are. Compare by shape instead.
const same = (got, want, msg) =>
  assert.strictEqual(JSON.stringify(got), JSON.stringify(want), (msg ? msg + ' -> ' : '') + JSON.stringify(got));

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- Minimal DOM mock (same shape as slack-alerts.test.js) ----
function makeSelect(value, label) {
  const opt = { textContent: label };
  return { value, options: [opt], selectedIndex: 0, textContent: label };
}
function makeInput(value) { return { value }; }
function makeCheckbox(checked) { return { checked }; }
function makeTextarea(value) { return { value }; }

function makeSingleNode(classMap, paramNodes, attrs) {
  attrs = attrs || {};
  return {
    querySelector: function (sel) {
      const cls = sel.replace(/^\./, '');
      return classMap[cls] || null;
    },
    querySelectorAll: function (sel) {
      if (sel === '.al-params .al-p') return paramNodes || [];
      return [];
    },
    getAttribute: function (name) { return attrs[name] != null ? attrs[name] : null; },
  };
}

function makeAlertNode(opts) {
  opts = opts || {};
  const paramNodes = (opts.params || []).map(function (p) {
    const isText = p.text != null;
    const sel = isText ? makeSelect('__text', '-- fixed text --') : makeSelect(p.field || '', p.fieldLabel || p.field || '');
    const txt = makeInput(isText ? (p.text || '') : '');
    return makeSingleNode({ 'ap-field': sel, 'ap-text': txt }, []);
  });
  const attrs = {};
  if (opts.alertId) attrs['data-alert-id'] = opts.alertId;
  if (opts.byBranch) attrs['data-by-branch'] = opts.byBranch;
  const classMap = {
    'al-field': makeSelect(opts.field || '', opts.field || ''),
    'al-values': makeInput(opts.equalsStr || ''),
    'al-label': makeInput(opts.label || ''),
    'al-every': makeCheckbox(!!opts.every),
    'al-tpl': makeTextarea(opts.tpl || ''),
    'al-contacts': makeTextarea(opts.contacts || ''),
    'al-auto': makeCheckbox(!!opts.autoChecked),
    'al-channel': makeSelect(opts.channel || 'whatsapp', opts.channel || 'whatsapp'),
    'al-tmpl': makeInput(opts.tmpl || ''),
    'al-lang': makeSelect(opts.lang || 'en', opts.lang || 'en'),
    'al-to': makeTextarea(opts.toValue || ''),
    'al-dedupe': makeInput(String(opts.dedupe != null ? opts.dedupe : 60)),
    'al-stale': makeInput(String(opts.stale != null ? opts.stale : 30)),
    'al-slack-channel': makeInput(opts.slackCh || ''),
    'al-email-to': makeTextarea(opts.emailTo || ''),
    'al-email-subject': makeInput(opts.subject || ''),
  };
  return makeSingleNode(classMap, paramNodes, attrs);
}

function makeDocument(alertNodes) {
  return {
    querySelectorAll: function (sel) {
      if (sel === '#bld-alerts .bld-alert') return alertNodes;
      return [];
    },
  };
}

const js = scripts('index.html');
const ctx = { console };
vm.createContext(ctx);
new vm.Script(
  '(function(){\n' +
  grab(js, 'waDigits', 'index.html') + '\n' +
  grab(js, 'parseContactLines', 'index.html') + '\n' +
  grab(js, 'parseEmailLines', 'index.html') + '\n' +
  grab(js, 'alertMessageSpecs', 'index.html') + '\n' +
  grab(js, 'serializeAlerts', 'index.html') + '\n' +
  '\nthis.API={ serializeAlerts, parseEmailLines, alertMessageSpecs };}).call(this)'
).runInContext(ctx);
const { serializeAlerts, parseEmailLines } = ctx.API;

function runOne(nodeOpts) {
  const node = makeAlertNode(nodeOpts);
  ctx.document = makeDocument([node]);
  const problems = [];
  const rules = serializeAlerts.call(ctx, problems);
  return { rules, problems };
}

// ---- the address parser ----
// People do not type one address per line however firmly the placeholder asks. They paste
// what their mail client gave them, which is comma separated, and they paste a display
// name with it. Everything that can be read as an address is kept; everything else is
// handed back so it can be named in the problem list rather than silently dropped.

t('one address per line', () => {
  const r = parseEmailLines.call(ctx, 'a.najjar@blk.jo\nops@blk.jo');
  same(r.list, ['a.najjar@blk.jo', 'ops@blk.jo']);
  same(r.bad, []);
});

t('commas and semicolons separate too, and whitespace is trimmed', () => {
  const r = parseEmailLines.call(ctx, '  a@blk.jo ,b@blk.jo;  c@blk.jo  ');
  same(r.list, ['a@blk.jo', 'b@blk.jo', 'c@blk.jo']);
  same(r.bad, []);
});

t('a display name around the address is stripped', () => {
  const r = parseEmailLines.call(ctx, 'Ahmad Najjar <a.najjar@blk.jo>');
  same(r.list, ['a.najjar@blk.jo'], JSON.stringify(r));
  same(r.bad, []);
});

t('an empty box yields nothing and complains about nothing', () => {
  const r = parseEmailLines.call(ctx, '   \n  \n');
  same(r.list, []);
  same(r.bad, []);
});

t('what is not an address is reported rather than dropped', () => {
  const r = parseEmailLines.call(ctx, 'a@blk.jo\nnot an address\nb@@blk.jo\nc@blk');
  same(r.list, ['a@blk.jo'], JSON.stringify(r.list));
  assert.strictEqual(r.bad.length, 3, JSON.stringify(r.bad));
  assert.ok(r.bad.indexOf('not an address') !== -1, JSON.stringify(r.bad));
  assert.ok(r.bad.indexOf('c@blk') !== -1, 'an address with no dot in the domain is not one: ' + JSON.stringify(r.bad));
});

t('the same address twice is kept once, ignoring case', () => {
  const r = parseEmailLines.call(ctx, 'Ops@blk.jo\nops@BLK.jo\nops@blk.jo');
  same(r.list, ['Ops@blk.jo'], 'first spelling wins: ' + JSON.stringify(r.list));
});

// ---- an email rule serializes ----

t('an email rule writes channel, to_emails, subject and labelled message lines', () => {
  const { rules, problems } = runOne({
    every: true,
    autoChecked: true,
    channel: 'email',
    emailTo: 'ops@blk.jo\nqc@blk.jo',
    subject: 'New complaint',
    label: 'Complaints',
    params: [
      { field: 'f-name', fieldLabel: 'Customer Name' },
      { text: 'There is a complaint' },
      { field: '__record_link', fieldLabel: 'Record link' },
    ],
  });
  assert.strictEqual(problems.length, 0, 'no problems: ' + JSON.stringify(problems));
  assert.strictEqual(rules.length, 1);
  const r = rules[0];
  assert.strictEqual(r.channel, 'email');
  assert.ok(r.send, 'send must be present');
  same(r.send.to_emails, ['ops@blk.jo', 'qc@blk.jo']);
  assert.strictEqual(r.send.subject, 'New complaint');
  assert.strictEqual(r.send.params.length, 3);
  assert.strictEqual(r.send.params[0].field, 'f-name');
  assert.strictEqual(r.send.params[0].label, 'Customer Name', 'email lines carry labels like Slack: ' + JSON.stringify(r.send.params[0]));
  assert.strictEqual(r.send.params[1].text, 'There is a complaint');
  // Nothing from the other two channels may ride along.
  assert.ok(!r.send.slack_channel, 'no slack_channel on an email send: ' + JSON.stringify(r.send));
  assert.ok(!r.send.template, 'no WhatsApp template on an email send: ' + JSON.stringify(r.send));
  assert.ok(!r.send.to, 'no WhatsApp to on an email send: ' + JSON.stringify(r.send));
});

t('an empty subject is written as null so the server falls back to the alert name', () => {
  const { rules, problems } = runOne({
    every: true, autoChecked: true, channel: 'email',
    emailTo: 'ops@blk.jo', subject: '   ', label: 'Complaints',
    params: [{ text: 'hi' }],
  });
  assert.strictEqual(problems.length, 0, JSON.stringify(problems));
  assert.strictEqual(rules[0].send.subject, null, JSON.stringify(rules[0].send));
});

// ---- the three ways it is not ready ----

t('an email rule with no recipients pushes a problem and emits no send', () => {
  const { rules, problems } = runOne({
    every: true, autoChecked: true, channel: 'email',
    emailTo: '', label: 'Complaints', params: [{ text: 'hi' }],
  });
  assert.ok(problems.some(p => /email/i.test(p) && /nobody/i.test(p)),
    'expected an email-has-nobody problem: ' + JSON.stringify(problems));
  assert.strictEqual(rules.length, 1);
  assert.ok(!rules[0].send, 'send must be absent when there is nobody to send to');
});

t('an email rule with recipients but no message lines pushes a problem and emits no send', () => {
  const { rules, problems } = runOne({
    every: true, autoChecked: true, channel: 'email',
    emailTo: 'ops@blk.jo', label: 'Complaints',
    tpl: 'There is a complaint',   // the Notify-button box, which email never reads
    params: [],
  });
  assert.ok(problems.some(p => /email/i.test(p) && /message/i.test(p)),
    'expected an email-needs-a-message problem: ' + JSON.stringify(problems));
  assert.ok(!rules[0].send, 'send must be absent when an email rule has no message lines');
});

t('an email rule whose only message line is blank fixed text counts as having none', () => {
  const { rules, problems } = runOne({
    every: true, autoChecked: true, channel: 'email',
    emailTo: 'ops@blk.jo', label: 'Blank', params: [{ text: '   ' }],
  });
  assert.ok(problems.some(p => /email/i.test(p) && /message/i.test(p)), JSON.stringify(problems));
  assert.ok(!rules[0].send, 'send must be absent');
});

t('a bad address is named in the problems while the good ones still send', () => {
  const { rules, problems } = runOne({
    every: true, autoChecked: true, channel: 'email',
    emailTo: 'ops@blk.jo\nnot an address', label: 'Complaints', params: [{ text: 'hi' }],
  });
  assert.ok(problems.some(p => p.includes('not an address')),
    'the bad address must be quoted back: ' + JSON.stringify(problems));
  assert.ok(rules[0].send, 'the rule still sends to the address that is valid: ' + JSON.stringify(rules[0]));
  same(rules[0].send.to_emails, ['ops@blk.jo']);
});

// ---- the other two channels are untouched ----
// serializeAlerts now has three branches where it had two. These are the same assertions
// slack-alerts.test.js makes, repeated here because the shared message-line helper is new
// and a mistake in it would land on Slack, not on email.

t('a Slack rule still serializes exactly as it did', () => {
  const { rules, problems } = runOne({
    every: true, autoChecked: true, channel: 'slack', slackCh: '#alerts', label: 'S',
    params: [{ field: 'f-product', fieldLabel: 'Product name' }],
  });
  assert.strictEqual(problems.length, 0, JSON.stringify(problems));
  assert.strictEqual(rules[0].channel, 'slack');
  assert.strictEqual(rules[0].send.slack_channel, '#alerts');
  assert.strictEqual(rules[0].send.params[0].label, 'Product name');
  assert.ok(!rules[0].send.to_emails, 'no email keys on a Slack send: ' + JSON.stringify(rules[0].send));
});

t('a WhatsApp rule still serializes with no channel key and unlabelled params', () => {
  const { rules, problems } = runOne({
    every: false, field: 'f-status', equalsStr: 'Rejected', label: 'QC',
    autoChecked: true, channel: 'whatsapp', tmpl: 'qc_v1', toValue: '+962791234567',
    params: [{ field: 'f-product', fieldLabel: 'Product name' }],
  });
  assert.strictEqual(problems.length, 0, JSON.stringify(problems));
  assert.ok(!('channel' in rules[0]), 'channel key must stay absent for WhatsApp: ' + JSON.stringify(rules[0]));
  assert.ok(!('label' in rules[0].send.params[0]),
    'WhatsApp params must stay unlabelled — they fill {{1}},{{2}} positionally: ' + JSON.stringify(rules[0].send.params[0]));
});

if (!process.exitCode) console.log('email-alerts: ' + n + ' tests passed');
