// A refresh keeps the photos and the files too.
//
// form-draft.test.js covers the answers, which are text and live in localStorage. This covers
// the other half: the files, which do not. A phone photo is 2-4 MB, the shop QC check asks for
// 52 of them, and localStorage holds strings inside about 5 MB — so the files go to IndexedDB
// under the same draft key, and this is the layer that puts them there and reads them back.
//
// It was worth writing because the failure it guards against is silent and expensive. Somebody
// stands in a shop photographing 52 stations, the tab is discarded while the camera app is
// open — which is exactly what a photo question asks them to risk — and everything they typed
// comes back while everything they photographed does not. What follows is mostly the ways
// keeping files can do harm rather than good: one person's photos following the next person on
// a shop tablet, a question wearing another question's pictures, a draft from last month
// filling in a form somebody thought was fresh, and a browser that refuses storage taking the
// whole form down instead of quietly keeping nothing.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  // Normalised to LF. The pages are CRLF on the dev machine, and a test that matches a whole
  // line of source — which several below do — otherwise passes or fails on the line endings
  // of whoever last saved the file rather than on what the line says.
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
function grabVar(js, name, file) {
  const one = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!one) throw new Error('could not find var ' + name + ' in ' + file);
  return one[0];
}

const FNS = ['fileKey', 'fileDb', 'fileRowId', 'nextFileSeq', 'fileRowFresh',
             'syncDraftFiles', 'rowToFile', 'readDraftFiles', 'clearDraftFiles', 'sweepDraftFiles'];
const VARS = ['DRAFT_MAX_AGE_MS', 'FILE_DB', 'FILE_STORE', 'fileDbP', 'FILE_ROW_SEP', 'fileSeqN'];

// The page's own code, lifted whole. `draftK` is the one thing a test has to be able to set —
// the page assigns it once the form is known — so it comes with a setter rather than being
// restated here under a name of its own.
function load(file, idb) {
  const js = scripts(file);
  const ctx = { console, Promise, Date, File, Blob, Error, JSON, Object, Number, String, Array,
                setTimeout, indexedDB: idb, IDBKeyRange: idb.IDBKeyRange,
                window: { indexedDB: idb } };
  vm.createContext(ctx);
  new vm.Script('(function(){' +
    VARS.map(v => grabVar(js, v, file)).join('\n') + '\n' +
    'var draftK = "";\n' +
    FNS.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + FNS.join(',') + ', setDraftK: function (v) { draftK = v; }};}).call(this)').runInContext(ctx);
  return ctx.API;
}

// ---- an IndexedDB that behaves like one ----------------------------------
// Small, but faithful in the three ways the page depends on: a cursor arrives one row at a
// time and only moves when it is told to, a transaction says it is complete only after the
// writes made inside it, and a store that will not take a write aborts the transaction rather
// than throwing where the caller can catch it. `mode` is how a browser refuses: 'none' is an
// engine with no IndexedDB at all, 'blocked' is one that will not open a database (private
// mode), 'full' is a phone with no room left.
function fakeIndexedDB(mode) {
  const data = new Map();     // store name -> Map(id -> row)
  const paths = new Map();    // store name -> Map(index name -> key path)
  let opened = false;
  const IDBKeyRange = { only: v => ({ __only: v }) };

  function makeTx(name) {
    const tx = { objectStore: null, oncomplete: null, onerror: null, onabort: null };
    let outstanding = 0, settled = false, dead = false;
    function done() {
      if (settled || outstanding > 0) return;
      settled = true;
      setTimeout(() => { if (!dead && tx.oncomplete) tx.oncomplete(); }, 0);
    }
    function abort(err) {
      if (settled) return;
      settled = true; dead = true;
      const ev = { preventDefault() {} };
      setTimeout(() => { if (tx.onerror) tx.onerror(ev); if (tx.onabort) tx.onabort(); }, 0);
    }
    function cursorReq(pred) {
      const rq = { result: null, onsuccess: null, onerror: null };
      let rows = null, i = 0;
      function emit() {
        if (dead) return;
        if (rows === null) rows = [...data.get(name).values()].filter(pred);
        if (i >= rows.length) { rq.result = null; if (rq.onsuccess) rq.onsuccess(); done(); return; }
        const row = rows[i++];
        rq.result = {
          value: row,
          delete() { data.get(name).delete(row.id); },
          continue() { setTimeout(emit, 0); }
        };
        if (rq.onsuccess) rq.onsuccess();
      }
      outstanding++;
      setTimeout(() => { outstanding--; emit(); }, 0);
      return rq;
    }
    const store = {
      put(row) {
        const rq = { onsuccess: null, onerror: null };
        if (mode === 'full') { setTimeout(() => abort(new Error('QuotaExceededError')), 0); return rq; }
        outstanding++;
        setTimeout(() => { if (!dead) data.get(name).set(row.id, row); outstanding--; done(); }, 0);
        return rq;
      },
      index(iname) {
        const kp = paths.get(name).get(iname);
        return { openCursor: r => cursorReq(row => !r || row[kp] === r.__only) };
      },
      openCursor: r => cursorReq(row => !r || true)
    };
    tx.objectStore = () => store;
    return tx;
  }

  const idb = mode === 'none' ? undefined : {
    open(dbName) {
      const rq = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        if (mode === 'blocked') { rq.error = new Error('denied'); if (rq.onerror) rq.onerror(); return; }
        rq.result = {
          objectStoreNames: { contains: n => data.has(n) },
          createObjectStore(n) {
            data.set(n, new Map()); paths.set(n, new Map());
            return { createIndex(iname, keyPath) { paths.get(n).set(iname, keyPath); } };
          },
          transaction: n => makeTx(n)
        };
        if (!opened) { opened = true; if (rq.onupgradeneeded) rq.onupgradeneeded(); }
        if (rq.onsuccess) rq.onsuccess();
      }, 0);
      return rq;
    },
    IDBKeyRange,
    rows: () => [...(data.get('files') || new Map()).values()]
  };
  if (idb) idb.IDBKeyRange = IDBKeyRange;
  return idb || { IDBKeyRange, rows: () => [] };
}

