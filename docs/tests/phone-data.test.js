// The two generated tables, pinned. Nothing here tests behaviour: it tests that the DATA in
// the page is the data we think it is, because every function in the next file is only as
// right as these two strings. Both pages carry the same copy, so the last test is the one
// that matters most: a table right on one page and stale on the other is the shape of the
// outage in 6cc5a29.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
// Anchored to the end of the LINE, not to a following "\n": the working tree is CRLF, so a
// pattern ending `;\n` matches nothing here and the declaration reads as missing.
function grabVar(js, name, file) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name + ' in ' + file);
  return m[0];
}
function vars(js, names, file) {
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grabVar(js, n, file)).join('\n') +
                '\nthis.OUT={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.OUT;
}
const SRC = scripts('index.html'), FSRC = scripts('f/index.html');
const D = vars(SRC, ['PHONE_ROWS', 'TZ_ISO'], 'index.html');
const F = vars(FSRC, ['PHONE_ROWS', 'TZ_ISO'], 'f/index.html');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const rows = D.PHONE_ROWS.split(';').map(r => {
  const p = r.split('~');
  return { iso: p[0], cc: p[1], len: p[2].split('').map(x => parseInt(x, 36)), ph: p[3], pat: p[4], name: p[5], pri: p[6] };
});
const byIso = {}; rows.forEach(r => { byIso[r.iso] = r; });

// ---- the dial table ------------------------------------------------------------------
t('245 countries, every field present', () => {
  assert.strictEqual(rows.length, 245);
  rows.forEach(r => {
    assert.ok(/^[A-Z]{2}$/.test(r.iso), 'bad iso ' + r.iso);
    assert.ok(/^[0-9]{1,4}$/.test(r.cc), r.iso + ' has a bad dial code: ' + r.cc);
    assert.ok(r.len.length > 0 && r.len.every(x => x >= 2 && x <= 17), r.iso + ' has bad lengths');
    assert.ok(r.ph && /^[0-9]+$/.test(r.ph), r.iso + ' has no example number');
    assert.ok(r.pat && r.pat.length > 1, r.iso + ' has no pattern');
    assert.ok(r.name && r.name.length > 1, r.iso + ' has no name');
  });
});
t('the separators never appear inside a field', () => {
  // ~ and ; were chosen by measurement: the patterns contain |, , and : and would corrupt
  // exactly one country each, silently.
  rows.forEach(r => {
    [r.ph, r.pat, r.name].forEach(v => {
      assert.ok(v.indexOf('~') === -1, r.iso + ' has a ~ in a field');
      assert.ok(v.indexOf(';') === -1, r.iso + ' has a ; in a field');
    });
  });
});
t('the four house countries read as expected', () => {
  assert.strictEqual(byIso.JO.cc, '962');
  assert.strictEqual(byIso.LB.cc, '961');
  assert.strictEqual(byIso.SY.cc, '963');
  assert.strictEqual(byIso.IQ.cc, '964');
  // Per country rather than hand written, so these are libphonenumber's and include
  // landlines. Jordan was "exactly 9" before this change.
  assert.deepStrictEqual(byIso.JO.len, [8, 9]);
  assert.deepStrictEqual(byIso.LB.len, [7, 8]);
  assert.deepStrictEqual(byIso.SY.len, [8, 9]);
  assert.deepStrictEqual(byIso.IQ.len, [8, 9, 10]);
  assert.strictEqual(byIso.JO.name, 'Jordan');
});
t('every example number satisfies its own row', () => {
  // 245 assertions the generator gives away free, and the whole validation approach in one
  // line: if a country's own example fails its own rule, the rule is wrong.
  rows.forEach(r => {
    assert.ok(r.len.indexOf(r.ph.length) !== -1, r.iso + ' example is not a valid length');
    assert.ok(new RegExp('^(?:' + r.pat + ')$').test(r.ph), r.iso + ' example does not match its pattern');
  });
});
t('a shared dial code names exactly one primary country', () => {
  const byDial = {};
  rows.forEach(r => { (byDial[r.cc] = byDial[r.cc] || []).push(r); });
  const shared = Object.keys(byDial).filter(d => byDial[d].length > 1);
  assert.strictEqual(shared.length, 12, 'expected 12 shared dial codes, got ' + shared.length);
  shared.forEach(d => {
    const pri = byDial[d].filter(r => r.pri);
    assert.strictEqual(pri.length, 1, '+' + d + ' has ' + pri.length + ' primary countries');
  });
  // The ones that would be visibly wrong without it.
  assert.strictEqual(byDial['1'].filter(r => r.pri)[0].iso, 'US');
  assert.strictEqual(byDial['44'].filter(r => r.pri)[0].iso, 'GB');
  assert.strictEqual(byDial['7'].filter(r => r.pri)[0].iso, 'RU');
  assert.strictEqual(byDial['39'].filter(r => r.pri)[0].iso, 'IT');
});

