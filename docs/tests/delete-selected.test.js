// Deleting a selection of records from the grid. The reason this file tests the CALLER and not
// a pure helper is payroll.test.js: all 16 of its tests handed `payrollRows` an array they built
// themselves, so the export stayed broken for four days while every test passed. The bug was in
// who called it and with what. So here the thing under test is `deleteSelectedRecords` itself,
// with the database, the bucket, the confirm dialog and the DOM stubbed, and the assertions are
// about the CALLS IT MAKES and their ORDER.
//
// Both failure modes are permanent losses, which is why the order is asserted rather than the
// set: a child left behind is an orphan — parent_id null, invisible in every view because
// children are only ever read as .eq("parent_id", …), and worth nothing to the payroll export
// that joins through it. Two real event signups were found in exactly that state on 2026-08-18.
// A file left behind is a photo or a video stranded in R2 with no row pointing at it.
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
const RAW = fs.readFileSync('index.html', 'utf8');   // the markup tests need the page, not its JS

// A rig that records every call the handler makes, in the order it makes them.
function rig(opts) {
  opts = opts || {};
  const log = [];
  const table = opts.table || { id: 'T', name: 'Events' };
  const kid = opts.kid === undefined ? null : opts.kid;
  const rows = opts.rows || [];
  const fields = opts.fields || [];
  const sel = {};
  (opts.ids || rows.map(r => r.id)).forEach(id => { sel[id] = true; });

  // A quiet console: the failure tests deliberately make the handler log an error, and a real
  // console.error turns a green run into a wall of noise that hides the one line that matters.
  const quiet = { log: () => {}, error: () => { log.push({ op: 'logged' }); }, warn: () => {} };
  const ctx = {
    console: quiet,
    customSel: sel,
    currentCustom: { table, fields, subs: rows },
    selectedIds() { return Object.keys(ctx.customSel); },
    canManage: () => opts.canManage !== false,
    childTableOf: () => kid,
    isFileField: f => f.type === 'photo' || f.type === 'media',
    storageDelete(p) { log.push({ op: 'storage', path: p }); return Promise.resolve(); },
    openCustomTable(t) { log.push({ op: 'reload', table: t.id }); },
    paintSelBar() { log.push({ op: 'paint' }); },
    document: {
      getElementById: id => (id === 'sel-delete' ? ctx.btn : null)
    },
    window: {
      confirm(msg) { log.push({ op: 'confirm', msg }); return opts.confirm !== false; },
      alert(msg) { log.push({ op: 'alert', msg }); },
      console: quiet
    },
    btn: { disabled: false, textContent: '' },
    db: {
      from() {
        const q = {
          _count: null, _table: null, _parents: null, _ids: null, _del: false,
          select(_c, o) { this._count = (o && o.head) ? 'head' : 'rows'; return this; },
          delete() { this._del = true; return this; },
          eq(col, v) { if (col === 'table_id') this._table = v; return this; },
          in(col, v) { if (col === 'parent_id') this._parents = v; else this._ids = v; return this; },
          then(res, rej) {
            if (this._count) {
              log.push({ op: 'count', table: this._table, parents: this._parents });
              return Promise.resolve(opts.countErr
                ? { error: { message: 'nope' } }
                : { count: opts.kidCount === undefined ? 0 : opts.kidCount }).then(res, rej);
            }
            const entry = this._parents
              ? { op: 'delKids', table: this._table, parents: this._parents }
              : { op: 'delRows', ids: this._ids };
            log.push(entry);
            const fail = opts.failOn && opts.failOn === entry.op;
            return Promise.resolve(fail ? { error: { message: 'boom' } } : {}).then(res, rej);
          },
          catch(f) { return this.then(x => x).catch(f); }
        };
        return q;
      }
    }
  };
  vm.createContext(ctx);
  // filePaths/recordFilePaths are loaded for real rather than stubbed: an upload question
  // holds several files now, and "which paths does the delete sweep?" is exactly the question
  // this rig exists to answer. A stub here would let the collector break silently.
  new vm.Script('(function(){' +
    grab(SRC, 'filePaths', 'index.html') + '\n' +
    grab(SRC, 'recordFilePaths', 'index.html') + '\n' +
    grab(SRC, 'deleteSelectedRecords', 'index.html') +
    '\n this.RUN = deleteSelectedRecords;}).call(this)').runInContext(ctx);
  return { ctx, log, run: () => { ctx.RUN(); return new Promise(r => setTimeout(r, 30)); } };
}

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---- the orphan, which is the whole reason this is not one delete call ----
t('a parent record deletes its children FIRST, never after', async () => {
  const r = rig({
    kid: { id: 'K', name: 'Event signups' }, kidCount: 4,
    rows: [{ id: 'e1', data: {} }, { id: 'e2', data: {} }]
  });
  await r.run();
  const ops = r.log.filter(x => x.op === 'delKids' || x.op === 'delRows').map(x => x.op);
  assert.deepStrictEqual(ops, ['delKids', 'delRows'],
    'children must be deleted before parents — the FK is ON DELETE SET NULL, so the other order orphans them');
});
t('the child delete is scoped to the child table and the selected parents only', async () => {
  const r = rig({
    kid: { id: 'K', name: 'Event signups' }, kidCount: 4,
    rows: [{ id: 'e1', data: {} }, { id: 'e2', data: {} }]
  });
  await r.run();
  const k = r.log.filter(x => x.op === 'delKids')[0];
  assert.strictEqual(k.table, 'K', 'a child delete that is not scoped by table_id can hit another table');
  assert.deepStrictEqual(k.parents, ['e1', 'e2']);
});
t('a table with no child table issues no child delete at all', async () => {
  const r = rig({ rows: [{ id: 'a', data: {} }] });
  await r.run();
  assert.strictEqual(r.log.filter(x => x.op === 'delKids').length, 0);
  assert.strictEqual(r.log.filter(x => x.op === 'count').length, 0,
    'and it does not ask the database to count children it knows cannot exist');
});
t('a failed child delete stops before the parents are deleted', async () => {
  // the one outcome worse than not deleting: children gone-or-not and parents gone, i.e. orphans
  const r = rig({
    kid: { id: 'K', name: 'Event signups' }, kidCount: 2, failOn: 'delKids',
    rows: [{ id: 'e1', data: {} }]
  });
  await r.run();
  assert.strictEqual(r.log.filter(x => x.op === 'delRows').length, 0,
    'the parent delete must not run once the child delete failed');
  assert.strictEqual(r.log.filter(x => x.op === 'alert').length, 1, 'and it must say so');
  assert.strictEqual(r.log.filter(x => x.op === 'reload').length, 0);
});

