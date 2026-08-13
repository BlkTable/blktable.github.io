// The "media" field type: a question that takes a photo OR a video.
//
// What makes this type worth its own test file is that the stored answer is a bare R2 object
// key with no MIME type beside it. Everything downstream — the card cover, the grid cell, the
// record gallery, the lightbox — has to decide "image or video?" from that string alone. Get
// it wrong in the safe direction and a reviewer sees an empty grey box; get it wrong in the
// other and an <img> is handed a 40 MB video and shows a broken-image icon.
//
// The rules also live in TWO files (index.html and f/index.html), the way condMet does, so the
// last tests here read both and assert they still agree.

const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(path) {
  const src = fs.readFileSync(path, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
const APP = scripts('index.html');
const PUB = scripts('f/index.html');
const APP_SRC = fs.readFileSync('index.html', 'utf8');
const PUB_SRC = fs.readFileSync('f/index.html', 'utf8');

// Brace-matched, so a one-line function is taken whole instead of running on to the next
// "\n  }" and dragging whatever sits between them into the sandbox.
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
// Ends at the first ";" that closes a line, so a value written across several lines
// (PLAY_SVG) is taken whole rather than truncated at its first line break.
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

const A = load(APP,
  ['VIDEO_EXT', 'VIDEO_PLAYABLE', 'PLAY_SVG', 'PHOTO_MAX_BYTES', 'MEDIA_MAX_BYTES'],
  ['esc', 'isFileField', 'isFileType', 'isVideoPath', 'isPlayableVideo', 'fileLabel',
   'coverHtml', 'uploadCap', 'mbText', 'photoSectionHtml', 'ageText', 'otherKeyFor',
   'isChoiceField', 'isOtherChoice', 'customCellText']);

const P = load(PUB, ['MAX_BYTES', 'MEDIA_MAX_BYTES'], ['isVideoFile', 'mbText', 'sizeText']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- which questions hold an uploaded file -------------------------------
// Every skip-site in the app hangs off this: the record editor, autosave, the new-record
// payload, the filter list, sorting, the CSV summary. If a media field is not recognised
// here, its object key is written back as if it were a typed answer.
t('photo and media are both upload questions', () => {
  assert.ok(A.isFileField({ type: 'photo' }));
  assert.ok(A.isFileField({ type: 'media' }));
  assert.ok(A.isFileType('photo') && A.isFileType('media'));
});
t('an ordinary question is not an upload question', () => {
  ['short_text', 'long_text', 'number', 'dropdown', 'dob', 'link', 'yesno'].forEach(ty => {
    assert.ok(!A.isFileField({ type: ty }), ty + ' must not be treated as an upload');
  });
});
t('a missing field is not an upload question', () => {
  assert.ok(!A.isFileField(null));
  assert.ok(!A.isFileField(undefined));
  assert.ok(!A.isFileField({}));
});

// ---- image or video, decided from the key alone ---------------------------
t('the common phone and camera video formats read as video', () => {
  ['a.mp4', 'a.mov', 'a.m4v', 'a.webm', 'a.3gp', 'a.avi', 'a.mkv', 'a.mts'].forEach(p => {
    assert.ok(A.isVideoPath('uuid_' + p), p + ' should read as a video');
  });
});
t('an image never reads as video', () => {
  ['a.jpg', 'a.jpeg', 'a.png', 'a.heic', 'a.webp', 'a.gif'].forEach(p => {
    assert.ok(!A.isVideoPath('uuid_' + p), p + ' must not read as a video');
  });
});
// Every answer written before this type existed is a photo, and many of those keys came out
// of the importer. Anything unrecognised must fall to "image", which is what they are.
t('a key with no extension reads as an image, not a video', () => {
  assert.ok(!A.isVideoPath('9d3f2a1b-0000-0000-0000-000000000000_web.whatsapp.com'));
  assert.ok(!A.isVideoPath('avatars/somebody'));
  assert.ok(!A.isVideoPath(''));
  assert.ok(!A.isVideoPath(null));
});
t('the extension is matched however it was typed', () => {
  assert.ok(A.isVideoPath('uuid_IMG_4021.MP4'));
  assert.ok(A.isVideoPath('uuid_clip.MoV'));
});
// "holiday.mp4.jpg" is a JPEG. Matching the substring rather than the end of the name would
// send a real photo down the video path and show a play button over an image nobody can see.
t('only the last extension counts', () => {
  assert.ok(!A.isVideoPath('uuid_holiday.mp4.jpg'));
  assert.ok(!A.isVideoPath('uuid_mp4_receipts.png'));
  assert.ok(A.isVideoPath('uuid_holiday.jpg.mp4'));
});
// .avi and .mkv upload fine and are somebody's real answer, but a <video> pointed at one
// shows a black rectangle with no explanation. They are offered as a download instead.
t('playable is narrower than video', () => {
  ['a.mp4', 'a.mov', 'a.webm', 'a.m4v'].forEach(p => assert.ok(A.isPlayableVideo('u_' + p), p));
  ['a.avi', 'a.mkv', 'a.wmv', 'a.flv', 'a.mpg'].forEach(p => {
    assert.ok(A.isVideoPath('u_' + p), p + ' is still a video');
    assert.ok(!A.isPlayableVideo('u_' + p), p + ' must not be handed to a <video> player');
  });
});

// ---- what a person is shown the file is called ---------------------------
t('the uuid the app minted is not part of the name', () => {
  assert.strictEqual(A.fileLabel('3f2504e0-4f89-41d3-9a0c-0305e82c3301_IMG_4021.mp4'), 'IMG_4021.mp4');
});
t('a name with no uuid in front of it is kept whole', () => {
  assert.strictEqual(A.fileLabel('machine-clean.mp4'), 'machine-clean.mp4');
});
t('a foldered key reads as its file, not its folder', () => {
  assert.strictEqual(A.fileLabel('avatars/3f2504e0-4f89-41d3-9a0c-0305e82c3301_face.jpg'), 'face.jpg');
});

// ---- the card cover ------------------------------------------------------
// A video has no thumbnail: the sweeper builds them from images. Painting one as a CSS
// background produces nothing at all, so a video cover has to be marked, not painted.
t('a video cover is marked so nothing tries to paint a thumbnail on it', () => {
  const h = A.coverHtml('u_clip.mp4');
  assert.ok(/is-video/.test(h), 'a video cover must carry is-video');
  assert.ok(/<svg/.test(h), 'and must show something rather than sit empty');
});
t('an image cover is exactly what it always was', () => {
  assert.strictEqual(A.coverHtml('u_face.jpg'), '<div class="photo"></div>');
});
t('the is-video class the cover uses has a rule in the stylesheet', () => {
  assert.ok(/\.ja-card \.photo\.is-video\s*\{/.test(APP_SRC),
    'is-video is set on the cover but styled nowhere — the mark would be invisible');
});

// ---- the record gallery --------------------------------------------------
const F_PHOTO = { id: 'f1', label: 'Shelf photo', type: 'photo' };
const F_VID = { id: 'f2', label: 'Machine video', type: 'media' };
const F_TEXT = { id: 'f3', label: 'Notes', type: 'long_text' };

t('an unanswered upload question is not in the gallery', () => {
  assert.strictEqual(A.photoSectionHtml([F_PHOTO, F_VID], {}), '');
});
t('a video is a player, never an <img> pointed at a video', () => {
  const h = A.photoSectionHtml([F_VID], { f2: 'u_clip.mp4' });
  assert.ok(/pc-video/.test(h), 'a playable video needs the play control');
  assert.ok(!/<img/.test(h), 'an <img> with a video src is a broken-image icon');
  assert.ok(/data-vpath="u_clip\.mp4"/.test(h), 'and the path has to reach the wiring');
});
t('a photo is still the thumbnail it always was', () => {
  const h = A.photoSectionHtml([F_PHOTO], { f1: 'u_face.jpg' });
  assert.ok(/imp-thumb/.test(h) && /data-path="u_face\.jpg"/.test(h));
  assert.ok(!/pc-video/.test(h));
});
t('a format no browser plays is offered as a download, not as a player', () => {
  const h = A.photoSectionHtml([F_VID], { f2: 'u_clip.avi' });
  assert.ok(/pc-file/.test(h), 'an unplayable video must be a link');
  assert.ok(!/pc-video/.test(h), 'and must not be handed to the player');
  assert.ok(/clip\.avi/.test(h), 'and should say what it is');
});
// "Photos (3)" over two videos reads as a video that failed to save.
t('the heading counts what is actually there', () => {
  assert.ok(/Photos \(1\)/.test(A.photoSectionHtml([F_PHOTO], { f1: 'a.jpg' })));
  assert.ok(/Video \(1\)/.test(A.photoSectionHtml([F_VID], { f2: 'a.mp4' })));
  assert.ok(/Videos \(2\)/.test(A.photoSectionHtml(
    [F_VID, { id: 'f4', label: 'Second', type: 'media' }], { f2: 'a.mp4', f4: 'b.mov' })));
  assert.ok(/Photos and videos \(2\)/.test(A.photoSectionHtml([F_PHOTO, F_VID], { f1: 'a.jpg', f2: 'b.mp4' })));
});
t('a question that is not an upload never reaches the gallery', () => {
  assert.strictEqual(A.photoSectionHtml([F_TEXT], { f3: 'some notes' }), '');
});
// The editable record panel carries the first IMAGE as a header with its own Change button,
// and passes that field's id here so the same photo is not shown twice.
t('the question already shown as the panel header is not repeated', () => {
  const h = A.photoSectionHtml([F_PHOTO, F_VID], { f1: 'a.jpg', f2: 'b.mp4' }, 'f1');
  assert.ok(!/imp-thumb/.test(h), 'the header photo must not appear a second time');
  assert.ok(/pc-video/.test(h), 'but everything else still must');
  assert.ok(/Video \(1\)/.test(h), 'and the count follows what is actually listed');
});
// This is the bug that shipped: the editable panel never called this at all, so an admin —
// the person who reviews these — could not see a video, because a video is never the header.
// Skipping must be by id and must never swallow a video.
t('a video is never skipped, whatever id is passed', () => {
  const h = A.photoSectionHtml([F_VID], { f2: 'b.mp4' }, 'f2');
  assert.ok(/pc-video/.test(h), 'a video must survive even if named as the header');
});
t('the editable record panel renders the gallery', () => {
  assert.ok(/scoredBlock \+ photoSectionHtml\(fields, d, photoPath \? photoFieldId : null\)/.test(APP_SRC),
    'without this an editor cannot see an upload at all — the header only shows an image');
});
// The label is typed by an admin and goes into markup.
t('the question label is escaped', () => {
  const h = A.photoSectionHtml([{ id: 'f5', label: '<img src=x onerror=alert(1)>', type: 'media' }], { f5: 'a.mp4' });
  assert.ok(!/<img src=x/.test(h), 'the label must not become markup');
  assert.ok(/&lt;img/.test(h));
});

// ---- the size ceilings ---------------------------------------------------
t('a media question allows more than a photo question', () => {
  assert.ok(A.uploadCap({ type: 'media' }) > A.uploadCap({ type: 'photo' }));
});
// A field type that is not media must never inherit the video ceiling by accident: the
// photo cap is what protects the 226 tables that already exist.
t('anything that is not media gets the photo ceiling', () => {
  [{ type: 'photo' }, { type: 'short_text' }, {}, null].forEach(f => {
    assert.strictEqual(A.uploadCap(f), 10 * 1024 * 1024);
  });
});
t('the ceilings read as whole megabytes', () => {
  assert.strictEqual(A.mbText(10 * 1024 * 1024), '10 MB');
  assert.strictEqual(A.mbText(50 * 1024 * 1024), '50 MB');
});

// ---- the CSV / cell text -------------------------------------------------
// A column of "3f2504e0-…-3301_IMG_4021.mp4" tells a reader nothing; the uuid is ours.
t('an upload exports as its filename, not as the object key', () => {
  assert.strictEqual(
    A.customCellText(F_VID, { f2: '3f2504e0-4f89-41d3-9a0c-0305e82c3301_IMG_4021.mp4' }),
    'IMG_4021.mp4');
});
t('an unanswered upload still exports as a dash', () => {
  assert.strictEqual(A.customCellText(F_VID, {}), '—');
});

// ---- the public form's own copy ------------------------------------------
t('a chosen file is judged by its MIME type, which is what the browser knows', () => {
  assert.ok(P.isVideoFile({ type: 'video/mp4' }));
  assert.ok(P.isVideoFile({ type: 'video/quicktime' }));
  assert.ok(!P.isVideoFile({ type: 'image/jpeg' }));
  assert.ok(!P.isVideoFile(null));
});
t('a size reads the way a person would say it', () => {
  assert.strictEqual(P.sizeText(500 * 1024), '500 KB');
  assert.strictEqual(P.sizeText(1.5 * 1048576), '1.5 MB');
  assert.strictEqual(P.sizeText(42 * 1048576), '42 MB');
  assert.strictEqual(P.sizeText(0), '0 KB');
});
// A 700-byte file reading "0 KB" looks like nothing was chosen at all.
t('a tiny file never reads as nothing', () => {
  assert.strictEqual(P.sizeText(700), '1 KB');
});

// ---- the two copies must not drift ---------------------------------------
// The ceiling is written in both pages, the way condMet is. If one is raised and the other
// is not, the dashboard and the public form disagree about what a person may upload.
t('both pages use the same media ceiling', () => {
  assert.strictEqual(P.mbText(50 * 1024 * 1024), A.mbText(50 * 1024 * 1024));
  assert.ok(/var MEDIA_MAX_BYTES = 50 \* 1024 \* 1024;/.test(APP_SRC), 'index.html');
  assert.ok(/var MEDIA_MAX_BYTES = 50 \* 1024 \* 1024;/.test(PUB_SRC), 'f/index.html');
});
t('both pages ask for the same file types on a media question', () => {
  assert.ok(/accept = isMedia \? "image\/\*,video\/\*" : "image\/\*"/.test(PUB_SRC),
    'the public form must offer video on a media question');
  assert.ok(/f\.type === "media" \? "image\/\*,video\/\*" : "image\/\*"/.test(APP_SRC),
    'and so must the record editor');
});
// The page can be deployed before the r2 function is updated. When that happens the upload
// comes back "images_only", and the person has to be told something they can act on rather
// than "try again" on something that will never work.
t('both pages name the two errors the file server can return', () => {
  assert.ok(/images_only/.test(PUB_SRC) && /too_large/.test(PUB_SRC), 'f/index.html');
  assert.ok(/images_only/.test(APP_SRC) && /too_large/.test(APP_SRC), 'index.html');
});
// The type has to be offered in the builder or nobody can create one.
t('the builder offers the type', () => {
  assert.ok(/\{ v: "media", label: "Photo or video" \}/.test(APP_SRC));
});
t('the type has its own glyph in the grid header', () => {
  assert.ok(/\n    media: '/.test(APP_SRC), 'a type with no FICONS entry silently gets the text icon');
});

console.log(n + ' media-field tests passed');
