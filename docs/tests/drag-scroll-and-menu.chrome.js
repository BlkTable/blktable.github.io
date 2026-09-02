// Reaching what is below the fold — the drag that will not scroll, and the ⋯ menu that
// opens off the bottom of the screen.
//
// Two complaints, one shape: the thing you need is under the edge of the window and
// nothing will bring it up.
//
//   * Drag a question in a form with sixty of them, or a table in a rail with two hundred.
//     You reach the bottom of the screen still holding the row and everything stops —
//     an HTML5 drag scrolls nothing by itself.
//   * Press the ⋯ on the LAST row of the sidebar. openFormMenu placed the menu at
//     r.bottom + 6 with no check that it fits, and #form-menu is position:fixed, so the
//     half below the fold could not be scrolled to at all. A form's menu carries one line
//     per workspace, so it is regularly taller than the window on its own.
//
// Neither is provable from node: both are geometry, on a real window, at a real scroll
// position. So this file drives them in headless Chrome, and skips rather than fails when
// there is no Chrome:
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/drag-scroll-and-menu.chrome.js
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
// The drag half is wired once, on the document, rather than onto each draggable: the rail
// and the question editor are two different drags today and neither should have to
// remember this, nor should the third one when it arrives.
src_ok('drag scrolling is wired once, on the document', /document\.addEventListener\("dragover", function \(e\) \{[\s\S]{0,400}?dragScrollStep/.test(js));
src_ok('and a finished drag stops it', /document\.addEventListener\("dragend", dragScrollStop, true\);/.test(js));
src_ok('and so does a drop, which may be the only one of the two that arrives',
       /document\.addEventListener\("drop", dragScrollStop, true\);/.test(js));
// Both menus place through the same helper. placeRecMenu already flipped above the button;
// the sidebar's did not, and the fix is one placement rather than a second copy of it.
src_ok('the per-record ⋯ places through the shared helper', /function placeRecMenu\([\s\S]{0,300}?placeMenuInView\(/.test(js));
src_ok('and so does the sidebar\'s ⋯', /function openFormMenu\([\s\S]*?placeMenuInView\(anchor, menu/.test(js));
src_ok('a menu that cannot fit scrolls itself', /#form-menu \{[^}]*overflow-y: auto/.test(style));
src_ok('and so does the per-record one', /\.rec-actions \{[^}]*overflow-y: auto/.test(style));

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
const fns = grabLine(/var DRAG_EDGE = [\s\S]*?;/, 'the drag-scroll constants') + '\n' +
            grabLine(/var dragScroll = \{[\s\S]*?\};/, 'the drag-scroll state') + '\n' +
            ['scrollableAt', 'dragScrollStep', 'dragScrollStop', 'wireDragScroll',
             'placeMenuInView', 'openFormMenu', 'closeFormMenu'].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style>
<style>
  html, body { height: 100%; }
  #tall { height: 4000px; }
</style></head><body>
<div class="app" id="app" style="display:flex;">
  <div class="workspace">
    <aside class="sidebar">
      <div class="side-scroll" id="side-scroll">
        <div class="side-group">
          <nav class="side-list" id="side-tables"></nav>
        </div>
      </div>
    </aside>
    <div class="main" id="main"><div class="view-body"><div id="tall"></div></div></div>
  </div>
</div>
<!-- The question editor, as the builder modal draws it: the OVERLAY is the scroller, not
     the card inside it, which is the distinction a reorder drag has to get right. -->
<div class="modal-overlay" id="bld-modal"><div class="modal"><div id="bld-fields"></div></div></div>
<!-- A corner that scrolls nothing of its own, and enough page under the app to scroll. -->
<div id="plain" style="position:fixed;right:0;bottom:0;width:70px;height:70px;"></div>
<div id="pagetail" style="height:1500px;"></div>
<ul id="form-menu"></ul>
<pre id="out"></pre>
<script>
${fns}
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
// Timers, not frames: requestAnimationFrame does not tick in headless Chrome under a
// virtual time budget, which is also why the scroll loop itself runs off setTimeout.
function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

// ---- the page's own world, stubbed down to what the menu touches -------------
// None of these are what is under test: the subject is where the menu lands.
var WORKSPACES = [];
for (var w = 1; w <= 18; w++) WORKSPACES.push('Workspace ' + w);
var customTables = [];
for (var i = 1; i <= 40; i++) customTables.push({ id: 't' + i, name: 'Table ' + i, slug: 't' + i, kind: 'form', workspace: 'Main' });
function esc(s) { return String(s == null ? '' : s); }
function browsableTables() { return customTables; }
function tableWorkspace() { return 'Main'; }
function workspaceNames() { return WORKSPACES; }
var MOVE_TARGETS = WORKSPACES;
function workspaceMoveTargets() { return MOVE_TARGETS; }
function wsMoveLabel(w) { return 'Move to ' + w; }
function isArchived() { return false; }

var rail = document.getElementById('side-tables');
customTables.forEach(function (t) {
  var b = document.createElement('button');
  b.className = 'side-item';
  b.setAttribute('data-custom', t.id);
  b.innerHTML = '<span class="side-label">' + t.name + '</span><span class="side-gear" title="Options">\\u22ef</span>';
  rail.appendChild(b);
});
document.getElementById('side-tables').classList.add('show-gears');
var rows = [].slice.call(rail.querySelectorAll('.side-item'));
var firstRow = rows[0], lastRow = rows[rows.length - 1];
var scroller = document.getElementById('side-scroll');
var menu = document.getElementById('form-menu');
function gearOf(row) { return row.querySelector('.side-gear'); }
function fits(el) {
  var r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight + 0.5 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
}

(async function () {

// ============ A. the ⋯ on the last row =======================================
// The rail is scrolled to its end, which is the only way the last row is on screen —
// and it puts that row hard against the bottom of the window, which is the whole bug.
scroller.scrollTop = scroller.scrollHeight;
await wait(30);

MOVE_TARGETS = WORKSPACES;           // a long menu: one line per workspace
closeFormMenu();
openFormMenu(gearOf(lastRow), lastRow);
ok('the menu opened at all', menu.classList.contains('open') && menu.querySelectorAll('li').length > 10,
   menu.querySelectorAll('li').length + ' entries');
ok('a long menu on the last row is inside the window', fits(menu),
   JSON.stringify(menu.getBoundingClientRect().toJSON ? menu.getBoundingClientRect().toJSON() : {}) +
   ' window ' + window.innerHeight);
// The complaint in one assertion: every option can be reached.
var lis = [].slice.call(menu.querySelectorAll('li'));
var lastLi = lis[lis.length - 1];
menu.scrollTop = menu.scrollHeight;
ok('and its last option can be scrolled to',
   lastLi.getBoundingClientRect().bottom <= window.innerHeight + 0.5,
   'last option bottom ' + Math.round(lastLi.getBoundingClientRect().bottom) + ' of ' + window.innerHeight);
ok('and it is the menu itself that scrolls, not the page',
   ['auto', 'scroll'].indexOf(getComputedStyle(menu).overflowY) !== -1, getComputedStyle(menu).overflowY);

MOVE_TARGETS = [];                   // a short menu, the everyday case
closeFormMenu();
openFormMenu(gearOf(lastRow), lastRow);
var gr = gearOf(lastRow).getBoundingClientRect(), mr = menu.getBoundingClientRect();
ok('a short menu on the last row flips above the button', mr.bottom <= gr.top + 0.5,
   'menu bottom ' + Math.round(mr.bottom) + ', button top ' + Math.round(gr.top));
ok('and is inside the window', fits(menu));

scroller.scrollTop = 0;
await wait(30);
closeFormMenu();
openFormMenu(gearOf(firstRow), firstRow);
gr = gearOf(firstRow).getBoundingClientRect(); mr = menu.getBoundingClientRect();
ok('a menu with room below it still opens downwards', mr.top >= gr.bottom - 0.5,
   'menu top ' + Math.round(mr.top) + ', button bottom ' + Math.round(gr.bottom));
ok('and is inside the window', fits(menu));
ok('and sits under its own button rather than adrift', Math.abs(mr.left - gr.left) < 200,
   'menu left ' + Math.round(mr.left) + ', button left ' + Math.round(gr.left));
closeFormMenu();

// ============ B. scrolling while you drag ====================================
wireDragScroll();
var box = scroller;
box.scrollTop = 0;
await wait(30);
var br = box.getBoundingClientRect();
function over(y) {
  document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true,
    clientX: Math.round(br.left + br.width / 2), clientY: y }));
}
ok('the rail is a scroller with more in it than fits', box.scrollHeight > box.clientHeight + 1,
   box.scrollHeight + ' in ' + box.clientHeight);

// Holding the row against the bottom edge of the rail.
over(br.bottom - 6);
await wait(120);
ok('dragging to the bottom edge scrolls the list down', box.scrollTop > 0, 'scrollTop ' + box.scrollTop);

// Held there, it keeps going — the pointer stops moving the moment you are waiting for
// the list to come to you, and that is exactly when this has to keep working.
var was = box.scrollTop;
over(br.bottom - 6);
await wait(150);
ok('and keeps scrolling while it is held there', box.scrollTop > was, was + ' -> ' + box.scrollTop);

// Back the other way.
was = box.scrollTop;
over(br.top + 6);
await wait(150);
ok('dragging to the top edge scrolls it back up', box.scrollTop < was, was + ' -> ' + box.scrollTop);

// The middle of the list is not an edge.
box.scrollTop = 100;
over(br.top + br.height / 2);
await wait(150);
ok('the middle of the list does not scroll at all', box.scrollTop === 100, 'scrollTop ' + box.scrollTop);

// A finished drag must not leave the list creeping.
box.scrollTop = 0;
over(br.bottom - 6);
await wait(50);
document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
await wait(30);
was = box.scrollTop;
await wait(300);
ok('a dropped row stops the scrolling', box.scrollTop === was, was + ' -> ' + box.scrollTop);

box.scrollTop = 0;
over(br.bottom - 6);
await wait(50);
document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await wait(30);
was = box.scrollTop;
await wait(300);
ok('and so does letting go of it over nothing', box.scrollTop === was, was + ' -> ' + box.scrollTop);

// A drag that leaves the window sends no more dragover and may send no dragend either.
box.scrollTop = 0;
over(br.bottom - 6);
await wait(700);                  // longer than the staleness guard allows
was = box.scrollTop;
await wait(300);
ok('a drag that goes quiet stops rather than scrolling to the end for ever',
   box.scrollTop === was && box.scrollTop < box.scrollHeight - box.clientHeight,
   was + ' -> ' + box.scrollTop + ' of ' + (box.scrollHeight - box.clientHeight));

// It is the box UNDER THE POINTER that moves, not the one the row came out of: carrying a
// table across to the main pane must scroll the pane, and leave the rail where it was.
var main = document.getElementById('main');
var mr2 = main.getBoundingClientRect();
box.scrollTop = 0; main.scrollTop = 0;
document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true,
  clientX: Math.round(mr2.left + mr2.width / 2), clientY: Math.round(mr2.bottom - 6) }));
await wait(150);
ok('the box under the pointer is the one that scrolls', main.scrollTop > 0, 'main scrollTop ' + main.scrollTop);
ok('and the list you came from stays where it was', box.scrollTop === 0, 'rail scrollTop ' + box.scrollTop);
document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));

// The other drag in the app: a question being reordered in a form with sixty questions.
// The modal card itself does not scroll — its overlay does — so a walk that stopped at the
// nearest positioned box would find nothing and the editor would stay exactly as stuck.
var overlay = document.getElementById('bld-modal');
var host = document.getElementById('bld-fields');
for (var q = 1; q <= 60; q++) {
  var f = document.createElement('div');
  f.className = 'bld-field';
  f.innerHTML = '<div class="r1"><span class="bld-drag">\\u283f</span><textarea class="lab" rows="1">Question ' + q + '</textarea></div>';
  host.appendChild(f);
}
overlay.classList.add('open');
await wait(30);
overlay.scrollTop = 0;
ok('the question editor has more in it than fits', overlay.scrollHeight > overlay.clientHeight + 1,
   overlay.scrollHeight + ' in ' + overlay.clientHeight);
document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true,
  clientX: Math.round(window.innerWidth / 2), clientY: window.innerHeight - 6 }));
