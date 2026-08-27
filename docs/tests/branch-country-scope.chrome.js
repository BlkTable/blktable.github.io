// Picking a country on the public form, and watching the shop list narrow.
//
// branch-country-scope.test.js covers the rules from source. This drives the two real
// controls: the country combo and the branch combo, both built by the page's own buildCombo,
// wired through the page's own answerChanged. It is worth its own file because the narrowing
// only happens if the country control's onChange actually reaches applyBranchScope and the
// branch control actually carries a rescope — a chain of four things, none of which a source
// test can see connected.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/branch-country-scope.chrome.js
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

const src = fs.readFileSync('f/index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) throw new Error('no <style> block in f/index.html');
function grab(name) {
  const multi = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}'));
  if (multi) return multi[0];
  const one = js.match(new RegExp('\\n  function ' + name + '\\s*\\(.*'));
  if (one) return one[0];
  throw new Error('could not find function ' + name);
}
const fns = ['esc', 'buildCombo', 'countryNameFor', 'countryChoiceNames', 'branchListKeysOf',
  'countryCodeOf', 'branchScopeKeysOf', 'branchOptionsFor', 'currentCountryAnswer',
  'applyBranchScope', 'answerChanged'].map(grab).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="host"></div><pre id="out"></pre>
<script>
${fns}
// The page's real data shapes. Jal el Deeb says nothing about Lebanon in its name and
// Baghdad One says Iraq in its; both are grouped by list_key alone, which is the point.
var BRANCHES = [
  { name: 'Abdoun',      name_ar: 'عبدون', position: 1, list_key: 'jo',      is_active: true },
  { name: 'Swefieh',     name_ar: null,    position: 2, list_key: 'jo',      is_active: true },
  { name: 'Closed Shop', name_ar: null,    position: 3, list_key: 'jo',      is_active: false },
  { name: 'Jal el Deeb', name_ar: null,    position: 1, list_key: 'lebanon', is_active: true },
  { name: 'Hamra',       name_ar: null,    position: 2, list_key: 'lebanon', is_active: true },
  { name: 'Baghdad One', name_ar: null,    position: 1, list_key: 'iraq',    is_active: true }
];
var COUNTRY_ROWS = [
  { code: 'jo', name_en: 'Jordan', name_ar: 'الأردن' },
  { code: 'lebanon', name_en: 'Lebanon', name_ar: 'لبنان' },
  { code: 'iraq', name_en: 'Iraq', name_ar: 'العراق' }
];
var COUNTRY_NAMES_ALL = ['Jordan', 'Lebanon', 'Iraq', 'Syria', 'Egypt'];
// The two halves of answerChanged this harness is not exercising.
function applyConditions() {}
function paintScores() {}

var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
var host = document.getElementById('host');
var controls = [];

// A form covering Jordan and Lebanon: the country question the builder writes, then a shop
// question. Exactly the two rows a two-country form gets.
var CQ = { id: 'c1', type: 'country', label: 'Country', options: { only: ['jo', 'lebanon'] } };
var BQ = { id: 'b1', type: 'branch',  label: 'Branch',  options: { list: 'jo, lebanon' } };

var cOpts = countryChoiceNames(CQ).map(function (nm) { return { value: nm, label: nm }; });
var cCombo = buildCombo(CQ, cOpts, function () { answerChanged(); });
host.appendChild(cCombo.wrap);
controls.push({ f: CQ, el: cCombo.input, value: function () { return cCombo.getValue(); } });

var bCombo = buildCombo(BQ, branchOptionsFor(BQ, null), function () { answerChanged(); });
host.appendChild(bCombo.wrap);
controls.push({ f: BQ, el: bCombo.input, value: function () { return bCombo.getValue(); },
                rescope: function (a) { bCombo.setOptions(branchOptionsFor(BQ, a)); } });

// What the person actually sees when the box is open.
function shopsOnScreen() {
  bCombo.input.dispatchEvent(new Event('focus'));
  var els = [].slice.call(bCombo.wrap.querySelectorAll('.combo-opt'));
  return els.map(function (e) { return e.textContent.split(' — ')[0].split(' / ')[0]; });
}
function pickCountry(name) {
  cCombo.setValue(name);
  answerChanged();
}

// ---- the country question offers only the form's own countries ----
ok('the country question offers two, not 195',
   cOpts.length === 2, String(cOpts.length));
