// More than one file per upload question.
//
// Every upload answer in the app used to be ONE bare R2 object key. This adds a second
// shape — an array of keys — and the whole point of these tests is that the first shape
// is untouched: 158,207 records already hold a plain string, and a change that rewrote
// what those mean would be a migration of every table at once rather than a feature.
//
// So the two rules everything else rests on:
//   filePaths(v)  reads EITHER shape and always hands back an array
//   fileValue(a)  writes ONE key as a plain string and only several as an array
// A round trip through both is therefore a no-op on every row written before today.
//
// The rules live in index.html AND f/index.html, the way condMet does, because the public
// form and the review app each carry their own copy. The last tests read both files and
// fail if only one of them was changed.

const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(path) {
  const src = fs.readFileSync(path, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
const APP = scripts('index.html');
const PUB = scripts('f/index.html');
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
  new vm.Script('(function(){' + code + '\n this.API={' + vars.concat(fns).join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const A = load(APP,
  ['PHOTO_MAX_BYTES', 'MEDIA_MAX_BYTES', 'MAX_FILES', 'VIDEO_EXT', 'VIDEO_PLAYABLE', 'IMAGE_EXT', 'PLAY_SVG', 'FILE_SVG', 'ADD_SVG'],
  ['isFileField', 'isFileType', 'isVideoPath', 'isPlayableVideo', 'isImagePath', 'fileLabel', 'esc',
   'filePaths', 'fileValue', 'firstPath', 'coverPath', 'recordFilePaths',
   'photoSectionHtml', 'coverHtml', 'customCellText', 'otherKeyFor', 'isChoiceField', 'isOtherChoice', 'ageText',
   'groupUploads']);

// The public form carries its own copy of the rules and its own file ceiling.
const P = load(PUB, ['MAX_FILES'], ['filePaths', 'fileValue', 'groupUploads']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- filePaths: read either shape --------------------------------------------
t('nothing reads as no files', () => {
  [null, undefined, '', [], [null], ['', null]].forEach(v => {
    assert.deepEqual(A.filePaths(v), [], JSON.stringify(v) + ' should read as no files');
  });
});
// This is the one that protects every existing record.
t('a single key still reads as exactly that one file', () => {
  assert.deepEqual(A.filePaths('uuid_face.jpg'), ['uuid_face.jpg']);
  assert.deepEqual(A.filePaths('9d3f2a1b-0000-0000-0000-000000000000_web'), ['9d3f2a1b-0000-0000-0000-000000000000_web']);
});
t('an array of keys reads as all of them, in order', () => {
  assert.deepEqual(A.filePaths(['a.jpg', 'b.png', 'c.mp4']), ['a.jpg', 'b.png', 'c.mp4']);
});
// A half-written array (an upload that failed mid-flight, a hand-edited row) must not
// produce a blank tile pointed at nothing.
t('empty entries inside an array are dropped', () => {
  assert.deepEqual(A.filePaths(['a.jpg', '', null, 'b.png', undefined]), ['a.jpg', 'b.png']);
});

// ---- fileValue: write the narrowest shape that fits --------------------------
t('one file is stored as a plain string, not an array of one', () => {
  const v = A.fileValue(['uuid_face.jpg']);
  assert.strictEqual(typeof v, 'string', 'a single file must stay a string or every existing reader changes meaning');
  assert.strictEqual(v, 'uuid_face.jpg');
});
t('several files are stored as an array', () => {
  assert.deepEqual(A.fileValue(['a.jpg', 'b.jpg']), ['a.jpg', 'b.jpg']);
});
t('no files stores nothing at all', () => {
  [[], null, undefined, ''].forEach(v => assert.strictEqual(A.fileValue(v), null, JSON.stringify(v)));
});
// The guarantee stated as one assertion: read a row, write it back, and it is the same row.
t('a round trip through both rules is a no-op on every shape', () => {
  ['uuid_face.jpg', 'legacy_key_no_ext'].forEach(v => {
    assert.strictEqual(A.fileValue(A.filePaths(v)), v, v + ' must survive a round trip unchanged');
  });
  assert.deepEqual(A.fileValue(A.filePaths(['a.jpg', 'b.jpg'])), ['a.jpg', 'b.jpg']);
  assert.strictEqual(A.fileValue(A.filePaths(null)), null);
});

// ---- which one of many is "the" file -----------------------------------------
t('the first file is the first of the list, or the lone string', () => {
  assert.strictEqual(A.firstPath(['a.jpg', 'b.jpg']), 'a.jpg');
  assert.strictEqual(A.firstPath('only.jpg'), 'only.jpg');
  assert.strictEqual(A.firstPath(null), null);
});
// A card cover has to be something a browser can paint. With one answer there was no choice
// to make; with five there is, and a play glyph over a record that DOES hold a photo is a
// cover that reads as "no picture here" when there is one.
t('a cover prefers the first image over a video or a document', () => {
  assert.strictEqual(A.coverPath(['clip.mp4', 'face.jpg']), 'face.jpg');
  assert.strictEqual(A.coverPath(['cv.pdf', 'shelf.png']), 'shelf.png');
});
t('a cover with no image falls back to the first file rather than nothing', () => {
  assert.strictEqual(A.coverPath(['clip.mp4', 'other.mov']), 'clip.mp4');
  assert.strictEqual(A.coverPath('clip.mp4'), 'clip.mp4');
  assert.strictEqual(A.coverPath([]), null);
});

// ---- every file on a record, for deleting it ---------------------------------
// A record deleted without this orphans its uploads in R2 forever — invisible, because a
// row that is gone cannot tell you what it was pointing at.
const R_PHOTO = { id: 'p1', label: 'Shelf photo', type: 'photo' };
const R_MEDIA = { id: 'm1', label: 'Machine video', type: 'media' };
const R_TEXT = { id: 't1', label: 'Notes', type: 'long_text' };

t('every file of every upload question is collected, arrays flattened', () => {
  const got = A.recordFilePaths([R_PHOTO, R_MEDIA, R_TEXT],
    { p1: ['a.jpg', 'b.jpg', 'c.jpg'], m1: 'clip.mp4', t1: 'some notes' });
  assert.deepEqual(got, ['a.jpg', 'b.jpg', 'c.jpg', 'clip.mp4']);
});
t('an answer to an ordinary question is never mistaken for a file', () => {
  assert.deepEqual(A.recordFilePaths([R_TEXT], { t1: 'uuid_looks_like.jpg' }), []);
});
t('a record with no uploads has nothing to delete', () => {
  assert.deepEqual(A.recordFilePaths([R_PHOTO, R_MEDIA], {}), []);
  assert.deepEqual(A.recordFilePaths(null, null), []);
});

// ---- the record gallery ------------------------------------------------------
const G_PHOTO = { id: 'g1', label: 'Shelf photo', type: 'photo' };
const G_MEDIA = { id: 'g2', label: 'Machine', type: 'media' };
const G_FILE = { id: 'g3', label: 'CV', type: 'file' };

t('three photos on one question are three tiles, not one', () => {
  const h = A.photoSectionHtml([G_PHOTO], { g1: ['a.jpg', 'b.jpg', 'c.jpg'] });
  assert.strictEqual((h.match(/imp-thumb/g) || []).length, 3, 'every photo needs its own tile');
  ['a.jpg', 'b.jpg', 'c.jpg'].forEach(p => assert.ok(h.includes('data-path="' + p + '"'), p + ' is missing'));
});
// The heading is the number a reviewer trusts to know whether they have seen everything.
t('the heading counts files, not questions', () => {
  assert.ok(/Photos \(3\)/.test(A.photoSectionHtml([G_PHOTO], { g1: ['a.jpg', 'b.jpg', 'c.jpg'] })));
  assert.ok(/Videos \(2\)/.test(A.photoSectionHtml([G_MEDIA], { g2: ['a.mp4', 'b.mp4'] })));
  assert.ok(/Files \(2\)/.test(A.photoSectionHtml([G_FILE], { g3: ['a.pdf', 'b.docx'] })));
  assert.ok(/Photos and videos \(3\)/.test(A.photoSectionHtml([G_PHOTO, G_MEDIA], { g1: ['a.jpg', 'b.jpg'], g2: 'c.mp4' })));
  assert.ok(/Attachments \(3\)/.test(A.photoSectionHtml([G_PHOTO, G_FILE], { g1: ['a.jpg', 'b.jpg'], g3: 'c.pdf' })));
});
// Five tiles all captioned "Shelf photo" tell a reviewer nothing about which is which.
t('a question holding several files numbers them in the label', () => {
  const h = A.photoSectionHtml([G_PHOTO], { g1: ['a.jpg', 'b.jpg', 'c.jpg'] });
  assert.ok(/Shelf photo \(1\/3\)/.test(h), 'the first of three should say so');
  assert.ok(/Shelf photo \(3\/3\)/.test(h), 'and the last');
});
t('a question holding one file is labelled exactly as it always was', () => {
  const h = A.photoSectionHtml([G_PHOTO], { g1: 'a.jpg' });
  assert.ok(/>Shelf photo</.test(h), 'a lone photo keeps a bare label');
  assert.ok(!/1\/1/.test(h), 'and gains no counter');
});
// The regression guard: an old single-key answer must render byte-for-byte as before.
t('a single-key answer renders identically to an array of one', () => {
  assert.strictEqual(
    A.photoSectionHtml([G_PHOTO], { g1: 'a.jpg' }),
    A.photoSectionHtml([G_PHOTO], { g1: ['a.jpg'] }),
    'the two shapes must be indistinguishable on screen');
});

// ---- the header photo is skipped ONCE, not per question ----------------------
// The editable panel carries one image as a header with its own Change button. It shows the
// FIRST image of the first question that has one — so exactly that one file is skipped here.
// Skipping the whole question would hide the other four photos from the only people who can
// review them, which is the bug the gallery was added to fix in the first place.
t('only the header photo itself is skipped, the rest of its question still show', () => {
  const h = A.photoSectionHtml([G_PHOTO], { g1: ['a.jpg', 'b.jpg', 'c.jpg'] }, 'g1');
  assert.ok(!h.includes('data-path="a.jpg"'), 'the header photo must not be shown twice');
  assert.ok(h.includes('data-path="b.jpg"') && h.includes('data-path="c.jpg"'), 'the others must still be reviewable');
  assert.ok(/Photos \(2\)/.test(h), 'and the heading counts what is actually shown');
});
t('a question holding one image named as the header still renders nothing', () => {
  assert.strictEqual(A.photoSectionHtml([G_PHOTO], { g1: 'a.jpg' }, 'g1'), '',
    'the single-photo case must behave exactly as it did before');
});
// A video is never the header, so a video first in the list must not be swallowed by the skip.
t('the skip takes an image, never the first file blindly', () => {
  const h = A.photoSectionHtml([G_MEDIA], { g2: ['clip.mp4', 'face.jpg'] }, 'g2');
  assert.ok(h.includes('data-vpath="clip.mp4"'), 'the video is not the header and must stay playable');
  assert.ok(!h.includes('data-path="face.jpg"'), 'the image IS the header and must not repeat');
});

// ---- editing: add and remove ------------------------------------------------
// Without these a reviewer can see five photos and change only one of them, which is the
// half-feature the single "Change photo" button already was.
t('the gallery is read-only unless editing is asked for', () => {
  const h = A.photoSectionHtml([G_PHOTO], { g1: ['a.jpg', 'b.jpg'] });
  assert.ok(!/pc-del/.test(h) && !/pc-add/.test(h), 'a reviewer must not be offered a remove button');
});
t('editing puts a remove button on every file', () => {
  const h = A.photoSectionHtml([G_PHOTO], { g1: ['a.jpg', 'b.jpg'] }, null, { edit: true });
  assert.strictEqual((h.match(/pc-del/g) || []).length, 2, 'each file needs its own remove');
  assert.ok(/data-del-field="g1"/.test(h) && /data-del-path="a\.jpg"/.test(h),
    'remove must name both the question and the exact file, or it deletes the wrong one');
});
t('editing offers an add tile per upload question', () => {
  const h = A.photoSectionHtml([G_PHOTO, G_MEDIA], { g1: 'a.jpg', g2: 'b.mp4' }, null, { edit: true });
  assert.ok(/data-add-field="g1"/.test(h) && /data-add-field="g2"/.test(h),
    'every upload question must be addable to, not just the ones with files');
});
// A record whose photo question is empty had nowhere to attach one: the header only appeared
// when a photo already existed, so the answer could never be filled in after the fact.
t('editing a record with no files at all still offers somewhere to add them', () => {
  const h = A.photoSectionHtml([G_PHOTO], {}, null, { edit: true });
  assert.ok(h !== '' && /data-add-field="g1"/.test(h), 'an empty upload question must be fillable');
});
t('a record with no files and no editing renders nothing, as before', () => {
  assert.strictEqual(A.photoSectionHtml([G_PHOTO, G_MEDIA], {}), '');
});
// The label is typed by an admin and goes straight into markup.
t('the question label is escaped in every tile and in the add button', () => {
  const bad = { id: 'g9', label: '<img src=x onerror=alert(1)>', type: 'photo' };
  const h = A.photoSectionHtml([bad], { g9: ['a.jpg', 'b.jpg'] }, null, { edit: true });
  assert.ok(!/<img src=x/.test(h) && /&lt;img/.test(h));
});

// ---- the grid cell and the CSV ----------------------------------------------
t('a cell text lists every filename, not just the first', () => {
  // Real stored keys: "<uuid>_<original filename>". The uuid is ours, not theirs, and
  // fileLabel strips it — so an export column reads as the names the person recognises.
  const txt = A.customCellText(R_PHOTO, {
    p1: ['11111111-2222-3333-4444-555555555555_one.jpg',
         '66666666-7777-8888-9999-aaaaaaaaaaaa_two.jpg']
  });
  assert.ok(/one\.jpg/.test(txt) && /two\.jpg/.test(txt), 'an export that names one of five photos is wrong');
  assert.ok(!/1111/.test(txt), 'the uuid must not reach the export');
});
t('a cell text for one file is unchanged', () => {
  assert.strictEqual(A.customCellText(R_PHOTO, { p1: 'abc_face.jpg' }),
                     A.customCellText(R_PHOTO, { p1: ['abc_face.jpg'] }));
});
t('an upload question with no answer still reads as empty', () => {
  assert.strictEqual(A.customCellText(R_PHOTO, { p1: [] }), '—');
  assert.strictEqual(A.customCellText(R_PHOTO, {}), '—');
});

// ---- uploaded paths going back onto their questions -------------------------
// This is the step where nine of ten photos used to be lost: they upload fine, and then the
// old `data[r.id] = r.path` keeps whichever one finished last. Both pages have to do it, so
// both are asked the same questions here.
[['the review app', A], ['the public form', P]].forEach(([who, M]) => {
  t(who + ' groups several files of one question into an array, in order', () => {
    const out = M.groupUploads([
      { id: 'q1', path: 'k1.jpg' }, { id: 'q1', path: 'k2.jpg' }, { id: 'q1', path: 'k3.jpg' }
    ]);
    assert.deepEqual(out.q1, ['k1.jpg', 'k2.jpg', 'k3.jpg'],
      'order matters: it is the order the person chose them in');
  });
  t(who + ' stores one file of one question as a plain string', () => {
    const out = M.groupUploads([{ id: 'q1', path: 'only.jpg' }]);
    assert.strictEqual(out.q1, 'only.jpg', 'a single upload must be stored the way it always was');
  });
  t(who + ' keeps two questions apart', () => {
    const out = M.groupUploads([
      { id: 'q1', path: 'a.jpg' }, { id: 'q2', path: 'b.mp4' }, { id: 'q1', path: 'c.jpg' }
    ]);
    assert.deepEqual(out.q1, ['a.jpg', 'c.jpg']);
    assert.strictEqual(out.q2, 'b.mp4');
  });
  t(who + ' produces no answer when nothing was uploaded', () => {
    assert.deepEqual(Object.keys(M.groupUploads([])), []);
    assert.deepEqual(Object.keys(M.groupUploads(null)), []);
  });
  // uploadAll leaves a hole in its results array if an item was skipped; a hole must not
  // become an answer of `undefined`, which is a key the form did not answer.
  t(who + ' ignores a gap in the results rather than answering with nothing', () => {
    const out = M.groupUploads([{ id: 'q1', path: 'a.jpg' }, undefined, null]);
    assert.strictEqual(out.q1, 'a.jpg');
    assert.strictEqual(Object.keys(out).length, 1);
  });
});
t('both pages send their uploads through the same grouping, not a second copy of it', () => {
  assert.ok(/var ups = groupUploads\(results\);/.test(PUB_SRC), 'the public form must group its uploads');
  assert.ok(/var photos = groupUploads\(ups\);/.test(APP_SRC), 'the New record panel must group its uploads');
});

// ---- the ceiling on how many ------------------------------------------------
// Per-file size is already capped; the count needs its own limit because the r2 function is
// rate limited per IP (a whole shop is one IP) and forty photos from one form is how that
// limit is reached by accident.
t('there is a cap on how many files one question takes, and both pages agree on it', () => {
  assert.ok(A.MAX_FILES > 1, 'a cap of one is not a cap, it is the old behaviour');
  assert.strictEqual(A.MAX_FILES, P.MAX_FILES,
    'the public form and the app must refuse at the same count or one of them lies');
});

// ---- the widgets (asserted by source: they touch the DOM) -------------------
t('the public form file input takes more than one file', () => {
  assert.ok(/fin\.multiple = true/.test(PUB_SRC),
    'the public form upload input must accept multiple files');
});
t('the public form reads every chosen file, not files[0]', () => {
  assert.ok(!/return fin\.files\[0\] \|\| null;/.test(PUB_SRC),
    'files[0] is the single-file assumption this change exists to remove');
});
t('the in-record editor file input takes more than one file', () => {
  assert.ok(/<input type="file" multiple/.test(APP_SRC),
    'the record and New-record editors must accept multiple files');
});
t('the New record panel reads every chosen file', () => {
  assert.ok(!/\(el && el\.files && el\.files\[0\]\) \|\| null/.test(APP_SRC),
    'the create panel must not take only the first file');
});
t('the grid cell says how many more files there are', () => {
  assert.ok(/class="cellmore"/.test(APP_SRC), 'a cell showing 1 of 5 photos must say so');
  assert.ok(/span\.cellmore\s*\{/.test(APP_SRC), 'cellmore has no stylesheet rule');
});
// One photo attached to two questions is uploaded once and both answers hold the same key
// (uploadAll remembers per File object). Removing it from one question must not delete the
// object out from under the other, which would leave a tile nobody can fix.
t('a file still answering another question is not deleted from the bucket', () => {
  assert.ok(/var stillUsed = recordFilePaths\(fields, s\.data\)\.indexOf\(p\) !== -1;/.test(APP_SRC),
    'the remove must check whether any other answer still points at the key');
  assert.ok(/return stillUsed \? null : storageDelete\(p\);/.test(APP_SRC),
    'and skip the bucket delete when one does');
});
t('the remove and add tiles are styled', () => {
  assert.ok(/\.pc-del\s*\{/.test(APP_SRC), 'pc-del has no stylesheet rule');
  assert.ok(/\.pc-add\s*\{/.test(APP_SRC), 'pc-add has no stylesheet rule');
});
// Both delete paths must sweep the whole record, and there is now one function that knows how.
t('both delete paths collect files through the one rule', () => {
  assert.strictEqual((APP_SRC.match(/recordFilePaths\(/g) || []).length >= 3, true,
    'the single delete, the selection delete and the definition should be the only users');
  assert.ok(!/\.map\(function \(f\) \{ return s\.data \? s\.data\[f\.id\] : null; \}\)/.test(APP_SRC),
    'the old first-path-only collector must be gone');
});

console.log(n + ' tests defined');
