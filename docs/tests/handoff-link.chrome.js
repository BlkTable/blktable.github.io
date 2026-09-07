// Contact Us, driven in a real browser, because "the function returns the right answer" was
// never the thing that was broken. What was broken was that choosing "Job Application"
// showed the link to the application form AND left a Submit button under it — so 39 people
// between 2026-08-18 and 2026-09-06 pressed Submit, filed a name and a topic against no
// application, and went away believing they had applied.
//
// handoff-link.test.js pins the rule. This file loads the WHOLE public form page against a
// stubbed database holding the real Contact Us fields, clicks through the Topic list answer
// by answer, and asks the only question that matters: is the button on the screen. A unit
// test cannot see that — the mutation that stops hiding the button passes every one of them.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/handoff-link.chrome.js
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

const PAGE = fs.readFileSync('f/index.html', 'utf8');

// The real Contact Us questions, read out of the live table on 2026-09-07. Three of the six
// topics hand off; the other three are answered on the form.
const TOPIC = '1ca4ef3e-a730-51c8-8de0-747c3f63025a';
const T_JOB = 'Job Application - طلب توظيف';
const T_COMPLAINT = 'Complaint/Note - شكوى او ملاحظة';
const T_FRANCHISE = 'Franchise Opportunity - فرصة شراكة';
const T_RENTAL = 'Rental Location - موقع للإيجار/التملك';
const T_OTHER = 'Other Topic - موضوع آخر';
const FIELDS = [
  { id: 'f-name', position: 1, label: 'Full Name', type: 'short_text', required: true, internal: false },
  { id: 'f-email', position: 2, label: 'Email', type: 'email', required: true, internal: false },
  { id: TOPIC, position: 4, label: 'Topic', type: 'dropdown', required: true, internal: false,
    options: [{ en: T_COMPLAINT, ar: '' }, { en: T_JOB, ar: '' }, { en: T_RENTAL, ar: '' },
              { en: T_FRANCHISE, ar: '' }, { en: 'Events Opportunity', ar: '' }, { en: T_OTHER, ar: '' }] },
  { id: 'f-link-franchise', position: 5, label: 'يرجى متابعة على الرابط', type: 'link', required: false, internal: false,
    options: { url: 'https://blktable.blk.jo/f/?t=franchise-apply', text: 'https://blktable.blk.jo/f/?t=franchise-apply' },
    show_if: { field: TOPIC, equals: [T_FRANCHISE] } },
  { id: 'f-link-complaint', position: 6, label: 'يرجى متابعة على الرابط', type: 'link', required: false, internal: false,
    options: { url: 'https://blktable.blk.jo/f/?t=customer-complaints', text: 'https://blktable.blk.jo/f/?t=customer-complaints' },
    show_if: { field: TOPIC, equals: [T_COMPLAINT] } },
  { id: 'f-message', position: 7, label: 'Message', type: 'long_text', required: true, internal: false,
    show_if: { field: TOPIC, equals: ['Events Opportunity', T_OTHER] } },
  { id: 'f-where', position: 8, label: 'Where is the location?', type: 'short_text', required: true, internal: false,
    show_if: { field: TOPIC, equals: [T_RENTAL] } },
  { id: 'f-sqm', position: 9, label: 'Space of rental Location (in sqm)', type: 'short_text', required: true, internal: false,
    show_if: { field: TOPIC, equals: [T_RENTAL] } },
  { id: 'f-link-job', position: 11, label: 'يرجى متابعة على الرابط', type: 'link', required: false, internal: false,
    options: { url: 'https://blktable.blk.jo/apply/', text: 'https://blktable.blk.jo/apply/' },
    show_if: { field: TOPIC, equals: [T_JOB] } }
];
// A footnote link, always shown, on a form that still collects an answer. Nothing about the
// hand-off may take THIS form's Submit button away — 196 imported link fields and any
// "read the policy" button depend on it.
const FOOTNOTE_FIELDS = [
  { id: 'f-name', position: 1, label: 'Full Name', type: 'short_text', required: true, internal: false },
  { id: 'f-policy', position: 2, label: 'Our privacy policy', type: 'link', required: false, internal: false,
    options: { url: 'https://blk.jo/privacy' } },
  { id: 'f-imported', position: 3, label: 'Linked To Meeting Schedule', type: 'link', required: false, internal: false,
    options: null }
];