await wait(150);
ok('dragging a question to the bottom of the screen scrolls the editor', overlay.scrollTop > 0,
   'overlay scrollTop ' + overlay.scrollTop);
document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
overlay.classList.remove('open');
await wait(30);

// Over something that scrolls nothing of its own, the page is what moves. Which element
// that is cannot be assumed: this page sets overflow-x: hidden on html AND body, which
// makes body the scroller and leaves document.scrollingElement measuring nothing at all.
document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
var pr = document.getElementById('plain').getBoundingClientRect();
var px = Math.round(pr.left + pr.width / 2), py = Math.round(pr.bottom - 6);
var hit = scrollableAt(px, py);
document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: px, clientY: py }));
await wait(150);
ok('over a box that does not scroll, the page does',
   document.documentElement.scrollTop > 0 || document.body.scrollTop > 0,
   'html ' + document.documentElement.scrollTop + ', body ' + document.body.scrollTop +
   '; scrollableAt gave ' + (hit ? (hit.id || hit.tagName) : 'nothing'));
document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
})().catch(function (err) {
  out.push('FAIL the page threw -> ' + (err && err.stack || err));
  out.push('RESULT ' + pass + ' passed, ' + (fail + 1) + ' failed');
  document.getElementById('out').textContent = out.join('\\n');
});
<\/script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-drag-scroll-')), 'drag.html');
fs.writeFileSync(file, page);
const url = 'file:///' + file.replace(/\\/g, '/');
const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--window-size=1100,700',
                                  '--virtual-time-budget=8000', '--dump-dom', url],
                         { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dom = run.stdout || '';
const block = (dom.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (!block || !/RESULT/.test(block)) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 2000));
  process.exitCode = 1;
} else {
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  const m = result.match(/(\d+) passed, (\d+) failed/) || [0, 0, 1];
  pass += Number(m[1]); fail += Number(m[2]);
  console.log(pass + ' passed, ' + fail + ' failed (drag scrolling and menu placement, in ' + path.basename(chrome) + ')');
  if (fail) process.exitCode = 1;
}
// KEEP_PAGE=1 leaves the harness page on disk and names it, for opening in a real browser
// when something in it throws and the dump comes back empty.
if (process.env.KEEP_PAGE) console.log('page kept at ' + file);
else try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
