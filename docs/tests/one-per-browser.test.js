// One submission per browser, opt-in per form. Two things are worth pinning down here and
// they are both about not lying to the person reading the page: what it says to a browser
// that already has a place, and — the one that could take a form down — that the device key
// is never sent to a form that has not declared it takes one.
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
// A top-level `var NAME = ...;` the functions under test close over. Pulled out of the page
// rather than restated here, so the test cannot quietly use a different storage key than the
// page does — which is the whole reason these tests read the source instead of a copy.
function grabVar(js, name, file) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name + ' in ' + file);
  return m[0];
}
function load(file, names, extra, vars) {
  const js = scripts(file);
  const ctx = Object.assign({ console }, extra || {});
  // the page runs where window IS the global, so a bare `crypto` resolves to window.crypto
  if (ctx.window && ctx.window.crypto && !ctx.crypto) ctx.crypto = ctx.window.crypto;
  vm.createContext(ctx);
  new vm.Script('(function(){' + (vars || []).map(v => grabVar(js, v, file)).join('\n') + '\n' +
    names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}
const KEYVAR = ['DEVICE_STORE'];

const SRC = scripts('f/index.html');
const F = load('f/index.html', ['alreadyText']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- what it says to a browser that already signed up ----
t('no existing signup means nothing to say', () => {
  assert.strictEqual(F.alreadyText(null), null);
  assert.strictEqual(F.alreadyText(undefined), null);
});
t('a confirmed place says so, and says who to contact', () => {
  const a = F.alreadyText({ slot: 'confirmed' });
  assert.ok(/already have a place/i.test(a.head), a.head);
  // there is no cancel button by decision, so the page has to name the way out
  assert.ok(/Faisal|Waleed/.test(a.body), a.body);
});
t('a backup place is never described as having a place', () => {
  const a = F.alreadyText({ slot: 'backup' });
  assert.ok(/backup/i.test(a.head), a.head);
  assert.ok(!/already have a place/i.test(a.head), a.head);
  assert.ok(/if someone drops out/i.test(a.body), a.body);
});
t('a signup with no slot still reports as signed up', () => {
  // a one-per-browser form with no capacity declared writes no slot at all
  const a = F.alreadyText({ slot: null });
  assert.ok(/already signed up/i.test(a.head), a.head);
  assert.ok(!/backup/i.test(a.head), a.head);
});
t('every branch returns both a heading and a body', () => {
  [{ slot: 'confirmed' }, { slot: 'backup' }, { slot: null }].forEach(m => {
    const a = F.alreadyText(m);
    assert.ok(a.head && a.head.length > 4, JSON.stringify(m));
    assert.ok(a.body && a.body.length > 20, JSON.stringify(m));
  });
});

// ---- the outage guard: the payload again ----
// PostgREST resolves an RPC by the keys in the request body. A fourth key sent to a database
// that still has the three-argument submit_public_form resolves to nothing and the submit
// button dies. So p_device is added only when there is one, and there is only one when the
// form itself declared one_per_device — which cannot be true before the migration.
t('p_device is added conditionally, never passed inline', () => {
  assert.ok(/if \(submitDevice\) payload\.p_device = submitDevice;/.test(SRC),
    'p_device is not added conditionally');
  const inline = /db\.rpc\("submit_public_form",\s*\{[^}]*\}/.exec(SRC);
  assert.strictEqual(inline, null, 'submit_public_form called with an inline object: ' + (inline && inline[0]));
});
t('the device key is only minted for a form that declared one_per_device', () => {
  assert.ok(/var onePer = !!\(table\.config && table\.config\.one_per_device\);/.test(SRC),
    'the opt-in is not read off the form config');
  assert.ok(/var myKey = onePer \? deviceKey\(\) : null;/.test(SRC),
    'deviceKey() is called regardless of the opt-in');
});
t('the ordinary two-key payload is still built exactly as it was', () => {
  // every one of the 226 existing forms takes this path and must be untouched
  assert.ok(/var payload = \{ p_slug: slug, p_data: data \};/.test(SRC));
});

// ---- storage that refuses to work ----
t('deviceKey swallows a storage failure instead of throwing', () => {
  // private mode in some browsers, storage disabled, an embedded webview: with no key the
  // form must behave as it always did, not refuse a real person
  const api = load('f/index.html', ['deviceKey'], {
    window: { localStorage: { getItem() { throw new Error('denied'); }, setItem() {} } }
  }, KEYVAR);
  assert.strictEqual(api.deviceKey(), null);
});
t('deviceKey reuses the id it already stored', () => {
  const store = { blk_device: 'kept-id' };
  const api = load('f/index.html', ['deviceKey'], {
    window: { localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } } }
  }, KEYVAR);
  assert.strictEqual(api.deviceKey(), 'kept-id');
});
t('deviceKey mints and stores one when there is none, and is stable after', () => {
  const store = {};
  const api = load('f/index.html', ['deviceKey'], {
    window: { localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
              crypto: { randomUUID: () => 'minted-id' } }
  }, KEYVAR);
  assert.strictEqual(api.deviceKey(), 'minted-id');
  assert.strictEqual(store.blk_device, 'minted-id');
  assert.strictEqual(api.deviceKey(), 'minted-id', 'a second call minted a different id');
});
t('deviceKey still works where crypto.randomUUID does not exist', () => {
  const store = {};
  const api = load('f/index.html', ['deviceKey'], {
    window: { localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } } }
  }, KEYVAR);
  const k = api.deviceKey();
  assert.ok(k && k.length > 8, k);
  assert.strictEqual(api.deviceKey(), k);
});

console.log(n + ' one-per-browser tests passed');
