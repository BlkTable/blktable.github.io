// Filling a form in, losing the page, and coming back to it — in a real browser.
//
// form-draft.test.js covers the helpers. None of what matters here is reachable from node:
// it is the page booting, a combobox settling on a choice, a country picker, ticked boxes,
// a real File in a file input, and then the whole form being drawn again from scratch the
// way a reload draws it. The whole of f/index.html is loaded unmodified apart from two
// stubs (the supabase client, and a localStorage the test can look inside), so the code
// under test is the deployed code.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/form-draft.chrome.js
//   CHROME="C:/path/to/chrome.exe" …          (if Chrome is somewhere else)
//
// Skipped rather than failed when no Chrome is found, the way the other .chrome.js files are.
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
if (!/cdn\.jsdelivr\.net/.test(src)) throw new Error('f/index.html no longer loads supabase from a CDN; update this stub');

// The client and the browser's storage, and nothing else. A file:// page has no localStorage
// worth relying on, and the test needs to read what the page wrote, so it hands the page one
// it can see inside — the same API, and it records every write.
const STUB = `
window.__store = { map: {}, writes: 0 };
// what this browser was already carrying: another form's draft, left a month ago, and the
// one-submission-per-form id that must outlive every draft
window.__store.map['blk_draft_someotherform'] = JSON.stringify({ v: 1, at: Date.now() - 30 * 86400000, a: { x: '1' } });
window.__store.map['blk_device'] = 'device-id-that-must-survive';
try {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    get length() { return Object.keys(window.__store.map).length; },
    key: function (i) { return Object.keys(window.__store.map)[i]; },
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(window.__store.map, k) ? window.__store.map[k] : null; },
    setItem: function (k, v) { window.__store.writes++; window.__store.map[k] = String(v); },
    removeItem: function (k) { delete window.__store.map[k]; }
  } });
} catch (e) { window.__storeFailed = String(e && e.message); }
window.TABLE = { id: 'tbl', name: 'Shop Spot Check', name_ar: null, slug: 'qc', is_active: true, kind: 'form', config_public: {} };
function q(id, type, extra) {
  return Object.assign({ id: id, table_id: 'tbl', position: 0, label: id, label_ar: null, type: type,
                         required: false, options: null, internal: false, after_field: null, show_if: null }, extra || {});
}
window.FIELDS = [
  q('name', 'short_text', { required: true }),
  q('why', 'long_text'),
  q('age', 'number'),
  q('when', 'date'),
  q('ok', 'yesno'),
  q('detail', 'short_text', { show_if: { field: 'ok', equals: ['Yes'] } }),
  q('how', 'dropdown', { options: [{ en: 'Instagram' }, { en: 'Something else', other: true }] }),
  q('days', 'multi_select', { options: [{ en: 'Sat' }, { en: 'Sun' }, { en: 'Mon' }] }),
  q('tel', 'phone'),
  q('pic', 'photo')
];
window.__rpc = null;
window.supabase = { createClient: function () {
  function chain(rows) {
    var o = {};
    ['select', 'eq', 'order', 'limit'].forEach(function (m) { o[m] = function () { return o; }; });
    o.single = function () { return { then: function (f) { return Promise.resolve(f({ data: rows[0], error: null })); } }; };
    o.then = function (f) { return Promise.resolve(f({ data: rows, error: null })); };
    return o;
  }
  return {
    from: function (t) {
      if (t === 'app_tables') return chain([window.TABLE]);
      if (t === 'app_fields') return chain(window.FIELDS);
      return chain([]);
    },
    rpc: function (name, payload) { window.__rpc = { name: name, payload: payload }; return Promise.resolve({ data: {}, error: null }); }
  };
} };
`;