// The page writes and reads through callbacks two or three turns deep. Rather than guess how
// many, every test settles the loop before it asserts.
const settle = () => new Promise(r => setTimeout(r, 40));
// Objects built inside the vm are not this realm's Object, so deepStrictEqual would fail on
// two things that are in every way the same. The same trick form-draft.test.js uses.
const same = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
const photo = (name, bytes, lm) => new File([bytes || name], name, { type: 'image/jpeg', lastModified: lm || 1000 });

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
async function run() {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; }
    catch (e) { fail++; console.log('FAIL: ' + name + ' -> ' + (e && e.message)); }
  }
  console.log(pass + ' of ' + (pass + fail) + ' form-draft-files tests passed');
  if (fail) process.exitCode = 1;
}

// ---- keeping them, and getting them back ---------------------------------
async function fresh(mode) {
  const idb = fakeIndexedDB(mode);
  const A = load('f/index.html', idb);
  A.setDraftK('blk_draft_qc');
  return { idb, A };
}

t('a photo picked on a form comes back after the refresh', async () => {
  const { A } = await fresh();
  A.syncDraftFiles('q1', [photo('front.jpg', 'aaaa')]);
  await settle();
  const back = await A.readDraftFiles('blk_draft_qc', Date.now());
  assert.ok(back.q1, 'nothing came back for q1');
  assert.strictEqual(back.q1.length, 1);
  assert.strictEqual(back.q1[0].name, 'front.jpg');
  assert.strictEqual(back.q1[0].size, 4);
  assert.strictEqual(back.q1[0].type, 'image/jpeg');
});

t('it comes back as a File, not a Blob — the tiles and the size check read .name', async () => {
  // a bare Blob has lost the name, the size check still works and the tile is captioned
  // "undefined": the answer would upload under a made-up filename
  const { A } = await fresh();
  A.syncDraftFiles('q1', [photo('receipt.png')]);
  await settle();
  const back = await A.readDraftFiles('blk_draft_qc', Date.now());
  assert.ok(back.q1[0] instanceof File, 'not a File');
  assert.strictEqual(back.q1[0].lastModified, 1000);
});

t('the bytes survive the round trip', async () => {
  const { A } = await fresh();
  A.syncDraftFiles('q1', [photo('a.jpg', 'hello world')]);
  await settle();
  const back = await A.readDraftFiles('blk_draft_qc', Date.now());
  assert.strictEqual(await back.q1[0].text(), 'hello world');
});

t('several photos come back in the order they were chosen', async () => {
  // uploadAll hands the paths back in the order it was given, and the review app shows them
  // in that order — a draft that reshuffles them renames what the reviewer is looking at
  const { A } = await fresh();
  A.syncDraftFiles('q1', [photo('1.jpg'), photo('2.jpg'), photo('3.jpg')]);
  await settle();
  const back = await A.readDraftFiles('blk_draft_qc', Date.now());
  same(back.q1.map(f => f.name), ['1.jpg', '2.jpg', '3.jpg']);
});

