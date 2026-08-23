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

// Comments removed, quote-aware so a URL inside a string is not mistaken for one. Used by
// the "never printed as a literal" test, which is about what the app prints and must not be
// tripped by a comment that happens to quote a name.
function stripComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(function (line) {
    var q = null;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '\\') { i++; continue; }            // an escaped slash in a regex, not a comment
      if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
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
  // Counted with COMMENTS REMOVED. This used to scan the raw script, so a comment
  // explaining why "Job Application" and "Job Applications" differ counted as a hard-coded
  // name and failed a test about what the app PRINTS. A mention in a comment is
  // documentation; the thing worth forbidding is a literal the user can end up reading.
  const code = stripComments(SRC);
  // the stripper must not have eaten the line the assertion depends on, or this passes for
  // the wrong reason
  assert.ok(/var BUILTIN_DEFAULT_NAME = \{/.test(code), 'comment stripping removed real code');
  const lines = code.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.indexOf('"Job Applications"') !== -1);
  assert.strictEqual(lines.length, 1,
    'hard-coded "Job Applications" on line(s) ' + lines.map(([n]) => n).join(', ') +
    ' — read it from the table row with builtinName() instead');
  // and the one that is allowed is the default, not a print
  assert.ok(/BUILTIN_DEFAULT_NAME/.test(lines[0][1]),
    'the surviving literal is not BUILTIN_DEFAULT_NAME: ' + lines[0][1].trim());
  assert.strictEqual(API.BUILTIN_DEFAULT_NAME.job_applications, 'Job Applications');
  // The markup carries the name too, as the label before anything has loaded. That is fine
  // *because* it is repainted from the table row — which is the part worth asserting.
  const html = fs.readFileSync('index.html', 'utf8');
  assert.ok(/data-view="job_applications"[^>]*>[\s\S]*?Job Applications/.test(html),
    'the sidebar no longer carries a pre-load label');
  assert.ok(/function paintBuiltinNames\(\)[\s\S]*?lab\.textContent = builtinName\(k\)/.test(SRC),
    'nothing repaints the sidebar label from the table row, so a rename would not reach it');
});
t('the preview shows the heading a built-in page really prints, not its table name', () => {
  // "Job Applications" is the name in the dashboard; the page prints "Job Application ·
  // طلب توظيف". Renaming the table does not reach the page (config_public is a whitelisted
  // generated column), so a preview built from the name would be showing something false.
  assert.strictEqual(API.BUILTIN_PUBLIC_TITLE.job_applications.en, 'Job Application');
  [['apply/index.html', APPLY], ['cast/index.html', CAST]].forEach(function (p) {
    var h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(p[1])[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
    var key = /apply/.test(p[0]) ? 'job_applications' : 'casting';
    var want = API.BUILTIN_PUBLIC_TITLE[key];
    assert.ok(h1.indexOf(want.en) !== -1, p[0] + ' prints "' + h1.trim() + '", not "' + want.en + '"');
    assert.ok(h1.indexOf(want.ar) !== -1, p[0] + ' does not print the Arabic "' + want.ar + '"');
  });
});
t('nothing writes an unreachable key into a built-in form config', () => {
  // config_public is a whitelisted GENERATED column, so a key invented here never reaches
  // the public page — a control that writes one would look like it worked and do nothing.
  //
  // This used to pin the line byte for byte:
  //     tableUpdate.config = { hidden: hidden, intro: serializeIntro() };
  // and so went red when that line was correctly changed to MERGE onto the existing config
  // instead of replacing it. Replacing wiped parent, capacity, scoring, alerts, card layout
  // and column order every time somebody edited a question. A test that pins a literal line
  // fails the next honest fix to it, so this asserts the rule instead: which keys, and
  // merged rather than replaced.
  const at = SRC.indexOf('if (builderMode === "builtin") {');
  assert.ok(at > -1, 'the built-in branch of the save has moved');
  const branch = SRC.slice(at, SRC.indexOf('\n    } else {', at));
  const write = /tableUpdate\.config = ([\s\S]*?);/.exec(branch);
  assert.ok(write, 'the built-in branch no longer writes tableUpdate.config');

  // merged, never replaced — the bug that wiped every key the editor does not know about
  assert.ok(/Object\.assign\(\s*\{\}\s*,\s*prevCfg\s*,/.test(write[1]),
    'the built-in config is replaced rather than merged onto what is already there: ' + write[1]);

  // and exactly the two keys that reach anything
  const keys = (write[1].match(/(\w+)\s*:/g) || []).map(function (k) { return k.replace(/\s*:$/, ''); });
  assert.deepStrictEqual(keys.sort(), ['hidden', 'intro'],
    'the built-in branch writes ' + keys.join(', ') + ' — a key beyond hidden/intro cannot reach the public page');
});
t('a task table keeps its Form tab, because its fields still need editing', () => {
  assert.ok(!/custom-tab-form"\)\.style\.display = isTask \? "none" : ""/.test(SRC),
    'the Form tab is hidden for task tables again, which leaves their questions uneditable');
});

console.log(n + ' tests passed');