const DRIVER = `
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); } else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function finish() {
  out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
  document.getElementById('out').textContent = out.join('\\n');
  document.title = 'done';
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function until(test, ms) {
  var t0 = Date.now();
  return (function again() {
    if (test()) return Promise.resolve(true);
    if (Date.now() - t0 > ms) return Promise.resolve(false);
    return sleep(50).then(again);
  })();
}
function el(id) { return document.getElementById(id); }
function set(id, v) { var e = el(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }
function tick(fieldId, values) {
  [].slice.call(el('fld-' + fieldId).querySelectorAll('input')).forEach(function (i) {
    if (values.indexOf(i.value) !== -1) { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}
// The combobox settles a choice in code, on blur, not through a DOM event — so it is driven
// the way a person on a desktop drives it: type the choice, leave the box.
function pickCombo(fieldId, text) {
  var i = el('fld-' + fieldId);
  i.dispatchEvent(new Event('focus', { bubbles: true }));
  i.value = text;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('blur', { bubbles: true }));
  return sleep(250);
}
function addPhoto() {
  var dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(512)], 'me.jpg', { type: 'image/jpeg' }));
  var inp = el('fld-pic');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
}
// A reload, as far as this page is concerned: nothing on screen, no controls, and init()
// drawing the questions again from the same table and fields.
function refresh() {
  controls.length = 0;
  el('fields').innerHTML = '';
  el('draft-note').style.display = 'none';
  currentTable = null;
  init(window.TABLE, window.FIELDS);
  return sleep(120);
}

until(function () { return el('fld-name'); }, 5000).then(function (booted) {
  ok('the form drew its questions', booted);
  ok('the page could be given a storage it can see inside', !window.__storeFailed, window.__storeFailed);
  ok('an untouched form writes no draft at all', window.__store.writes === 0 && !window.__store.map['blk_draft_qc'],
     JSON.stringify(window.__store.map));
  ok('a month-old draft for another form was swept on the way in',
     !window.__store.map['blk_draft_someotherform'], JSON.stringify(Object.keys(window.__store.map)));
  ok('and this browser kept its device id, which is not a draft',
     window.__store.map['blk_device'] === 'device-id-that-must-survive', JSON.stringify(Object.keys(window.__store.map)));

  set('fld-name', 'Ahmad');
  set('fld-why', 'because the coffee');
  set('fld-age', '7');
  set('fld-when', '2026-08-01');
  set('fld-ok', 'Yes');
  tick('days', ['Sat', 'Mon']);
  set('fld-tel', '71234567');
  document.querySelectorAll('.cc-menu li')[1].click();   // Lebanon
  addPhoto();
  return pickCombo('how', 'Something else');
}).then(function () {
  return until(function () { return el('fld-detail'); }, 2000);
}).then(function (asked) {
  ok('the question behind a Yes is being asked', asked);
  set('fld-detail', 'it was the fastest');
  set('fld-how-other', 'a friend told me');
  saveDraftNow();
  var raw = window.__store.map['blk_draft_qc'];
  ok('the answers are in the browser under this form\\'s own key', !!raw, JSON.stringify(Object.keys(window.__store.map)));
  var a = JSON.parse(raw || '{}').a || {};
  ok('every kind of question was kept',
     a.name === 'Ahmad' && a.why === 'because the coffee' && a.age === '7' && a.when === '2026-08-01' &&
     a.ok === 'Yes' && a.detail === 'it was the fastest' && a.how === 'Something else' &&
     a.how__other === 'a friend told me' && a.days === 'Sat, Mon' && a.tel === '+96171234567',
     JSON.stringify(a));
  ok('the photo was not, because a file cannot be', !('pic' in a), JSON.stringify(a));

  return refresh();
}).then(function () {
  ok('the name came back', el('fld-name').value === 'Ahmad', el('fld-name').value);
  ok('the long answer came back', el('fld-why').value === 'because the coffee', el('fld-why').value);
  ok('the number came back', el('fld-age').value === '7', el('fld-age').value);
  ok('the date came back', el('fld-when').value === '2026-08-01', el('fld-when').value);
  ok('the yes/no came back', el('fld-ok').value === 'Yes', el('fld-ok').value);
  ok('the chosen option came back, read as its own label', /Something else/.test(el('fld-how').value), el('fld-how').value);
  ok('and the words typed behind it', el('fld-how-other').value === 'a friend told me', el('fld-how-other').value);
  var ticked = [].slice.call(el('fld-days').querySelectorAll('input')).filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
  ok('the ticks came back, and only the ticked ones', ticked.join(',') === 'Sat,Mon', ticked.join(','));
  ok('the phone number came back', el('fld-tel').value === '71234567', el('fld-tel').value);
  ok('with the country it was typed under, not the default',
     document.querySelector('.cc-dial').textContent === '+961', document.querySelector('.cc-dial').textContent);
  // The one that would have made the whole thing worthless: a question asked only behind a
  // Yes is hidden while the form is being rebuilt, and must not lose its answer to that.
  ok('a question asked only behind a Yes is asked again, with its answer',
     el('fld-detail') && el('fld-detail').value === 'it was the fastest', el('fld-detail') && el('fld-detail').value);
  // The input is empty whatever happens: no page may put a file into an <input type="file">,
  // so a kept photo comes back into the control and its tiles, never into the element. And in
  // this harness nothing comes back at all — the page is on file://, which has no origin, and
  // Chrome refuses an origin-less page IndexedDB. That is the fallback the pages are written
  // to survive, and here it is being survived: the answers come back, the photo does not, and
  // the note says so rather than promising something that is not there. The photos actually
  // coming back, on a served page and across a real reload, is form-draft-files.chrome.js.
  ok('the file input is empty, as it is either way', el('fld-pic').files.length === 0, String(el('fld-pic').files.length));
  ok('and with no storage to keep the photo, the person is told so in both languages',
     el('draft-note').style.display === 'block' &&
     /kept the answers/.test(el('draft-note-en').textContent) && /Photos and files/.test(el('draft-note-en').textContent) &&
     el('draft-note-ar').textContent.length > 10,
     el('draft-note').style.display + ' | ' + el('draft-note-en').textContent);

  // Submitting is what ends a draft: the next person on this phone must find an empty form.
  el('submit-btn').click();
  return until(function () { return el('success').style.display === 'block' || el('form-msg').textContent !== ''; }, 8000);
}).then(function () {
  ok('the submission landed', el('success').style.display === 'block', el('form-msg').textContent);
  ok('it carried the restored answers, not blanks',
     window.__rpc && window.__rpc.payload.p_data.name === 'Ahmad' && window.__rpc.payload.p_data.tel === '+96171234567',
     JSON.stringify(window.__rpc && window.__rpc.payload.p_data));
  ok('and the draft is gone', !window.__store.map['blk_draft_qc'], JSON.stringify(Object.keys(window.__store.map)));
  // The page is still holding every answer in the DOM, so a save on the way out would put
  // them straight back — the reason clearing the draft also drops the key.
  saveDraftNow();
  window.dispatchEvent(new Event('pagehide'));
  return sleep(60);
}).then(function () {
  ok('nothing writes it back when the page is closed', !window.__store.map['blk_draft_qc'],
     JSON.stringify(Object.keys(window.__store.map)));
  finish();
}).catch(function (e) { ok('the driver ran to the end', false, String(e && e.message)); finish(); });
`;

