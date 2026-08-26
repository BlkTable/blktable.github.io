// Moving a table between workspaces — by dragging it, or from either ⋯ menu.
//
// The thing to keep in mind reading this: THERE IS NO WORKSPACES TABLE. A workspace is
// nothing but the distinct string sitting in app_tables.workspace, so it comes into
// existence the moment a table names it and stops existing the moment the last table
// leaves. That is deliberate — it makes "create" and "delete" the same one-column write
// as "move" — but it means two rules have to hold or the sidebar grows junk:
//
//   1. A name that differs only in case or spacing from one that already exists must land
//      in THAT workspace. "hr" typed once and "HR" typed again would otherwise be two
//      folds side by side holding what the user thinks is one thing.
//   2. Both ⋯ menus have to offer the same list, built from what actually exists plus the
//      three the app names itself — a menu hard-coded to Main/Operate/OLD can never reach
//      a workspace somebody invented, which makes drag the only way back out of one.
//
// sidebar-groups.test.js covers what the rail is grouped by and sidebar-recent.chrome.js
// what it is ordered by; this covers what MOVES between the groups. The drag itself is a
// DOM operation and is driven for real in workspace-move.chrome.js.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const SRC_HTML = fs.readFileSync('index.html', 'utf8');
const SRC = [...SRC_HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function grab(name) {
  const at = SRC.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('no fn ' + name);
  const open = SRC.indexOf('{', at);
  let d = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') d++;
    else if (SRC[i] === '}') { d--; if (!d) return SRC.slice(at, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
// The three names the app knows itself are a var, not a function. Lift the real line out
// rather than re-typing it, so renaming a workspace in the page fails here instead of
// quietly leaving this file testing a name nothing uses.
function grabWsVars() {
  const m = SRC.match(/var WS_OLD = [\s\S]*?;/);
  if (!m) throw new Error('could not find the WS_ names');
  return m[0];
}
const names = ['tableWorkspace', 'wsCompare', 'groupByWorkspace', 'workspaceNames',
               'resolveWorkspaceName', 'workspaceMoveTargets', 'wsMoveLabel'];
const ctx = { console };
vm.createContext(ctx);
new vm.Script('(function(){' + grabWsVars() + '\n' + names.map(grab).join('\n') +
              '\nthis.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
// An array built inside the vm is not reference-equal to one built out here, so anything
// that comes back as a list is round-tripped through JSON the way sidebar-groups does.
const asW = o => JSON.parse(JSON.stringify(o === undefined ? null : o));
const raw = ctx.API;
const A = {
  tableWorkspace: raw.tableWorkspace,
  wsCompare: raw.wsCompare,
  resolveWorkspaceName: raw.resolveWorkspaceName,
  wsMoveLabel: raw.wsMoveLabel,
  groupByWorkspace: l => asW(raw.groupByWorkspace(l)),
  workspaceNames: l => asW(raw.workspaceNames(l)),
  workspaceMoveTargets: (t, e) => asW(raw.workspaceMoveTargets(t, e))
};

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const tbl = (name, workspace) => ({ id: name, name: name, workspace: workspace });

// ---- which workspaces exist -------------------------------------------------
t('the workspaces that exist are the ones tables are in, in sidebar order', () => {
  assert.deepStrictEqual(A.workspaceNames([
    tbl('a', 'OLD (Airtable)'), tbl('b', 'Zebra'), tbl('c', 'Main'),
    tbl('d', 'Admin'), tbl('e', 'Operate')
  ]), ['Main', 'Operate', 'Admin', 'Zebra', 'OLD (Airtable)']);
});

t('a workspace no table is in does not exist', () => {
  // There is nothing to delete a workspace WITH — dragging the last table out is the
  // delete, and this is the proof that it takes effect.
  const before = [tbl('a', 'Main'), tbl('b', 'Retired')];
  assert.deepStrictEqual(A.workspaceNames(before), ['Main', 'Retired']);
  const after = [tbl('a', 'Main'), Object.assign(tbl('b'), { workspace: 'Main' })];
  assert.deepStrictEqual(A.workspaceNames(after), ['Main']);
});

t('no table carries a workspace at all, so there are no names rather than one null', () => {
  // groupByWorkspace answers null here (the column is not in the database yet) and a
  // caller that mapped over it blind would put `null` in a menu.
  assert.deepStrictEqual(A.workspaceNames([tbl('a'), tbl('b')]), []);
  assert.deepStrictEqual(A.workspaceNames([]), []);
  assert.deepStrictEqual(A.workspaceNames(null), []);
});

// ---- where an invented workspace sits ---------------------------------------
const shape = gs => (gs || []).map(g => [g.name, g.items.map(x => x.name)]);

t('a workspace you invented sits between Operate and OLD', () => {
  assert.deepStrictEqual(shape(A.groupByWorkspace([
    tbl('old', 'OLD (Airtable)'), tbl('hr', 'HR'), tbl('main', 'Main'), tbl('op', 'Operate')
  ])), [['Main', ['main']], ['Operate', ['op']], ['HR', ['hr']], ['OLD (Airtable)', ['old']]]);
});

t('two invented workspaces sort A to Z between themselves', () => {
  assert.deepStrictEqual(shape(A.groupByWorkspace([
    tbl('z', 'Zebra'), tbl('a', 'Apple'), tbl('m', 'Main')
  ])).map(g => g[0]), ['Main', 'Apple', 'Zebra']);
});

t('Main is the only group that renders flat', () => {
  const gs = A.groupByWorkspace([tbl('m', 'Main'), tbl('h', 'HR'), tbl('o', 'OLD (Airtable)')]);
  assert.deepStrictEqual(gs.map(g => !!g.flat), [true, false, false]);
});

// ---- naming a new workspace -------------------------------------------------
t('surrounding and repeated whitespace is collapsed', () => {
  assert.strictEqual(A.resolveWorkspaceName('  Head   Office  ', []), 'Head Office');
});

t('a name that is empty or only whitespace is refused', () => {
  // window.prompt gives back "" on Cancel and "" on OK-with-nothing-typed, and a table
  // whose workspace is "" reads as no workspace at all — it would vanish into OLD.
  assert.strictEqual(A.resolveWorkspaceName('', []), null);
  assert.strictEqual(A.resolveWorkspaceName('   ', []), null);
  assert.strictEqual(A.resolveWorkspaceName(null, []), null);
});

t('a name that only differs in case lands in the workspace that already exists', () => {
  assert.strictEqual(A.resolveWorkspaceName('hr', ['Main', 'HR']), 'HR');
  assert.strictEqual(A.resolveWorkspaceName('  oPeRaTe ', ['Main', 'Operate']), 'Operate');
});

t('a genuinely new name is kept exactly as it was typed', () => {
  assert.strictEqual(A.resolveWorkspaceName('Events 2027', ['Main', 'HR']), 'Events 2027');
});

// ---- what the two menus offer -----------------------------------------------
t('the workspace a table is already in is not offered', () => {
  assert.ok(A.workspaceMoveTargets(tbl('x', 'Operate'), ['Main', 'Operate']).indexOf('Operate') === -1);
});

t('the three the app names itself are always offered, even when nothing is in them', () => {
  // A fresh database has every table in Main. Without this the menu offers nowhere to go
  // and drag is the only way to make the second workspace.
  assert.deepStrictEqual(A.workspaceMoveTargets(tbl('x', 'Main'), ['Main']),
                         ['Operate', 'OLD (Airtable)']);
});

t('a workspace somebody invented is offered too', () => {
  assert.deepStrictEqual(A.workspaceMoveTargets(tbl('x', 'Main'), ['Main', 'HR', 'OLD (Airtable)']),
                         ['Operate', 'HR', 'OLD (Airtable)']);
});

t('an invented name equal to a built-in one is offered once, not twice', () => {
  const out = A.workspaceMoveTargets(tbl('x', 'HR'), ['Main', 'Operate', 'OLD (Airtable)']);
  assert.deepStrictEqual(out, ['Main', 'Operate', 'OLD (Airtable)']);
});

t('targets come back in the same order the sidebar uses', () => {
  assert.deepStrictEqual(
    A.workspaceMoveTargets(tbl('x', 'Zebra'), ['OLD (Airtable)', 'Zebra', 'Apple', 'Main', 'Operate']),
    ['Main', 'Operate', 'Apple', 'OLD (Airtable)']);
});

t('Main is offered as "the top level", because the sidebar never shows the word Main', () => {
  // Main renders flat and unheaded — its tables just sit at the top of the rail beside Job
  // Applications — so a menu item reading "Move to Main" names a thing the user has never
  // seen anywhere on screen.
  assert.strictEqual(A.wsMoveLabel('Main'), 'Move to the top level');
});

t('every other workspace is offered by its own name', () => {
  assert.strictEqual(A.wsMoveLabel('OLD (Airtable)'), 'Move to OLD (Airtable)');
  assert.strictEqual(A.wsMoveLabel('Head Office'), 'Move to Head Office');
});

t('a table with no workspace at all is still offered all three', () => {
  assert.deepStrictEqual(A.workspaceMoveTargets(tbl('x'), []), ['Main', 'Operate', 'OLD (Airtable)']);
});

// ---- the wiring, read out of the page as source ------------------------------
t('a sidebar table row is draggable', () => {
  assert.ok(/b\.draggable = true/.test(SRC), 'sidebar rows never become draggable');
});

t('and whether it may be lifted is read when it is lifted, not when it is drawn', () => {
  // moveTableToWorkspace refuses a non-admin anyway, so a row that lifts for everybody is
  // an invitation to a drop that silently does nothing. But the check cannot happen at
  // render: showApp fires loadRole() and loadCustomTables() as two independent queries and
  // does not order them, so the rail is regularly built before the app knows the role. A
  // draggable decided then would be false for an admin, on a rail nothing re-renders.
  // This is the same reason the ⋯ gears are a class on the container rather than per row.
  assert.ok(/if \(!isAdmin\) \{ e\.preventDefault\(\); return; \}/.test(SRC),
            'the admin check is not made at drag time');
});

t('a workspace fold takes a drop', () => {
  assert.ok(/wireWsDrop\(head, ws\.name\)/.test(SRC), 'the workspace heading is not a drop target');
});

t('the Workspace heading takes a drop, which is how a table gets back to the top level', () => {
  // Main renders flat and has no heading of its own, so the rail's own "Workspace" label
  // stands in for it. Without this there is no way to drag anything OUT of a fold.
  assert.ok(/wireWsDrop\([^,]*ws-top[^,]*, WS_MAIN\)/.test(SRC) || /id="ws-top"/.test(SRC_HTML),
            'nothing represents the top level as a drop target');
});

t('a new workspace can be made by dropping on the last row', () => {
  assert.ok(/New workspace/.test(SRC), 'no way to create a workspace by dragging');
});

t('both menus build their Workspace section from the one list', () => {
  // The base menu used to hard-code Main/Operate/OLD. Two copies of that list is how the
  // sidebar menu ends up unable to reach a workspace the base menu can.
  const uses = (SRC.match(/workspaceMoveTargets\(/g) || []).length;
  assert.ok(uses >= 3, 'expected the base menu, the sidebar menu and the helper — found ' + uses);
});

t('both menus offer a brand new workspace, not only the ones that exist', () => {
  const uses = (SRC.match(/Move to a new workspace/g) || []).length;
  assert.strictEqual(uses, 2, 'expected both ⋯ menus to offer it, found ' + uses);
});

console.log(n + ' workspace-move tests passed');
