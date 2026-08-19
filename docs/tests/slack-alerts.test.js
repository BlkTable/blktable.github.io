// Tests for: Slack channel delivery and on-every-submission trigger in the alerts editor.
// serializeAlerts() reads from DOM nodes that addAlertRow() builds. Rather than running a
// full browser we construct the same node tree by hand using a minimal DOM mock that matches
// the element API serializeAlerts calls: querySelector, querySelectorAll, getAttribute,
// checked, value, options/selectedIndex, and textContent.
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

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- Minimal DOM mock ----
// Each node has a map of class->node for querySelector, a flat list for querySelectorAll,
// and typed value/checked/options/selectedIndex/textContent/getAttribute for leaf inputs.
function makeSelect(value, label) {
  const opt = { textContent: label };
  return { value, options: [opt], selectedIndex: 0, textContent: label };
}
function makeInput(value) { return { value }; }
function makeCheckbox(checked) { return { checked }; }
function makeTextarea(value) { return { value }; }

// Build a minimal bld-alert node matching the shape serializeAlerts reads.
// options:
//   every       - boolean (.al-every.checked)
//   field       - string (.al-field.value)
//   equalsStr   - string (.al-values.value)
//   label       - string (.al-label.value)
//   alertId     - string or null (data-alert-id attribute)
//   tpl         - string (.al-tpl.value)
//   contacts    - string (.al-contacts.value)
//   autoChecked - boolean (.al-auto.checked)
//   channel     - "whatsapp" | "slack"
//   tmpl        - string (.al-tmpl.value)
//   lang        - string (.al-lang.value)
//   toValue     - string (.al-to.value)
//   dedupe      - string (.al-dedupe.value)
//   stale       - string (.al-stale.value)
//   slackCh     - string (.al-slack-channel.value)
//   params      - array of { field?: string, fieldLabel?: string, text?: string }
//   byBranch    - string or null (data-by-branch attribute)
function makeAlertNode(opts) {
  opts = opts || {};

  // Build param nodes for .al-params .al-p
  const paramNodes = (opts.params || []).map(function (p) {
    const isText = p.text != null;
    const sel = isText ? makeSelect('__text', '-- fixed text --') : makeSelect(p.field || '', p.fieldLabel || p.field || '');
    const txt = makeInput(isText ? (p.text || '') : '');
    return makeSingleNode({ 'ap-field': sel, 'ap-text': txt }, []);
  });

  // Build a node with the shape serializeAlerts expects
  const alField = makeSelect(opts.field || '', opts.field || '');
  const alValues = makeInput(opts.equalsStr || '');
  const alLabel = makeInput(opts.label || '');
  const alEvery = makeCheckbox(!!opts.every);
  const alTpl = makeTextarea(opts.tpl || '');
  const alContacts = makeTextarea(opts.contacts || '');
  const alAuto = makeCheckbox(!!opts.autoChecked);
  const alChannel = makeSelect(opts.channel || 'whatsapp', opts.channel || 'whatsapp');
  const alTmpl = makeInput(opts.tmpl || '');
  const alLang = makeSelect(opts.lang || 'en', opts.lang || 'en');
  const alTo = makeTextarea(opts.toValue || '');
  const alDedupe = makeInput(String(opts.dedupe != null ? opts.dedupe : 60));
  const alStale = makeInput(String(opts.stale != null ? opts.stale : 30));
  const alSlackCh = makeInput(opts.slackCh || '');

  const attrs = {};
  if (opts.alertId) attrs['data-alert-id'] = opts.alertId;
  if (opts.byBranch) attrs['data-by-branch'] = opts.byBranch;

  const classMap = {
    'al-field': alField,
    'al-values': alValues,
    'al-label': alLabel,
    'al-every': alEvery,
    'al-tpl': alTpl,
    'al-contacts': alContacts,
    'al-auto': alAuto,
    'al-channel': alChannel,
    'al-tmpl': alTmpl,
    'al-lang': alLang,
    'al-to': alTo,
    'al-dedupe': alDedupe,
    'al-stale': alStale,
    'al-slack-channel': alSlackCh,
  };

  return makeSingleNode(classMap, paramNodes, attrs);
}

function makeSingleNode(classMap, paramNodes, attrs) {
  attrs = attrs || {};
  return {
    querySelector: function (sel) {
      const cls = sel.replace(/^\./, '');
      return classMap[cls] || null;
    },
    querySelectorAll: function (sel) {
      // Only pattern used in serializeAlerts for params is ".al-params .al-p"
      if (sel === '.al-params .al-p') return paramNodes || [];
      return [];
    },
    getAttribute: function (name) {
      return attrs[name] != null ? attrs[name] : null;
    },
  };
}

// Build the document mock: document.querySelectorAll("#bld-alerts .bld-alert") returns alertNodes.
function makeDocument(alertNodes) {
  return {
    querySelectorAll: function (sel) {
      if (sel === '#bld-alerts .bld-alert') return alertNodes;
      return [];
    },
  };
}

// Load serializeAlerts and parseContactLines from index.html
const js = scripts('index.html');
const ctx = { console };
vm.createContext(ctx);
new vm.Script(
  '(function(){\n' +
  grab(js, 'waDigits', 'index.html') + '\n' +
  grab(js, 'parseContactLines', 'index.html') + '\n' +
  grab(js, 'serializeAlerts', 'index.html') + '\n' +
  '\nthis.API={ serializeAlerts, parseContactLines };}).call(this)'
).runInContext(ctx);
const { serializeAlerts } = ctx.API;