// ---- the names the country question already stores -----------------------------------
t('every country name the page stores has a dial row', () => {
  // The picker and the country question must read the same, and a changed name string is a
  // country question whose stored answers stop resolving. Seven names disagree with the
  // packages and are overridden in the generator; this is what proves all seven landed.
  const ours = JSON.parse(grabVar(FSRC, 'COUNTRY_NAMES_ALL', 'f/index.html').match(/\[.*\]/)[0]);
  assert.strictEqual(ours.length, 197);
  const emitted = {}; rows.forEach(r => { emitted[r.name] = (emitted[r.name] || 0) + 1; });
  const missing = ours.filter(x => !emitted[x]);
  assert.deepStrictEqual(missing, [], 'names with no dial row: ' + JSON.stringify(missing));
  ['Cote d\'Ivoire', 'Turkey', 'United States', 'Vatican City', 'Kosovo',
   'Congo (Brazzaville)', 'Congo (Kinshasa)'].forEach(x => {
    assert.strictEqual(emitted[x], 1, x + ' appears ' + emitted[x] + ' times');
  });
});

// ---- the zone map --------------------------------------------------------------------
const zones = {};
D.TZ_ISO.split(';').forEach(p => { const i = p.indexOf('~'); zones[p.slice(0, i)] = p.slice(i + 1); });
t('541 zones, each naming one country', () => {
  assert.strictEqual(Object.keys(zones).length, 541);
  Object.keys(zones).forEach(z => assert.ok(/^[A-Z]{2}$/.test(zones[z]), z + ' maps to ' + zones[z]));
});
t('a zone shared between countries resolves to the one it is named for', () => {
  // tzdata gives one canonical zone to every country sharing its rules, so Africa/Abidjan
  // covers twelve countries including Iceland. Read naively, this map sends Dubai to the
  // French Southern Territories, Riyadh to Yemen and Berlin to Svalbard.
  assert.strictEqual(zones['Africa/Abidjan'], 'CI');
  assert.strictEqual(zones['Asia/Dubai'], 'AE');
  assert.strictEqual(zones['Asia/Riyadh'], 'SA');
  assert.strictEqual(zones['Europe/Berlin'], 'DE');
  assert.strictEqual(zones['Europe/London'], 'GB');
});
t('deprecated zone names are present', () => {
  // Browsers still report these, and ICU treats several as canonical. Without them India,
  // Ukraine, Myanmar and Argentina silently stop pre-filling.
  assert.strictEqual(zones['Asia/Calcutta'], 'IN');
  assert.strictEqual(zones['Asia/Kolkata'], 'IN');
  assert.strictEqual(zones['Europe/Kiev'], 'UA');
  assert.strictEqual(zones['Europe/Kyiv'], 'UA');
  assert.strictEqual(zones['Asia/Rangoon'], 'MM');
  assert.strictEqual(zones['America/Buenos_Aires'], 'AR');
});
t('our four are there, and so is the shape of a non-answer', () => {
  assert.strictEqual(zones['Asia/Amman'], 'JO');
  assert.strictEqual(zones['Asia/Beirut'], 'LB');
  assert.strictEqual(zones['Asia/Baghdad'], 'IQ');
  assert.strictEqual(zones['Asia/Damascus'], 'SY');
  assert.ok(!zones['UTC'], 'UTC must not map to a country: a hardened browser reporting it is a non-answer, not a guess');
});

// ---- one copy, two pages -------------------------------------------------------------
t('both pages carry the same tables, character for character', () => {
  assert.strictEqual(F.PHONE_ROWS, D.PHONE_ROWS, 'PHONE_ROWS differs between the pages');
  assert.strictEqual(F.TZ_ISO, D.TZ_ISO, 'TZ_ISO differs between the pages');
});
t('the generated block is marked as generated in both pages', () => {
  [['index.html', SRC], ['f/index.html', FSRC]].forEach(([f, js]) => {
    assert.ok(js.indexOf('BEGIN GENERATED phone data') !== -1, f + ' has no begin marker');
    assert.ok(js.indexOf('END GENERATED phone data') !== -1, f + ' has no end marker');
  });
});
t('the old four-country lists are gone', () => {
  assert.ok(!/\n  var COUNTRIES = \[/.test(SRC), 'index.html still declares var COUNTRIES');
  assert.ok(!/\n  var COUNTRIES = \[/.test(FSRC), 'f/index.html still declares var COUNTRIES');
  // Task 5 restores this: Task 1 deliberately leaves COUNTRIES_ED alive so the record editor
  // keeps working until its replacement exists.
  // assert.ok(!/COUNTRIES_ED/.test(SRC), 'index.html still mentions COUNTRIES_ED');
});

console.log(n + ' passed');
