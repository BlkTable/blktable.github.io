// The Form tab, for every form there is. Job Applications and BLK Casting used to print a
// paragraph saying their questions "can't be previewed here" and offered no editor at all;
// they are now described in BUILTIN_SCHEMA the way a table describes itself, so one preview
// and one editor cover all three views.
//
// Two things can go wrong quietly and both are tested here:
//   1. BUILTIN_SCHEMA drifting from the page it claims to describe. The dashboard offers
//      every entry as a "show after" anchor, and the public page silently appends a question
//      to the BOTTOM of the form when it cannot resolve the anchor. An admin who places a
//      question after "Full name" and gets it under "Photo" is given no error to notice.
//   2. builtinPreviewFields losing or repeating an extra question — the preview is the only
//      place an admin checks the order before sending the link out.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grabFn(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
// Object literals are pulled out of the page too, so a test can never assert against a copy
// of the schema that the page has since moved on from.
function grabObj(js, name, file, indent) {
  const pad = indent == null ? '  ' : indent;
  // one-line form first: the multi-line pattern would otherwise run past it to the next
  // closing brace at this indent and drag half the page in with it
  const m = js.match(new RegExp('\\n' + pad + 'var ' + name + ' = \\{[^\\n]*\\};', '')) ||
    js.match(new RegExp('\\n' + pad + 'var ' + name + ' = \\{[\\s\\S]*?\\n' + pad + '\\};', ''));
  if (!m) throw new Error('could not find var ' + name + ' in ' + file);
  return m[0];
}

const SRC = scripts('index.html');
const APPLY = fs.readFileSync('apply/index.html', 'utf8');
const CAST = fs.readFileSync('cast/index.html', 'utf8');

const ctx = { console };
vm.createContext(ctx);
new vm.Script('(function(){' +
  grabObj(SRC, 'BUILTIN_SCHEMA', 'index.html') +
  grabObj(SRC, 'BUILTIN_PUBLIC_TITLE', 'index.html') +
  grabObj(SRC, 'BUILTIN_DEFAULT_NAME', 'index.html') +
  '\n  var builtinHidden = { job_applications: [], casting: [] };' +
  '\n  var builtinExtra = { job_applications: [], casting: [] };' +
  grabFn(SRC, 'builtinPreviewFields', 'index.html') +
  '\n this.API={BUILTIN_SCHEMA,BUILTIN_PUBLIC_TITLE,BUILTIN_DEFAULT_NAME,builtinPreviewFields,' +
  'setHidden:function(k,v){builtinHidden[k]=v;},setExtra:function(k,v){builtinExtra[k]=v;}};' +
  '}).call(this)').runInContext(ctx);
const API = ctx.API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const reset = () => { API.setHidden('job_applications', []); API.setExtra('job_applications', []); };

