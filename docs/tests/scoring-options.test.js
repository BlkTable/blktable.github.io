// Points on a choice have to survive the Options box. The builder rebuilds the whole
// choice list from that text on every save, so a token it cannot read is a price that
// silently becomes zero the next time somebody edits an unrelated question.
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

// parseChoice is one answer out of "English|عربي|pts:3"; parseChoiceList is the whole box,
// which still splits on commas as well as newlines for the text people typed there before
// the answers editor existed.
const { parseChoiceList, optsToString } =
  load('index.html', ['parseChoice', 'parseChoiceList', 'optsToString', 'linkRecordOptions']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// parseChoiceList builds its objects inside the vm context, so they carry that realm's
// Object prototype and deepStrictEqual rejects them against a literal written out here on
// reference-equality alone (see the same note in new-record.test.js). Compare the shape.
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg ||
  ('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)));

// ---- what the box already had to do, still working ----
t('plain English choices parse', () => {
  same(parseChoiceList('Yes, No'), [{ en: 'Yes', ar: '' }, { en: 'No', ar: '' }]);
});
t('English|Arabic still pairs up', () => {
  same(parseChoiceList('Yes|نعم'), [{ en: 'Yes', ar: 'نعم' }]);
});
t('other in its old third position still reads', () => {
  assert.strictEqual(parseChoiceList('Something else|غير ذلك|other')[0].other, true);
});
t('other with no Arabic still reads', () => {
  assert.strictEqual(parseChoiceList('Something else||other')[0].other, true);
});

// ---- the new tokens ----
t('pts: prices a choice', () => {
  assert.strictEqual(parseChoiceList('Excellent|ممتاز|pts:3')[0].points, 3);
});
t('a price with no Arabic still reads', () => {
  assert.strictEqual(parseChoiceList('Excellent||pts:3')[0].points, 3);
});
t('na marks a choice as not applicable', () => {
  assert.strictEqual(parseChoiceList('Not applicable|لا ينطبق|na')[0].na, true);
});
t('tokens are order independent and can combine', () => {
  const o = parseChoiceList('Other|أخرى|na|other|pts:2')[0];
  assert.strictEqual(o.na, true);
  assert.strictEqual(o.other, true);
  assert.strictEqual(o.points, 2);
});
t('a price of zero is kept, not dropped as falsy', () => {
  assert.strictEqual(parseChoiceList('Poor||pts:0')[0].points, 0);
});
t('a fractional price is kept', () => {
  assert.strictEqual(parseChoiceList('Half||pts:0.5')[0].points, 0.5);
});
t('a price that is not a number does not become NaN', () => {
  const o = parseChoiceList('Broken||pts:abc')[0];
  assert.ok(!('points' in o) || o.points === 0, 'expected no price rather than NaN, got: ' + JSON.stringify(o));
});
t('an unknown token is ignored rather than becoming a choice', () => {
  const list = parseChoiceList('Fine||wat');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].en, 'Fine');
});
t('blank entries are dropped', () => {
  same(parseChoiceList('Yes,,No').map(o => o.en), ['Yes', 'No']);
});

// ---- the trip back out ----
t('a priced choice round-trips through the text box', () => {
  const before = parseChoiceList('Excellent|ممتاز|pts:3, Poor||pts:0, N/A||na');
  const after = parseChoiceList(optsToString(before));
  assert.deepStrictEqual(after, before, 'round trip changed the list: ' + optsToString(before));
});
t('an unpriced choice does not gain a price on the way out', () => {
  assert.strictEqual(optsToString([{ en: 'Yes', ar: '' }]), 'Yes');
});
t('other still round-trips', () => {
  const before = parseChoiceList('Something else|غير ذلك|other');
  assert.deepStrictEqual(parseChoiceList(optsToString(before)), before);
});

if (!process.exitCode) console.log(n + ' passed');