// ---- the bucket ----
t('every file field is deleted from storage, not just the first', async () => {
  // the exact bug deleteCustomSub had: a table with two upload questions stranded the rest
  const r = rig({
    fields: [{ id: 'f1', type: 'photo' }, { id: 'f2', type: 'media' }, { id: 'f3', type: 'short_text' }],
    rows: [{ id: 'a', data: { f1: 'p/a1.jpg', f2: 'p/a2.mp4', f3: 'not a path' } },
           { id: 'b', data: { f1: 'p/b1.jpg' } }]
  });
  await r.run();
  const paths = r.log.filter(x => x.op === 'storage').map(x => x.path).sort();
  assert.deepStrictEqual(paths, ['p/a1.jpg', 'p/a2.mp4', 'p/b1.jpg']);
});
// One question holding several files is the same class of bug one step down: sweeping the
// answer instead of the answer's files strands nine photos out of ten in the bucket, where
// nothing can ever find them again because the row that named them is gone.
t('every file of a question holding several is deleted, not just the first', async () => {
  const r = rig({
    fields: [{ id: 'f1', type: 'photo' }, { id: 'f2', type: 'media' }],
    rows: [{ id: 'a', data: { f1: ['p/a1.jpg', 'p/a2.jpg', 'p/a3.jpg'], f2: 'p/a4.mp4' } },
           { id: 'b', data: { f1: 'p/b1.jpg' } }]
  });
  await r.run();
  const paths = r.log.filter(x => x.op === 'storage').map(x => x.path).sort();
  assert.deepStrictEqual(paths, ['p/a1.jpg', 'p/a2.jpg', 'p/a3.jpg', 'p/a4.mp4', 'p/b1.jpg']);
});
t('a record with no uploads deletes no files and still deletes the row', async () => {
  const r = rig({ fields: [{ id: 'f1', type: 'photo' }], rows: [{ id: 'a', data: {} }] });
  await r.run();
  assert.strictEqual(r.log.filter(x => x.op === 'storage').length, 0);
  assert.strictEqual(r.log.filter(x => x.op === 'delRows').length, 1);
});
t('files go before the rows, so a row is never dropped pointing at a file still there', async () => {
  const r = rig({ fields: [{ id: 'f1', type: 'photo' }], rows: [{ id: 'a', data: { f1: 'p/a.jpg' } }] });
  await r.run();
  const iS = r.log.findIndex(x => x.op === 'storage');
  const iR = r.log.findIndex(x => x.op === 'delRows');
  assert.ok(iS > -1 && iR > iS, 'storage delete must come first');
});

// ---- the URL length ----
t('250 ids are chunked into 100s rather than one enormous URL', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: 'r' + i, data: {} }));
  const r = rig({ rows });
  await r.run();
  const calls = r.log.filter(x => x.op === 'delRows');
  assert.deepStrictEqual(calls.map(c => c.ids.length), [100, 100, 50]);
  const all = calls.reduce((a, c) => a.concat(c.ids), []);
  assert.strictEqual(all.length, 250, 'and no id is lost between the chunks');
  assert.strictEqual(new Set(all).size, 250, 'nor deleted twice');
});
t('the child delete is chunked the same way', async () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({ id: 'r' + i, data: {} }));
  const r = rig({ rows, kid: { id: 'K', name: 'Event signups' }, kidCount: 9 });
  await r.run();
  assert.deepStrictEqual(r.log.filter(x => x.op === 'delKids').map(c => c.parents.length), [100, 50]);
});