// ---- the schema must describe the page it claims to describe ----
// Every col the dashboard offers has to be resolvable by the public page, or the "show
// after" it offers is a lie that costs an admin a question in the wrong place.
function anchorsOf(pageSrc) {
  const ids = {};
  ['HIDE_MAP', 'ANCHOR_IDS'].forEach(function (name) {
    const m = new RegExp('var ' + name + ' = \\{([^}]*)\\};').exec(pageSrc);
    if (!m) throw new Error('no ' + name + ' on the page');
    [...m[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].forEach(function (kv) { ids[kv[1]] = kv[2]; });
  });
  // the two questions whose wrapper carries the id rather than the input
  [...pageSrc.matchAll(/if \(col === "(\w+)"\) return document\.getElementById\("([\w-]+)"\)/g)]
    .forEach(function (kv) { ids[kv[1]] = kv[2]; });
  return ids;
}
function checkPage(formKey, pageSrc, pageName) {
  const ids = anchorsOf(pageSrc);
  API.BUILTIN_SCHEMA[formKey].forEach(function (d) {
    assert.ok(ids[d.col], pageName + ' cannot resolve the anchor "' + d.col + '" the dashboard offers');
    assert.ok(new RegExp('id="' + ids[d.col] + '"').test(pageSrc),
      pageName + ' maps ' + d.col + ' to #' + ids[d.col] + ', which is not on the page');
  });
}
t('every job-application question the dashboard offers exists on apply/', () => {
  checkPage('job_applications', APPLY, 'apply/index.html');
});
t('every casting question the dashboard offers exists on cast/', () => {
  checkPage('casting', CAST, 'cast/index.html');
});
t('a question that can be turned off is never marked required-in-the-record', () => {
  // core = the page requires it; those must not appear as untickable/tickable both ways
  const apply = API.BUILTIN_SCHEMA.job_applications;
  const hideMap = /var HIDE_MAP = \{([^}]*)\};/.exec(APPLY)[1];
  apply.filter(d => d.core).forEach(function (d) {
    assert.ok(!new RegExp('\\b' + d.col + '\\s*:').test(hideMap),
      d.col + ' is core in the dashboard but removable on apply/ — one of the two is wrong');
  });
});
t('every schema entry carries a type, so the preview never guesses', () => {
  Object.keys(API.BUILTIN_SCHEMA).forEach(function (k) {
    API.BUILTIN_SCHEMA[k].forEach(function (d) {
      assert.ok(d.type, k + '/' + d.col + ' has no type');
      assert.ok(d.label, k + '/' + d.col + ' has no label');
    });
  });
});

// ---- the preview ----
t('a built-in form previews its questions rather than refusing to', () => {
  reset();
  const rows = API.builtinPreviewFields('job_applications');
  assert.ok(rows.length >= 10, 'expected the whole job form, got ' + rows.length + ' questions');
  assert.strictEqual(rows[0].label, API.BUILTIN_SCHEMA.job_applications[0].label);
});
t('a question turned off is not in the preview', () => {
  reset();
  API.setHidden('job_applications', ['favorite_drink']);
  const labels = API.builtinPreviewFields('job_applications').map(f => f.label);
  assert.ok(!labels.some(l => /Favorite drink/.test(l)));
});
t('a core question stays even if something puts it in hidden', () => {
  // config.hidden is written by this app, but a stale or hand-edited row must not be able
  // to take the phone number off a form the record cannot be created without
  reset();
  API.setHidden('job_applications', ['phone', 'full_name']);
  const cols = API.builtinPreviewFields('job_applications').map(f => f.id);
  assert.ok(cols.indexOf('b-phone') !== -1);
  assert.ok(cols.indexOf('b-full_name') !== -1);
});
t('an extra question sits right after the question it is anchored to', () => {
  reset();
  API.setExtra('job_applications', [{ id: 'x1', label: 'Where before?', after_field: 'favorite_drink' }]);
  const rows = API.builtinPreviewFields('job_applications');
  const i = rows.findIndex(f => f.id === 'x1');
  assert.ok(i > 0, 'the extra question is missing from the preview');
  assert.strictEqual(rows[i - 1].id, 'b-favorite_drink');
});
t('two extras on the same anchor keep their own order', () => {
  reset();
  API.setExtra('job_applications', [
    { id: 'x1', label: 'First', after_field: 'gender' },
    { id: 'x2', label: 'Second', after_field: 'gender' }
  ]);
  const ids = API.builtinPreviewFields('job_applications').map(f => f.id);
  assert.ok(ids.indexOf('x1') < ids.indexOf('x2'));
  assert.strictEqual(ids[ids.indexOf('x1') - 1], 'b-gender');
});
t('an extra with no anchor goes to the end, where the public page puts it', () => {
  reset();
  API.setExtra('job_applications', [{ id: 'x1', label: 'Anything else?', after_field: null }]);
  const rows = API.builtinPreviewFields('job_applications');
  assert.strictEqual(rows[rows.length - 1].id, 'x1');
});
t('an extra anchored to a question that is now off falls to the end, not out', () => {
  // losing it from the preview would be worse than misplacing it: the admin would think
  // the question is gone when the public form is still asking it
  reset();
  API.setHidden('job_applications', ['gender']);
  API.setExtra('job_applications', [{ id: 'x1', label: 'Orphan', after_field: 'gender' }]);
  const rows = API.builtinPreviewFields('job_applications');
  assert.strictEqual(rows.filter(f => f.id === 'x1').length, 1);
  assert.strictEqual(rows[rows.length - 1].id, 'x1');
});
t('no extra question is ever shown twice', () => {
  reset();
  API.setExtra('job_applications', [
    { id: 'x1', after_field: 'gender', label: 'A' },
    { id: 'x2', after_field: null, label: 'B' },
    { id: 'x3', after_field: 'nonexistent_col', label: 'C' }
  ]);
  const ids = API.builtinPreviewFields('job_applications').map(f => f.id);
  ['x1', 'x2', 'x3'].forEach(function (id) {
    assert.strictEqual(ids.filter(x => x === id).length, 1, id + ' appears ' + ids.filter(x => x === id).length + ' times');
  });
});
t('a casting form with no extra questions still previews', () => {
  const rows = API.builtinPreviewFields('casting');
  assert.ok(rows.length >= 5);
  assert.ok(rows.every(f => f.builtin));
});