t('one more photo does not rewrite the ones already kept', async () => {
  // the whole reason there is a row per file: a question holding forty photos would otherwise
  // write a couple of hundred megabytes again every time somebody adds a forty-first, while
  // they are still standing in the shop filling the form in
  const { idb, A } = await fresh();
  const first = photo('1.jpg'), second = photo('2.jpg');
  A.syncDraftFiles('q1', [first]);
  await settle();
  const seqBefore = idb.rows()[0].seq;
  A.syncDraftFiles('q1', [first, second]);
  await settle();
  const rows = idb.rows();
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows.filter(r => r.name === '1.jpg')[0].seq, seqBefore, 'the first row was rewritten');
});

t('a photo taken off the form is taken out of storage too', async () => {
  const { idb, A } = await fresh();
  const a = photo('a.jpg'), b = photo('b.jpg');
  A.syncDraftFiles('q1', [a, b]);
  await settle();
  A.syncDraftFiles('q1', [b]);
  await settle();
  same(idb.rows().map(r => r.name), ['b.jpg']);
});

t('emptying a question empties its rows and no others', async () => {
  const { idb, A } = await fresh();
  A.syncDraftFiles('q1', [photo('a.jpg')]);
  A.syncDraftFiles('q2', [photo('b.jpg')]);
  await settle();
  A.syncDraftFiles('q1', []);
  await settle();
  same(idb.rows().map(r => r.fid), ['q2'], 'q2 lost its file to q1 being emptied');
});

t('a question never wears another question\'s photos', async () => {
  // groupUploads exists because assigning every path onto one key threw nine photos of ten
  // away; the draft has the same shape and the same way to get it wrong
  const { A } = await fresh();
  A.syncDraftFiles('front', [photo('f.jpg')]);
  A.syncDraftFiles('back', [photo('b1.jpg'), photo('b2.jpg')]);
  await settle();
  const back = await A.readDraftFiles('blk_draft_qc', Date.now());
  same(back.front.map(f => f.name), ['f.jpg']);
  same(back.back.map(f => f.name), ['b1.jpg', 'b2.jpg']);
});

t('the same file picked twice is one row', async () => {
  // a phone picker reopens with the previous selection still ticked, so "add one more" hands
  // back everything a second time — addFiles refuses the duplicate and so must this
  const { idb, A } = await fresh();
  const same = photo('IMG_0001.jpg');
  A.syncDraftFiles('q1', [same, same]);
  await settle();
  assert.strictEqual(idb.rows().length, 1);
});

t('two different photos that share a name and a size are two rows', async () => {
  // IMG_0001.jpg off two phones, or a picker that calls everything image.jpg
  const { idb, A } = await fresh();
  A.syncDraftFiles('q1', [photo('IMG_0001.jpg', 'aaaa', 1000), photo('IMG_0001.jpg', 'bbbb', 2000)]);
  await settle();
  assert.strictEqual(idb.rows().length, 2);
});

// ---- the ways keeping files could do harm --------------------------------
t('another form\'s draft is never read into this one', async () => {
  const { idb, A } = await fresh();
  A.syncDraftFiles('q1', [photo('mine.jpg')]);
  await settle();
  A.setDraftK('blk_draft_other');
  A.syncDraftFiles('q1', [photo('theirs.jpg')]);
  await settle();
  const back = await A.readDraftFiles('blk_draft_qc', Date.now());
  same(back.q1.map(f => f.name), ['mine.jpg']);
  assert.strictEqual(idb.rows().length, 2, 'the two drafts did not both survive');
});

t('a draft from last month is not read back', async () => {
  // the same promise the answers make: a week, and then it is a new visit
  const { A } = await fresh();
  A.syncDraftFiles('q1', [photo('old.jpg')]);
  await settle();
  const monthLater = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const back = await A.readDraftFiles('blk_draft_qc', monthLater);
  same(back, {});
});

t('a row written by a clock that was ahead is not read back', async () => {
  const { A } = await fresh();
  A.syncDraftFiles('q1', [photo('future.jpg')]);
  await settle();
  const back = await A.readDraftFiles('blk_draft_qc', Date.now() - 10 * 60 * 1000);
  same(back, {});
});

t('the sweep clears the expired rows and leaves the fresh ones', async () => {
  // a form nobody goes back to is never read again, so nothing else would ever remove it —
  // and an abandoned QC check is a couple of hundred megabytes of somebody's phone
  const { idb, A } = await fresh();
  A.syncDraftFiles('q1', [photo('keep.jpg')]);
  await settle();
  idb.rows()[0].id;                                     // one fresh row exists
  A.setDraftK('blk_draft_ancient');
  A.syncDraftFiles('q1', [photo('gone.jpg')]);
  await settle();
  idb.rows().filter(r => r.name === 'gone.jpg')[0].at -= 30 * 24 * 60 * 60 * 1000;
  const n = await A.sweepDraftFiles(Date.now());
  assert.strictEqual(n, 1, 'swept ' + n + ' rows');
  same(idb.rows().map(r => r.name), ['keep.jpg']);
});

