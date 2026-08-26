// Dragging a table into a workspace — driven in a real browser, on the real handlers.
//
// workspace-move.test.js covers the pure part: which workspaces exist, what a typed name
// becomes, what the two menus offer. None of that proves the drag WORKS. The helpers can
// all be right while the row never lifts, the fold never accepts a drop, or the ＋ row is
// left behind in the rail after the drop rebuilt it — every one of which reads to a person
// as "the feature does nothing".
//
// So this file lifts dragstart/dragover/drop/dragend out of index.html and fires real
// DragEvents at them, with moveTableToWorkspace stubbed to record what it was asked to
// write. The assertions are about the write and about the rail's state afterwards.
//
// Needs headless Chrome, so it skips rather than fails when Chrome is not installed:
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/workspace-move.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in index.html');

let pass = 0, fail = 0;
function src_ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
// The drop target for the top level is markup, not script: Main renders flat, so the
// rail's own "Workspace" label is the only thing standing in for it.
src_ok('the rail\'s Workspace label is identified so it can take a drop', /id="ws-top"/.test(src));
src_ok('and it says what dropping on it does', /Drop a table here to move it to the top level/.test(src));

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log(pass + ' source checks passed, ' + fail + ' failed. SKIPPED the browser half: no Chrome or Edge found (set CHROME=<path>).');
  process.exit(fail ? 1 : 0);
}

function grab(name) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('could not find function ' + name);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
function grabLine(re, what) {
  const m = js.match(re);
  if (!m) throw new Error('could not find ' + what);
  return m[0];
}
const fns = grabLine(/var WS_OLD = [\s\S]*?;/, 'the WS_ names') + '\n' +
            grabLine(/var wsDragTable = null;/, 'the drag state') + '\n' +
            ['tableWorkspace', 'wsCompare', 'groupByWorkspace', 'workspaceNames', 'resolveWorkspaceName',
             'endWsDrag', 'wireWsDragSource', 'wireWsDrop', 'showNewWorkspaceRow', 'hideNewWorkspaceRow',
             'promptNewWorkspace'].map(grab).join('\n');

// A rail with the shape the real one has: two tables at the top level, an Operate fold and
// an OLD fold, and the "Workspace" label above the lot.
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<aside class="sidebar">
  <div class="side-label" id="ws-top" title="Drop a table here to move it to the top level">Workspace</div>
  <nav class="side-list" id="side-tables">
    <span id="custom-tables-slot"></span>
  </nav>
</aside>
<pre id="out"></pre>
<script>
${fns}
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

// ---- the page's own world, stubbed down to what the handlers touch ----------
var TABLES = [
  { id: 'a', name: 'Alpha', workspace: 'Main' },
  { id: 'b', name: 'Beta', workspace: 'Main' },
  { id: 'o', name: 'Old one', workspace: 'OLD (Airtable)' },
  { id: 'p', name: 'Task one', workspace: 'Operate' }
];
function browsableTables() { return TABLES; }
var writes = [];
function moveTableToWorkspace(t, ws) { writes.push(t.id + ' -> ' + ws); }
var answer = null;
window.prompt = function () { return answer; };
// Set by loadRole, which is a separate query from the one that draws the rail. The point
// of the two tests at the bottom is that this can still be false when a row is drawn.
var isAdmin = true;

// The rail, built the way loadCustomTables builds it, using the real wiring calls.
var slot = document.getElementById('custom-tables-slot');
var rows = {}, folds = {};
groupByWorkspace(TABLES).forEach(function (ws) {
  var host = slot;
  if (!ws.flat) {
    var head = document.createElement('button');
    head.className = 'side-item side-ws';
    head.innerHTML = '<span class="side-label">' + ws.name + '</span>';
    wireWsDrop(head, ws.name);
    folds[ws.name] = head;
    var wrap = document.createElement('span');
    wrap.className = 'side-cat-items';
    slot.appendChild(head); slot.appendChild(wrap);
    host = wrap;
  }
  ws.items.forEach(function (t) {
    var b = document.createElement('button');
    b.className = 'side-item';
    b.setAttribute('data-custom', t.id);
    b.innerHTML = '<span class="side-label">' + t.name + '</span><span class="side-gear">\\u22ef</span>';
    b.draggable = true;
    wireWsDragSource(b, t);
    rows[t.id] = b;
    host.appendChild(b);
  });
});
wireWsDrop(document.getElementById('ws-top'), WS_MAIN);

// ---- real DragEvents at the real handlers -----------------------------------
// Which of these a real browser lets you cancel, per the HTML drag-and-drop spec:
// dragstart, dragover, dragleave and drop are cancelable, dragend is not. Getting this
// wrong makes a preventDefault in the page look like it did nothing.
var CANCELABLE = { dragstart: 1, dragover: 1, dragleave: 1, drop: 1 };
function ev(type, target, dt) {
  var e = new DragEvent(type, { bubbles: true, cancelable: !!CANCELABLE[type], dataTransfer: dt });
  target.dispatchEvent(e);
  return e;
}
function drag(from, to, opts) {
  opts = opts || {};
  var dt = new DataTransfer();
  ev('dragstart', from, dt);
  var over = ev('dragover', to, dt, true);
  if (!opts.stopAtOver) {
    ev('drop', to, dt, true);
    if (!opts.noDragEnd) ev('dragend', from, dt);
  }
  return over;
}
function newRow() { return document.getElementById('ws-new-drop'); }