// ---- what the page now claims ----
t('the "cannot be previewed here" note is gone from every form', () => {
  assert.ok(!/hand-coded in the app/.test(SRC + fs.readFileSync('index.html', 'utf8')),
    'a form is still telling the admin its questions cannot be shown');
});
t('the editor is one node with two homes, not two editors', () => {
  // the whole reason "edit everything" cannot be true in one place and false in the other
  assert.ok(/function moveBuilderBody\(/.test(SRC));
  assert.ok(/id="bld-body"/.test(fs.readFileSync('index.html', 'utf8')));
  assert.ok(!/id="fform-fields"/.test(fs.readFileSync('index.html', 'utf8')),
    'the Form tab still has its own question host, so the two can drift again');
});
t('the name is editable for a built-in form too', () => {
  // the bug: setBuilderChrome used to hide the name row whenever the form was built in
  assert.ok(!/bld-two.*style\.display = isBuiltin \? "none"/.test(SRC),
    'the name row is hidden again for built-in forms');
  assert.ok(/document\.getElementById\("bld-name"\)\.value = builtinName\(formKey\)/.test(SRC));
});
t('a built-in name is read from the table row, never printed as a literal', () => {
  const literals = (SRC.match(/"Job Applications"/g) || []).length;
  // only BUILTIN_DEFAULT_NAME may still carry it
  assert.strictEqual(literals, 1, 'found ' + literals + ' hard-coded "Job Applications" in the script');
  assert.strictEqual(API.BUILTIN_DEFAULT_NAME.job_applications, 'Job Applications');
});
t('the public heading is only overridden when an admin sets one', () => {
  // pressing Save must not retitle a live form that 34,000 people have opened
  assert.ok(/title: serializePublicTitle\(\)/.test(SRC));
  assert.ok(/return \(en \|\| ar\) \? \{ en: en, ar: ar \} : null;/.test(SRC));
  [['apply/index.html', APPLY], ['cast/index.html', CAST]].forEach(function (p) {
    assert.ok(/renderTitle\(res\.data\.title\)/.test(p[1]), p[0] + ' never reads config.title');
    assert.ok(/if \(!en && !ar\) return;/.test(p[1]), p[0] + ' would blank its own heading when title is unset');
  });
});
t('a task table keeps its Form tab, because its fields still need editing', () => {
  assert.ok(!/custom-tab-form"\)\.style\.display = isTask \? "none" : ""/.test(SRC),
    'the Form tab is hidden for task tables again, which leaves their questions uneditable');
});

console.log(n + ' tests passed');
