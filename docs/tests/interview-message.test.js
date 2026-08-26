// The WhatsApp interview invite. It used to be a hard-coded Arabic string in the page, so
// changing a sentence in the message HR sends to every applicant was a code change and a
// deploy. It now lives in the Job Applications form editor as config.interviewMsg, and the
// string in the page is only the wording the app ships with.
//
// Three things can go quietly wrong and all three are tested here:
//   1. The template stops being read, or is read from somewhere a manager cannot see, and
//      every applicant gets the shipped default while the editor happily shows HR's wording.
//   2. A token stops being filled in, and an applicant is sent "{Date}" or a blank where
//      the date should be.
//   3. Clearing the box sends an empty WhatsApp instead of falling back to the default.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grabFn(js, name) {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', ''));
  if (!m) throw new Error('could not find function ' + name + ' in index.html');
  return m[0];
}
// var NAME = ... ; up to the first semicolon that ends the statement. Covers the multi-line
// concatenated string the default message is written as, and the token map object.
function grabVar(js, name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' =[\\s\\S]*?;\\r?\\n', ''));
  if (!m) throw new Error('could not find var ' + name + ' in index.html');
  return m[0];
}

const SRC = scripts('index.html');
const HTML = fs.readFileSync('index.html', 'utf8');

const ctx = { console };
vm.createContext(ctx);
new vm.Script('(function(){' +
  '\n  var builtinConfig = { job_applications: {}, casting: {} };' +
  grabVar(SRC, 'BLK_LOCATION') +
  grabVar(SRC, 'DEFAULT_INTERVIEW_MSG') +
  grabVar(SRC, 'INTERVIEW_TOKENS') +
  grabFn(SRC, 'interviewTemplate') +
  grabFn(SRC, 'interviewMessage') +
  '\n this.API={DEFAULT_INTERVIEW_MSG,BLK_LOCATION,interviewTemplate,interviewMessage,' +
  'setSaved:function(v){builtinConfig.job_applications={interviewMsg:v};}};' +
  '}).call(this)').runInContext(ctx);
const API = ctx.API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const reset = () => API.setSaved(null);

// ---- the wording the app ships with ----
t('the shipped message is the one HR asked for, spelling and all', () => {
  reset();
  const d = API.DEFAULT_INTERVIEW_MSG;
  // The corrections, each one a word an earlier draft got wrong. Pinned individually so a
  // failure names the word rather than diffing two paragraphs of Arabic.
  [['حابين', 'حابيين'], ['وإذا', 'وازا'], ['بانتظارك', 'بأنتظارك'], ['نرتبلك', 'نرتب لك']]
    .forEach(function (p) {
      assert.ok(d.indexOf(p[0]) !== -1, 'the message no longer says "' + p[0] + '"');
      assert.ok(d.indexOf(p[1]) === -1, 'the message says "' + p[1] + '" again, which is the misspelling');
    });
  // and the wording that was replaced is gone
  ['هلا ', 'حبينا نعزمك', 'فريق التوظيف'].forEach(function (old) {
    assert.ok(d.indexOf(old) === -1, 'the previous message is still in the page: "' + old + '"');
  });
  assert.ok(/مع تحياتنا\s*$/.test(d), 'the message no longer ends on "مع تحياتنا"');
});
t('the shipped message asks for every token it needs', () => {
  reset();
  ['{Full name}', '{Date}', '{Time}', '{Location}'].forEach(function (tok) {
    assert.ok(API.DEFAULT_INTERVIEW_MSG.indexOf(tok) !== -1,
      'the shipped message no longer carries ' + tok + ', so that detail never reaches the applicant');
  });
});

// ---- which template wins ----
t('a message saved in the editor replaces the shipped one', () => {
  API.setSaved('مرحبا {Full name}');
  assert.strictEqual(API.interviewTemplate(), 'مرحبا {Full name}');
  reset();
});
t('an empty or blank box falls back — approving must never send a blank WhatsApp', () => {
  [null, '', '   ', '\n\n'].forEach(function (v) {
    API.setSaved(v);
    assert.strictEqual(API.interviewTemplate(), API.DEFAULT_INTERVIEW_MSG,
      'a template of ' + JSON.stringify(v) + ' is used as-is instead of falling back');
  });
  reset();
});

