// Ticking several tables in the rail and acting on the lot. Reorganising 200-odd migrated
// tables through a ⋯ menu is 200 menus; this is the grid's ticked-rows-and-a-bar one level
// up, for tables instead of records.
//
// The thing this file guards hardest is what the bar CANNOT do. Deleting a table takes every
// record with it and has no undo, which is why the single delete sits behind a typed sum —
// eight of those in one press is the one action here that could not be walked back, so it was
// deliberately left off the bar and stays on the ⋯ menu, chosen table by table. A later hand
// adding "Delete selected" because it looks symmetrical is the failure this file exists for.
//
// The rest follow delete-selected.test.js: the pure helpers are tested as helpers, and the two
// writes are tested as CALLERS, with the database, the dialogs and the DOM stubbed and the
// assertions about the calls made — because a helper tested in isolation says nothing about
// who calls it and with what.
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
const SRC = scripts('index.html');
const RAW = fs.readFileSync('index.html', 'utf8');

// ---- the pure half ----------------------------------------------------------
const PURE = ['sideSelPrune', 'sideSelSummary', 'sideSelBarText', 'workspaceMoveTargetsMany',
  'archiveManyConfirmText', 'archiveConfirmText', 'workspaceMoveTargets', 'tableWorkspace',
  'wsCompare', 'wsMoveLabel', 'isArchived'];
const api = {};
{
  const ctx = { WS_MAIN: 'Main', WS_OPERATE: 'Operate', WS_OLD: 'OLD (Airtable)', out: api };
  vm.createContext(ctx);
  new vm.Script('(function(){' + PURE.map(n => grab(SRC, n, 'index.html')).join('\n') +
    '\n' + PURE.map(n => 'out.' + n + ' = ' + n + ';').join('\n') + '})()').runInContext(ctx);
}

let n = 0;
function t(name, fn) { fn(); n++; }
// Objects built inside the vm carry that realm's Object.prototype, which deepStrictEqual
// counts as a difference. Copy into this realm before comparing shapes.
const plain = o => Object.assign({}, o);
const list_ = a => Array.from(a || []);

const live = (id, name, ws) => ({ id, name, workspace: ws || null, config: {} });
const arch = (id, name, ws) => ({ id, name, workspace: ws || null, config: { archived: true } });

// ---- a selection outliving a re-render, but not the tables ------------------
t('a selection survives the rail being rebuilt', () => {
  // archiving five tables reloads the rail; the ticks on the rest have to still be there,
  // or a tidy-up of twenty tables is four separate selections
  const kept = plain(api.sideSelPrune({ a: true, b: true }, [live('a'), live('b'), live('c')]));
  assert.deepStrictEqual(kept, { a: true, b: true });
});
t('a ticked table that has left the list is dropped from the selection', () => {
  // exactly what happens when you archive with "Archived" switched off: the five you just
  // archived are no longer in customTables. Left in, the bar keeps counting them and the
  // next press writes to tables the page is no longer holding.
  const kept = plain(api.sideSelPrune({ a: true, gone: true }, [live('a')]));
  assert.deepStrictEqual(kept, { a: true });
});
t('pruning returns a new map rather than editing the one the page holds', () => {
  const before = { a: true, gone: true };
  api.sideSelPrune(before, [live('a')]);
  assert.deepStrictEqual(before, { a: true, gone: true }, 'the caller\'s map was mutated');
});
t('an unticked id is not resurrected by pruning', () => {
  assert.deepStrictEqual(plain(api.sideSelPrune({ a: false, b: true }, [live('a'), live('b')])), { b: true });
});

// ---- what the bar says ------------------------------------------------------
t('a mixed selection is counted as both halves', () => {
  const s = plain(api.sideSelSummary([live('a'), arch('b'), arch('c')]));
  assert.deepStrictEqual(s, { n: 3, live: 1, archived: 2 });
});
t('an empty selection counts nothing rather than throwing', () => {
  assert.deepStrictEqual(plain(api.sideSelSummary([])), { n: 0, live: 0, archived: 0 });
  assert.deepStrictEqual(plain(api.sideSelSummary(null)), { n: 0, live: 0, archived: 0 });
});
t('one selected table reads as singular', () => {
  assert.strictEqual(api.sideSelBarText({ n: 1 }), '1 table selected');
  assert.strictEqual(api.sideSelBarText({ n: 4 }), '4 tables selected');
  assert.strictEqual(api.sideSelBarText(null), '0 tables selected');
});