// The stub sits where the Supabase CDN <script> is, so the real page boots against it. The
// page makes exactly these reads: the table by slug, its fields, branches, countries, and the
// ballot RPC. RPC calls are counted, which is how the last test knows nothing was filed.
function stubbed(fields, draftAnswers) {
  // Seeded before the page's own script runs, so this is the form somebody comes back to
  // rather than one they clicked through: restoring answers fires no events, and the whole
  // consequence of a restored answer is applied in one call at the end of render.
  const seed = draftAnswers ? `
  try {
    window.localStorage.setItem('blk_draft_contact-us',
      JSON.stringify({ v: 1, at: Date.now(), a: ${JSON.stringify(draftAnswers)} }));
  } catch (e) { window.SEED_FAILED = true; }` : '';
  const stub = `<script>${seed}
  window.RPC_CALLS = [];
  var TABLE = { id: 't-contact', name: 'Contact Us', name_ar: '', slug: 'contact-us',
                is_active: true, kind: 'form', config_public: {} };
  var FIELDS = ${JSON.stringify(fields)};
  function rowsFor(t) {
    if (t === 'app_tables') return TABLE;
    if (t === 'app_fields') return FIELDS;
    return [];
  }
  function builder(t) {
    var o = {}, res = { data: rowsFor(t), error: null };
    ['select', 'eq', 'order', 'limit', 'in', 'is', 'neq'].forEach(function (m) { o[m] = function () { return o; }; });
    o.single = function () { return Promise.resolve(res); };
    o.then = function (f, r) { return Promise.resolve(res).then(f, r); };
    o.catch = function (f) { return Promise.resolve(res).catch(f); };
    return o;
  }
  window.supabase = { createClient: function () {
    return {
      from: builder,
      rpc: function (name, args) {
        window.RPC_CALLS.push({ name: name, args: args });
        return Promise.resolve({ data: name === 'ballot_options' ? [] : null, error: null });
      }
    };
  } };
<\/script>`;
  let html = PAGE.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, stub);
  if (html === PAGE) throw new Error('could not find the Supabase CDN script tag to stub');
  // The page reads its slug off the query string, which a file:// URL carries fine, but the
  // driver is appended here so it runs in the same document as the page it is driving.
  html = html.replace('</body>', DRIVER + '</body>');
  if (html.indexOf('id="out"') === -1) throw new Error('driver was not appended');
  return html;
}

