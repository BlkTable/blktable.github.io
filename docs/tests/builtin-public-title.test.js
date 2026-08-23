// The heading /apply and /cast print, which is NOT the table's name.
//
// The table is called "Job Applications"; the page says "Job Application · طلب توظيف".
// Renaming the table in the dashboard therefore could not reach the page, and pretending it
// did would have been worse than leaving it: the preview would show applicants a heading
// they never see. So the heading is its own setting — `config.title` on the built-in table,
// carried to the page by `get_form_config`, which returns that config as it is (unlike a
// custom form, whose page reads the whitelisted `config_public` column — which is exactly
// why this control is offered for the two built-in forms only).
//
// The rule is written TWICE, in index.html and in both public pages, the way condMet is, so
// the tests below load all three and assert they cannot disagree about what the applicant is
// looking at.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('no fn ' + name);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function grabVar(js, name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = \\{[\\s\\S]*?\\n  \\};'));
  if (!m) throw new Error('no var ' + name);
  return m[0];
}
const SRC = scripts('index.html');
const APPLY_SRC = fs.readFileSync('apply/index.html', 'utf8');
const CAST_SRC = fs.readFileSync('cast/index.html', 'utf8');

const ctx = { console };
vm.createContext(ctx);
new vm.Script('(function(){' + grabVar(SRC, 'BUILTIN_PUBLIC_TITLE') + '\n' +
  grab(SRC, 'builtinPublicTitle') + '\nthis.API={builtinPublicTitle,BUILTIN_PUBLIC_TITLE};}).call(this)').runInContext(ctx);
const API = ctx.API;

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const title = (k, cfg) => JSON.parse(JSON.stringify(API.builtinPublicTitle(k, cfg)));

// ---- the fallback, which is what all of today's traffic gets ----
t('no title set: the page keeps the heading it has always printed', () => {
  assert.deepStrictEqual(title('job_applications', {}), { en: 'Job Application', ar: 'طلب توظيف' });
  assert.deepStrictEqual(title('casting', null), { en: 'BLK Casting', ar: 'كاستنج' });
});
t('a null or empty title is the same as no title', () => {
  // serializePublicTitle() returns null for two empty boxes, so this is the shape that is
  // actually stored when an admin clears the fields — it must not blank the heading.
  assert.deepStrictEqual(title('job_applications', { title: null }), { en: 'Job Application', ar: 'طلب توظيف' });
  assert.deepStrictEqual(title('job_applications', { title: { en: '', ar: '' } }), { en: 'Job Application', ar: 'طلب توظيف' });
  assert.deepStrictEqual(title('job_applications', { title: { en: '   ', ar: '  ' } }), { en: 'Job Application', ar: 'طلب توظيف' });
});

// ---- each half falls back on its own ----
t('setting only the English keeps the Arabic the page already printed', () => {
  // The failure this prevents: an Arabic-first form losing its Arabic heading because
  // somebody typed an English one.
  assert.deepStrictEqual(title('job_applications', { title: { en: 'Barista Hiring', ar: '' } }),
    { en: 'Barista Hiring', ar: 'طلب توظيف' });
});
t('setting only the Arabic keeps the English', () => {
  assert.deepStrictEqual(title('job_applications', { title: { en: '', ar: 'توظيف باريستا' } }),
    { en: 'Job Application', ar: 'توظيف باريستا' });
});
t('setting both replaces both', () => {
  assert.deepStrictEqual(title('casting', { title: { en: 'Casting Call', ar: 'اختبار أداء' } }),
    { en: 'Casting Call', ar: 'اختبار أداء' });
});
t('an unknown form key does not throw', () => {
  assert.deepStrictEqual(title('nope', { title: { en: 'X', ar: 'ص' } }), { en: 'X', ar: 'ص' });
  assert.deepStrictEqual(title('nope', {}), { en: '', ar: '' });
});

// ---- the same rule on the pages that actually print it ----
[['apply/index.html', APPLY_SRC, 'Job Application', 'طلب توظيف'],
 ['cast/index.html', CAST_SRC, 'BLK Casting', 'كاستنج']].forEach(function (p) {
  t(p[0] + ' reads the configured heading', () => {
    assert.ok(/applyHeading\(res\.data\.title\)/.test(p[1]), 'never reads res.data.title');
  });
  t(p[0] + ' still carries its own heading in the markup as the fallback', () => {
    // Served HTML must read correctly before any request completes, and if the RPC fails.
    const h1 = /<h1 id="form-heading">([\s\S]*?)<\/h1>/.exec(p[1]);
    assert.ok(h1, 'the heading has no id, so nothing can replace it');
    assert.ok(h1[1].indexOf(p[2]) !== -1, 'the English fallback is gone from the markup');
    assert.ok(h1[1].indexOf(p[3]) !== -1, 'the Arabic fallback is gone from the markup');
  });
  t(p[0] + ' falls back per half, the same way the dashboard does', () => {
    const fn = p[1].slice(p[1].indexOf('function applyHeading'));
    const body = fn.slice(0, fn.indexOf('\n  db.rpc'));
    assert.ok(/if \(!en && !ar\) return;/.test(body), 'an empty title would blank the heading');
    assert.ok(/en \|\| dflt\.en/.test(body) && /ar \|\| dflt\.ar/.test(body),
      'the two halves do not fall back independently, so setting one blanks the other');
  });
  t(p[0] + ' sets the heading as TEXT, never as markup', () => {
    // config.title is typed by a person and stored in the database; innerHTML here would be
    // an XSS hole on a page anyone can open.
    const fn = p[1].slice(p[1].indexOf('function applyHeading'));
    const body = fn.slice(0, fn.indexOf('\n  db.rpc'));
    assert.ok(!/innerHTML/.test(body), 'applyHeading uses innerHTML');
    assert.ok(/textContent|nodeValue/.test(body), 'applyHeading does not set text at all');
  });
});

// ---- the editor ----
t('the heading boxes are offered for built-in forms only', () => {
  // A custom form's public page prints its NAME, so the name row already IS its heading;
  // a second box there would be two controls for one thing.
  assert.ok(/bld-ptitle-row/.test(SRC), 'the heading row does not exist');
  assert.ok(/\["bld-ptitle-lab", "bld-ptitle-row"\][\s\S]{0,200}isBuiltin \? "" : "none"/.test(SRC),
    'the heading row is not gated on the form being built-in');
});
t('the editor seeds the boxes from config.title and shows the current heading as placeholder', () => {
  assert.ok(/setPublicTitleInputs\(cfg\.title, formKey\)/.test(SRC), 'the boxes are never seeded');
  const fn = grab(SRC, 'setPublicTitleInputs');
  assert.ok(/placeholder = dflt\.en/.test(fn) && /placeholder = dflt\.ar/.test(fn),
    'an admin cannot see the heading they would be replacing');
});
t('two empty boxes store nothing rather than an empty title', () => {
  const fn = grab(SRC, 'serializePublicTitle');
  assert.ok(/\(en \|\| ar\) \? \{ en: en, ar: ar \} : null/.test(fn),
    'an empty heading is stored as an object, which reads as "set" and blanks the page');
});
t('the preview shows the heading the page prints, not the table name', () => {
  assert.ok(/builtinPublicTitle\(face\.builtinKey, cfg\)/.test(SRC),
    'the preview no longer resolves the built-in heading through builtinPublicTitle');
  assert.ok(!/BUILTIN_PUBLIC_TITLE\[face\.builtinKey\]/.test(SRC),
    'the preview still reads the raw default and would ignore a configured heading');
});

console.log(n + ' built-in public title tests passed');
