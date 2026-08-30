// Light mode, checked as a rule rather than as a screenshot.
//
// A theme fails in one direction only: something keeps a colour that was chosen for the other
// ground, and it goes invisible — white text on white, a hairline that was white-at-7%-alpha
// on a white page, a chip with a dark background and dark ink. None of that throws, nothing
// logs, and it is invisible in the theme you happen to be looking at. So the tests here are
// mostly "no colour is left behind", not "this pixel is that colour".
//
// The three mechanisms this file pins:
//   --wash        one channel, 255,255,255 in the dark theme and 0,0,0 in the light one, so a
//                 raised surface is lifted with white on black and with black on white. It is
//                 what 54 hand-written rgba(255,255,255,α) turned into.
//   the chip pair every chip declares the two colours it is made of (--chip-dark/--chip-light)
//                 and ONE shared rule decides which is the background and which is the ink.
//                 The light theme swaps them, so a pair that was legible stays legible: the
//                 contrast between two colours does not care which way round they are.
//   the boot      the theme is resolved and put on <html> BEFORE the body exists, or the app
//                 paints dark and then flips, which reads as a bug on every load.
const fs = require('fs'), assert = require('assert');

const SRC = fs.readFileSync('index.html', 'utf8');
const STYLE = (SRC.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!STYLE) throw new Error('no <style> block in index.html');

function block(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n  \\}', '');
  const m = STYLE.match(re);
  return m ? m[1] : null;
}
function tokensIn(text) {
  const out = {};
  (text || '').replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (_, k, v) => { out[k] = v.trim(); return _; });
  return out;
}

const DARK = tokensIn(block(':root'));
const LIGHT = tokensIn(block(':root[data-theme="light"]'));

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---- the palette ----
t('there is a light palette at all', () => {
  assert.ok(Object.keys(LIGHT).length > 10, 'expected a :root[data-theme="light"] block with the palette in it');
});

// The surfaces and the ink are the theme. A light theme that redefined the accent but not the
// page ground would be the dark app with a different blue in it.
const MUST_FLIP = ['--bg', '--bg-2', '--bg-top', '--card', '--text', '--muted',
                   '--silver', '--silver-hi', '--silver-lo', '--field-bg', '--field-border', '--wash'];
MUST_FLIP.forEach(tok => {
  t('the light theme gives ' + tok + ' its own value', () => {
    assert.ok(LIGHT[tok], tok + ' is not redefined for the light theme');
    assert.notStrictEqual(LIGHT[tok], DARK[tok], tok + ' is the same in both themes');
  });
});

t('the light theme defines nothing the dark one has not', () => {
  const stray = Object.keys(LIGHT).filter(k => !(k in DARK));
  assert.deepStrictEqual(stray, [], 'light-only tokens have no dark value to fall back on: ' + stray);
});

