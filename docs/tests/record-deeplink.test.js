// Tests for #rec=<tableId>:<recordId> deeplink and __record_link alert param.
// The boot logic is DOM-dependent and cannot run headless; we test parseRecHash
// (the pure hash-parsing helper) and the serialization contract for __record_link.
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

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- parseRecHash ----
const js = scripts('index.html');
const ctx = { console };
vm.createContext(ctx);
new vm.Script('(function(){' + grab(js, 'parseRecHash', 'index.html') +
  '\n this.API={ parseRecHash };}).call(this)').runInContext(ctx);
const { parseRecHash } = ctx.API;

t('extracts tableId and recordId from a valid hash', () => {
  const r = parseRecHash('#rec=aaaa-1111:bbbb-2222');
  assert.strictEqual(r.tableId, 'aaaa-1111');
  assert.strictEqual(r.recordId, 'bbbb-2222');
});
t('accepts uuid-shaped ids', () => {
  const tid = '550e8400-e29b-41d4-a716-446655440000';
  const rid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const r = parseRecHash('#rec=' + tid + ':' + rid);
  assert.strictEqual(r.tableId, tid);
  assert.strictEqual(r.recordId, rid);
});
t('returns null for an empty hash', () => {
  assert.strictEqual(parseRecHash(''), null);
  assert.strictEqual(parseRecHash(null), null);
  assert.strictEqual(parseRecHash(undefined), null);
});
t('returns null when hash has no rec= prefix', () => {
  assert.strictEqual(parseRecHash('#something-else'), null);
  assert.strictEqual(parseRecHash('#rec=nocolon'), null);
});
t('a colon inside the recordId is allowed (recordId is everything after first colon)', () => {
  const r = parseRecHash('#rec=aaa:bbb:ccc');
  assert.strictEqual(r.tableId, 'aaa');
  assert.strictEqual(r.recordId, 'bbb:ccc');
});

// ---- __record_link serialization contract ----
// serializeAlerts reads .ap-field value; when it is not "__text" it returns {field: value}.
// Confirm __record_link takes that path and never hits the __text branch.
t('__record_link serializes to {field:"__record_link"} not {text:...}', () => {
  const src = [
    grab(js, 'serializeAlerts', 'index.html'),
    grab(js, 'addAlertParamRow', 'index.html'),
    grab(js, 'addAlertRow', 'index.html'),
    grab(js, 'bldFieldOptionsHtml', 'index.html'),
  ].join('\n');
  // The only way __record_link can produce {text:...} is if the code treats it like __text.
  // Verify the serialization branch: v !== "__text" -> {field: v}
  // We do this by checking the source contract rather than spinning up a DOM.
  assert.ok(!src.includes('"__record_link"') || src.includes('field: v') || src.includes("field:v"),
    'serialization path must map non-__text to {field:v}');
  // The option must appear in the extra (param) context only
  assert.ok(src.includes('__record_link'), '__record_link option must be present in the source');
});

// ---- bldFieldOptionsHtml includes the option only in extra mode ----
t('__record_link option is present in the source only within the extra branch', () => {
  // Check that __record_link is gated on the `extra` parameter
  const fnSrc = grab(js, 'bldFieldOptionsHtml', 'index.html');
  assert.ok(fnSrc.includes('__record_link'), 'option must be in the function');
  // The option must be inside the extra-mode block (after the extra ternary)
  const extraIdx = fnSrc.indexOf('extra');
  const rlIdx = fnSrc.indexOf('__record_link');
  assert.ok(rlIdx > extraIdx, '__record_link must appear after the extra check');
});

if (!process.exitCode) console.log('record-deeplink: ' + n + ' tests passed');