// ---- the job application, which is a hand-built page and keeps its draft its own way ----
// Its trap is the Country question: it drives the dial code, the Jordan-only City list and
// "Are you Lebanese?", and it blanks the two of them for a country they do not apply to —
// so a draft restored in the wrong order comes back with the two answers wiped.
const APPLY_STUB = `
window.__store = { map: {}, writes: 0 };
try {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(window.__store.map, k) ? window.__store.map[k] : null; },
    setItem: function (k, v) { window.__store.writes++; window.__store.map[k] = String(v); },
    removeItem: function (k) { delete window.__store.map[k]; }
  } });
} catch (e) { window.__storeFailed = String(e && e.message); }
window.__rpc = null;
window.supabase = { createClient: function () {
  return {
    rpc: function (name, payload) {
      if (name === 'get_form_config') return Promise.resolve({ data: {}, error: null });
      if (name === 'form_token_valid') return Promise.resolve({ data: true, error: null });
      if (name === 'get_extra_fields') return Promise.resolve({ data: [
        { id: 'shift', label: 'Which shift?', label_ar: null, type: 'dropdown', required: false,
          options: [{ en: 'Morning' }, { en: 'Evening' }], after_field: null }
      ], error: null });
      window.__rpc = { name: name, payload: payload };
      return Promise.resolve({ data: {}, error: null });
    }
  };
} };
window.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ path: 'photos/me.jpg' }); } }); };
`;

