// The picker driven in a real browser, because "the function returns the right row" was never
// what was broken. What was broken was that a picker of four could not represent the number
// somebody was typing, and there was no way to look for theirs.
//
// The value is read by pressing the real Submit button and catching the RPC payload, not by
// reading the input: the answer is composed from the picker and the local box together, and
// the composition is the part that can be wrong. An invalid number never reaches the RPC at
// all, so the same hook tests validation.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/phone-picker.chrome.js
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

const P_ID = 'q-phone';
const COUNTRY_ROWS = [
  { code: 'jo', name_en: 'Jordan', name_ar: 'الأردن', timezones: ['Asia/Amman'] },
  { code: 'lebanon', name_en: 'Lebanon', name_ar: 'لبنان', timezones: ['Asia/Beirut'] }
];

// `zone` is the timezone the page will believe it is in. Chrome on Windows ignores the TZ
// environment variable and reports the OS zone regardless, measured, so the only way to test
// a device outside Amman is to replace Intl before the page's own script runs. The stub takes
// the CDN script tag's place, which is line 246 of the page, above everything that reads a
// zone. Passing null leaves Intl alone, which on this machine means Asia/Amman.
function build(zone, fieldOpts) {
  const fields = [
    { id: P_ID, position: 0, label: 'Phone Number', type: 'phone', required: true, internal: false, options: fieldOpts || {} },
    { id: 'q-what', position: 1, label: 'Your Complaint', type: 'long_text', required: false, internal: false }
  ];
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
  const stub = `<script>${tz}
  try { window.localStorage.removeItem('blk_draft_phone-test'); } catch (e) {}
  window.__err = null; window.__sent = null;
  window.onerror = function (m, u, l) { window.__err = m + ' (line ' + l + ')'; };
  var TABLE = { id: 't-ph', name: 'Phone test', name_ar: '', slug: 'phone-test',
                is_active: true, kind: 'form', config_public: {} };
  function rowsFor(t) {
    if (t === 'app_tables') return TABLE;
    if (t === 'app_fields') return ${JSON.stringify(fields)};
    if (t === 'branches') return [];
    if (t === 'countries') return ${JSON.stringify(COUNTRY_ROWS)};
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
             rpc: function (name, args) {
               // What the form WOULD store. Captured rather than sent, so the assertions read
               // the composed answer instead of recomputing it.
               if (name === 'submit_public_form') window.__sent = args;
               return Promise.resolve({ data: { ok: true }, error: null });
             },
             storage: { from: function () { return { upload: function () { return Promise.resolve({}); } }; } } };
  } };
<\/script>`;
  return PAGE.replace(CDN, stub);
}