// ---- where a set can be moved ----------------------------------------------
t('the set is offered the union of where each table could go on its own', () => {
  // the bar and a single table's ⋯ menu must never offer different lists — a workspace
  // reachable from the menu but not the bar reads as the bar being broken
  const list = [live('a', 'A', 'Main'), live('b', 'B', 'HR')];
  const existing = ['Main', 'HR', 'Operate', 'OLD (Airtable)'];
  const union = [];
  list.forEach(x => api.workspaceMoveTargets(x, existing).forEach(w => {
    if (union.indexOf(w) === -1) union.push(w);
  }));
  const many = list_(api.workspaceMoveTargetsMany(list, existing));
  assert.deepStrictEqual(many.slice().sort(), union.slice().sort());
});
t('a workspace every selected table is already in is not offered', () => {
  // it would write nothing — a menu entry that does nothing reads as a failed press
  const list = [live('a', 'A', 'HR'), live('b', 'B', 'HR')];
  const many = list_(api.workspaceMoveTargetsMany(list, ['HR', 'Main']));
  assert.strictEqual(many.indexOf('HR'), -1, 'offered the workspace they are all in');
  assert.ok(many.indexOf('Main') !== -1);
});
t('a selection spanning two workspaces can still be sent to either', () => {
  const list = [live('a', 'A', 'HR'), live('b', 'B', 'Ops')];
  const many = list_(api.workspaceMoveTargetsMany(list, ['HR', 'Ops']));
  assert.ok(many.indexOf('HR') !== -1 && many.indexOf('Ops') !== -1);
});
t('the three the app names itself are offered on a fresh database', () => {
  const many = list_(api.workspaceMoveTargetsMany([live('a', 'A', null)], []));
  assert.deepStrictEqual(many, ['Main', 'Operate', 'OLD (Airtable)']);
});
t('nothing selected offers nowhere', () => {
  assert.deepStrictEqual(list_(api.workspaceMoveTargetsMany([], ['HR'])), []);
});
t('the targets come back in the rail\'s own order', () => {
  const many = list_(api.workspaceMoveTargetsMany([live('a', 'A', 'Zed')], ['Zed', 'Alpha']));
  assert.deepStrictEqual(many, ['Main', 'Operate', 'Alpha', 'OLD (Airtable)']);
});

// ---- the confirm before a bulk archive -------------------------------------
t('archiving one table from the bar asks exactly what the menu asks', () => {
  // the wording was argued over once; a second copy for the bar is a second thing to keep
  // in step, and the one that goes stale is the one that stops mentioning the QR codes
  const one = live('a', 'Wastage');
  assert.strictEqual(api.archiveManyConfirmText([one]), api.archiveConfirmText(one));
});
t('archiving several says how many, and names them', () => {
  const s = api.archiveManyConfirmText([live('a', 'Wastage'), live('b', 'Handover')]);
  assert.ok(/\b2 tables\b/.test(s), 'does not say how many');
  assert.ok(s.indexOf('Wastage') !== -1 && s.indexOf('Handover') !== -1,
    'does not name what is about to be archived');
});
t('the bulk confirm keeps all three promises the single one makes', () => {
  const s = api.archiveManyConfirmText([live('a', 'A'), live('b', 'B')]);
  assert.ok(/nothing is deleted/i.test(s), 'does not say nothing is deleted');
  assert.ok(/put them back/i.test(s), 'does not say it can be undone');
  assert.ok(/QR/.test(s) && /keep working/.test(s), 'does not say the links keep working');
});
t('a table with no name still appears in the list rather than as a blank line', () => {
  const s = api.archiveManyConfirmText([{ config: {} }, live('b', 'B')]);
  assert.ok(/unnamed/.test(s));
});