// Everything below runs IN the page, after the form has rendered.
const DRIVER = `
<pre id="out"></pre>
<script>
(function () {
  var out = [], pass = 0, fail = 0;
  function ok(name, cond, extra) {
    if (cond) { pass++; out.push('ok   ' + name); }
    else { fail++; out.push('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
  }
  function finish() {
    out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
    document.getElementById('out').textContent = out.join('\\n');
  }
  window.onerror = function (m, s, l) {
    document.getElementById('out').textContent = 'RESULT 0 passed, 1 failed\\nFAIL page threw: ' + m + ' (line ' + l + ')';
    return true;
  };

  var btn = function () { return document.getElementById('submit-btn'); };
  // What a person can see, not what a variable says: an element with no offsetParent and no
  // box is not on the screen, however the style was written.
  function onScreen(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return !!(el.offsetParent || el.offsetWidth || el.offsetHeight) && r.width > 0 && r.height > 0;
  }
  function visibleLinks() {
    return [].slice.call(document.querySelectorAll('#fields a.form-link')).filter(onScreen);
  }
  // Pick from the real Topic widget the way a person does: focus it (which opens the list),
  // then press the option. It is a custom combo — assigning .value fires nothing.
  function chooseTopic(label) {
    var input = document.getElementById('fld-${TOPIC}');
    if (!input) return 'no topic box';
    input.dispatchEvent(new Event('focus'));
    var list = input.parentNode.querySelector('.combo-list');
    var opts = [].slice.call(list.querySelectorAll('.combo-opt'));
    var hit = opts.filter(function (o) { return o.textContent.trim() === label.trim(); })[0];
    if (!hit) return 'no option ' + label + ' among [' + opts.map(function (o) { return o.textContent; }).join(' | ') + ']';
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    return '';
  }

  // The footnote form has no Topic question, so only the number of rendered questions is
  // waited on — a page that never boots must fail loudly rather than pass vacuously.
  var WANT = Number(document.body.getAttribute('data-questions'));
  function waitForForm(tries, then) {
    var f = document.getElementById('fields');
    if (f && f.children.length >= WANT) return then();
    if (tries <= 0) {
      ok('the form rendered all ' + WANT + ' questions', false,
         'only ' + ((f && f.children.length) || 0) + ' in #fields after waiting');
      return finish();
    }
    setTimeout(function () { waitForForm(tries - 1, then); }, 50);
  }

  waitForForm(60, function () {
    var mode = document.body.getAttribute('data-mode');

    if (mode === 'draft') {
      // ---- the form somebody comes back to ----
      // A draft is put back one answer at a time and fires nothing, so the button is decided
      // by the single catch-up call at the end of render. If that call were ever dropped, a
      // returning applicant would see the link and the button together again.
      ok('the draft was seeded', !window.SEED_FAILED, 'localStorage refused the seed');
      ok('the restored topic is in the box',
         (document.getElementById('fld-${TOPIC}') || {}).value === '${T_JOB}',
         JSON.stringify((document.getElementById('fld-${TOPIC}') || {}).value));
      ok('the restored answer revealed the link', visibleLinks().length === 1,
         String(visibleLinks().length) + ' links');
      ok('and no Submit button came back with the draft', !onScreen(btn()),
         btn() ? 'display=' + btn().style.display : 'no button element');
      return finish();
    }

    if (mode === 'footnote') {
      // ---- the form that must NOT lose its button ----
      ok('an always-shown link is on screen', visibleLinks().length >= 1,
         String(visibleLinks().length) + ' visible links');
      ok('a footnote link does not take the Submit button away', onScreen(btn()));
      return finish();
    }

    // ---- nothing chosen yet ----
    ok('the Submit button is there before a topic is chosen', onScreen(btn()));
    ok('and no link is showing yet', visibleLinks().length === 0);

    // ---- the reported case ----
    var err = chooseTopic('${T_JOB}');
    ok('Job Application can be chosen', !err, err);
    var links = visibleLinks();
    ok('choosing Job Application shows the application link', links.length === 1,
       String(links.length) + ' links');
    ok('and the link points at the application form',
       links[0] && links[0].getAttribute('href') === 'https://blktable.blk.jo/apply/',
       links[0] && links[0].getAttribute('href'));
    ok('THE SUBMIT BUTTON IS GONE', !onScreen(btn()),
       btn() ? 'still on screen (display=' + btn().style.display + ')' : 'no button element');
    ok('the questions this topic does not ask are gone too',
       !onScreen(document.getElementById('fld-f-message')));

    // ---- pressing Submit anyway files nothing ----
    // The button is not the only way in: a keypress, a stale click on a button mid-hide, a
    // page driven by script. So the refusal is checked, not only painted.
    var before = window.RPC_CALLS.length;
    btn().click();
    ok('a Submit that gets through anyway files nothing',
       window.RPC_CALLS.filter(function (c) { return c.name === 'submit_public_form'; }).length === 0,
       'RPCs since: ' + window.RPC_CALLS.slice(before).map(function (c) { return c.name; }).join(','));
    ok('and it does not put an error under the form instead',
       (document.getElementById('form-msg').textContent || '').trim() === '',
       document.getElementById('form-msg').textContent);
    ok('the success screen was not shown either',
       !onScreen(document.getElementById('success')));

    // ---- a complaint hands off to its own form ----
    err = chooseTopic('${T_COMPLAINT}');
    ok('Complaint can be chosen', !err, err);
    ok('a complaint shows the complaint link',
       visibleLinks()[0] && visibleLinks()[0].getAttribute('href') === 'https://blktable.blk.jo/f/?t=customer-complaints',
       visibleLinks()[0] && visibleLinks()[0].getAttribute('href'));
    ok('and the Submit button is gone for a complaint', !onScreen(btn()));

    // ---- and comes BACK for a topic this form answers itself ----
    // The half-fix to guard against: a button hidden once and never restored strands
    // everybody who changes their mind.
    err = chooseTopic('${T_RENTAL}');
    ok('Rental Location can be chosen', !err, err);
    ok('a rental location asks its own questions',
       onScreen(document.getElementById('fld-f-sqm')));
    ok('no link is showing for a rental location', visibleLinks().length === 0,
       String(visibleLinks().length) + ' links');
    ok('THE SUBMIT BUTTON IS BACK', onScreen(btn()),
       btn() ? 'display=' + btn().style.display : 'no button element');

    // ---- and the ordinary path still validates rather than silently doing nothing ----
    err = chooseTopic('${T_OTHER}');
    ok('Other Topic can be chosen', !err, err);
    ok('Other Topic keeps the Submit button', onScreen(btn()));
    btn().click();
    ok('pressing Submit with the form empty still asks for the missing answers',
       (document.getElementById('form-msg').textContent || '').indexOf('fill in') !== -1,
       'msg was ' + JSON.stringify(document.getElementById('form-msg').textContent));

    // ---- and that complaint is not left hanging over the hand-off ----
    // "Please fill in the highlighted fields" under a form whose only remaining instruction
    // is "follow this link" reads as a form that is refusing to work.
    err = chooseTopic('${T_JOB}');
    ok('Job Application can be chosen again', !err, err);
    ok('the leftover error is cleared when the form hands off',
       (document.getElementById('form-msg').textContent || '').trim() === '',
       'msg was ' + JSON.stringify(document.getElementById('form-msg').textContent));
    ok('and the button is gone again', !onScreen(btn()));

    finish();
  });
})();
<\/script>
`;