const APPLY_DRIVER = `
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok   ' + name); } else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function finish() {
  out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
  document.getElementById('out').textContent = out.join('\\n');
  document.title = 'done';
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function until(test, ms) {
  var t0 = Date.now();
  return (function again() {
    if (test()) return Promise.resolve(true);
    if (Date.now() - t0 > ms) return Promise.resolve(false);
    return sleep(50).then(again);
  })();
}
function el(id) { return document.getElementById(id); }
function set(id, v) { var e = el(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }
// A reload, as far as this page is concerned: every box empty again, then the draft read back.
function refresh() {
  [].slice.call(document.querySelectorAll('#form input, #form select, #form textarea')).forEach(function (e) {
    if (e.type !== 'file') e.value = '';
  });
  el('draft-note').style.display = 'none';
  loadDraft();
  return sleep(80);
}

until(function () { return el('extra-shift'); }, 5000).then(function (extras) {
  ok('the page drew its questions, admin-defined ones included', extras);
  ok('an untouched form writes no draft at all', !window.__store.map['blk_draft_job_applications'],
     JSON.stringify(window.__store.map));
  set('full_name', 'Ahmad');
  set('dob', '2000-03-04');
  set('country', 'Lebanon');
  set('phone_local', '71234567');
  set('living_area', 'Beirut');
  set('how_found', 'Online');
  set('gender', 'Male');
  set('work_type', 'Full-time');
  set('currently_working', 'No');
  set('education_level', 'University');
  set('favorite_drink', 'Flat white');
  set('why_join', 'because the coffee');
  set('extra-shift', 'Evening');
  return until(function () { return el('leb-field').style.display !== 'none'; }, 2000);
}).then(function (asked) {
  ok('"Are you Lebanese?" is asked for a Lebanese number', asked, el('leb-field').style.display);
  set('is_lebanese', 'Yes');
  saveDraftNow();
  var a = JSON.parse(window.__store.map['blk_draft_job_applications'] || '{}').a || {};
  ok('the answers are in the browser under this form\\'s own key', !!Object.keys(a).length, JSON.stringify(a));
  ok('including the admin-defined question', a['extra-shift'] === 'Evening', JSON.stringify(a));
  return refresh();
}).then(function () {
  ok('the name came back', el('full_name').value === 'Ahmad', el('full_name').value);
  ok('the date of birth came back', el('dob').value === '2000-03-04', el('dob').value);
  ok('the country came back', el('country').value === 'Lebanon', el('country').value);
  ok('and with it the dial code it decides', el('cc-dial').textContent === '+961', el('cc-dial').textContent);
  ok('the phone number came back', el('phone_local').value === '71234567', el('phone_local').value);
  ok('the admin-defined question came back', el('extra-shift').value === 'Evening', el('extra-shift').value);
  ok('every other answer came back too',
     el('how_found').value === 'Online' && el('gender').value === 'Male' && el('work_type').value === 'Full-time' &&
     el('currently_working').value === 'No' && el('education_level').value === 'University' &&
     el('favorite_drink').value === 'Flat white' && el('why_join').value === 'because the coffee',
     [el('how_found').value, el('gender').value, el('work_type').value, el('currently_working').value,
      el('education_level').value, el('favorite_drink').value, el('why_join').value].join(' | '));
  // The one the ordering could quietly break: syncCountry blanks this on its way through.
  ok('"Are you Lebanese?" is asked again, and still says Yes',
     el('leb-field').style.display !== 'none' && el('is_lebanese').value === 'Yes',
     el('leb-field').style.display + ' | ' + el('is_lebanese').value);
  ok('the Jordan-only City question is still not asked', el('city-field').style.display === 'none' && el('city').value === '',
     el('city-field').style.display + ' | ' + el('city').value);
  ok('the person is told their answers were kept', el('draft-note').style.display === 'block' &&
     /kept the answers/.test(el('draft-note-en').textContent), el('draft-note-en').textContent);

  var dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(512)], 'me.jpg', { type: 'image/jpeg' }));
  el('photo').files = dt.files;
  el('photo').dispatchEvent(new Event('change', { bubbles: true }));
  el('submit-btn').click();
  return until(function () { return el('success').style.display === 'block' || el('form-msg').textContent !== ''; }, 8000);
}).then(function () {
  ok('the application went in', el('success').style.display === 'block', el('form-msg').textContent);
  ok('carrying the restored answers', window.__rpc && window.__rpc.payload.p_data.full_name === 'Ahmad' &&
     window.__rpc.payload.p_data.phone === '+96171234567', JSON.stringify(window.__rpc && window.__rpc.payload.p_data));
  ok('and the draft is gone, so the next person starts on an empty form',
     !window.__store.map['blk_draft_job_applications'], JSON.stringify(Object.keys(window.__store.map)));
  saveDraftNow();
  window.dispatchEvent(new Event('pagehide'));
  return sleep(60);
}).then(function () {
  ok('nothing writes it back when the page is closed', !window.__store.map['blk_draft_job_applications'],
     JSON.stringify(Object.keys(window.__store.map)));
  finish();
}).catch(function (e) { ok('the driver ran to the end', false, String(e && e.message)); finish(); });
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-form-draft-'));
let failed = 0, total = 0;

function run(label, srcFile, stub, driver, query) {
  const pageSrc = fs.readFileSync(srcFile, 'utf8');
  const page = pageSrc.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, '<script>' + stub + '</script>')
                      .replace('</body>', '<pre id="out"></pre><script>' + driver + '</script></body>');
  if (page === pageSrc) throw new Error('could not inject the stubs into ' + srcFile);
  const file = path.join(dir, label.replace(/\W+/g, '-') + '.html');
  fs.writeFileSync(file, page);
  const url = 'file:///' + file.replace(/\\/g, '/') + query;
  const proc = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=60000', '--dump-dom', url],
                            { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const block = ((proc.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
  if (!block) {
    console.log('FAILED (' + label + '): the page produced no results. Chrome said:\n' + (proc.stderr || '').slice(0, 2000));
    failed++; return;
  }
  const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").split('\n');
  lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(label + ': ' + l));
  const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing';
  total += Number((result.match(/(\d+) passed/) || [0, 0])[1]);
  if (!/ 0 failed/.test(result)) failed++;
  console.log('  ' + label + ': ' + result.replace('RESULT ', ''));
}

run('a custom form', 'f/index.html', STUB, DRIVER, '?t=qc');
run('the job application', 'apply/index.html', APPLY_STUB, APPLY_DRIVER, '?k=live');

console.log(total + ' form-draft browser checks passed (in ' + path.basename(chrome) + ')');
if (failed) process.exitCode = 1;
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