const DRIVER = `<pre id="out">pending</pre>
<script>
  var out = [], pass = 0, fail = 0;
  function t(name, fn) {
    try { var why = fn(); if (why) { fail++; out.push('FAIL ' + name + ' -> ' + why); } else pass++; }
    catch (e) { fail++; out.push('FAIL ' + name + ' -> threw ' + e.message); }
  }
  // An assertion that has to wait. The submit path builds its payload inside a .then, after
  // the upload promises settle, so anything reading window.__sent straight after the click
  // reads null and every value assertion would pass by accident.
  var chain = Promise.resolve();
  function ta(name, fn) {
    chain = chain.then(function () {
      return Promise.resolve().then(fn).then(function (why) {
        if (why) { fail++; out.push('FAIL ' + name + ' -> ' + why); } else pass++;
      }, function (e) { fail++; out.push('FAIL ' + name + ' -> threw ' + e.message); });
    });
    return chain;
  }
  function row() { return document.querySelector('.phone-row'); }
  function q(sel) { return row().querySelector(sel); }
  function local() { return document.getElementById('fld-${P_ID}'); }
  function dial() { return q('.cc-dial').textContent.trim(); }
  function isOpen() { return q('.cc-menu').classList.contains('open'); }
  function rows() { return [].slice.call(row().querySelectorAll('.cc-list li')); }
  function labels() { return rows().map(function (li) { return li.textContent.replace(/\\s+/g, ' ').trim(); }); }
  function open() { q('.cc-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  function type(v) { var s = q('.cc-search'); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); }
  function key(k) { q('.cc-search').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
  // mousedown, not click: the list settles a choice on mousedown so that dragging off a row
  // does not select it. A dispatched click picks nothing and reads as a broken picker.
  function pickNth(i) { rows()[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
  function typeNumber(v) { var el = local(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  // Given an id by prefillPhone in Task 4, the way the country question's note is
  // country-guess-note. Absent until then, which is correct: this run does not pre-fill.
  function note() { return document.getElementById('phone-guess-note'); }
  // Presses the real Submit button and returns what the form WOULD store, or null when the
  // number was refused and the submit never reached the RPC. Resolves either way, so a
  // refusal is an assertable outcome rather than a hang.
  function submitted() {
    window.__sent = null;
    document.getElementById('submit-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return new Promise(function (res) {
      var give = Date.now() + 2000;
      (function poll() {
        if (window.__sent && window.__sent.p_data) return res(window.__sent.p_data['${P_ID}']);
        if (Date.now() > give) return res(null);
        setTimeout(poll, 20);
      })();
    });
  }
  var deadline = Date.now() + 5000;
  (function wait() {
    var ready = document.querySelector('.phone-row') && document.getElementById('fld-${P_ID}');
    if (!ready && Date.now() < deadline) return setTimeout(wait, 40);
    function finish() {
      out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
      document.getElementById('out').textContent = out.join('\\n');
    }
    var p;
    try { p = window.CHECKS(); } catch (e) { fail++; out.push('FAIL driver threw ' + e.message); }
    // CHECKS returns the async chain when it has one, so the results are not printed before
    // the submits have been answered. --virtual-time-budget gives them room.
    Promise.resolve(p).then(finish, function (e) {
      fail++; out.push('FAIL driver threw ' + e.message); finish();
    });
  })();
<\/script>`;

function run(html, checks, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-ph-'));
  const file = path.join(dir, 'index.html');
  const page = html.replace('</body>',
    '<script>window.CHECKS = function () {' + checks + '};<\/script>' + DRIVER + '</body>');
  if (page.indexOf('id="out"') === -1) throw new Error('driver was not appended');
  fs.writeFileSync(file, page);
  const r = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files',
    '--virtual-time-budget=9000', '--dump-dom',
    'file:///' + file.replace(/\\/g, '/') + '?t=phone-test'],
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

