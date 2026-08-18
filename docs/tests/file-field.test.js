// The "file" field type: a question that takes an uploaded file of ANY type.
//
// It is the widest member of the isFileField family (photo -> media -> file). The stored
// answer is the same bare R2 object key with no MIME beside it, so — like media — every
// downstream site decides "image, video, or a file to download?" from that string alone.
// This file tests the admin app (index.html); the public form is asserted by source regex
// at the end, the way media-field.test.js does for the shared byte ceilings.

const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(path) {
  const src = fs.readFileSync(path, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
const APP = scripts('index.html');
const APP_SRC = fs.readFileSync('index.html', 'utf8');
const PUB_SRC = fs.readFileSync('f/index.html', 'utf8');

function grab(js, name) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('could not find function ' + name);
  const open = js.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    const c = js[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
function grabVar(js, name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [\\s\\S]*?;(?=\\r?\\n)'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
function load(js, vars, fns) {
  const code = vars.map(v => grabVar(js, v)).join('\n') + '\n' + fns.map(f => grab(js, f)).join('\n');
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + code + '\n this.API={' + fns.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

// Each task extends these two arrays with the names it needs. Task 1 lists only what already
// exists in the page, so this file loads green from the start and Task 1's assertions are the
// first red. A later task that names a not-yet-written function makes load() throw — which is
// that task's red state, resolved by implementing the function.
const A = load(APP,
  ['PHOTO_MAX_BYTES', 'MEDIA_MAX_BYTES'],
  ['isFileField', 'isFileType', 'uploadCap']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- file is an upload question ------------------------------------------
t('photo, media and file are all upload questions', () => {
  ['photo', 'media', 'file'].forEach(ty => {
    assert.ok(A.isFileField({ type: ty }), ty + ' must be an upload question');
    assert.ok(A.isFileType(ty), ty + ' must be an upload type');
  });
});
t('an ordinary question is not an upload question', () => {
  ['short_text', 'long_text', 'number', 'dropdown', 'dob', 'yesno', 'email', 'phone'].forEach(ty => {
    assert.ok(!A.isFileField({ type: ty }), ty + ' must not be treated as an upload');
  });
});
t('a missing field is not an upload question', () => {
  assert.ok(!A.isFileField(null) && !A.isFileField(undefined) && !A.isFileField({}));
});

// ---- the size ceiling ----------------------------------------------------
t('a file question gets the same 50 MB ceiling as media', () => {
  assert.strictEqual(A.uploadCap({ type: 'file' }), A.uploadCap({ type: 'media' }));
  assert.strictEqual(A.uploadCap({ type: 'file' }), 50 * 1024 * 1024);
});
// The photo cap is what protects the tables that already exist — a new type must not raise it.
t('photo and ordinary fields keep the 10 MB ceiling', () => {
  [{ type: 'photo' }, { type: 'short_text' }, {}, null].forEach(f => {
    assert.strictEqual(A.uploadCap(f), 10 * 1024 * 1024);
  });
});

// ---- the builder offers it -----------------------------------------------
t('the field-type picker offers File', () => {
  assert.ok(/\{\s*v:\s*["']file["'],\s*label:\s*["']File["']\s*\}/.test(APP_SRC),
    'File must be a choice in FIELD_TYPES or nobody can create the question');
});

console.log(n + ' tests defined');