// ---- filling it in ----
t('every token is filled, in English and in Arabic', () => {
  reset();
  API.setSaved('{Full name}|{Date}|{Time}|{Location}');
  assert.strictEqual(API.interviewMessage('Sara', 'Monday 1 September 2026', '4:30 PM'),
    'Sara|Monday 1 September 2026|4:30 PM|' + API.BLK_LOCATION);
  API.setSaved('{الاسم}|{التاريخ}|{الوقت}|{المكان}');
  assert.strictEqual(API.interviewMessage('Sara', 'Monday 1 September 2026', '4:30 PM'),
    'Sara|Monday 1 September 2026|4:30 PM|' + API.BLK_LOCATION,
    'the Arabic spelling of the tokens is not filled in, so an Arabic-typed message sends {التاريخ} literally');
  reset();
});
t('tokens are matched loosely enough to survive being typed by hand', () => {
  API.setSaved('{ full NAME }');
  assert.strictEqual(API.interviewMessage('Sara', '', ''), 'Sara',
    'a token with stray spaces or different case is not recognised');
  reset();
});
t('a token nobody recognises is dropped, not sent to the applicant', () => {
  API.setSaved('hello {Nonsense} there');
  const out = API.interviewMessage('Sara', 'd', 't');
  assert.ok(out.indexOf('{') === -1, 'an unrecognised token is sent verbatim: ' + out);
  reset();
});
t('a missing date or time leaves a gap, never the string "undefined"', () => {
  reset();
  const out = API.interviewMessage(null, undefined, undefined);
  assert.ok(out.indexOf('undefined') === -1, 'the message prints "undefined": ' + out);
  assert.ok(out.indexOf('null') === -1, 'the message prints "null": ' + out);
});

// ---- the editor that writes it ----
t('the Job Applications editor has a box for the message', () => {
  assert.ok(/id="bld-invite"/.test(HTML), 'there is no invite textarea in the builder');
  assert.ok(/id="bld-invite-lab"/.test(HTML) && /id="bld-invite-row"/.test(HTML),
    'the invite box has no label/row to show and hide');
  assert.ok(/id="bld-invite-lab"[^>]*display:none/.test(HTML) && /id="bld-invite-row"[^>]*display:none/.test(HTML),
    'the invite box starts visible, so it shows on a custom table until the editor hides it');
});
t('the box is offered to Job Applications only', () => {
  const m = /var showInvite = ([^;]+);/.exec(SRC);
  assert.ok(m, 'nothing decides whether the invite box is shown');
  assert.ok(/isBuiltin/.test(m[1]) && /job_applications/.test(m[1]),
    'the invite box is not limited to the built-in Job Applications form: ' + m[1]);
});
t('opening the editor loads the saved message, and saving writes it back', () => {
  assert.ok(/setInviteInput\(cfg\.interviewMsg\)/.test(SRC),
    'openBuiltinEdit does not load config.interviewMsg, so the box shows blank over a saved message');
  assert.ok(/setInviteInput\(null\)/.test(SRC),
    'the box is not cleared before loading, so it would show the previous form\'s message');
  assert.ok(/interviewMsg: builtinEditKey === "job_applications" \? serializeInviteMsg\(\)/.test(SRC),
    'the save no longer writes serializeInviteMsg() for job_applications');
  assert.ok(/return v \|\| null;/.test(grabFn(SRC, 'serializeInviteMsg')),
    'a cleared box is saved as "" rather than null, which no longer reads as "use the default"');
});
t('the message is read from the RPC cache, not the admin-only table row', () => {
  // get_form_config is security definer and granted to authenticated; app_tables is gated by
  // can_access on the placeholder UUID, which a manager does not hold. Reading the row would
  // work for whoever edited the message and silently fail for whoever sends it.
  assert.ok(/builtinConfig\.job_applications[^;\n]*\.interviewMsg/.test(SRC),
    'interviewTemplate no longer reads builtinConfig');
  assert.ok(/builtinConfig\[k\] = res\.data;/.test(SRC),
    'nothing fills builtinConfig from get_form_config, so it stays empty and the default always wins');
  assert.ok(!/builtinTable\.job_applications[^;\n]*interviewMsg/.test(SRC),
    'the message is read off the app_tables row, which a manager cannot select');
});
t('saving updates the cache, so the next invite uses the new wording', () => {
  assert.ok(/builtinConfig\[bk\] = tableUpdate\.config;/.test(SRC),
    'the cache is not refreshed after a save — the message just written would not be sent until a reload');
});

console.log(n + ' tests passed');
