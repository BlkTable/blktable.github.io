// The Country question pre-filled from the device's timezone, driven in a real browser.
//
// device-timezone.test.js pins the rule; this file asks whether the form actually behaves.
// The interesting failures are all invisible to a unit test: the box is filled but the shop
// list still offers both countries, or the note says "filled in from your location" after
// somebody has corrected it, or a returning draft is quietly overwritten by the guess.
//
// THE TRICK THAT MAKES THIS A REAL TEST: the machine these run on is in Asia/Amman, so a
// fixture where Jordan claims Asia/Amman would pass for a page that hardcoded Jordan, or that
// simply took the first country row. So the fixture gives Asia/Amman to LEBANON and gives
// Jordan a zone this machine is not in. Pre-filling "Lebanon" therefore proves the answer
// came out of countries.timezones and nowhere else. (Chrome on Windows ignores TZ, measured,
// so the zone itself cannot be varied — the country list can.)
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/country-prefill.chrome.js
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

const PAGE = fs.readFileSync('f/index.html', 'utf8');
const CDN = /<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/;
if (!CDN.test(PAGE)) throw new Error('could not find the Supabase CDN script tag to stub');

const C_ID = 'q-country', B_ID = 'q-branch';
const FIELDS = [
  { id: C_ID, position: 0, label: 'Country', type: 'country', required: true, internal: false,
    options: { only: ['jo', 'lebanon'] } },
  { id: B_ID, position: 1, label: 'Branch', type: 'branch', required: true, internal: false,
    options: { list: 'jo, lebanon' } },
  { id: 'q-what', position: 2, label: 'Your Complaint', type: 'long_text', required: false, internal: false },
];
const BRANCHES = [
  { name: '7th Circle', name_ar: '', position: 1, list_key: 'jo', is_active: true },
  { name: 'Abdoun 1', name_ar: '', position: 2, list_key: 'jo', is_active: true },
  { name: 'Mar Mikhael', name_ar: '', position: 3, list_key: 'lebanon', is_active: true },
  { name: 'Jal El Dib', name_ar: '', position: 4, list_key: 'lebanon', is_active: true },
];
// Asia/Amman deliberately belongs to LEBANON here. See the note at the top.
const ZONES_SWAPPED = [
  { code: 'jo', name_en: 'Jordan', name_ar: 'الأردن', timezones: ['Asia/Baghdad'] },
  { code: 'lebanon', name_en: 'Lebanon', name_ar: 'لبنان', timezones: ['Asia/Amman'] },
];
// Nobody in this fixture's DATABASE claims this machine's zone (jo has Baghdad, lebanon has
// Damascus). Before Task 6 that meant nothing to guess. Since Task 6, Asia/Amman is also a real
// IANA zone in the embedded worldwide map, which names it Jordan -- and Jordan is a country this
// question offers -- so the box still fills in, this time from the embedded map rather than the
// countries table. See the section below.
const ZONES_UNKNOWN = [
  { code: 'jo', name_en: 'Jordan', name_ar: 'الأردن', timezones: ['Asia/Baghdad'] },
  { code: 'lebanon', name_en: 'Lebanon', name_ar: 'لبنان', timezones: ['Asia/Damascus'] },
];
// This machine's zone belongs to a country the QUESTION does not offer — a Jordan-and-Lebanon
// form opened in Baghdad. The box cannot show a choice that is not on its list, so filling it
// in would leave an answer nobody can see and a branch box scoped to nothing.
const ZONES_UNOFFERED = [
  { code: 'jo', name_en: 'Jordan', name_ar: 'الأردن', timezones: ['Asia/Baghdad'] },
  { code: 'lebanon', name_en: 'Lebanon', name_ar: 'لبنان', timezones: ['Asia/Damascus'] },
  { code: 'iraq', name_en: 'Iraq', name_ar: 'العراق', timezones: ['Asia/Amman'] },
];