// ---- the writes, tested as callers -----------------------------------------
function rig(opts) {
  opts = opts || {};
  const log = [];
  const quiet = { log: () => {}, error: () => { log.push({ op: 'logged' }); }, warn: () => {} };
  const ctx = {
    console: quiet,
    isAdmin: opts.isAdmin !== false,
    myUserId: 'me',
    showArchived: !!opts.showArchived,
    currentCustom: opts.currentCustom || null,
    customTables: opts.customTables || [],
    WS_MAIN: 'Main', WS_OPERATE: 'Operate', WS_OLD: 'OLD (Airtable)',
    showView(v) { log.push({ op: 'view', v }); },
    loadCustomTables() { log.push({ op: 'reload' }); return Promise.resolve(); },
    openCustomTable(t) { log.push({ op: 'open', id: t.id }); },
    window: {
      confirm(msg) { log.push({ op: 'confirm', msg }); return opts.confirm !== false; },
      alert(msg) { log.push({ op: 'alert', msg }); },
      prompt(msg) { log.push({ op: 'prompt', msg }); return opts.prompt === undefined ? null : opts.prompt; },
      console: quiet
    },
    db: {
      from() {
        const q = {
          _cfg: null, _ws: undefined, _id: null, _ids: null,
          update(patch) {
            if (Object.prototype.hasOwnProperty.call(patch, 'workspace')) this._ws = patch.workspace;
            else this._cfg = patch.config;
            return this;
          },
          eq(_c, v) { this._id = v; return this; },
          in(_c, v) { this._ids = v; return this; },
          then(res, rej) {
            const entry = this._ws !== undefined
              ? { op: 'move', ws: this._ws, ids: this._ids }
              : { op: 'archive', id: this._id, archived: !!(this._cfg && this._cfg.archived) };
            log.push(entry);
            const fail = opts.failOn && opts.failOn(entry);
            return Promise.resolve(fail ? { error: { message: 'boom' } } : {}).then(res, rej);
          }
        };
        return q;
      }
    }
  };
  vm.createContext(ctx);
  const need = ['isArchived', 'archivedConfig', 'archiveConfirmText', 'archiveManyConfirmText',
    'tableWorkspace', 'setTablesArchived', 'moveTablesToWorkspace'];
  new vm.Script('(function(){' + need.map(x => grab(SRC, x, 'index.html')).join('\n') +
    '\nthis.setTablesArchived = setTablesArchived; this.moveTablesToWorkspace = moveTablesToWorkspace;})()')
    .runInContext(ctx);
  return { ctx, log };
}

function ta(name, fn) { return fn().then(() => { n++; }); }
const runs = [];

// --- archive / restore in bulk ---
runs.push(ta('every ticked table is written, one write each', () => {
  const r = rig();
  const list = [live('a', 'A'), live('b', 'B'), live('c', 'C')];
  return r.ctx.setTablesArchived(list, true).then(() => {
    const w = r.log.filter(x => x.op === 'archive');
    assert.deepStrictEqual(w.map(x => x.id), ['a', 'b', 'c']);
    assert.ok(w.every(x => x.archived === true));
  });
}));
runs.push(ta('the rail is reloaded once, not once per table', () => {
  // one reload per table is 3 full table reads for 3 tables, and 200 for a rail-wide tidy
  const r = rig();
  return r.ctx.setTablesArchived([live('a', 'A'), live('b', 'B'), live('c', 'C')], true).then(() => {
    assert.strictEqual(r.log.filter(x => x.op === 'reload').length, 1);
  });
}));
runs.push(ta('a table already in the state asked for is not written at all', () => {
  // ticking a mixed selection and pressing Archive must not rewrite the archived ones —
  // it would stamp a fresh archived_at on a table nobody touched
  const r = rig();
  return r.ctx.setTablesArchived([live('a', 'A'), arch('b', 'B')], true).then(() => {
    assert.deepStrictEqual(r.log.filter(x => x.op === 'archive').map(x => x.id), ['a']);
  });
}));
runs.push(ta('a selection that is already all archived writes nothing and asks nothing', () => {
  const r = rig();
  return r.ctx.setTablesArchived([arch('a', 'A')], true).then(() => {
    assert.strictEqual(r.log.length, 0, 'asked or wrote when there was nothing to do');
  });
}));
runs.push(ta('archiving is confirmed before anything is written', () => {
  const r = rig();
  return r.ctx.setTablesArchived([live('a', 'A'), live('b', 'B')], true).then(() => {
    assert.strictEqual(r.log[0].op, 'confirm', 'wrote before asking');
    assert.ok(/\b2 tables\b/.test(r.log[0].msg));
  });
}));
runs.push(ta('cancelling the confirm writes nothing', () => {
  const r = rig({ confirm: false });
  return r.ctx.setTablesArchived([live('a', 'A'), live('b', 'B')], true).then(() => {
    assert.strictEqual(r.log.filter(x => x.op === 'archive').length, 0);
    assert.strictEqual(r.log.filter(x => x.op === 'reload').length, 0);
  });
}));
runs.push(ta('restoring is not put behind a confirm', () => {
  // it puts tables back exactly as they were; asking would be noise, and the single
  // restore does not ask either
  const r = rig();
  return r.ctx.setTablesArchived([arch('a', 'A'), arch('b', 'B')], false).then(() => {
    assert.strictEqual(r.log.filter(x => x.op === 'confirm').length, 0);
    assert.deepStrictEqual(r.log.filter(x => x.op === 'archive').map(x => x.archived), [false, false]);
  });
}));
runs.push(ta('a reviewer who reaches the handler directly writes nothing', () => {
  const r = rig({ isAdmin: false });
  return r.ctx.setTablesArchived([live('a', 'A')], true).then(() => {
    assert.strictEqual(r.log.length, 0);
  });
}));
runs.push(ta('one table failing does not silently swallow it, and the rest still go', () => {
  // the half-done state is the dangerous one: 18 of 20 archived and no word about the 2
  // leaves somebody believing the rail is tidy
  const r = rig({ failOn: e => e.op === 'archive' && e.id === 'b' });
  const list = [live('a', 'A'), live('b', 'Handover'), live('c', 'C')];
  return r.ctx.setTablesArchived(list, true).then(() => {
    assert.deepStrictEqual(r.log.filter(x => x.op === 'archive').map(x => x.id), ['a', 'b', 'c'],
      'one failure stopped the others');
    const said = r.log.filter(x => x.op === 'alert');
    assert.strictEqual(said.length, 1, 'a table failed to archive and nothing was said');
    assert.ok(said[0].msg.indexOf('Handover') !== -1, 'the alert does not name what failed');
  });
}));
runs.push(ta('a table whose write failed keeps the config the page is holding', () => {
  const r = rig({ failOn: e => e.op === 'archive' && e.id === 'b' });
  const b = live('b', 'B');
  return r.ctx.setTablesArchived([b], true).then(() => {
    assert.deepStrictEqual(b.config, {}, 'a failed write was applied locally anyway');
  });
}));
runs.push(ta('archiving the table on screen steps back to Home', () => {
  // it is no longer in the rail; leaving the page open is a table you cannot navigate back to
  const open = live('a', 'A');
  const r = rig({ currentCustom: { table: open }, showArchived: false });
  return r.ctx.setTablesArchived([open, live('b', 'B')], true).then(() => {
    assert.ok(r.log.some(x => x.op === 'view' && x.v === 'home'), 'stayed on an archived table');
  });
}));
runs.push(ta('archiving with Archived switched on leaves you where you are', () => {
  const open = live('a', 'A');
  const r = rig({ currentCustom: { table: open }, showArchived: true });
  return r.ctx.setTablesArchived([open], true).then(() => {
    assert.ok(!r.log.some(x => x.op === 'view'), 'navigated away from a table still in the rail');
  });
}));

