// Sending many photos in one submission.
//
// The shop QC form asks 52 photo questions. Both pages used to fire every chosen photo at the
// file server at once and fail the whole submission on the first refusal, which meant pressing
// Submit again re-uploaded all 52 and refilled the per-IP bucket that had just overflowed. On
// 2026-08-23 one Lebanon shop pressed Submit through ~1,100 uploads and 262 refusals across
// eight minutes and not a single submission landed.
//
// So the tests here are not about a helper returning a tidy value. They are about the three
// properties that stop that from happening again:
//
//   1. no more than UPLOAD_LANES uploads are ever in flight, so the bucket is not overflowed
//      by one press of Submit;
//   2. a refusal is waited out and retried, using the server's own reset when it gives one;
//   3. a file already in the bucket is never uploaded twice, so a second press costs only what
//      is left. Without this one, 1 and 2 only slow the storm down.
//
// The queue lives in BOTH pages (the public form and the record editor), the way condMet and
// the size ceilings do, so the last tests read both files and fail if the copies drift.

const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(path) {
  const src = fs.readFileSync(path, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
const APP = scripts('index.html');
const PUB = scripts('f/index.html');
const APP_SRC = fs.readFileSync('index.html', 'utf8');
const PUB_SRC = fs.readFileSync('f/index.html', 'utf8');

// Brace-matched, so a one-line function is taken whole instead of running on to the next
// "\n  }" and dragging whatever sits between them into the sandbox.
function grab(js, name) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('could not find function ' + name);
  const open = js.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    const c = js[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
function grabVar(js, name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [\\s\\S]*?;(?=\\r?\\n)'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}

// `wait` and `storageUpload` are replaced rather than grabbed: the real ones sleep for whole
// seconds and talk to R2. Everything else is the page's own code, so a rewrite that breaks the
// lane count or the memo fails here rather than in a shop.
function load(js) {
  const code = ['UPLOAD_LANES', 'UPLOAD_TRIES', 'UPLOAD_MAX_WAIT_MS', 'UPLOADED'].map(v => grabVar(js, v)).join('\n')
    + '\n' + ['retryAfterMs', 'worthRetry', 'uploadWithRetry', 'uploadAll'].map(f => grab(js, f)).join('\n');
  const ctx = { console, Promise, WeakMap, Math, isFinite, parseInt, setTimeout };
  vm.createContext(ctx);
  new vm.Script(
    '(function(){' +
    // recorded, not slept through
    'var WAITS = [];' +
    'function wait(ms) { WAITS.push(ms); return Promise.resolve(); }' +
    'var UPLOADS = [];' +
    'var behaviour = null;' +
    'function storageUpload(file) { UPLOADS.push(file); return behaviour(file); }' +
    code +
    '\n this.API = { retryAfterMs: retryAfterMs, worthRetry: worthRetry, uploadWithRetry: uploadWithRetry,' +
    ' uploadAll: uploadAll, LANES: UPLOAD_LANES, TRIES: UPLOAD_TRIES, MAX_WAIT: UPLOAD_MAX_WAIT_MS,' +
    ' waits: WAITS, uploads: UPLOADS, set: function (b) { behaviour = b; UPLOADS.length = 0; WAITS.length = 0; } };' +
    '}).call(this)').runInContext(ctx);
  return ctx.API;
}
const A = load(APP);
const P = load(PUB);

// A header bag shaped like fetch's, which is all retryAfterMs is allowed to assume.
const res = h => ({ headers: { get: n => (Object.prototype.hasOwnProperty.call(h, n) ? h[n] : null) } });
const err = (status, extra) => Object.assign(new Error('upload_failed_' + status), { status }, extra || {});
// Values built inside the vm have that context's Array/Object prototypes, so deepStrictEqual
// on them fails on the realm rather than on the value. Compared as plain data instead.
const plain = v => JSON.parse(JSON.stringify(v));
const files = n => Array.from({ length: n }, (_, i) => ({ id: 'q' + i, file: { name: 'p' + i + '.jpg' } }));

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---- which failures are worth another try --------------------------------
t('a refusal, a timeout and a dead connection are all retried', () => {
  [A, P].forEach(api => {
    assert.ok(api.worthRetry(err(429)), '429 is the shop over its per-IP minute');
    assert.ok(api.worthRetry(err(408)), '408 is the gateway giving up on a slow body');
    assert.ok(api.worthRetry(err(425)));
    assert.ok(api.worthRetry(err(500)) && api.worthRetry(err(502)) && api.worthRetry(err(503)));
    // a fetch that rejects outright carries no status at all, and on a phone that is the
    // commonest failure of the lot
    assert.ok(api.worthRetry(new Error('Load failed')));
    assert.ok(api.worthRetry(undefined));
  });
});
t('a file the server will never accept is not retried', () => {
  [A, P].forEach(api => {
    [400, 401, 403, 404, 413, 415, 422].forEach(s => {
      assert.ok(!api.worthRetry(err(s)), s + ' must not be retried: the answer will not change');
    });
  });
});

// ---- how long to wait ----------------------------------------------------
t("the server's own Retry-After is used, in milliseconds", () => {
  [A, P].forEach(api => assert.strictEqual(api.retryAfterMs(res({ 'Retry-After': '12' })), 12000));
});
t('RateLimit-Reset is used when there is no Retry-After', () => {
  [A, P].forEach(api => assert.strictEqual(api.retryAfterMs(res({ 'RateLimit-Reset': '38' })), 38000));
});
t('Retry-After wins when both are sent', () => {
  [A, P].forEach(api =>
    assert.strictEqual(api.retryAfterMs(res({ 'Retry-After': '5', 'RateLimit-Reset': '38' })), 5000));
});
// An hour bucket resets in up to 3600s. Holding a person on a spinner for an hour is not
// waiting it out, it is a hung page, so the wait is capped and the caller is told instead.
t('an hour-long reset is capped, not obeyed', () => {
  [A, P].forEach(api => assert.strictEqual(api.retryAfterMs(res({ 'Retry-After': '3599' })), api.MAX_WAIT));
});
t('a missing, empty or nonsense header means no number at all', () => {
  [A, P].forEach(api => {
    assert.strictEqual(api.retryAfterMs(res({})), 0);
    assert.strictEqual(api.retryAfterMs(res({ 'Retry-After': '' })), 0);
    assert.strictEqual(api.retryAfterMs(res({ 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' })), 0);
    assert.strictEqual(api.retryAfterMs(res({ 'Retry-After': '-4' })), 0);
    assert.strictEqual(api.retryAfterMs(null), 0, 'a rejected fetch has no response to read');
    assert.strictEqual(api.retryAfterMs({}), 0);
  });
});

// ---- the lane limit ------------------------------------------------------
// The property that keeps one press of Submit from overflowing the bucket. Fifty-two photos
// fired at once is the bug; three at a time is the fix.
t('never more than UPLOAD_LANES uploads are in flight', async () => {
  for (const api of [A, P]) {
    let live = 0, peak = 0;
    const held = [];
    api.set(() => {
      live++; peak = Math.max(peak, live);
      return new Promise(done => held.push(() => { live--; done('path'); }));
    });
    const all = api.uploadAll(files(52), null);
    // let each settled lane pick up its next item
    while (held.length) { held.shift()(); await Promise.resolve(); await Promise.resolve(); }
    await all;
    assert.strictEqual(peak, api.LANES, 'peak in flight');
  }
});
t('fewer files than lanes still runs, and an empty list is not a hang', async () => {
  for (const api of [A, P]) {
    api.set(() => Promise.resolve('p'));
    assert.deepStrictEqual(plain(await api.uploadAll([], null)), []);
    const two = await api.uploadAll(files(2), null);
    assert.strictEqual(two.length, 2);
  }
});

// ---- what comes back -----------------------------------------------------
t('answers come back in the order asked, whichever lane finished first', async () => {
  for (const api of [A, P]) {
    // the last question resolves first, so a queue that returned completion order would
    // write each photo against the wrong question
    api.set(f => new Promise(done => setTimeout(() => done('r2/' + f.name), f.name === 'p0.jpg' ? 20 : 1)));
    const out = await api.uploadAll(files(4), null);
    assert.deepStrictEqual(plain(out.map(r => r.id)), ['q0', 'q1', 'q2', 'q3']);
    assert.deepStrictEqual(plain(out.map(r => r.path)), ['r2/p0.jpg', 'r2/p1.jpg', 'r2/p2.jpg', 'r2/p3.jpg']);
  }
});
t('progress is reported from none to all', async () => {
  for (const api of [A, P]) {
    api.set(() => Promise.resolve('p'));
    const seen = [];
    await api.uploadAll(files(5), (done, total) => seen.push(done + '/' + total));
    assert.strictEqual(seen[0], '0/5', 'the count must appear before the first upload, not after it');
    assert.strictEqual(seen[seen.length - 1], '5/5');
    assert.strictEqual(seen.length, 6);
  }
});

// ---- retrying ------------------------------------------------------------
t('a refusal is waited out and the upload still lands', async () => {
  for (const api of [A, P]) {
    let calls = 0;
    api.set(() => (++calls < 3 ? Promise.reject(err(429, { retryAfterMs: 7000 })) : Promise.resolve('p')));
    const out = await api.uploadAll(files(1), null);
    assert.deepStrictEqual(plain(out), [{ id: 'q0', path: 'p' }]);
    assert.strictEqual(calls, 3, 'refused twice, third try landed');
    // the server's number, plus jitter so fifty photos behind one refusal do not all return
    // in the same instant and refuse each other again
    api.waits.forEach(w => assert.ok(w >= 7000 && w < 7900, 'waited ' + w + 'ms, expected the server\'s 7s'));
  }
});
t('a refusal with no number still backs off rather than hammering', async () => {
  for (const api of [A, P]) {
    let calls = 0;
    api.set(() => (++calls < 2 ? Promise.reject(err(429)) : Promise.resolve('p')));
    await api.uploadAll(files(1), null);
    assert.ok(api.waits[0] >= 3000, 'a retry with no server number must still wait, got ' + api.waits[0]);
  }
});
t('a file that will never be accepted is tried exactly once', async () => {
  for (const api of [A, P]) {
    api.set(() => Promise.reject(err(413)));
    await assert.rejects(api.uploadAll(files(1), null), e => e.status === 413);
    assert.strictEqual(api.uploads.length, 1, 'retrying a 413 only makes somebody wait for the same answer');
  }
});
t('a refusal that never clears gives up after UPLOAD_TRIES and says which status it was', async () => {
  for (const api of [A, P]) {
    api.set(() => Promise.reject(err(429)));
    await assert.rejects(api.uploadAll(files(1), null), e => e.status === 429);
    assert.strictEqual(api.uploads.length, api.TRIES);
  }
});

// ---- the memo: why a second press of Submit is cheap ----------------------
// This is the test that matters. Without the memo, retrying a 52-photo form re-uploads all 52,
// refilling the bucket that refused it, and the form can never recover.
t('a second run only uploads what the first one did not manage', async () => {
  for (const api of [A, P]) {
    const items = files(6);
    // the fifth photo is refused for good, so the submission fails with four already stored
    api.set(f => (f.name === 'p4.jpg' ? Promise.reject(err(400)) : Promise.resolve('r2/' + f.name)));
    await assert.rejects(api.uploadAll(items, null));
    const firstRun = api.uploads.length;
    assert.ok(firstRun >= 5, 'sanity: the first run did upload something');

    // they fix the fifth photo and press Submit again. Only the files with no path go up.
    const fixed = items.slice();
    fixed[4] = { id: 'q4', file: { name: 'p4-smaller.jpg' } };
    api.set(f => Promise.resolve('r2/' + f.name));
    const out = await api.uploadAll(fixed, null);
    const again = plain(api.uploads.map(f => f.name));
    assert.deepStrictEqual(again.filter(nm => /^p[0-3]\.jpg$/.test(nm)), [],
      'a photo already in the bucket must not go up a second time');
    assert.ok(again.indexOf('p4-smaller.jpg') !== -1, 'the replaced photo does go up');
    assert.ok(again.length <= 2, 'a second press must cost only what is left, got ' + again.join(', '));
    assert.strictEqual(out.length, 6, 'and the submission still carries all six answers');
    assert.strictEqual(out[0].path, 'r2/p0.jpg', 'the remembered path is the one submitted');
  }
});
t('the same file chosen for two questions is uploaded once', async () => {
  for (const api of [A, P]) {
    const one = { name: 'same.jpg' };
    api.set(() => Promise.resolve('r2/same'));
    const out = await api.uploadAll([{ id: 'qa', file: one }, { id: 'qb', file: one }], null);
    assert.strictEqual(api.uploads.length, 1);
    assert.deepStrictEqual(plain(out), [{ id: 'qa', path: 'r2/same' }, { id: 'qb', path: 'r2/same' }]);
  }
});

// ---- the callers ---------------------------------------------------------
// payroll.test.js passing 16/16 while the export was broken is the reason these exist: a queue
// tested in isolation says nothing about whether either page actually uses it.
t('neither page fires its uploads all at once any more', () => {
  assert.ok(!/Promise\.all\(uploads\)/.test(PUB_SRC),
    'the public form must send photos through uploadAll, not Promise.all over every chosen file');
  assert.ok(!/Promise\.all\(shots\.map/.test(APP_SRC),
    'adding a record by hand must do the same');
});
t('both pages send their photos through the queue', () => {
  assert.ok(/uploadAll\(toUpload,/.test(PUB_SRC), 'f/index.html submit');
  assert.ok(/uploadAll\(shots\.map/.test(APP_SRC), 'index.html new record');
});
t('both pages carry the status through from the file server', () => {
  // without this the queue cannot tell "wait, we are throttled" from "this file is too big",
  // and every failure is either retried pointlessly or given up on immediately
  assert.ok(/e\.status = r\.status;[\s\S]{0,80}e\.retryAfterMs = retryAfterMs\(r\);/.test(PUB_SRC), 'f/index.html');
  assert.ok(/e\.status = r\.status;[\s\S]{0,80}e\.retryAfterMs = retryAfterMs\(r\);/.test(APP_SRC), 'index.html');
});
t('both pages tell a throttled person to wait, and that nothing is sent twice', () => {
  [['f/index.html', PUB_SRC], ['index.html', APP_SRC]].forEach(([name, src]) => {
    const m = src.match(/Too many photos are going up[^"]*/);
    assert.ok(m, name + ' must name the refusal in words a person can act on');
    assert.ok(/Wait a minute/.test(m[0]), name + ': "try again" with no wait is what caused the storm');
    assert.ok(/not sent twice/.test(m[0]), name + ': the reason waiting is safe has to be said');
  });
});
t('the queue is the same size in both pages', () => {
  assert.strictEqual(A.LANES, P.LANES);
  assert.strictEqual(A.TRIES, P.TRIES);
  assert.strictEqual(A.MAX_WAIT, P.MAX_WAIT);
});
t('the progress count is shown while photos are going up', () => {
  assert.ok(/Uploading photo " \+ \(upDone \+ 1\) \+ " of " \+ upTotal/.test(PUB_SRC), 'f/index.html');
  assert.ok(/Uploading photo " \+ \(upDone \+ 1\) \+ " of " \+ upTotal/.test(APP_SRC), 'index.html');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); n++; }
    catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; }
  }
  console.log(n + '/' + tests.length + ' upload-queue tests passed');
})();
