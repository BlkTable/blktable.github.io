// One name, one list. Each page is a single inline script, so `var X` twice at the top level
// is not two variables — it is one, and whichever assignment runs last wins for every caller
// of both. Nothing throws. Nothing logs. The first list simply stops existing.
//
// This has now happened twice, which is why it is a test and not a note:
//
//   COUNTRIES, 2026-08-18 — PR #42 added a list of country NAMES beside the existing list of
//   dial codes. COUNTRIES[0] became the string "Afghanistan", so every phone question on 34
//   live public forms showed "+undefined" and threw on submit.
//
//   TINTS, found 2026-08-30 — the 20 pastel card accents were declared after the 10 saturated
//   table-mark colours, so tableTint() had been handing out pastels: every table's colour mark
//   in the sidebar was drawing from the wrong palette, and the saturated list was dead code
//   nobody could see. Quiet for months, because a colour that is wrong still looks like a
//   colour. Found while giving those same tints a light-theme value.
//
// The check is deliberately dumb — a top-level `var` is exactly two spaces of indent in these
// files — because the failure it catches is dumb, and a parser would not have caught either of
// them any earlier than this does.
const fs = require('fs'), assert = require('assert');

const PAGES = ['index.html', 'apply/index.html', 'cast/index.html', 'f/index.html'];

function topLevelVars(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const seen = {};
  js.replace(/\n  var ([A-Za-z_$][\w$]*)\s*=/g, (_, name) => { seen[name] = (seen[name] || 0) + 1; return _; });
  return seen;
}

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

PAGES.forEach(page => {
  t(page + ' declares each top-level name once', () => {
    const seen = topLevelVars(page);
    const dupes = Object.keys(seen).filter(k => seen[k] > 1).map(k => k + ' ×' + seen[k]);
    assert.deepStrictEqual(dupes, [],
      'a second `var` at this scope replaces the first, it does not shadow it: ' + dupes.join(', '));
  });
});

// The two that have actually bitten, named so the file says what it is protecting.
t('the dial-code list is still the only COUNTRIES', () => {
  PAGES.forEach(p => assert.ok((topLevelVars(p).COUNTRIES || 0) <= 1, p + ' declares COUNTRIES more than once'));
});
t('the table-mark palette is still the only TINTS', () => {
  const seen = topLevelVars('index.html');
  assert.ok((seen.TINTS || 0) <= 1, 'index.html declares TINTS more than once');
  const src = fs.readFileSync('index.html', 'utf8');
  const arr = (src.match(/\n  var TINTS = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(/#2d7ff9/.test(arr), 'the surviving TINTS should be the saturated table-mark palette');
  // and the card accents it used to be clobbered by now live in the stylesheet, per theme
  assert.ok(/--tint-0:/.test(src) && /--tint-19:/.test(src), 'the card accents are not in the stylesheet');
});

console.log(n + ' one-declaration tests passed');