// Helper: run serializeAlerts against a single alert node and return result.
function runOne(nodeOpts) {
  const node = makeAlertNode(nodeOpts);
  ctx.document = makeDocument([node]);
  const problems = [];
  const rules = serializeAlerts.call(ctx, problems);
  return { rules, problems };
}

// ---- Slack channel + on-every-submission ----

t('slack rule with every=true serializes when, channel, send.slack_channel, and send.params with labels', () => {
  const { rules, problems } = runOne({
    every: true,
    autoChecked: true,
    channel: 'slack',
    slackCh: '#alerts',
    label: 'Every sub',
    params: [
      { field: 'f-product', fieldLabel: 'Product name' },
      { field: '__record_link', fieldLabel: 'Record link' },
    ],
  });
  assert.strictEqual(problems.length, 0, 'no problems: ' + JSON.stringify(problems));
  assert.strictEqual(rules.length, 1);
  const r = rules[0];
  assert.strictEqual(r.when, 'always', 'when must be "always"');
  assert.strictEqual(r.channel, 'slack');
  assert.ok(r.send, 'send must be present');
  assert.strictEqual(r.send.slack_channel, '#alerts');
  assert.ok(!r.send.template, 'no template on slack send');
  assert.ok(!r.send.to, 'no to on slack send');
  assert.strictEqual(r.send.params.length, 2);
  assert.strictEqual(r.send.params[0].field, 'f-product');
  assert.strictEqual(r.send.params[0].label, 'Product name');
  assert.strictEqual(r.send.params[1].field, '__record_link');
  assert.strictEqual(r.send.params[1].label, 'Record link');
  // field/equals must be absent (every=true)
  assert.ok(!('field' in r), 'field must not appear when every=true');
  assert.ok(!('equals' in r), 'equals must not appear when every=true');
});

t('slack rule with empty channel pushes a problem and emits no send', () => {
  const { rules, problems } = runOne({
    every: true,
    autoChecked: true,
    channel: 'slack',
    slackCh: '',
    label: 'Bad slack',
  });
  assert.ok(problems.some(p => p.includes('Slack') && p.includes('no channel')), 'expected Slack-no-channel problem: ' + JSON.stringify(problems));
  // The rule itself is still emitted (every=true, label present), but send is absent.
  assert.strictEqual(rules.length, 1);
  assert.ok(!rules[0].send, 'send must be absent when slack channel is empty');
});

t('whatsapp rule serializes without channel key, without when key, params without label', () => {
  const { rules, problems } = runOne({
    every: false,
    field: 'f-status',
    equalsStr: 'Rejected',
    label: 'QC alert',
    autoChecked: true,
    channel: 'whatsapp',
    tmpl: 'qc_result_v1',
    toValue: '+962791234567',
    dedupe: 60,
    stale: 30,
    params: [
      { field: 'f-product', fieldLabel: 'Product name' },
    ],
  });
  assert.strictEqual(problems.length, 0, 'no problems: ' + JSON.stringify(problems));
  assert.strictEqual(rules.length, 1);
  const r = rules[0];
  assert.ok(!('channel' in r), 'channel key must be absent for whatsapp: ' + JSON.stringify(r));
  assert.ok(!('when' in r), 'when key must be absent for a match rule: ' + JSON.stringify(r));
  assert.strictEqual(r.field, 'f-status');
  assert.ok(Array.isArray(r.equals) && r.equals.length === 1 && r.equals[0] === 'Rejected', 'equals: ' + JSON.stringify(r.equals));
  assert.ok(r.send, 'send must be present');
  assert.strictEqual(r.send.template, 'qc_result_v1');
  assert.ok(r.send.to, 'to must be present');
  assert.strictEqual(r.send.params.length, 1);
  // WhatsApp specs must NOT carry label
  assert.ok(!('label' in r.send.params[0]), 'label must NOT be on WA params: ' + JSON.stringify(r.send.params[0]));
  assert.strictEqual(r.send.params[0].field, 'f-product');
});

t('every=false rule with no field and no equals is dropped silently when label is also empty', () => {
  const { rules, problems } = runOne({ every: false, field: '', equalsStr: '', label: '' });
  assert.strictEqual(rules.length, 0, 'empty rule must be dropped');
  assert.strictEqual(problems.length, 0, 'empty rule must not produce a problem when nothing is set');
});

t('every=false rule with field but no equals reports a problem', () => {
  const { rules, problems } = runOne({ every: false, field: 'f-status', equalsStr: '', label: 'partial' });
  assert.ok(problems.length > 0, 'expected a problem for a partial match rule');
  assert.strictEqual(rules.length, 0);
});

t('every=true rule with no auto checked emits a rule with when=always and no send', () => {
  const { rules, problems } = runOne({ every: true, label: 'Notify always', autoChecked: false });
  assert.strictEqual(problems.length, 0);
  assert.strictEqual(rules.length, 1);
  assert.strictEqual(rules[0].when, 'always');
  assert.ok(!rules[0].send, 'no send when auto is unchecked');
});

if (!process.exitCode) console.log('slack-alerts: ' + n + ' tests passed');