// ---- dropping a table on a fold ---------------------------------------------
writes = [];
drag(rows.a, folds['OLD (Airtable)']);
ok('dropping a table on a workspace fold moves it there',
   writes.join('|') === 'a -> OLD (Airtable)', writes.join('|') || '(nothing was written)');

writes = [];
drag(rows.o, folds['OLD (Airtable)']);
ok('dropping a table on the workspace it is already in writes nothing',
   writes.length === 0, writes.join('|'));

// ---- the highlight promises only what will happen ---------------------------
var over = drag(rows.a, folds.Operate, { stopAtOver: true });
ok('a fold you are over accepts the drop', over.defaultPrevented);
ok('and outlines while you are over it', folds.Operate.classList.contains('ws-drop-over'));
folds.Operate.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
ok('and stops when you leave it', !folds.Operate.classList.contains('ws-drop-over'));
endWsDrag();

over = drag(rows.o, folds['OLD (Airtable)'], { stopAtOver: true });
ok('the fold a table is already in does not accept the drop', !over.defaultPrevented);
ok('and does not outline, so nothing promises a move that will not happen',
   !folds['OLD (Airtable)'].classList.contains('ws-drop-over'));
endWsDrag();

// ---- the row you picked up ---------------------------------------------------
var dt0 = new DataTransfer();
ev('dragstart', rows.a, dt0);
ok('the row you are carrying fades', rows.a.classList.contains('ws-dragging'));
ok('and the New workspace row appears while you carry it', !!newRow());
ok('which says what it is for', /New workspace/.test(newRow().textContent));
ok('and sits at the bottom of the rail',
   newRow() === document.getElementById('side-tables').lastElementChild,
   String(document.getElementById('side-tables').lastElementChild.className));
ev('dragend', rows.a, dt0);
ok('dropping nowhere puts the rail back as it was', !newRow() && !rows.a.classList.contains('ws-dragging'));

// ---- making a workspace by dropping on it ------------------------------------
writes = []; answer = 'Head   Office ';
drag(rows.a, (ev('dragstart', rows.a, new DataTransfer()), newRow()));
ok('dropping on the New workspace row makes the workspace the name says',
   writes.join('|') === 'a -> Head Office', writes.join('|') || '(nothing was written)');

writes = []; answer = '';
ev('dragstart', rows.a, new DataTransfer());
drag(rows.a, newRow());
ok('cancelling the name writes nothing rather than a workspace called ""',
   writes.length === 0, writes.join('|'));

writes = []; answer = 'old (airtable)';
ev('dragstart', rows.a, new DataTransfer());
drag(rows.a, newRow());
ok('typing a name that exists in another case lands in the one that exists',
   writes.join('|') === 'a -> OLD (Airtable)', writes.join('|'));

// ---- getting back out to the top level ---------------------------------------
writes = [];
drag(rows.o, document.getElementById('ws-top'));
ok('dropping on the Workspace label moves a table to the top level',
   writes.join('|') === 'o -> Main', writes.join('|') || '(nothing was written)');

writes = [];
var overTop = drag(rows.a, document.getElementById('ws-top'), { stopAtOver: true });
ok('a table already at the top level cannot be dropped there again', !overTop.defaultPrevented);
endWsDrag();

// ---- the drop rebuilds the rail, so dragend may never arrive -------------------
// This is the one that leaves a ＋ row and a half-faded table sitting in the sidebar
// until the next reload, which is what "the drag broke my sidebar" looks like.
ev('dragstart', rows.b, new DataTransfer());
ok('the New workspace row is up', !!newRow());
ev('drop', folds.Operate, new DataTransfer(), true);
ok('after a drop the New workspace row is gone even with no dragend', !newRow());
ok('and the row that was carried is not left faded', !rows.b.classList.contains('ws-dragging'));
ok('and nothing is left outlined',
   document.querySelectorAll('.ws-drop-over').length === 0);
ok('and the page is no longer in drag mode', !document.body.classList.contains('ws-dragging-on'));

// ---- who may lift a row, and when that is decided -----------------------------
// showApp() fires loadRole() and loadCustomTables() without ordering them, so the rail is
// regularly drawn before the app knows the role. Every row below was drawn while isAdmin
// was true and is now being dragged as a reviewer, and vice versa — which is exactly the
// pair of orderings a real boot produces.
isAdmin = false;
writes = [];
var lift = ev('dragstart', rows.b, new DataTransfer());
ok('a reviewer cannot lift a row', lift.defaultPrevented);
ok('and no New workspace row appears for them', !newRow());
ev('drop', folds.Operate, new DataTransfer(), true);
ok('and a drop they somehow reach writes nothing', writes.length === 0, writes.join('|'));
endWsDrag();

isAdmin = true;
writes = [];
drag(rows.b, folds.Operate);
ok('the same row, drawn before the role was known, lifts once the role arrives',
   writes.join('|') === 'b -> Operate', writes.join('|') || '(nothing was written)');

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
<\/script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-ws-move-')), 'drag.html');
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
  console.log(pass + ' passed, ' + fail + ' failed (workspace drag, in ' + path.basename(chrome) + ')');
  if (fail) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