// ---- 1. searching 245 countries ----
run(build(null), `
  t('the page did not throw', function () { if (window.__err) return window.__err; });
  t('it opens on Jordan, showing the Jordanian example number as the placeholder', function () {
    if (dial() !== '+962') return 'the button reads ' + dial();
    if (local().placeholder !== '790123456') return 'placeholder is ' + JSON.stringify(local().placeholder);
  });
  t('the picker opens with every country in it', function () {
    open();
    if (!isOpen()) return 'the menu did not open';
    if (rows().length !== 245) return 'the list has ' + rows().length + ' rows, expected 245';
  });
  t('the four we serve are held above the other 241', function () {
    var l = labels();
    if (!/^Jordan/.test(l[0]) || !/^Lebanon/.test(l[1]) || !/^Iraq/.test(l[2]) || !/^Syria/.test(l[3]))
      return 'the first four are ' + l.slice(0, 4).join(' | ');
    if (!rows()[3].classList.contains('pin-last')) return 'the divider is not after the fourth row';
  });
  t('typing a name finds it, and Enter picks it', function () {
    // "german" rather than "ger": the shorter substring also lands inside Algeria, Niger and
    // Nigeria, which is correct search behaviour, not a bug, but leaves more than one row and
    // would make Enter pick whichever sorts first rather than proving Enter takes the match.
    type('german');
    var l = labels();
    if (l.length !== 1 || l[0].indexOf('Germany') !== 0) return 'searching "german" gave ' + l.join(' | ');
    key('Enter');
    if (isOpen()) return 'the menu stayed open after Enter';
    if (dial() !== '+49') return 'the button reads ' + dial();
    if (local().placeholder !== '15123456789') return 'the placeholder is still ' + JSON.stringify(local().placeholder);
  });
  t('typing a dial code finds it too, with or without a plus', function () {
    open(); type('49');
    if (!labels().some(function (x) { return x.indexOf('Germany') === 0; })) return '"49" did not find Germany';
    type('+49');
    if (!labels().some(function (x) { return x.indexOf('Germany') === 0; })) return '"+49" did not find Germany';
    // The ISO2 check is exact ("de" === Germany's own code), but "de" is also a plain
    // substring of Bangladesh, Cabo Verde, Denmark, Guadeloupe and Sweden, so this asks
    // whether Germany is among the results rather than the only one.
    type('de');
    if (!labels().some(function (x) { return x.indexOf('Germany') === 0; })) return '"de" did not find Germany';
  });
  t('a search with no matches says so and offers nothing', function () {
    type('zzzz');
    if (rows().length !== 0) return 'still showing ' + rows().length + ' rows';
    if (q('.cc-empty').hidden) return 'the No matches line is hidden';
  });
  t('the arrow keys move the highlight and Enter takes it', function () {
    type(''); key('ArrowDown'); key('ArrowDown');
    var hi = labels()[1];
    key('Enter');
    // Second row of the unfiltered list is Lebanon, so this proves Enter took the HIGHLIGHT
    // and not simply the first row.
    if (dial() !== '+961') return 'picked ' + dial() + ' after highlighting ' + hi;
  });
  t('Escape closes the menu and changes nothing', function () {
    open(); type('ger'); key('Escape');
    if (isOpen()) return 'the menu is still open';
    if (dial() !== '+961') return 'the country changed to ' + dial();
  });
  ta('a number is composed from the picker and the box together', async function () {
    open(); type('jordan'); pickNth(0);
    typeNumber('0791234567');
    var v = await submitted();
    // The leading zero is still stripped, which is the fix for the commonest entry mistake
    // here.
    if (v !== '+962791234567') return 'submitted ' + JSON.stringify(v);
  });
  ta('an Amman landline is accepted now, and nonsense of the right length is not', async function () {
    typeNumber('65001234');
    var landline = await submitted();
    if (landline !== '+96265001234') return '8 digit landline was refused, got ' + JSON.stringify(landline);
    typeNumber('999999999');
    var junk = await submitted();
    if (junk !== null) return '999999999 was accepted as ' + JSON.stringify(junk);
    typeNumber('79123456');
    var short = await submitted();
    if (short !== null) return 'a number one digit short was accepted as ' + JSON.stringify(short);
  });
  // Egypt, not Germany: Germany's real pattern (sourced from the same libphonenumber-style
  // metadata as every other row) is wide enough that a 9-digit Jordanian mobile happens to
  // pass it too, which would prove nothing. Egypt's valid lengths also include 9, so this is a
  // same-length rejection, not a disguised length check: the pattern is what does the work.
  return ta('validation is the chosen country rule, not one rule for everybody', async function () {
    open(); type('egypt'); key('Enter');
    typeNumber('1001234567');
    var eg = await submitted();
    if (eg !== '+201001234567') return 'a real Egyptian number was refused';
    // A Jordanian mobile is not an Egyptian number, even though both are 9 digits.
    typeNumber('791234567');
    var wrong = await submitted();
    if (wrong !== null) return 'a Jordanian number was accepted as Egyptian: ' + JSON.stringify(wrong);
  });
`, 'search and per-country validation');