function runPage(html, name, mode, questions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-handoff-'));
  // The page asks for ../assets/favicon.svg; give it somewhere to look so the console stays
  // readable and nothing depends on a failed request.
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'f'), { recursive: true });
  try { fs.copyFileSync('assets/favicon.svg', path.join(dir, 'assets', 'favicon.svg')); } catch (e) {}
  const file = path.join(dir, 'f', 'index.html');
  fs.writeFileSync(file, html.replace('<body>',
    '<body data-mode="' + mode + '" data-questions="' + questions + '">'));
  const url = 'file:///' + file.replace(/\\/g, '/') + '?t=contact-us';
  const run = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files',
    '--virtual-time-budget=8000', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const block = ((run.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
  if (block === undefined) {
    console.log('FAILED (' + name + '): the page produced no results. Chrome said:\n' +
                (run.stderr || '').slice(0, 2000));
    process.exitCode = 1;
  } else {
    const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
    lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log(l));
    const result = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing (page never finished)';
    console.log(result.replace('RESULT ', '') + ' (' + name + ', in ' + path.basename(chrome) + ')');
    if (!/ 0 failed/.test(result)) process.exitCode = 1;
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

runPage(stubbed(FIELDS), 'Contact Us, topic by topic', 'contact', FIELDS.length);
runPage(stubbed(FIELDS, { [TOPIC]: T_JOB }), 'a kept draft comes back handed off', 'draft', FIELDS.length);
runPage(stubbed(FOOTNOTE_FIELDS), 'a form with an always-shown link keeps Submit', 'footnote', FOOTNOTE_FIELDS.length);
