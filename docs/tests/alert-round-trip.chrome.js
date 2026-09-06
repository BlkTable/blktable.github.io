// An alert must come back out of the editor as the same rule that went in.
//
// `slack-alerts.test.js` builds the DOM by hand and covers what serializeAlerts WRITES.
// This covers the half that made the bug: what addAlertRow READS. The two have to agree,
// and for a Slack rule they did not — "Send it automatically" was ticked from
// `send.template`, the WhatsApp approved-template name, which a Slack rule never has. So a
// saved Slack alert rendered with the box unticked and the whole automatic block hidden,
// and the next save wrote the rule back with no channel and no send.
//
// That is not a cosmetic loss. The trigger does `v_send := v_rule->'send'; if v_send is
// null then continue` — the alert stops firing and queues nothing at all, so there is no
// failed row to notice. Customer Complaints lost its Slack channel to an unrelated
// settings save on 2026-09-01 and five complaints went unannounced before anyone asked.
//
// Headless Chrome because addAlertRow builds real nodes and wires real listeners; skipped,
// not failed, without a browser.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/alert-round-trip.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log('SKIPPED: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run this file.');
  process.exit(0);
}

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function grab(name) {
  const at = js.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('could not find function ' + name);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
const NAMES = ['esc', 'waDigits', 'bldFieldOptionsHtml', 'parseContactLines', 'contactLinesText',
  'renumberAlertParams', 'addAlertParamRow', 'addAlertRow', 'serializeAlerts'];
const fns = NAMES.map(grab).join('\n');
const langs = (js.match(/var WA_LANGS = \[.*\];/) || [])[0];
if (!langs) throw new Error('could not find WA_LANGS in index.html');

const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="bld-alerts"></div>
<pre id="out"></pre>
<script>
${langs}
// The questions the alert editor offers. A field line's label is read off the option text,
// so these labels are what a round trip must hand back.
var bldAlertFields = [
  { id: 'f-name', label: 'Customer Name - اسم العميل' },
  { id: 'f-branch', label: 'Branch - الفرع' },
  { id: 'f-status', label: 'Status' }
];
${fns}
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function same(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) + ' != ' + JSON.stringify(want));
}
// Render one saved rule into the editor, then save it straight back out.
function roundTrip(rule) {
  document.getElementById('bld-alerts').innerHTML = '';
  addAlertRow(rule);
  var problems = [];
  return { rules: serializeAlerts(problems), problems: problems };
}

try {
// ---- the regression: Customer Complaints ----
// Exactly the rule that was live, and exactly the save that emptied it.
var SLACK = {
  id: 'A1-jlve', when: 'always', label: 'Complaints', channel: 'slack',
  contacts: [], template: null,
  send: {
    slack_channel: 'C0BT4B4C2V7',
    params: [
      { field: 'f-name', label: 'Customer Name - اسم العميل' },
      { text: 'There is a complaint' },
      { field: '__record_link', label: 'Record link' }
    ]
  }
};
var slack = roundTrip(SLACK);
same('a saved Slack alert reports no problems', slack.problems, []);
ok('a saved Slack alert is still one rule', slack.rules.length === 1, JSON.stringify(slack.rules));
var r = slack.rules[0] || {};
ok('it keeps its id', r.id === 'A1-jlve', JSON.stringify(r.id));
ok('it still fires on every submission', r.when === 'always', JSON.stringify(r.when));
ok('it is STILL a Slack rule after a save', r.channel === 'slack', JSON.stringify(r));
ok('it still has somewhere to send', !!r.send, JSON.stringify(r));
ok('it still names its channel', r.send && r.send.slack_channel === 'C0BT4B4C2V7',
   JSON.stringify(r.send));
same('every message line survives, text and labels alike',
  r.send && r.send.params, SLACK.send.params);

// ---- the same guarantee for WhatsApp ----
var WA = {
  id: 'A2-wa', field: 'f-status', equals: ['Rejected'], label: 'QC alert',
  contacts: [{ name: 'Ahmad', phone: '+962791234567' }], template: 'Batch rejected',
  send: {
    template: 'qc_result_rejected_v1', lang: 'ar', dedupe_minutes: 30, stale_days: 7,
    to: { numbers: [{ name: 'Ahmad - QC', phone: '+962791234567' }] },
    params: [{ field: 'f-branch' }]
  }
};
var wa = roundTrip(WA);
same('a saved WhatsApp alert reports no problems', wa.problems, []);
var w = wa.rules[0] || {};
ok('it keeps its approved template', w.send && w.send.template === 'qc_result_rejected_v1',
   JSON.stringify(w.send));
ok('it keeps its language', w.send && w.send.lang === 'ar', JSON.stringify(w.send && w.send.lang));
ok('it keeps who it goes to',
   w.send && w.send.to && w.send.to.numbers.length === 1, JSON.stringify(w.send && w.send.to));
ok('it keeps the question it watches', w.field === 'f-status' && w.equals[0] === 'Rejected',
   JSON.stringify(w));
same('its don\\u2019t-repeat window survives', w.send && w.send.dedupe_minutes, 30);
same('its ignore-older-than survives', w.send && w.send.stale_days, 7);

// ---- a rule that was never automatic stays that way ----
// The Notify button alone: no send goes in, none must come out. Otherwise the fix would
// invent a destination for a rule nobody set one on.
var manual = roundTrip({ id: 'A3-man', when: 'always', label: 'Notify only',
  template: 'Ring the shop', contacts: [{ name: 'Ali', phone: '+962790000000' }] });
same('a manual-only alert reports no problems', manual.problems, []);
ok('a manual-only alert still has no send', !(manual.rules[0] || {}).send,
   JSON.stringify(manual.rules[0]));
ok('and it keeps its Notify-button message',
   (manual.rules[0] || {}).template === 'Ring the shop', JSON.stringify(manual.rules[0]));

// ---- two rules in one table, one of each ----
// The editor renders every rule into the same host; a Slack rule must not be flattened by
// a WhatsApp one sitting above it.
document.getElementById('bld-alerts').innerHTML = '';
addAlertRow(WA); addAlertRow(SLACK);
var both = [], pair = serializeAlerts(both);
same('a mixed table reports no problems', both, []);
ok('both rules survive together', pair.length === 2, JSON.stringify(pair));
ok('the WhatsApp one is still WhatsApp', pair[0] && !pair[0].channel && !!pair[0].send,
   JSON.stringify(pair[0]));
ok('the Slack one is still Slack', pair[1] && pair[1].channel === 'slack' &&
   pair[1].send && pair[1].send.slack_channel === 'C0BT4B4C2V7', JSON.stringify(pair[1]));
} catch (e) {
  fail++;
  out.push('FAIL the page threw -> ' + (e && e.message) + '\\n' + (e && e.stack));
}
document.getElementById('out').textContent =
  out.join('\\n') + '\\n\\n' + pass + ' passed, ' + fail + ' failed';
</script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-alertrt-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page, 'utf8');
const dump = cp.execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=3000', '--dump-dom', 'file:///' + file.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
const m = dump.match(/<pre id="out">([\s\S]*?)<\/pre>/);
const text = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
if (!text.trim()) {
  console.log('FAIL: the page produced no results — the script did not reach the end');
  process.exitCode = 1;
} else {
  console.log(text);
  if (/FAIL/.test(text) || /\b0 passed/.test(text)) process.exitCode = 1;
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