// --- move in bulk ---
runs.push(ta('moving a set is one write, not one per table', () => {
  // unlike the config, the workspace is one column with one value, so the whole set goes
  // in a single .in() — 200 round trips for a drag-equivalent would be absurd
  const r = rig();
  return r.ctx.moveTablesToWorkspace([live('a', 'A'), live('b', 'B')], 'HR').then(() => {
    const w = r.log.filter(x => x.op === 'move');
    assert.strictEqual(w.length, 1);
    assert.deepStrictEqual(w[0], { op: 'move', ws: 'HR', ids: ['a', 'b'] });
  });
}));
runs.push(ta('250 tables become chunks of 100/100/50 with nothing lost or repeated', () => {
  // .in() with a whole rail ticked is a URL, and a URL has a length — the same reason the
  // record delete chunks
  const r = rig();
  const list = []; for (let i = 0; i < 250; i++) list.push(live('t' + i, 'T' + i));
  return r.ctx.moveTablesToWorkspace(list, 'HR').then(() => {
    const w = r.log.filter(x => x.op === 'move');
    assert.deepStrictEqual(w.map(x => x.ids.length), [100, 100, 50]);
    const all = w.reduce((a, x) => a.concat(x.ids), []);
    assert.strictEqual(new Set(all).size, 250);
  });
}));
runs.push(ta('tables already in the target workspace are left out of the write', () => {
  const r = rig();
  return r.ctx.moveTablesToWorkspace([live('a', 'A', 'HR'), live('b', 'B', 'Main')], 'HR').then(() => {
    assert.deepStrictEqual(r.log.filter(x => x.op === 'move')[0].ids, ['b']);
  });
}));
runs.push(ta('a set already all in the target writes nothing', () => {
  const r = rig();
  return r.ctx.moveTablesToWorkspace([live('a', 'A', 'HR')], 'HR').then(() => {
    assert.strictEqual(r.log.length, 0);
  });
}));
runs.push(ta('an empty workspace name is refused rather than written', () => {
  // a table whose workspace is "" reads as having none and drops into OLD
  const r = rig();
  return r.ctx.moveTablesToWorkspace([live('a', 'A')], '').then(() => {
    assert.strictEqual(r.log.length, 0);
  });
}));
runs.push(ta('a reviewer moves nothing', () => {
  const r = rig({ isAdmin: false });
  return r.ctx.moveTablesToWorkspace([live('a', 'A')], 'HR').then(() => {
    assert.strictEqual(r.log.length, 0);
  });
}));
runs.push(ta('a failed move says the likeliest cause and still re-reads the rail', () => {
  // the likeliest cause is the column not being there yet, exactly as the single move says.
  // Re-reading matters more here than there: an earlier chunk may already have written, so
  // the page's own copy is the half-applied one and the database is the truth.
  const r = rig({ failOn: e => e.op === 'move' });
  return r.ctx.moveTablesToWorkspace([live('a', 'A')], 'HR').then(() => {
    const said = r.log.filter(x => x.op === 'alert');
    assert.strictEqual(said.length, 1);
    assert.ok(/01-add-workspace\.sql/.test(said[0].msg));
    assert.strictEqual(r.log.filter(x => x.op === 'reload').length, 1);
  });
}));