t('a submitted form leaves no photos behind for the next person', async () => {
  // a shop tablet is one browser used by everybody; inheriting the last person's photographs
  // is worse than inheriting their answers, because nobody reads a photo before submitting
  const { idb, A } = await fresh();
  A.syncDraftFiles('q1', [photo('a.jpg'), photo('b.jpg')]);
  A.setDraftK('blk_draft_other');
  A.syncDraftFiles('q1', [photo('other.jpg')]);
  await settle();
  const n = await A.clearDraftFiles('blk_draft_qc');
  assert.strictEqual(n, 2);
  same(idb.rows().map(r => r.name), ['other.jpg'], 'it cleared more than its own draft');
});

t('clearing a draft that has no files is not an error', async () => {
  const { A } = await fresh();
  assert.strictEqual(await A.clearDraftFiles('blk_draft_qc'), 0);
  assert.strictEqual(await A.clearDraftFiles(''), 0);
});

// ---- browsers that refuse ------------------------------------------------
t('a browser with no IndexedDB keeps nothing and breaks nothing', async () => {
  const idb = fakeIndexedDB('none');
  const A = load('f/index.html', idb);
  A.setDraftK('blk_draft_qc');
  A.syncDraftFiles('q1', [photo('a.jpg')]);          // must not throw
  same(await A.readDraftFiles('blk_draft_qc', Date.now()), {});
  assert.strictEqual(await A.clearDraftFiles('blk_draft_qc'), 0);
  assert.strictEqual(await A.sweepDraftFiles(Date.now()), 0);
});

t('private mode, where the database will not open, is the same', async () => {
  const idb = fakeIndexedDB('blocked');
  const A = load('f/index.html', idb);
  A.setDraftK('blk_draft_qc');
  A.syncDraftFiles('q1', [photo('a.jpg')]);
  await settle();
  same(await A.readDraftFiles('blk_draft_qc', Date.now()), {});
});

t('a phone with no room left still fills in the form', async () => {
  // out of room is the expected failure — the QC check is 52 photos — and it is not one the
  // person filling the form can do anything about, so it is swallowed rather than shown
  const { A } = await fresh('full');
  A.syncDraftFiles('q1', [photo('a.jpg')]);
  await settle();
  same(await A.readDraftFiles('blk_draft_qc', Date.now()), {});
});

t('nothing is kept before the form is known', async () => {
  // draftK is empty until the slug has resolved; writing then would file photos under a key
  // nothing ever reads, which is the one way this leaks storage for good
  const { idb, A } = await fresh();
  A.setDraftK('');
  A.syncDraftFiles('q1', [photo('a.jpg')]);
  await settle();
  assert.strictEqual(idb.rows().length, 0);
});

t('a row with no blob is not turned into a file', async () => {
  const { A } = await fresh();
  assert.strictEqual(A.rowToFile(null), null);
  assert.strictEqual(A.rowToFile({ name: 'a.jpg' }), null);
});

// ---- the same layer on all three public pages ----------------------------
// /f is every custom form, /apply is the job application and /cast is the casting call. Each
// carries its own copy, the way condMet does, so a rule that changes in one and not the others
// is a page that files photos where the next one will not look for them.
const PAGES = ['f/index.html', 'apply/index.html', 'cast/index.html'];
const SRC = {};
PAGES.forEach(p => { SRC[p] = scripts(p); });

t('all three pages file their files in the same database', () => {
  PAGES.forEach(p => {
    assert.ok(/var FILE_DB = "blk_form_files";/.test(SRC[p]), p + ' uses a different database name');
    assert.ok(/var FILE_STORE = "files";/.test(SRC[p]), p + ' uses a different store name');
  });
});

t('all three identify a chosen file the same way', () => {
  // name, size and the moment it was last changed. A row written under one spelling is looked
  // for under another and never found again — the photo is there and the form says it is not.
  const rule = SRC['f/index.html'].match(/function fileKey\(f\) \{[^\n]*\}/)[0];
  PAGES.forEach(p => assert.ok(SRC[p].indexOf(rule) !== -1, p + ' spells fileKey differently'));
});