// `zone`, when given, replaces Intl before the page's own script runs, so the box believes it
// is in a zone this machine is not actually in. Chrome on Windows ignores the TZ environment
// variable and always reports the OS zone, measured, so this is the only way to test a zone
// other than this machine's own -- the same technique phone-picker.chrome.js uses. Omit it (the
// existing call sites all do) and Intl is left alone, which on this machine means Asia/Amman.
function build(countries, draftAnswers, zone) {
  const tz = zone ? `
  (function () {
    var real = Intl.DateTimeFormat;
    function Fake() {
      var f = real.apply(this, arguments);
      var ro = f.resolvedOptions.bind(f);
      f.resolvedOptions = function () { var o = ro(); o.timeZone = ${JSON.stringify(zone)}; return o; };
      return f;
    }
    Fake.supportedLocalesOf = real.supportedLocalesOf;
    Intl.DateTimeFormat = Fake;
  })();` : '';
  const seed = draftAnswers ? `
  try { window.localStorage.setItem('blk_draft_prefill-test',
    JSON.stringify({ v: 1, at: Date.now(), a: ${JSON.stringify(draftAnswers)} })); } catch (e) {}` : `
  try { window.localStorage.removeItem('blk_draft_prefill-test'); } catch (e) {}`;
  const stub = `<script>${tz}${seed}
  window.__err = null;
  window.onerror = function (m, u, l) { window.__err = m + ' (line ' + l + ')'; };
  var TABLE = { id: 't-pf', name: 'Prefill test', name_ar: '', slug: 'prefill-test',
                is_active: true, kind: 'form', config_public: {} };
  function rowsFor(t) {
    if (t === 'app_tables') return TABLE;
    if (t === 'app_fields') return ${JSON.stringify(FIELDS)};
    if (t === 'branches') return ${JSON.stringify(BRANCHES)};
    if (t === 'countries') return ${JSON.stringify(countries)};
    return [];
  }
  function builder(t) {
    var o = {}, res = { data: rowsFor(t), error: null };
    ['select','eq','order','limit','in','is','neq'].forEach(function (m) { o[m] = function () { return o; }; });
    o.single = function () { return Promise.resolve(res); };
    o.then = function (f, r) { return Promise.resolve(res).then(f, r); };
    o.catch = function (f) { return Promise.resolve(res).catch(f); };
    return o;
  }
  window.supabase = { createClient: function () {
    return { from: builder,
             rpc: function () { return Promise.resolve({ data: null, error: null }); },
             storage: { from: function () { return { upload: function () { return Promise.resolve({}); } }; } } };
  } };
<\/script>`;
  return PAGE.replace(CDN, stub);
}

// Reads the shops the branch box is actually offering. The list is only rendered once the
// combo is opened, which is also the only way a person ever sees it.
const DRIVER = `<pre id="out">pending</pre>
<script>
  var out = [], pass = 0, fail = 0;
  function t(name, fn) {
    try { var why = fn(); if (why) { fail++; out.push('FAIL ' + name + ' -> ' + why); } else pass++; }
    catch (e) { fail++; out.push('FAIL ' + name + ' -> threw ' + e.message); }
  }
  function val(id) { var el = document.getElementById('fld-' + id); return el ? el.value : null; }
  function shops(id) {
    var el = document.getElementById('fld-' + id);
    if (!el) return [];
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.focus();
    return [].slice.call(el.closest('.combo').querySelectorAll('.combo-opt'))
             .map(function (d) { return d.textContent.trim(); });
  }
  function note() { return document.getElementById('country-guess-note'); }
  function pickCountry(name) {
    var el = document.getElementById('fld-${C_ID}');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.focus();
    var opts = [].slice.call(el.closest('.combo').querySelectorAll('.combo-opt'));
    var hit = opts.filter(function (d) { return d.textContent.trim().indexOf(name) === 0; })[0];
    if (!hit) return false;
    // mousedown, not click: the combo settles a choice on mousedown so the input's blur
    // cannot close the list out from under the press. Dispatching a click here selects
    // nothing and the test reads as a re-scoping bug that is not there.
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  }
  var deadline = Date.now() + 5000;
  (function wait() {
    var ready = document.getElementById('fld-${C_ID}') && document.getElementById('fld-${B_ID}');
    if (!ready && Date.now() < deadline) return setTimeout(wait, 40);
    try { window.CHECKS(); } catch (e) { fail++; out.push('FAIL driver threw ' + e.message); }
    out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
    document.getElementById('out').textContent = out.join('\\n');
  })();
<\/script>`;

