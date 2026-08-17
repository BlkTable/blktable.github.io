// Conditional questions: app_fields.show_if, the rule that decides whether a question is
// being asked at all. Pulled out of both pages by name, because the public form and the
// dashboard each carry a copy and they must agree — a form that asks a question the review
// panel then hides (or the reverse) is the failure this file is here to catch.
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
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const DASH = load('index.html', ['condMet', 'condLabel']);
const FORM = load('f/index.html', ['condMet']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
// the same case must answer the same on the public form and in the dashboard
const both = (name, f, data, expected) => {
  t(name + ' (dashboard)', () => assert.strictEqual(DASH.condMet(f, data), expected));
  t(name + ' (public form)', () => assert.strictEqual(FORM.condMet(f, data), expected));
};

const gate = 'f-uni';
const dependent = { id: 'f-which', show_if: { field: gate, equals: ['Yes'] } };

// ---- the ordinary case ----
both('asked when the gate matches', dependent, { [gate]: 'Yes' }, true);
both('not asked when the gate says otherwise', dependent, { [gate]: 'No' }, false);
both('not asked while the gate is unanswered', dependent, {}, false);
both('not asked when the gate is null', dependent, { [gate]: null }, false);
both('not asked when the gate is blank', dependent, { [gate]: '' }, false);

// ---- every field written before this feature existed ----
both('no condition means always asked', { id: 'a' }, {}, true);
both('a null condition means always asked', { id: 'a', show_if: null }, {}, true);
both('a condition naming no field is ignored', { id: 'a', show_if: { equals: ['Yes'] } }, {}, true);
both('a missing data object is not a crash', dependent, null, false);
both('an undefined field is not a crash', undefined, {}, true);

// ---- several accepted answers, and "answered at all" ----
const multi = { id: 'm', show_if: { field: gate, equals: ['Yes', 'Maybe'] } };
both('any listed answer opens it', multi, { [gate]: 'Maybe' }, true);
both('an unlisted answer does not', multi, { [gate]: 'Later' }, false);
const anyAns = { id: 'p', show_if: { field: gate } };
both('no list means "as long as it is answered"', anyAns, { [gate]: 'anything' }, true);
both('no list still needs an answer', anyAns, { [gate]: '' }, false);
const single = { id: 's', show_if: { field: gate, equals: 'Yes' } };
both('a bare value works like a list of one', single, { [gate]: 'Yes' }, true);

// ---- answers are compared as text, the way the form stores them ----
const numGate = { id: 'ng', show_if: { field: 'f-n', equals: [4] } };
both('a number matches its text', numGate, { 'f-n': '4' }, true);
both('a number does not match a different one', numGate, { 'f-n': '5' }, false);
// a multi-select stores "A, B" — comma-joined, exactly as Airtable does. Matching now checks
// membership, so "show if the answer includes Clean" fires even when more than one is chosen.
// (This replaced the earlier whole-string-only rule so BLKTable can mirror Airtable's forms.)
const ms = { id: 'x', show_if: { field: 'f-ms', equals: ['Clean'] } };
both('a multi-select answer matches on any chosen part', ms, { 'f-ms': 'Clean, Organized' }, true);

// ---- how it reads on screen (dashboard only) ----
const fields = [{ id: gate, label: 'Did you go to university?' }, dependent];
t('label names the question and the answer', () =>
  assert.strictEqual(DASH.condLabel(dependent, fields), 'only if Did you go to university? = Yes'));
t('label lists every accepted answer', () =>
  assert.strictEqual(DASH.condLabel(multi, fields), 'only if Did you go to university? = Yes / Maybe'));
t('label without a list says "is answered"', () =>
  assert.strictEqual(DASH.condLabel(anyAns, fields), 'only if Did you go to university? is answered'));
t('an unconditional field has no label', () => assert.strictEqual(DASH.condLabel({ id: 'a' }, fields), ''));
t('a condition on a deleted question has no label', () =>
  assert.strictEqual(DASH.condLabel(dependent, [{ id: 'other', label: 'x' }]), ''));

// ---- multi_select driver: "show if the answer INCLUDES x" (Airtable-style) ----
// A multi_select answer is stored comma-joined; the sub-question must appear when its value
// is one of several chosen, not only when it is the sole choice.
const msCond = { id: 's', show_if: { field: gate, equals: ['Product'] } };
both('a sole multi-select answer still matches', msCond, { [gate]: 'Product' }, true);
both('one of several chosen answers matches', msCond, { [gate]: 'Customer Service, Product' }, true);
both('matches regardless of position in the list', msCond, { [gate]: 'Product, Shop Atmosphere' }, true);
both('no comma spacing still matches', msCond, { [gate]: 'Customer Service,Product' }, true);
both('a near-miss substring does not match', msCond, { [gate]: 'Product Issue' }, false);
both('an unrelated multi answer does not match', msCond, { [gate]: 'Customer Service, Other' }, false);

console.log(n + ' tests passed');