t('all three keep files for the same week as the answers', () => {
  PAGES.forEach(p => {
    const m = SRC[p].match(/function fileRowFresh\(r, now\)[\s\S]*?\n  \}/);
    assert.ok(m, p + ' has no fileRowFresh');
    assert.ok(/DRAFT_MAX_AGE_MS/.test(m[0]), p + ' does not measure a file draft against DRAFT_MAX_AGE_MS');
  });
});

t('all three clear the files when the form is submitted', () => {
  PAGES.forEach(p => {
    assert.ok(/clearDraft\(draftK\); clearDraftFiles\(draftK\);/.test(SRC[p]),
              p + ' clears the answers on submit but not the files');
  });
});

t('all three clear the files before "Start over" reloads', () => {
  // reloading first means the page comes back up and reads them straight in again, and the
  // button looks like it did nothing
  PAGES.forEach(p => assert.ok(/clearDraftFiles\(k\)\.then\(reload, reload\)/.test(SRC[p]),
                               p + ' reloads without waiting for the files to go'));
});

t('all three sweep expired files on load', () => {
  PAGES.forEach(p => assert.ok(/sweepDraftFiles\(Date\.now\(\)\)/.test(SRC[p]), p + ' never sweeps'));
});

// ---- the wiring on each page ---------------------------------------------
t('the picker writes on every change to the selection', () => {
  // at pick time, not at Submit: the tab being discarded while the camera app is open is the
  // exact thing a photo question asks somebody to risk, and by then there is no save left
  const refresh = SRC['f/index.html'].match(/function refreshFiles\(\)[\s\S]*?\n      \}/);
  assert.ok(refresh, 'could not find refreshFiles');
  assert.ok(/syncDraftFiles\(f\.id, picked\)/.test(refresh[0]), 'refreshFiles does not write the selection');
});

t('the file question can take its files back', () => {
  const body = SRC['f/index.html'];
  const push = body.slice(body.indexOf('controls.push({\n        f: f, el: frow, isPhoto: true'));
  assert.ok(push.slice(0, push.indexOf('});')).indexOf('setDraftFiles') !== -1,
            'the file control has no setDraftFiles, so a restored file has nowhere to go');
});

t('restored files go through the cap and the de-duplication like any other pick', () => {
  // a draft must not be able to put eleven photos on a question that takes ten
  const m = SRC['f/index.html'].match(/setDraftFiles: function \(fls\) \{[\s\S]*?\n        \}/);
  assert.ok(m, 'no setDraftFiles');
  assert.ok(/addFiles\(picked, fls, MAX_FILES\)/.test(m[0]), 'setDraftFiles bypasses addFiles');
});

t('the note says what actually came back, not what the page can do', () => {
  // a phone out of room hands back the answers and no photos; being told they were kept and
  // then being sent back up the page on Submit is worse than not being told at all
  const m = SRC['f/index.html'].match(/function showDraftNote\(hasFileQ, keptFiles\)[\s\S]*?\n  \}/);
  assert.ok(m, 'showDraftNote does not take what was restored');
  assert.ok(/var warn = hasFileQ && !keptFiles;/.test(m[0]), 'the warning does not depend on what came back');
  assert.ok(/need choosing again/.test(m[0]), 'the warning is gone entirely');
});

t('/apply and /cast read the photo the form is holding, not the input', () => {
  // a file read back out of this browser can never be put into an <input type=file>, so the
  // validation and the upload have to ask the page rather than the element
  ['apply/index.html', 'cast/index.html'].forEach(p => {
    assert.ok(/var noPhoto = !chosenPhoto\(\);/.test(SRC[p]), p + ' validates against the input');
    assert.ok(/var file = chosenPhoto\(\);/.test(SRC[p]), p + ' uploads from the input');
    assert.ok(!/fileInput\.files\[0\]/.test(SRC[p].replace(/function chosenPhoto[^\n]*\n/, '')),
              p + ' still reads fileInput.files[0] somewhere');
  });
});

t('/apply and /cast forget a restored photo the moment another is picked', () => {
  // including a pick that came back empty — the picker was opened and closed again, and the
  // old photo must not reappear under the new one's absence
  ['apply/index.html', 'cast/index.html'].forEach(p => {
    const m = SRC[p].match(/fileInput\.addEventListener\("change", function \(\) \{[\s\S]*?\n  \}\);/);
    assert.ok(m, p + ' has no change handler');
    assert.ok(/restoredPhoto = null;/.test(m[0]), p + ' keeps the restored photo after a new pick');
    assert.ok(/syncDraftFiles\("photo",/.test(m[0]), p + ' does not keep the picked photo');
  });
});

run();