// ---- who may press it ----
t('a viewer who cannot manage the table deletes nothing, button or no button', async () => {
  const r = rig({ canManage: false, rows: [{ id: 'a', data: {} }] });
  await r.run();
  assert.strictEqual(r.log.length, 0, 'not even a confirm should be shown');
});
t('an empty selection does nothing', async () => {
  const r = rig({ rows: [], ids: [] });
  await r.run();
  assert.strictEqual(r.log.length, 0);
});
t('cancelling the confirm deletes nothing', async () => {
  const r = rig({ confirm: false, kid: { id: 'K', name: 'Event signups' }, kidCount: 3, rows: [{ id: 'a', data: {} }] });
  await r.run();
  assert.strictEqual(r.log.filter(x => x.op === 'confirm').length, 1);
  assert.strictEqual(r.log.filter(x => x.op === 'delRows').length, 0);
  assert.strictEqual(r.log.filter(x => x.op === 'delKids').length, 0);
  assert.strictEqual(r.log.filter(x => x.op === 'storage').length, 0,
    'and it does not delete the files of records it is not deleting');
});

// ---- what the confirm actually says ----
t('the confirm names the number of children going with the records', async () => {
  const r = rig({ kid: { id: 'K', name: 'Event signups' }, kidCount: 27, rows: [{ id: 'a', data: {} }, { id: 'b', data: {} }] });
  await r.run();
  const msg = r.log.filter(x => x.op === 'confirm')[0].msg;
  assert.ok(/2 records/.test(msg), msg);
  assert.ok(/27 event signups/.test(msg), 'the second effect must be named before it happens: ' + msg);
  assert.ok(/can't be undone/.test(msg), msg);
});
t('one record and one child read as singular', async () => {
  const r = rig({ kid: { id: 'K', name: 'Event signups' }, kidCount: 1, rows: [{ id: 'a', data: {} }] });
  await r.run();
  const msg = r.log.filter(x => x.op === 'confirm')[0].msg;
  assert.ok(/this record/.test(msg), msg);
  assert.ok(/is deleted as well/.test(msg), msg);
});
t('a parent with zero children does not mention children', async () => {
  const r = rig({ kid: { id: 'K', name: 'Event signups' }, kidCount: 0, rows: [{ id: 'a', data: {} }] });
  await r.run();
  const msg = r.log.filter(x => x.op === 'confirm')[0].msg;
  assert.ok(!/event signups/.test(msg), 'do not warn about children that are not there: ' + msg);
});
t('a count the database refuses still warns, rather than promising nothing will be lost', async () => {
  const r = rig({ kid: { id: 'K', name: 'Event signups' }, countErr: true, rows: [{ id: 'a', data: {} }] });
  await r.run();
  const msg = r.log.filter(x => x.op === 'confirm')[0].msg;
  assert.ok(/event signups go too/.test(msg), 'an unknown count must err toward warning: ' + msg);
  assert.strictEqual(r.log.filter(x => x.op === 'delRows').length, 1,
    'and the delete still proceeds — a failed count is not a failed delete');
});

// ---- after ----
t('a successful delete clears the selection and re-reads the table', async () => {
  const r = rig({ rows: [{ id: 'a', data: {} }, { id: 'b', data: {} }] });
  await r.run();
  assert.deepStrictEqual(Object.keys(r.ctx.customSel), [], 'ticks for deleted rows must not survive');
  const reload = r.log.filter(x => x.op === 'reload');
  assert.strictEqual(reload.length, 1, 'splicing the array locally leaves the entry count and footer totals stale');
  assert.strictEqual(reload[0].table, 'T');
});
t('the button is re-enabled after a failure, so a retry is possible', async () => {
  const r = rig({ failOn: 'delRows', rows: [{ id: 'a', data: {} }] });
  await r.run();
  assert.strictEqual(r.ctx.btn.disabled, false);
});

// ---- the page as source ----
t('the selection bar carries a delete button and it starts hidden', () => {
  assert.ok(/id="sel-delete"/.test(RAW), 'no delete button in the selection bar');
  const tag = RAW.match(/<button[^>]*id="sel-delete"[^>]*>/)[0];
  assert.ok(/display:none/.test(tag), 'it must start hidden — paintSelBar decides who sees it');
  assert.ok(/qr-regen/.test(tag), 'destructive buttons in this app carry the qr-regen colour');
});
t('the button is shown on can_manage, the same gate the DELETE policy uses', () => {
  const paint = grab(SRC, 'paintSelBar', 'index.html');
  assert.ok(/sel-delete/.test(paint), 'paintSelBar must own the button visibility');
  assert.ok(/canManage\(currentCustom\.table\.id\)/.test(paint),
    'showing it on canEdit would offer a reviewer a button the database refuses');
});
t('the handler re-checks the permission itself', () => {
  const fn = grab(SRC, 'deleteSelectedRecords', 'index.html');
  assert.ok(/canManage\(/.test(fn), 'a hidden button is not a permission check');
  assert.ok(/window\.confirm/.test(fn), 'a bulk delete must always confirm');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); n++; }
    catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; }
  }
  console.log(n + ' delete-selected tests passed');
})();