function run(html, checks, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-pf-'));
  const file = path.join(dir, 'index.html');
  const page = html.replace('</body>',
    '<script>window.CHECKS = function () {' + checks + '};<\/script>' + DRIVER + '</body>');
  if (page.indexOf('id="out"') === -1) throw new Error('driver was not appended');
  fs.writeFileSync(file, page);
  const r = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files',
    '--virtual-time-budget=9000', '--dump-dom',
    'file:///' + file.replace(/\\/g, '/') + '?t=prefill-test'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const block = ((r.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
  if (block === undefined) {
    console.log('FAILED (' + name + '): no results. Chrome said:\n' + (r.stderr || '').slice(0, 1500));
    process.exitCode = 1;
  } else {
    const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
    lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log('  ' + l));
    const res = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing (page never finished)';
    console.log(res.replace('RESULT ', '') + '  (' + name + ')');
    if (!/ 0 failed/.test(res)) process.exitCode = 1;
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

// ---- 1. the guess lands, and the shop list follows it ----
run(build(ZONES_SWAPPED), `
  t('the page did not throw', function () { if (window.__err) return window.__err; });
  t('the country is pre-filled from the countries table, not from a hardcoded guess', function () {
    var v = val('${C_ID}');
    if (v !== 'Lebanon') return 'country box reads ' + JSON.stringify(v) + ', expected Lebanon (this machine is in Asia/Amman, which the fixture gives to Lebanon)';
  });
  t('the shop list narrowed to that country with no extra plumbing', function () {
    var s = shops('${B_ID}');
    if (!s.length) return 'the branch box offered nothing at all';
    var leaked = s.filter(function (x) { return /7th Circle|Abdoun/.test(x); });
    if (leaked.length) return 'Jordanian shops still offered: ' + leaked.join(', ');
    if (!s.some(function (x) { return /Mar Mikhael/.test(x); })) return 'Lebanese shops missing: ' + s.join(', ');
  });
  t('the box says the answer was guessed and can be changed', function () {
    var n = note();
    if (!n) return 'no note next to the pre-filled country';
    if (!n.offsetParent) return 'the note is in the DOM but not visible';
    if (!/change it/i.test(n.textContent)) return 'the note does not say it can be changed: ' + n.textContent;
  });
`, 'guess lands, shops follow');

// ---- 2. correcting it re-scopes, and the note stops claiming otherwise ----
run(build(ZONES_SWAPPED), `
  t('correcting the country re-scopes the shop list', function () {
    if (val('${C_ID}') !== 'Lebanon') return 'setup failed: country was ' + val('${C_ID}');
    if (!pickCountry('Jordan')) return 'could not pick Jordan from the country box';
    var s = shops('${B_ID}');
    var leaked = s.filter(function (x) { return /Mar Mikhael|Jal El Dib/.test(x); });
    if (leaked.length) return 'Lebanese shops still offered after switching to Jordan: ' + leaked.join(', ');
    if (!s.some(function (x) { return /7th Circle/.test(x); })) return 'Jordanian shops missing: ' + s.join(', ');
  });
  t('the note is gone once the answer is no longer the guess', function () {
    if (note()) return 'the note still reads "filled in from your location" after a correction';
  });
`, 'correction re-scopes, note clears');

// ---- 3. a returning draft is never overwritten ----
run(build(ZONES_SWAPPED, { 'q-country': 'Jordan' }), `
  t('A DRAFT ANSWER SURVIVES THE GUESS', function () {
    var v = val('${C_ID}');
    if (v !== 'Jordan') return 'the guess overwrote a restored draft: box reads ' + JSON.stringify(v) + ', expected Jordan';
  });
  t('and the shop list follows the DRAFT, not the guess', function () {
    var s = shops('${B_ID}');
    var leaked = s.filter(function (x) { return /Mar Mikhael|Jal El Dib/.test(x); });
    if (leaked.length) return 'Lebanese shops offered against a Jordanian draft: ' + leaked.join(', ');
  });
  t('a restored answer carries no "we guessed this" note', function () {
    if (note()) return 'a note claiming the answer was guessed, over an answer the person typed';
  });
`, 'draft beats the guess');

// ---- 4. no DB row claims the zone, but the embedded map still does ----
// Section 6 below covers the case where nothing resolves the zone at all. This section proves
// the other half: even with no DB row claiming this machine's own zone (Asia/Amman), the
// embedded map still supplies Jordan, and the fallback reaches the pre-fill note and the branch
// scope too, not only the box, in a real browser round trip.
run(build(ZONES_UNKNOWN), `
  t('the country still fills in, from the embedded map this time', function () {
    var v = val('${C_ID}');
    if (v !== 'Jordan') return 'country box reads ' + JSON.stringify(v) + ', expected Jordan (no DB row claims Asia/Amman here, but the embedded map does, and Jordan is offered)';
  });
  t('and the shop list narrows to Jordan the same as any other guess', function () {
    var s = shops('${B_ID}');
    var leaked = s.filter(function (x) { return /Mar Mikhael|Jal El Dib/.test(x); });
    if (leaked.length) return 'Lebanese shops still offered: ' + leaked.join(', ');
    if (!s.some(function (x) { return /7th Circle/.test(x); })) return 'Jordanian shops missing: ' + s.join(', ');
  });
  t('and the note says the answer was guessed', function () {
    if (!note()) return 'no note next to a country the embedded map filled in';
  });
`, 'DB has no row for the zone, embedded map still names it');

// ---- 5. a country the question does not offer is never filled in ----
run(build(ZONES_UNOFFERED), `
  t('a country the question does not offer is left alone', function () {
    var v = val('${C_ID}');
    if (v) return 'filled in ' + JSON.stringify(v) + ', which this question does not offer (only jo and lebanon)';
  });
  t('and the shop list is not scoped to a country nobody chose', function () {
    var s = shops('${B_ID}');
    if (!s.some(function (x) { return /7th Circle/.test(x); })) return 'Jordanian shops missing: ' + s.join(', ');
    if (!s.some(function (x) { return /Mar Mikhael/.test(x); })) return 'Lebanese shops missing: ' + s.join(', ');
  });
  t('and no note claims a guess was made', function () { if (note()) return 'a note over an empty box'; });
`, 'unoffered country is not filled');

// ---- 6. a zone nothing recognizes changes nothing at all ----
// Etc/UTC is what a hardened browser reports (Firefox resistFingerprinting, Tor, Brave), and
// the embedded 541-zone map deliberately does not name a country for it, so the DB fixture does
// not matter here -- neither source can resolve this zone. This machine's own zone can no
// longer stand in for "unresolvable" (see section 4's comment), so this uses the Intl override
// in `build`'s third argument to actually put the browser in a zone nothing knows, the same way
// phone-picker.chrome.js tests a zone other than this machine's own.
run(build(ZONES_UNKNOWN, undefined, 'Etc/UTC'), `
  t('the country box fills in nothing', function () {
    var v = val('${C_ID}');
    if (v) return 'country was pre-filled with ' + JSON.stringify(v) + ' from a zone nothing recognizes';
  });
  t('and both countries stay offered', function () {
    var s = shops('${B_ID}');
    if (!s.some(function (x) { return /7th Circle/.test(x); })) return 'Jordanian shops missing: ' + s.join(', ');
    if (!s.some(function (x) { return /Mar Mikhael/.test(x); })) return 'Lebanese shops missing: ' + s.join(', ');
  });
  t('and no note is shown', function () { if (note()) return 'a note with nothing guessed'; });
`, 'unresolvable zone changes nothing');
