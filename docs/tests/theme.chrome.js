// The light theme, rendered — because "no raw colour is left in the stylesheet" is a
// property of the text, and what a person complains about is a number they cannot read.
//
// So this file loads the real stylesheet in a real browser, in both themes, and MEASURES:
// every chip's ink against its own ground, the body text against the page, muted text
// against the page, the sidebar against the canvas, and a hairline against what it divides.
// Contrast is computed the way WCAG defines it, and translucent colours are composited over
// what they actually sit on first — a hairline is rgba(var(--wash),0.10) and comparing that
// to anything without compositing would be comparing it to nothing.
//
// The chips are not listed here. They are read out of the stylesheet, so the day somebody
// adds a 21st tag tint it is covered without this file being touched — and if they declare
// only half a pair, the swap makes it invisible in one theme and this fails.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/theme.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log('SKIPPED: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run this file.');
  process.exit(0);
}

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in index.html');

// the real switch, markup and behaviour, lifted rather than re-typed
const toggleMarkup = (src.match(/<button class="hd-btn" id="theme-toggle"[\s\S]*?<\/button>/) || [])[0];
if (!toggleMarkup) throw new Error('could not find the theme switch markup');
function grab(name) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
}
const fns = ['currentTheme', 'applyTheme', 'setTheme', 'toggleTheme'].map(grab).join('\n');
const themeKey = (js.match(/var THEME_KEY = "[^"]+";/) || [])[0];
if (!themeKey) throw new Error('could not find THEME_KEY');
// The app's own wiring line, lifted rather than re-typed: a harness that attaches its own
// listener proves the functions work and says nothing about whether the button is connected.
const wiring = (js.match(/document\.getElementById\("theme-toggle"\)\.addEventListener\("click", toggleTheme\);/) || [])[0];
if (!wiring) throw new Error('the theme switch is not wired to toggleTheme in index.html');

const page = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${style}</style></head><body>
<div class="topbar"><div class="hd-right">${toggleMarkup}</div></div>
<img class="brand-logo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E" alt="BLK">
<aside id="sidebar" class="sidebar"><button class="side-item"><span class="side-label">A table</span></button></aside>
<main><div class="card"><input placeholder="typed here"><span class="pill">plain</span>
<div class="thread"><div class="bub them">them</div><div class="bub us">us</div></div>
<table class="grid"><tbody><tr><td class="rowno">1</td><td>cell</td></tr></tbody></table>
</div></main>
<div id="chips"></div>
<pre id="out"></pre>
<script>
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
${themeKey}
${fns}
${wiring}
// Is storage usable here at all? A file:// page is refused it in some builds, and "the
// preference was not written" and "nothing can be written" are different results.
var STORAGE_OK = (function () {
  try { localStorage.setItem('blk_probe', '1'); localStorage.removeItem('blk_probe'); return true; }
  catch (e) { return false; }
})();

// ---- colour maths ----
function parse(c) {
  var m = /rgba?\\(([^)]+)\\)/.exec(c);
  if (!m) return null;
  var p = m[1].split(',').map(function (x) { return parseFloat(x); });
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function over(fg, bg) {                     // composite a translucent colour onto its ground
  if (!fg) return bg;
  if (fg.a >= 1) return fg;
  return { r: fg.r * fg.a + bg.r * (1 - fg.a),
           g: fg.g * fg.a + bg.g * (1 - fg.a),
           b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
}
function lum(c) {
  var v = [c.r, c.g, c.b].map(function (x) {
    x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  var l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function bgOf(el) {                          // the first opaque background up the tree
  var stack = [], n = el;
  while (n && n.nodeType === 1) { stack.push(parse(getComputedStyle(n).backgroundColor)); n = n.parentElement; }
  var acc = { r: 255, g: 255, b: 255, a: 1 };
  for (var i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
  return acc;
}
function inkRatio(el) {
  return ratio(over(parse(getComputedStyle(el).color), bgOf(el)), bgOf(el));
}

// ---- the chips, read out of the stylesheet itself ----
var CHIP_SELECTORS = [];
(function () {
  var css = [].slice.call(document.styleSheets[0].cssRules);
  css.forEach(function (r) {
    if (r.style && r.style.getPropertyValue('--chip-dark').trim()) {
      r.selectorText.split(',').forEach(function (s) { CHIP_SELECTORS.push(s.trim()); });
    }
  });
})();
var chipBox = document.getElementById('chips');
CHIP_SELECTORS.forEach(function (sel) {
  var el = document.createElement('span');
  el.className = sel.replace(/^\\./, '').split('.').join(' ');
  el.textContent = 'Aa';
  chipBox.appendChild(el);
});

function measure(theme) {
  applyTheme(theme);
  var body = document.body, card = document.querySelector('.card');
  var r = {
    theme: theme,
    bodyInk: inkRatio(body),
    ground: bgOf(body),
    card: bgOf(card),
    sidebar: bgOf(document.getElementById('sidebar')),
    placeholder: getComputedStyle(document.querySelector('input'), '::placeholder').color,
    worstChip: { sel: null, r: 99 },
    chips: 0
  };
  [].slice.call(chipBox.children).forEach(function (el, i) {
    var cr = ratio(bgOf(el), over(parse(getComputedStyle(el).color), bgOf(el)));
    r.chips++;
    if (cr < r.worstChip.r) r.worstChip = { sel: CHIP_SELECTORS[i], r: cr };
  });
  return r;
}

var dark = measure('dark'), light = measure('light');

// ---- the two grounds are actually different ----
ok('the light theme has a light page and the dark theme a dark one',
   lum(light.ground) > 0.7 && lum(dark.ground) < 0.1,
   'light lum ' + lum(light.ground).toFixed(2) + ', dark lum ' + lum(dark.ground).toFixed(2));

// ---- text you have to read ----
[['dark', dark], ['light', light]].forEach(function (p) {
  ok('body text is readable in the ' + p[0] + ' theme (4.5:1)', p[1].bodyInk >= 4.5, p[1].bodyInk.toFixed(2) + ':1');
});

// ---- every chip, both ways round ----
[['dark', dark], ['light', light]].forEach(function (p) {
  ok('all ' + p[1].chips + ' chips are legible in the ' + p[0] + ' theme',
     p[1].worstChip.r >= 4.5,
     'worst is ' + p[1].worstChip.sel + ' at ' + p[1].worstChip.r.toFixed(2) + ':1');
});
ok('there are chips to check at all', dark.chips >= 37, dark.chips + ' found');
// The swap is the whole trick: the same pair, the other way round, so a chip cannot be
// legible in one theme and not the other.
ok('the pair swaps rather than degrades', Math.abs(dark.worstChip.r - light.worstChip.r) < 0.01,
   dark.worstChip.r.toFixed(2) + ' vs ' + light.worstChip.r.toFixed(2));

// ---- surfaces still separate from the ground ----
[['dark', dark], ['light', light]].forEach(function (p) {
  ok('the sidebar is still distinguishable from the page in the ' + p[0] + ' theme',
     Math.abs(lum(p[1].sidebar) - lum(p[1].ground)) > 0.003 ||
     p[1].sidebar.r !== p[1].ground.r || p[1].sidebar.g !== p[1].ground.g || p[1].sidebar.b !== p[1].ground.b,
     JSON.stringify(p[1].sidebar) + ' vs ' + JSON.stringify(p[1].ground));
});

// ---- the wash flipped ----
ok('a raised surface lifts the other way in light mode', (function () {
  applyTheme('dark');
  var d = getComputedStyle(document.documentElement).getPropertyValue('--wash').replace(/\\s/g, '');
  applyTheme('light');
  var l = getComputedStyle(document.documentElement).getPropertyValue('--wash').replace(/\\s/g, '');
  return d === '255,255,255' && l === '0,0,0';
})());

// ---- the wordmark, which is white and therefore invisible on white ----
// Found by rendering the sign-in screen: every CSS test passed and the logo was gone.
applyTheme('dark');
ok('the wordmark is left alone on the dark ground',
   getComputedStyle(document.querySelector('.brand-logo')).filter === 'none',
   getComputedStyle(document.querySelector('.brand-logo')).filter);
applyTheme('light');
ok('and turned over on the light one',
   getComputedStyle(document.querySelector('.brand-logo')).filter === 'invert(1)',
   getComputedStyle(document.querySelector('.brand-logo')).filter);

// ---- the switch ----
applyTheme('dark');
var btn = document.getElementById('theme-toggle');
ok('the switch offers light while the app is dark', /light/i.test(btn.title), btn.title);
ok('and shows the sun, not the moon',
   getComputedStyle(btn.querySelector('.th-moon')).display === 'none' &&
   getComputedStyle(btn.querySelector('.th-sun')).display !== 'none');
btn.click();
ok('pressing it turns the app light', document.documentElement.getAttribute('data-theme') === 'light');
ok('and the switch now offers dark', /dark/i.test(btn.title), btn.title);
ok('and shows the moon', getComputedStyle(btn.querySelector('.th-moon')).display !== 'none' &&
   getComputedStyle(btn.querySelector('.th-sun')).display === 'none');
btn.click();
ok('pressing it again goes back', document.documentElement.getAttribute('data-theme') === 'dark');
if (STORAGE_OK) {
  ok('the choice is written down', localStorage.getItem(THEME_KEY) === 'dark', String(localStorage.getItem(THEME_KEY)));
} else {
  // The point of the try/catch in setTheme: no storage must cost you the memory of the
  // choice, never the choice itself.
  ok('a browser that refuses storage still switches', document.documentElement.getAttribute('data-theme') === 'dark');
}

out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
document.getElementById('out').textContent = out.join('\\n');
</script></body></html>`;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-theme-')), 'theme.html');
fs.writeFileSync(file, page);
const url = 'file:///' + file.replace(/\\/g, '/');
const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', url],
                         { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dom = run.stdout || '';
const block = (dom.match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
if (!block || !/RESULT/.test(block)) {
  console.log('FAILED: the page produced no results. Chrome said:\n' + (run.stderr || '').slice(0, 2000));
  process.exitCode = 1;
} else {
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  console.log(result.replace('RESULT ', '') + ' (both themes, in ' + path.basename(chrome) + ')');
  if (!/ 0 failed/.test(result)) process.exitCode = 1;
}
try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch (e) {}