// ---- the wash ----
t('the wash is white on the dark ground and black on the light one', () => {
  assert.strictEqual((DARK['--wash'] || '').replace(/\s/g, ''), '255,255,255');
  assert.strictEqual((LIGHT['--wash'] || '').replace(/\s/g, ''), '0,0,0');
});
// Every one of these was a surface lifted off the page. On a white page a white lift is
// nothing at all — the sidebar's hover, the group rows, the hairlines and the flat pills
// would each quietly stop existing.
// The lightbox is the one deliberate exception and is named here so it stays deliberate: it
// is a photo on a black backdrop in both themes, so its close button is white in both.
t('no hand-written white rgba is left in the stylesheet, outside the lightbox', () => {
  // comments stripped first: the palette explains the idiom it replaced, and prose about a
  // colour is not a colour
  const left = STYLE.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
    .filter(r => /rgba\(\s*255\s*,\s*255\s*,\s*255/.test(r))
    .map(r => (r.match(/^[^{]*/) || [''])[0].trim())
    .filter(sel => !/\.lightbox/.test(sel));
  assert.deepStrictEqual(left, [], 'white rgba left where the ground can be white: ' + left);
});
t('and the wash is actually used, not just declared', () => {
  const used = (STYLE.match(/rgba\(var\(--wash\)/g) || []).length;
  assert.ok(used > 40, 'only ' + used + ' uses of the wash; 54 white rgba were replaced');
});

// ---- the chip pair ----
t('every chip declares both of its colours', () => {
  const rules = STYLE.split('}');
  const half = rules.filter(r => /--chip-(dark|light)\s*:/.test(r))
                    .filter(r => !(/--chip-dark\s*:/.test(r) && /--chip-light\s*:/.test(r)))
                    .map(r => (r.match(/^[^{]*/) || [''])[0].trim().slice(0, 60));
  assert.deepStrictEqual(half, [], 'a chip with only half a pair is unreadable in one theme: ' + half);
});
// Two rules, not one indirection through :root: a custom property's var()s are substituted
// where the property is DECLARED, so `--chip-bg: var(--chip-dark)` on :root resolves the pair
// against :root, finds nothing, and every chip renders with no background. That shipped for
// about ten minutes and theme.chrome.js caught it by measuring.
t('the pair is chosen where the pair exists — on the chip', () => {
  const css = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/--chip-(bg|fg)\s*:/.test(css),
    'the pair must not be resolved on :root, where --chip-dark is not defined');
  assert.ok(/\.bub\.us\s*\{\s*background:\s*var\(--chip-dark\);\s*color:\s*var\(--chip-light\);/.test(css),
    'no rule paints a chip on its dark half');
  assert.ok(/:root\[data-theme="light"\][^{]*\.bub\.us\s*\{\s*background:\s*var\(--chip-light\);\s*color:\s*var\(--chip-dark\);/.test(css),
    'the light theme must swap the pair, not restate 74 colours');
});
t('both paint rules cover exactly the same chips', () => {
  const css = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');
  const dark = (css.match(/([^}]*)\{\s*background:\s*var\(--chip-dark\)/) || [])[1] || '';
  const light = (css.match(/([^}]*)\{\s*background:\s*var\(--chip-light\)/) || [])[1] || '';
  const names = s => s.split(',').map(x => x.trim().replace(/^:root\[data-theme="light"\]\s*/, '')).filter(Boolean).sort();
  assert.deepStrictEqual(names(light), names(dark),
    'a chip painted in one theme and not the other is a chip that vanishes in that theme');
  assert.ok(names(dark).length >= 37, 'expected all 37 chips, found ' + names(dark).length);
});
t('the tag tints all went through the engine', () => {
  const tints = (STYLE.match(/\.pill\.t\d+\s*\{[^}]*\}/g) || []);
  assert.ok(tints.length >= 20, 'expected the 20 tag tints, found ' + tints.length);
  const raw = tints.filter(r => /background:\s*#/.test(r) || /color:\s*#/.test(r));
  assert.deepStrictEqual(raw, [], 'a tag tint still paints itself directly: ' + raw.slice(0, 2));
});

// The one thing in the page that is a colour but not CSS: the wordmark is a white-filled
// SVG, so on a white page it is a white rectangle of nothing. Every place that draws it has
// to be turned over with the theme, and a fourth place added later is exactly how this comes
// back — so the rule is checked against the markup rather than restated in it.
t('every drawing of the wordmark is turned over in the light theme', () => {
  const drawn = [...SRC.matchAll(/<img class="([^"]+)"[^>]*src="[^"]*blk-logo\.svg"/g)].map(m => m[1].trim());
  assert.ok(drawn.length >= 3, 'expected the wordmark in the sign-in screen, the top bar and the form preview');
  const rule = (STYLE.match(/:root\[data-theme="light"\][^{]*filter:\s*invert\(1\)[^}]*\}/s) ||
                STYLE.match(/((?::root\[data-theme="light"\][^,{]+,?\s*)+)\{\s*filter:\s*invert\(1\);\s*\}/))|| [];
  const covered = rule[0] || '';
  drawn.forEach(cls => {
    assert.ok(new RegExp('\\.' + cls.split(/\s+/)[0] + '\\b').test(covered),
      'the wordmark is drawn as .' + cls + ' but that is not inverted in the light theme');
  });
});

// ---- the boot ----
// Resolved before the body, or the first paint is the wrong theme and the app blinks.
t('the theme is settled before the page renders', () => {
  const head = SRC.slice(0, SRC.indexOf('<body'));
  assert.ok(/data-theme/.test(head), 'nothing in <head> puts the theme on the document');
  assert.ok(/THEME_KEY|blk_theme/.test(head), 'the boot snippet does not read the saved choice');
});
t('"system" is a real answer, not the absence of one', () => {
  assert.ok(/prefers-color-scheme/.test(SRC), 'nothing asks the device what it prefers');
  assert.ok(/matchMedia\([^)]*prefers-color-scheme[^)]*\)[\s\S]{0,400}addEventListener|addEventListener\([\s\S]{0,80}change/.test(SRC),
    'the device switching to light while the app is open should follow');
});
// One switch, in the top bar where a person can see it, rather than a three-way setting
// buried in a menu. It flips to the other theme; the device only decides how the app opens
// before anybody has touched it.
t('there is a switch in the top bar', () => {
  assert.ok(/id="theme-toggle"/.test(SRC), 'no theme switch');
  const bar = SRC.slice(SRC.indexOf('id="hd-bell"') - 1500, SRC.indexOf('id="profile-btn"'));
  assert.ok(/id="theme-toggle"/.test(bar), 'the switch is not in the header beside the other top-bar buttons');
});
t('the switch says which way it will go', () => {
  assert.ok(/aria-label="[^"]*(theme|light|dark)[^"]*"/i.test(SRC) || /title="[^"]*(light|dark)[^"]*"/i.test(SRC),
    'the switch has no label saying what it does');
});
t('pressing it flips to the other theme and nothing else', () => {
  const fn = (SRC.match(/function toggleTheme\s*\([\s\S]*?\n  \}/) || [])[0];
  assert.ok(fn, 'no toggleTheme()');
  assert.ok(/light[\s\S]*dark|dark[\s\S]*light/.test(fn), 'it does not choose between the two themes');
  assert.ok(/setTheme|applyTheme/.test(fn), 'it does not go through the one function that applies a theme');
});
t('the choice is remembered, under one key both halves agree on', () => {
  const keys = (SRC.match(/THEME_KEY\s*=\s*"([^"]+)"/g) || []).map(s => s.split('"')[1]);
  assert.ok(keys.length >= 2, 'expected the key named in both the head snippet and the app');
  assert.deepStrictEqual([...new Set(keys)], ['blk_theme'], 'the two halves store under different keys: ' + keys);
  assert.ok(/localStorage\.setItem\(THEME_KEY/.test(SRC), 'the choice is never written');
  assert.ok(/localStorage\.getItem\(THEME_KEY/.test(SRC), 'the choice is never read back');
});
// Storage throws rather than returning null in a locked-down browser, and it throws on the
// read that happens before the app exists — so an unguarded read is a blank page, not a
// forgotten preference.
t('a browser that refuses storage still gets a theme', () => {
  const reads = SRC.split('localStorage.getItem(THEME_KEY').length - 1;
  const guarded = (SRC.match(/try\s*\{[^}]*localStorage\.(get|set)Item\(THEME_KEY[^}]*\}\s*catch/g) || []).length;
  assert.ok(guarded >= reads, 'a localStorage call on the theme path is not wrapped in try/catch');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; }
  }
  console.log(n + '/' + tests.length + ' theme tests passed');
})();
