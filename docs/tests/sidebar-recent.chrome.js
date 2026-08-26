// The sidebar in last-opened order — driven in a real browser, on the real markup.
//
// sidebar-groups.test.js covers what the rail is GROUPED by; this file covers what it is
// ORDERED by, which is a DOM operation and nothing else. Every rule here is about a line
// arriving somewhere it should not:
//
//   * a fold re-ordered away from the tables it holds (head and contents are separate
//     siblings, so a naive sort splits them and the group opens onto nothing),
//   * #ja-kids left behind when the Job Applications line moves, which would draw its
//     country list under whichever table happened to take its place,
//   * the OLD workspace — 219 migrated tables, deliberately folded and last — lifted over
//     the handful of tables somebody actually works in, because one of them was opened,
//   * and the first rule of all: a rail nobody has opened yet must look exactly as it
//     does today, or this is a silent reshuffle of a sidebar people know by position.
//
// It also holds the two removals that came with it, read out of index.html as source: the
// "＋ Create new…" line in the view rail (the ＋ Create button at the foot of the rail
// offers the same three view types) and the branch list under a table (the standard Filter
// does that job now). Both are the kind of thing that comes back by accident.
//
// Needs headless Chrome, so it skips rather than fails when Chrome is not installed:
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/sidebar-recent.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in index.html');

// ---- what index.html must (and must not) say --------------------------------
// These run with or without Chrome: they are the removals, and a removal that quietly
// comes back is exactly what a source assertion is for.
let pass = 0, fail = 0;
function src_ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
src_ok('the view rail has no "＋ Create new…" line', js.indexOf('vk-new') === -1 && src.indexOf('＋ Create new') === -1);
src_ok('and Help does not still send people to it', !/Create new[^<]*<\/b> under the table/.test(src));
src_ok('and the ＋ Create button still offers the view types',
       /View of/.test(js) && /side-create/.test(js) && /saveCurrentView\(\)/.test(js));
src_ok('no branch list is built under a table', js.indexOf('side-kid-branches') === -1 && src.indexOf('All branches') === -1);
src_ok('and no sidebar line carries a branch to scope to', js.indexOf('data-b="') === -1);
src_ok('the countries under a table are untouched', /side-kid-countries/.test(js) && /All countries/.test(src));
// The "Create new…" line was what kept this rail non-empty. Without it, a table with no
// saved views and one country would show an empty rail — 6px of nothing under the line
// you just pressed, on most of the 226 tables.
src_ok('an empty rail is hidden rather than left as a gap',
       /kids\.style\.display = kids\.innerHTML \? "flex" : "none"/.test(js));
