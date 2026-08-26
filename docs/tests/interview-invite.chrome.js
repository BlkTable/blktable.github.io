// The interview invite, typed and sent.
//
// interview-message.test.js covers the rules from node — which template wins, which tokens
// fill in, what a cleared box means. This covers the round trip the way HR actually does it:
// the real textarea in the builder, edited, serialised, put back where the sender reads it,
// and then the wa.me link that comes out the other end. The box could show HR's message and
// the sender could still be reading the shipped default from somewhere else, and every node
// test in this folder would pass.
//
// Needs headless Chrome, and is skipped rather than failed when there is none:
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/interview-invite.chrome.js
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
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in index.html');

// By indentation, not by counting braces: interviewMessage contains /\{([^}]+)\}/g, and a
// counter walks straight out of the function on the escaped brace in that regex. One-liners
// are tried first, or the multi-line pattern would run past one to the next function's end.
function grab(name) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([^)]*\\)[^\\n]*\\}[^\\n]*\\r?\\n', '')) ||
            js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
}
function grabVar(name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' =[\\s\\S]*?;\\r?\\n', ''));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
// The builder's own markup for the box, lifted verbatim — a test that wrote its own textarea
// would keep passing after the real one lost its id or its dir="auto".
const markup = (src.match(/<div class="fp-label" id="bld-invite-lab"[\s\S]*?<\/textarea>\s*<\/div>/) || [])[0];
if (!markup) throw new Error('could not find the invite box markup in index.html');
// and the page's own show/hide rule, so this cannot drift from setBuilderChrome
const toggle = (js.match(/\n    var showInvite = [\s\S]*?\n    \}\);/) || [])[0];
if (!toggle) throw new Error('could not find the showInvite block in setBuilderChrome');

const fns = ['bldGrow', 'wireBldGrow', 'setInviteInput', 'serializeInviteMsg',
  'interviewTemplate', 'interviewMessage', 'phoneCountry', 'waEligible', 'waUrlFor'].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
${markup}
<pre id="out"></pre>
<script>
// The app's own list, trimmed to the one country the invite is offered for. waEligible reads
// .dial off it and compares against WA_DIAL, so a stub with the wrong shape would make every
// applicant ineligible and quietly pass the tests that follow.
var COUNTRIES = [{ code: 'jo', name: 'Jordan', dial: '962' }];
var builtinConfig = { job_applications: {}, casting: {} };
${grabVar('BLK_LOCATION')}
${grabVar('WA_DIAL')}
${grabVar('DEFAULT_INTERVIEW_MSG')}
${grabVar('INTERVIEW_TOKENS')}
${fns}
function applyToggle(isBuiltin, builtinEditKey) {
${toggle}
}
var out = [], pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; out.push('FAIL: ' + name + (detail ? ' -> ' + detail : ''));
}
var box = document.getElementById('bld-invite');
var lab = document.getElementById('bld-invite-lab');
var row = document.getElementById('bld-invite-row');
function shown(el) { return el && getComputedStyle(el).display !== 'none'; }
function saved(v) { builtinConfig.job_applications = { interviewMsg: v }; }
function textOf(url) { return decodeURIComponent(String(url).split('?text=')[1] || ''); }

ok('the box is really in the builder markup', !!box && !!lab && !!row);
ok('and it is a right-to-left-aware textarea', box.tagName === 'TEXTAREA' && box.getAttribute('dir') === 'auto',
   box.tagName + ' dir=' + box.getAttribute('dir'));

// ---- who gets offered the box ----
applyToggle(true, 'job_applications');
ok('Job Applications is offered the box', shown(lab) && shown(row));
applyToggle(true, 'casting');
ok('Casting is not — it has no interview to invite anybody to', !shown(lab) && !shown(row));
applyToggle(false, 'job_applications');
ok('and neither is a custom table', !shown(lab) && !shown(row));
applyToggle(true, 'job_applications');

// ---- loading what was saved ----
setInviteInput(null);
ok('an unset message leaves the box empty', box.value === '', JSON.stringify(box.value));
ok('and shows the shipped wording as the placeholder, so editing starts from the message',
   box.placeholder === DEFAULT_INTERVIEW_MSG);
setInviteInput('مرحبا {Full name}');
ok('a saved message is loaded into the box', box.value === 'مرحبا {Full name}', JSON.stringify(box.value));

// ---- typing in it ----
wireBldGrow(box, true);
var before = box.style.height;
box.value = 'one\\ntwo\\nthree\\nfour\\nfive\\nsix\\nseven\\neight\\nnine\\nten\\neleven\\ntwelve';
box.dispatchEvent(new Event('input'));
ok('the box grows with the message instead of scrolling inside itself',
   parseInt(box.style.height, 10) > parseInt(before || '0', 10), before + ' -> ' + box.style.height);

// ---- the round trip: edited here, sent from there ----
var applicant = { full_name: 'سارة', phone: '+962791234567', interview_at: '2026-09-01T13:30:00.000Z' };
box.value = '  اهلا {Full name}، موعدك {Date} الساعة {Time} على {Location}  ';
saved(serializeInviteMsg());
ok('the message is stored trimmed', builtinConfig.job_applications.interviewMsg.slice(0, 4) === 'اهلا',
   JSON.stringify(builtinConfig.job_applications.interviewMsg));
var url = waUrlFor(applicant);
ok('the applicant gets a wa.me link to their own number', /^https:\\/\\/wa\\.me\\/962791234567\\?text=/.test(url), String(url).slice(0, 60));
var text = textOf(url);
ok('the message sent is the one just typed in the box', text.indexOf('اهلا سارة') === 0, JSON.stringify(text.slice(0, 40)));
ok('with the location filled in', text.indexOf(BLK_LOCATION) !== -1, JSON.stringify(text));
ok('and no token left unfilled', text.indexOf('{') === -1, JSON.stringify(text));
ok('the date reached it', /موعدك .+ الساعة/.test(text) && !/موعدك\\s+الساعة/.test(text), JSON.stringify(text));

// ---- clearing it ----
box.value = '   ';
saved(serializeInviteMsg());
ok('a box cleared to whitespace is stored as nothing at all', builtinConfig.job_applications.interviewMsg === null,
   JSON.stringify(builtinConfig.job_applications.interviewMsg));
var back = textOf(waUrlFor(applicant));
ok('and the applicant gets the shipped message rather than a blank WhatsApp', back.length > 50, JSON.stringify(back));
ok('which greets them by name', back.indexOf('كيف حالك سارة') === 0, JSON.stringify(back.slice(0, 30)));
ok('carries the corrected wording', back.indexOf('نرتبلك') !== -1 && back.indexOf('حابين') !== -1, JSON.stringify(back));
ok('and has no token left in it either', back.indexOf('{') === -1, JSON.stringify(back));

// ---- an applicant nobody can WhatsApp ----
ok('a non-Jordanian number gets no link, because the invite is Jordan-only',
   waUrlFor({ full_name: 'X', phone: '+9611234567', interview_at: applicant.interview_at }) === null);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-interview-invite-')), 'invite.html');
fs.writeFileSync(file, page);
const url = 'file:///' + file.replace(/\\/g, '/');
const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--dump-dom', url],
                         { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dom = run.stdout || '';
const block = (dom.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (!block) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 2000));
  process.exitCode = 1;
} else {
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  console.log(result.replace('RESULT ', '') + ' (interview invite, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