ok('and they are the form\\'s own',
   cOpts.map(function (o) { return o.value; }).join(',') === 'Jordan,Lebanon',
   cOpts.map(function (o) { return o.value; }).join(','));

// ---- before it is answered ----
ok('both countries\\' shops are offered while the country is unknown',
   shopsOnScreen().join(',') === 'Abdoun,Swefieh,Jal el Deeb,Hamra', shopsOnScreen().join(','));
ok('a closed shop is offered in neither', shopsOnScreen().indexOf('Closed Shop') === -1);
ok('a country the form does not cover brings no shops with it',
   shopsOnScreen().indexOf('Baghdad One') === -1);

// ---- picking Lebanon ----
pickCountry('Lebanon');
ok('picking Lebanon leaves ONLY Lebanon\\'s shops',
   shopsOnScreen().join(',') === 'Jal el Deeb,Hamra', shopsOnScreen().join(','));
ok('and the country suffix goes, because there is one list now',
   bCombo.wrap.querySelectorAll('.combo-opt')[0].textContent.indexOf('—') === -1,
   bCombo.wrap.querySelectorAll('.combo-opt')[0].textContent);

// ---- picking the other one ----
pickCountry('Jordan');
ok('picking Jordan leaves ONLY Jordan\\'s shops',
   shopsOnScreen().join(',') === 'Abdoun,Swefieh', shopsOnScreen().join(','));

// ---- a shop chosen and then contradicted ----
bCombo.setValue('Abdoun');
ok('a Jordanian shop can be chosen while the country says Jordan', bCombo.getValue() === 'Abdoun');
pickCountry('Lebanon');
ok('changing the country to Lebanon drops the Jordanian shop rather than submitting it',
   bCombo.getValue() === null, String(bCombo.getValue()));
ok('and the box is visibly empty, not just empty underneath', bCombo.input.value === '',
   bCombo.input.value);

// ---- a shop that is still valid survives ----
bCombo.setValue('Hamra');
pickCountry('Lebanon');
ok('re-picking the same country keeps a shop that is still on the list',
   bCombo.getValue() === 'Hamra', String(bCombo.getValue()));

// ---- clearing the country ----
pickCountry('');
ok('clearing the country brings both lists back',
   shopsOnScreen().join(',') === 'Abdoun,Swefieh,Jal el Deeb,Hamra', shopsOnScreen().join(','));
ok('and a Lebanese shop chosen before is still valid, so it is kept',
   bCombo.getValue() === 'Hamra', String(bCombo.getValue()));

// ---- typing, not clicking ----
pickCountry('Lebanon');
bCombo.input.value = 'jal';
bCombo.input.dispatchEvent(new Event('input'));
var typed = [].slice.call(bCombo.wrap.querySelectorAll('.combo-opt')).map(function (e) { return e.textContent; });
ok('typing still searches the narrowed list', typed.length === 1 && /Jal el Deeb/.test(typed[0]), typed.join('|'));
bCombo.input.value = 'abdoun';
bCombo.input.dispatchEvent(new Event('input'));
var typed2 = [].slice.call(bCombo.wrap.querySelectorAll('.combo-opt')).map(function (e) { return e.textContent; });
ok('and a shop from the other country cannot be typed in either',
   typed2.length === 0 || /No matches/.test(bCombo.wrap.querySelector('.combo-list').textContent),
   typed2.join('|'));

document.getElementById('out').textContent = out.join('\\n') + '\\n' + pass + ' passed, ' + fail + ' failed';
<\/script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-branch-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page, 'utf8');
const dump = path.join(dir, 'dump.txt');
cp.execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=4000', '--dump-dom', '--window-size=1200,900',
  'file:///' + file.replace(/\\/g, '/')], { stdio: ['ignore', fs.openSync(dump, 'w'), 'ignore'] });
const dom = fs.readFileSync(dump, 'utf8');
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
if (!m) { console.log('FAILED: the page did not run — no output block'); process.exit(1); }
const text = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const bad = text.split('\n').filter(l => l.indexOf('FAIL') === 0);
bad.forEach(l => console.log(l));
console.log(text.split('\n').filter(l => /passed, /.test(l))[0] + ' (branch scope, in Chrome)');
process.exitCode = bad.length ? 1 : 0;