// ---- the page wiring, read as source ---------------------------------------
Promise.all(runs).then(() => {

t('the rail\'s bulk bar offers no delete', () => {
  // THE test in this file. A table's delete takes every record with it and cannot be undone,
  // which is why the single one is behind a typed sum. Eight at once is not a thing this
  // rail does, by decision — it stays on the ⋯ menu, one table at a time.
  const bar = RAW.match(/<div class="side-selbar"[\s\S]*?\n\s*<\/div>\s*\n\s*<\/div>/);
  assert.ok(bar, 'the selection bar markup is not there');
  assert.ok(!/delete/i.test(bar[0]), 'the bulk bar has grown a delete');
  assert.ok(!/openDeleteTable/.test(grab(SRC, 'moveTablesToWorkspace', 'index.html')));
  assert.ok(!/openDeleteTable/.test(grab(SRC, 'setTablesArchived', 'index.html')));
});
t('only an admin can archive, restore or move a set', () => {
  assert.ok(/function setTablesArchived\(list, on\) \{\s*\n\s*if \(!isAdmin\) return/.test(SRC),
    'setTablesArchived is not gated on isAdmin');
  assert.ok(/function moveTablesToWorkspace\(list, ws\) \{\s*\n\s*if \(!isAdmin/.test(SRC),
    'moveTablesToWorkspace is not gated on isAdmin');
});
t('the Select toggle is hidden from anybody who cannot act on a selection', () => {
  // every action behind it is admin-only, so a reviewer given the toggle gets a mode whose
  // every button is a no-op
  assert.ok(/id="side-select-toggle"[^>]*style="display:none;"/.test(RAW),
    'the toggle is visible before the role is known');
  assert.ok(/side-select-toggle[\s\S]{0,200}?isAdmin/.test(SRC) || /isAdmin[\s\S]{0,200}?side-select-toggle/.test(SRC),
    'the toggle is never shown or hidden by role');
});
t('the tick box stands in the colour mark\'s slot rather than beside it', () => {
  // otherwise turning select mode on shunts every table name 20px right and the rail
  // visibly jumps — the same reason .side-fold matches .tmark
  const w = c => { const m = RAW.match(new RegExp('\\' + c + '\\s*\\{[^}]*width:\\s*(\\d+)px')); return m && m[1]; };
  assert.strictEqual(w('.side-chk'), w('.tmark'), '.side-chk and .tmark are different widths');
  assert.ok(/#side-tables\.selecting[^{]*\.tmark\s*\{[^}]*display:\s*none/.test(RAW),
    'the colour mark is not hidden while selecting, so both are drawn');
});
t('pressing a table while selecting ticks it instead of opening it', () => {
  assert.ok(/if \(sideSelMode\) \{ toggleSideSel\(t\); return; \}/.test(SRC),
    'a table line opens rather than ticks in select mode');
});
t('a table cannot be dragged into a workspace while it is being ticked', () => {
  // dragging and ticking are the same press. Left draggable, ticking a row lifts it.
  assert.ok(/draggable = !sideSelMode/.test(SRC), 'select mode does not stop the drag');
});
t('the selection is pruned by the reload rather than by each caller', () => {
  assert.ok(/sideSel = sideSelPrune\(sideSel, customTables\)/.test(SRC),
    'loadCustomTables does not prune the selection');
});

console.log(n + ' sidebar-select tests passed');
}).catch(err => { console.error(err); process.exit(1); });
