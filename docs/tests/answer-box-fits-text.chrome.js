// A long-text answer (a customer complaint, an inspection note) used to sit in a fixed ~70px
// box with a scrollbar — the reader had to scroll inside the box to see the whole thing. It
// now grows to fit what it holds, the same standard the table builder's own textareas already
// use (bldGrow), wired to every .ed-in box via wireEdGrow. Driven in a real browser because the
// measurement (scrollHeight vs. the rendered height) is layout, which node cannot do.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/answer-box-fits-text.chrome.js
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
const fns = ['esc', 'edText', 'edRow', 'bldGrow', 'wireEdGrow'].map(grab).join('\n');

const longAnswer = 'The espresso machine on the corner unit has been leaking from the group ' +
  'head since Tuesday morning, and the steam wand is not producing enough pressure to texture ' +
  'milk properly. Two customers asked for refunds after their lattes came out lukewarm and thin.';

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="host"></div><pre id="out"></pre>
<script>
${fns}
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

// A fixed, phone-width column — the modal's real field column is nowhere near full-page wide,
// so an unconstrained host would let a long sentence fit on one line and prove nothing.
var host = document.getElementById('host');
host.style.width = '340px';
host.innerHTML = edRow('Complaint', edText('ed-complaint', ${JSON.stringify(longAnswer)}, true), true);
var box = document.getElementById('ed-complaint');
// Setting height via scrollHeight on a border-box element leaves the border (1px top + 1px
// bottom) outside clientHeight, so a couple of px of slack here is the box being measured
// correctly, not content being clipped.
var BORDER_SLACK = 4;

ok('the box starts too short to show a long answer without scrolling',
   box.scrollHeight > box.clientHeight + BORDER_SLACK, 'scrollHeight=' + box.scrollHeight + ' clientHeight=' + box.clientHeight);

wireEdGrow(host);

ok('after wiring, the box grows tall enough that nothing is clipped',
   box.scrollHeight <= box.clientHeight + BORDER_SLACK, 'scrollHeight=' + box.scrollHeight + ' clientHeight=' + box.clientHeight);
ok('the box has no scrollbar to hide the rest of the message',
   getComputedStyle(box).overflowY === 'hidden');
ok('the resize handle is gone — height now tracks content, not a manual drag',
   getComputedStyle(box).resize === 'none');

var beforeTyping = box.clientHeight;
box.value += '\\n\\nUpdate: the technician is booked for Thursday.\\n\\nUpdate 2: parts are on order.';
box.dispatchEvent(new Event('input'));
ok('typing more into the box grows it further, live',
   box.clientHeight > beforeTyping, 'before=' + beforeTyping + ' after=' + box.clientHeight);
ok('and still nothing is clipped after the box has grown again',
   box.scrollHeight <= box.clientHeight + BORDER_SLACK, 'scrollHeight=' + box.scrollHeight + ' clientHeight=' + box.clientHeight);

// A short answer must not be forced taller than it needs — only the empty-box floor from CSS.
var host2 = document.getElementById('host');
host2.innerHTML += edRow('Note', edText('ed-short', 'ok', true), true);
wireEdGrow(host2);
var shortBox = document.getElementById('ed-short');
ok('a short answer keeps the normal minimum height rather than growing for no reason',
   shortBox.clientHeight <= 90, 'clientHeight=' + shortBox.clientHeight);

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-answer-box-')), 'panel.html');
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
  console.log(result.replace('RESULT ', '') + ' (answer box fits text, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