src_ok('opening a table re-orders the rail there and then',
       /function markOpened\([\s\S]{0,400}?sortSideByRecent\(\)/.test(js));
src_ok('and a reload re-parents the built-in lines into the sorted stream',
       /function loadCustomTables\([\s\S]*?builtinSideNodes\(\)[\s\S]*?sortSideByRecent\(slot\)/.test(js));

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log(pass + ' source checks passed, ' + fail + ' failed. SKIPPED the browser half: no Chrome or Edge found (set CHROME=<path>).');
  process.exit(fail ? 1 : 0);
}

// Brace-matched, so a one-line function comes out whole.
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
// The two lists the sort leans on are `var`s, not functions, and a test that re-typed them
// would go on passing after the page changed its mind. Lift them out of the source too.
function grabVar(name) {
  const m = js.match(new RegExp('var ' + name + ' = \\[[\\s\\S]*?\\];'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
const fns = ['sideStamp', 'sortSideByRecent', 'builtinSideNodes'].map(grab).join('\n') +
            '\n' + grabVar('SIDE_ATTACH') + '\n' + grabVar('BUILTIN_SIDE') + '\n';

// The real sidebar markup: the two built-in lines with their rails, and a slot holding a
// flat pair, a category fold and a workspace fold — which is what a real rail looks like.
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<aside class="sidebar"><nav class="side-list" id="side-tables">
  <button class="side-item" data-view="job_applications"><span class="side-label">Job Applications</span><span class="side-caret" id="ja-caret">▸</span></button>
  <div class="side-kids" id="ja-kids" style="display:none;"></div>
  <div class="side-kids" id="custom-kids" style="display:none;"></div>
  <button class="side-item" data-view="casting"><span class="side-label">BLK Casting</span></button>
  <span id="custom-tables-slot">
    <button class="side-item" data-custom="t-alpha"><span class="side-label">Alpha</span></button>
    <button class="side-item" data-custom="t-beta"><span class="side-label">Beta</span></button>
    <button class="side-item side-cat"><span class="side-label">QC</span></button>
    <span class="side-cat-items"
      ><button class="side-item" data-custom="t-qc1"><span class="side-label">QC one</span></button
      ><button class="side-item" data-custom="t-qc2"><span class="side-label">QC two</span></button
    ></span>
    <button class="side-item side-ws"><span class="side-label">OLD (Airtable)</span></button>
    <span class="side-cat-items"
      ><button class="side-item" data-custom="t-old1"><span class="side-label">Old one</span></button
      ><button class="side-item" data-custom="t-old2"><span class="side-label">Old two</span></button
    ></span>
  </span>
</nav></aside>
<pre id="out"></pre>
<script>
${fns}
var lastOpened = {};
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
var slot = document.getElementById('custom-tables-slot');
// What loadCustomTables does around the render: lift the built-in lines out, put them back
// at the head of the slot, then order the whole rail.
var builtins = builtinSideNodes();
builtins.forEach(function (n) { slot.parentNode.insertBefore(n, slot); });
builtins.slice().reverse().forEach(function (n) { slot.insertBefore(n, slot.firstChild); });

// Every line in the rail, top to bottom, named the way a person reads it.
function rail() {
  return [].slice.call(slot.children).map(function (n) {
    if (n.id) return '#' + n.id;
    if (n.classList.contains('side-cat-items')) return '(contents)';
    return n.getAttribute('data-custom') || n.getAttribute('data-view') ||
           n.querySelector('.side-label').textContent;
  }).join(' ');
}
function inside(wrapAt) {
  return [].slice.call(slot.children[wrapAt].children).map(function (n) {
    return n.getAttribute('data-custom');
  }).join(' ');
}
function open(key, when) { lastOpened[key] = when; sortSideByRecent(slot); }

// ---- a rail nobody has opened is the rail we have today ---------------------
sortSideByRecent(slot);
ok('nothing opened: the arrival order is kept exactly',
   rail() === 'job_applications #ja-kids casting t-alpha t-beta QC (contents) OLD (Airtable) (contents)', rail());

// ---- the last thing opened is on top ----------------------------------------
open('t-beta', '2026-08-26T09:00:00Z');
ok('a table you opened comes first', rail().split(' ')[0] === 't-beta', rail());
ok('and the lines nobody opened keep their own order',
   rail() === 't-beta job_applications #ja-kids casting t-alpha QC (contents) OLD (Airtable) (contents)', rail());
open('t-alpha', '2026-08-26T10:00:00Z');
ok('the newer of two opened tables is above the older',
   rail().indexOf('t-alpha') < rail().indexOf('t-beta'), rail());

// ---- a built-in line is in the same stream, and takes its rail with it ------
open('job_applications', '2026-08-26T11:00:00Z');
ok('a built-in table rises like any other', rail().split(' ')[0] === 'job_applications', rail());
ok('and #ja-kids moves with it, still directly underneath',
   rail().split(' ')[1] === '#ja-kids', rail());
ok('read off the DOM rather than the summary: the rail is that line\\'s next sibling',
   document.getElementById('ja-kids').previousElementSibling.getAttribute('data-view') === 'job_applications',
   String(document.getElementById('ja-kids').previousElementSibling.className));

// ---- a fold moves as one piece, and re-orders inside itself -----------------
ok('the category fold sits above the workspace fold while neither is opened',
   rail().indexOf('QC') < rail().indexOf('OLD (Airtable)'), rail());
open('t-qc2', '2026-08-26T12:00:00Z');
ok('opening a table inside a fold lifts the fold to the top', rail().split(' ')[0] === 'QC', rail());
ok('and its contents are still the very next line', rail().split(' ')[1] === '(contents)', rail());
ok('inside the fold, the opened table is first', inside(1) === 't-qc2 t-qc1', inside(1));

// ---- the OLD workspace stays where it is -----------------------------------
open('t-old2', '2026-08-26T13:00:00Z');
ok('opening a migrated table does NOT lift the OLD fold over the daily set',
   rail().indexOf('OLD (Airtable)') === rail().lastIndexOf('OLD (Airtable)') &&
   rail().split(' ').indexOf('OLD') === rail().split(' ').length - 3, rail());
ok('but inside OLD it is first, so it is easy to find again', inside(rail().split(' ').length - 2) === 't-old2 t-old1',
   inside(rail().split(' ').length - 2));

// ---- the open table's own rail follows it -----------------------------------
var kids = document.getElementById('custom-kids');
var alpha = slot.querySelector('[data-custom="t-alpha"]');
alpha.parentNode.insertBefore(kids, alpha.nextSibling);   // what renderCustomScope does
open('t-alpha', '2026-08-26T14:00:00Z');
ok('the open table is on top with its own rail under it',
   rail().split(' ')[0] === 't-alpha' && rail().split(' ')[1] === '#custom-kids', rail());

// ---- a stamp is read off the tables, not off the fold heading --------------
ok('a fold heading on its own carries no stamp', sideStamp([slot.querySelector('.side-cat')]) === '');
ok('a fold takes the newest stamp of what is inside it',
   sideStamp([slot.querySelector('.side-cat-items')]) === '2026-08-26T12:00:00Z',
   sideStamp([slot.querySelector('.side-cat-items')]));

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
<\/script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-sidebar-recent-')), 'rail.html');
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
  const m = result.match(/(\d+) passed, (\d+) failed/) || [0, 0, 1];
  pass += Number(m[1]); fail += Number(m[2]);
  console.log(pass + ' passed, ' + fail + ' failed (sidebar order, in ' + path.basename(chrome) + ')');
  if (fail) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
