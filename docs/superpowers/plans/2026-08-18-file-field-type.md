# File field type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `file` form-field type that collects an uploaded file of any type, alongside the existing `photo` (images) and `media` (images + video) types.

**Architecture:** `file` is the widest member of the existing `isFileField` family — same `storageUpload()` → `r2` edge function → R2 object-key answer, no new storage shape. The admin app (`index.html`) exposes it in the builder and, crucially, learns to render a stored document answer as a download link instead of a broken `<img>`. The public form (`f/index.html`) grows a third case in its one upload branch. The `r2` edge-function MIME widening is out of scope here (handed to Ali/Baker) — the frontend ships first and the type is inert for documents until that lands.

**Tech Stack:** Plain ES5-style JS embedded in two `index.html` files. No build step. Tests are standalone Node scripts under `docs/tests/` that pull functions out of the page source by name with `vm`.

**Spec:** `docs/superpowers/specs/2026-08-18-file-field-type-design.md`

**How to run the tests (macOS, Node is at `/opt/homebrew/bin/node`, on PATH):**
```bash
cd ~/Documents/blktable
node docs/tests/file-field.test.js
```
A pass prints nothing and exits 0. A failure prints `FAIL: <name> -> <reason>` and sets a non-zero exit code. Before a function exists, `load()` throws `could not find function <name>` and the whole script errors — that is the "red" state for TDD here.

**File structure:**
- Modify `index.html` — builder list, upload predicates, `isImagePath`/`FILE_SVG` helpers, record-gallery + grid-cell + card-cover rendering, in-record editor accept, CSS.
- Modify `f/index.html` — third case in the upload branch of `buildField`.
- Create `docs/tests/file-field.test.js` — mirrors `docs/tests/media-field.test.js`.

**Key decisions (from the spec):**
- `file` reuses the 50 MB `MEDIA_MAX_BYTES` ceiling — no new size constant in either file.
- Record-gallery heading: documents-only → `Files (n)`; documents mixed with photos/videos → `Attachments (n)`; photo/video-only wording is unchanged.
- A stored key is classified from its string alone (no MIME beside it). Image extension, or a filename with no extension at all (legacy/importer keys), reads as an image; any other extension reads as a file to download.

---

## Task 1: Recognise `file` as an upload field

**Files:**
- Modify: `index.html` — `FIELD_TYPES` (~line 3822), `isFileField`/`isFileType` (~lines 3931-3932), `uploadCap` (~line 3964)
- Test: `docs/tests/file-field.test.js`

- [ ] **Step 1: Create the test file with the recognition tests**

Create `docs/tests/file-field.test.js`:

```javascript
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
```

- [ ] **Step 2: Run it and watch the assertions fail**

Run: `node docs/tests/file-field.test.js`
Expected: the file loads (all names in `load()` already exist), then prints:
`FAIL: photo, media and file are all upload questions -> file must be an upload question`
`FAIL: a file question gets the same 50 MB ceiling as media -> ...`
`FAIL: the field-type picker offers File -> File must be a choice in FIELD_TYPES ...`
and exits non-zero. Those are the three behaviours Task 1 adds.

- [ ] **Step 3: Add `file` to `FIELD_TYPES`**

In `index.html`, find (~line 3822):

```javascript
    { v: "dropdown", label: "Dropdown" }, { v: "multi_select", label: "Multi-select" }, { v: "phone", label: "Phone" }, { v: "photo", label: "Photo" }, { v: "media", label: "Photo or video" }, { v: "email", label: "Email" }
```

Replace the `media`/`email` tail so it reads:

```javascript
    { v: "dropdown", label: "Dropdown" }, { v: "multi_select", label: "Multi-select" }, { v: "phone", label: "Phone" }, { v: "photo", label: "Photo" }, { v: "media", label: "Photo or video" }, { v: "file", label: "File" }, { v: "email", label: "Email" }
```

- [ ] **Step 4: Add `file` to the upload predicates**

In `index.html`, replace (~lines 3931-3932):

```javascript
  function isFileField(f) { return !!f && (f.type === "photo" || f.type === "media"); }
  function isFileType(t) { return t === "photo" || t === "media"; }
```

with:

```javascript
  function isFileField(f) { return !!f && (f.type === "photo" || f.type === "media" || f.type === "file"); }
  function isFileType(t) { return t === "photo" || t === "media" || t === "file"; }
```

- [ ] **Step 5: Give `file` the 50 MB ceiling**

In `index.html`, replace (~line 3964):

```javascript
  function uploadCap(f) { return f && f.type === "media" ? MEDIA_MAX_BYTES : PHOTO_MAX_BYTES; }
```

with:

```javascript
  function uploadCap(f) { return f && (f.type === "media" || f.type === "file") ? MEDIA_MAX_BYTES : PHOTO_MAX_BYTES; }
```

- [ ] **Step 6: Commit (implementation lands green after Task 4 — see Step 2)**

```bash
git add index.html docs/tests/file-field.test.js
git commit -m "feat: recognise file as an upload field type (builder, predicates, cap)"
```

---

## Task 2: Classify a stored key — image vs file

**Files:**
- Modify: `index.html` — add `IMAGE_EXT` + `isImagePath` and `FILE_SVG` near the existing `VIDEO_EXT`/`PLAY_SVG` block (~lines 3944-3951)
- Test: `docs/tests/file-field.test.js`

- [ ] **Step 1: Extend the load lists, then add the classification tests**

First, in `docs/tests/file-field.test.js`, replace the `load(APP, ...)` call with the wider lists this task needs:

```javascript
const A = load(APP,
  ['PHOTO_MAX_BYTES', 'MEDIA_MAX_BYTES', 'VIDEO_EXT', 'VIDEO_PLAYABLE', 'IMAGE_EXT', 'PLAY_SVG', 'FILE_SVG'],
  ['isFileField', 'isFileType', 'uploadCap', 'isVideoPath', 'isPlayableVideo', 'isImagePath', 'fileLabel']);
```

Then append, before the final `console.log`:

```javascript
// ---- image or file, decided from the key alone ---------------------------
t('an image extension reads as an image', () => {
  ['a.jpg', 'a.jpeg', 'a.png', 'a.gif', 'a.webp', 'a.heic', 'a.bmp', 'a.svg', 'a.tiff', 'a.avif'].forEach(p => {
    assert.ok(A.isImagePath('uuid_' + p), p + ' should read as an image');
  });
});
// Every answer written before this type existed is a photo, and importer keys often carry no
// filename extension at all. Those must stay images, exactly as they render today.
t('a key with no filename extension reads as an image', () => {
  assert.ok(A.isImagePath('9d3f2a1b-0000-0000-0000-000000000000_web'));
  assert.ok(A.isImagePath('avatars/somebody'));
});
t('a document extension does not read as an image', () => {
  ['a.pdf', 'a.docx', 'a.xlsx', 'a.csv', 'a.txt', 'a.zip', 'a.pptx', 'a.pages'].forEach(p => {
    assert.ok(!A.isImagePath('uuid_' + p), p + ' should read as a file, not an image');
  });
});
t('a video is never an image', () => {
  ['a.mp4', 'a.mov', 'a.avi', 'a.mkv'].forEach(p => assert.ok(!A.isImagePath('uuid_' + p), p));
});
// "report.pdf.jpg" is a JPEG; only the last extension counts, same rule as isVideoPath.
t('only the last extension counts', () => {
  assert.ok(A.isImagePath('uuid_report.pdf.jpg'));
  assert.ok(!A.isImagePath('uuid_holiday.jpg.pdf'));
});
t('there is a distinct file glyph to mark a document', () => {
  assert.ok(/<svg/.test(A.FILE_SVG), 'FILE_SVG must render something');
  assert.notStrictEqual(A.FILE_SVG, A.PLAY_SVG, 'a file must not be marked with the play glyph');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node docs/tests/file-field.test.js`
Expected: throws `could not find var IMAGE_EXT` — the widened `load()` list names `IMAGE_EXT`/`isImagePath`/`FILE_SVG`, which do not exist yet, so the file cannot load. That is this task's red state; Step 3 adds them and the file loads and runs.

- [ ] **Step 3: Add `IMAGE_EXT`, `isImagePath`, and `FILE_SVG`**

In `index.html`, find the `isPlayableVideo` line (~line 3944):

```javascript
  function isPlayableVideo(p) { return VIDEO_PLAYABLE.test(String(p || "")); }
```

Immediately after it, add:

```javascript
  // The stored key carries no MIME, so an answer is classed from its filename alone. An image
  // extension is an image; so is a key with no filename extension at all — every row written
  // before this type existed, and the importer keys, are photos. Any other extension (.pdf,
  // .docx, .zip) is a file to download, not a thumbnail. Checked after isVideoPath, so a video
  // never reaches here as an "image".
  var IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|svg|tiff?|avif|ico)(\?|#|$)/i;
  function isImagePath(p) {
    p = String(p || "");
    if (isVideoPath(p)) return false;
    if (IMAGE_EXT.test(p)) return true;
    var name = p.split(/[?#]/)[0].split("/").pop() || "";
    return name.indexOf(".") === -1;   // no extension we can name -> a legacy photo
  }
```

Then find the `PLAY_SVG` var (~line 3951) and immediately after its closing `;` add:

```javascript
  // A document has no thumbnail and is not a video; it is marked with a page glyph so a
  // grid cell or card cover reads as "there is a file here" rather than a failed image.
  var FILE_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">' +
    '<path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm7 1.5L18.5 9H13V3.5z"/></svg>';
```

- [ ] **Step 4: Run and watch it pass**

Run: `node docs/tests/file-field.test.js`
Expected: no `FAIL:` lines, prints `N tests defined`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.html docs/tests/file-field.test.js
git commit -m "feat: classify a stored key as image or file (isImagePath, FILE_SVG)"
```

---

## Task 3: Render a document answer in the record gallery

**Files:**
- Modify: `index.html` — `photoSectionHtml` heading (~lines 5003-5008) and per-answer render (~lines 5011-5023)
- Test: `docs/tests/file-field.test.js`

- [ ] **Step 1: Extend the load lists, then add the gallery tests**

First, widen the `load(APP, ...)` call — `photoSectionHtml` runs in the sandbox, so its own helper `esc` must be loaded alongside it:

```javascript
const A = load(APP,
  ['PHOTO_MAX_BYTES', 'MEDIA_MAX_BYTES', 'VIDEO_EXT', 'VIDEO_PLAYABLE', 'IMAGE_EXT', 'PLAY_SVG', 'FILE_SVG'],
  ['isFileField', 'isFileType', 'uploadCap', 'isVideoPath', 'isPlayableVideo', 'isImagePath', 'fileLabel', 'esc', 'photoSectionHtml']);
```

Then append, before the final `console.log`:

```javascript
// ---- the record gallery --------------------------------------------------
const G_PHOTO = { id: 'g1', label: 'Shelf photo', type: 'photo' };
const G_FILE = { id: 'g2', label: 'CV', type: 'file' };

t('a document answer is a download link, not a broken <img>', () => {
  const h = A.photoSectionHtml([G_FILE], { g2: 'uuid_cv.pdf' });
  assert.ok(/pc-file/.test(h), 'a document must be offered as a link');
  assert.ok(/imp-file/.test(h), 'and must carry imp-file so its href gets resolved');
  assert.ok(!/imp-thumb/.test(h) && !/<img/.test(h), 'never an <img> pointed at a PDF');
  assert.ok(/cv\.pdf/.test(h), 'and should say what it is');
});
t('a photo answer is still a thumbnail', () => {
  const h = A.photoSectionHtml([G_PHOTO], { g1: 'uuid_face.jpg' });
  assert.ok(/imp-thumb/.test(h) && /data-path="uuid_face\.jpg"/.test(h));
  assert.ok(!/pc-file/.test(h));
});
t('a documents-only gallery is headed Files', () => {
  assert.ok(/File \(1\)/.test(A.photoSectionHtml([G_FILE], { g2: 'a.pdf' })));
  assert.ok(/Files \(2\)/.test(A.photoSectionHtml(
    [G_FILE, { id: 'g3', label: 'Second', type: 'file' }], { g2: 'a.pdf', g3: 'b.docx' })));
});
t('documents mixed with photos are headed Attachments', () => {
  const h = A.photoSectionHtml([G_PHOTO, G_FILE], { g1: 'a.jpg', g2: 'b.pdf' });
  assert.ok(/Attachments \(2\)/.test(h), 'a mix must not claim to be all photos');
});
// The document label is admin-typed and goes into markup.
t('the document question label is escaped', () => {
  const h = A.photoSectionHtml([{ id: 'g9', label: '<img src=x onerror=alert(1)>', type: 'file' }], { g9: 'a.pdf' });
  assert.ok(!/<img src=x/.test(h) && /&lt;img/.test(h));
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node docs/tests/file-field.test.js`
Expected: `FAIL: a document answer is a download link ...` — today a non-video path renders as `<img>`, so a `.pdf` comes back as `imp-thumb`, and the heading says `Photos (1)`.

- [ ] **Step 3: Update the heading to count documents**

In `index.html`, find (~lines 5003-5008):

```javascript
    var vids = shots.filter(function (f) { return isVideoPath(d[f.id]); }).length;
    // The heading counts what is actually there. "Photos (3)" over two videos and a photo is
    // a small lie that makes a reviewer think a video is missing.
    var head = !vids ? "Photos (" + shots.length + ")"
      : vids === shots.length ? (vids === 1 ? "Video (1)" : "Videos (" + shots.length + ")")
      : "Photos and videos (" + shots.length + ")";
```

Replace with:

```javascript
    var vids = shots.filter(function (f) { return isVideoPath(d[f.id]); }).length;
    var docs = shots.filter(function (f) { return !isImagePath(d[f.id]) && !isVideoPath(d[f.id]); }).length;
    // The heading counts what is actually there. "Photos (3)" over two videos and a photo is
    // a small lie that makes a reviewer think a video is missing. A pile of PDFs is "Files";
    // a mix of files with photos or videos is honestly just "Attachments".
    var head =
        docs === shots.length ? (docs === 1 ? "File (1)" : "Files (" + docs + ")")
      : docs ? "Attachments (" + shots.length + ")"
      : !vids ? "Photos (" + shots.length + ")"
      : vids === shots.length ? (vids === 1 ? "Video (1)" : "Videos (" + shots.length + ")")
      : "Photos and videos (" + shots.length + ")";
```

- [ ] **Step 4: Route a document to the download tile**

In `index.html`, find the per-answer render (~lines 5011-5023):

```javascript
        var p = d[f.id], lab = '<span class="pc-lab">' + esc(f.label) + "</span>";
        if (!isVideoPath(p)) {
          return '<div class="photo-cell"><img class="imp-thumb" data-path="' + esc(p) + '" alt="">' + lab + "</div>";
        }
        // A format a browser will not play is still the person's answer: it is offered as a
        // download rather than a player that would show a black rectangle and no explanation.
        if (!isPlayableVideo(p)) {
          return '<div class="photo-cell"><a class="imp-file pc-file" data-path="' + esc(p) + '" href="#" target="_blank" rel="noopener">' +
            PLAY_SVG + "<span>" + esc(fileLabel(p)) + "</span></a>" + lab + "</div>";
        }
        return '<div class="photo-cell"><button type="button" class="pc-video" data-vpath="' + esc(p) + '" title="Play">' +
          PLAY_SVG + "</button>" + lab + "</div>";
```

Replace with:

```javascript
        var p = d[f.id], lab = '<span class="pc-lab">' + esc(f.label) + "</span>";
        if (isImagePath(p)) {
          return '<div class="photo-cell"><img class="imp-thumb" data-path="' + esc(p) + '" alt="">' + lab + "</div>";
        }
        // A document, or a video format a browser will not play, is still the person's answer:
        // it is offered as a download rather than a player that would show a black rectangle. A
        // document gets the page glyph; an unplayable video keeps the play glyph.
        if (!isPlayableVideo(p)) {
          return '<div class="photo-cell"><a class="imp-file pc-file" data-path="' + esc(p) + '" href="#" target="_blank" rel="noopener">' +
            (isVideoPath(p) ? PLAY_SVG : FILE_SVG) + "<span>" + esc(fileLabel(p)) + "</span></a>" + lab + "</div>";
        }
        return '<div class="photo-cell"><button type="button" class="pc-video" data-vpath="' + esc(p) + '" title="Play">' +
          PLAY_SVG + "</button>" + lab + "</div>";
```

- [ ] **Step 5: Run and watch it pass**

Run: `node docs/tests/file-field.test.js`
Expected: no `FAIL:` lines, exit 0.

- [ ] **Step 6: Run the media test to confirm no regression**

Run: `node docs/tests/media-field.test.js`
Expected: no `FAIL:` lines, exit 0 — the photo/video wording and rendering are unchanged (no documents in those cases).

- [ ] **Step 7: Commit**

```bash
git add index.html docs/tests/file-field.test.js
git commit -m "feat: render a document answer as a download link in the record gallery"
```

---

## Task 4: Grid cell, card cover, and CSS for documents

**Files:**
- Modify: `index.html` — `gridCell` (~lines 5121-5123), `coverHtml` (~line 3957), the card-cover paint guard (~line 4776), and CSS (`.cellvid` block ~line 1098, `.ja-card .photo.is-video` ~line 354)
- Test: `docs/tests/file-field.test.js`

- [ ] **Step 1: Extend the load lists, then add the cover and CSS-presence tests**

First, add `coverHtml` to the fns list in the `load(APP, ...)` call:

```javascript
const A = load(APP,
  ['PHOTO_MAX_BYTES', 'MEDIA_MAX_BYTES', 'VIDEO_EXT', 'VIDEO_PLAYABLE', 'IMAGE_EXT', 'PLAY_SVG', 'FILE_SVG'],
  ['isFileField', 'isFileType', 'uploadCap', 'isVideoPath', 'isPlayableVideo', 'isImagePath', 'fileLabel', 'esc', 'photoSectionHtml', 'coverHtml']);
```

Then append, before the final `console.log`:

```javascript
// ---- the card cover ------------------------------------------------------
t('a document cover is marked as a file, not left as an empty photo box', () => {
  const h = A.coverHtml('uuid_cv.pdf');
  assert.ok(/is-file/.test(h), 'a file cover must carry is-file');
  assert.ok(/<svg/.test(h), 'and must show a glyph rather than an empty box');
});
t('an image cover is unchanged', () => {
  assert.strictEqual(A.coverHtml('uuid_face.jpg'), '<div class="photo"></div>');
});
t('a video cover is unchanged', () => {
  assert.ok(/is-video/.test(A.coverHtml('uuid_clip.mp4')));
});
t('the is-file cover class is styled', () => {
  assert.ok(/\.ja-card \.photo\.is-file\s*\{/.test(APP_SRC), 'is-file cover has no stylesheet rule');
});
t('the grid cell has a file indicator that is styled', () => {
  assert.ok(/class="cellfile"/.test(APP_SRC), 'gridCell never emits a cellfile indicator for a document');
  assert.ok(/table\.grid span\.cellfile\s*\{/.test(APP_SRC), 'cellfile has no stylesheet rule');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node docs/tests/file-field.test.js`
Expected: `FAIL: a document cover is marked as a file ...` and the two CSS-presence tests fail.

- [ ] **Step 3: Give `coverHtml` a file branch**

In `index.html`, replace (~line 3957):

```javascript
    return isVideoPath(path) ? '<div class="photo is-video">' + PLAY_SVG + "</div>" : '<div class="photo"></div>';
```

with:

```javascript
    return isVideoPath(path) ? '<div class="photo is-video">' + PLAY_SVG + "</div>"
      : !isImagePath(path) ? '<div class="photo is-file">' + FILE_SVG + "</div>"
      : '<div class="photo"></div>';
```

- [ ] **Step 4: Give `gridCell` a file indicator**

In `index.html`, find (~lines 5121-5123):

```javascript
      if (isVideoPath(p)) return '<span class="cellvid" title="' + esc(fileLabel(p)) + '">' + PLAY_SVG + "</span>";
      return '<img class="cellimg" data-path="' + esc(p) + '" alt="">';
```

Replace with:

```javascript
      if (isVideoPath(p)) return '<span class="cellvid" title="' + esc(fileLabel(p)) + '">' + PLAY_SVG + "</span>";
      if (!isImagePath(p)) return '<span class="cellfile" title="' + esc(fileLabel(p)) + '">' + FILE_SVG + "</span>";
      return '<img class="cellimg" data-path="' + esc(p) + '" alt="">';
```

- [ ] **Step 5: Stop the card cover painting a thumbnail of a document**

In `index.html`, find (~line 4776):

```javascript
      if (photoField && d[photoField.id] && !isVideoPath(d[photoField.id])) {
```

Replace with:

```javascript
      if (photoField && d[photoField.id] && isImagePath(d[photoField.id])) {
```

(This narrows the paint to actual images — a video or a document no longer asks the thumbnail sweeper for something that does not exist. The cover markup is already handled by `coverHtml` in Step 3.)

- [ ] **Step 6: Add the CSS rules**

In `index.html`, find the `.cellvid svg` rule (~line 1098):

```css
  table.grid span.cellvid svg { width: 18px; height: 18px; }
```

Immediately after it, add:

```css
  table.grid span.cellfile { width: 34px; height: 34px; border-radius: 6px; background: var(--bg-3);
    border: 1px solid var(--field-border); color: var(--silver-lo); display: flex; align-items: center; justify-content: center; }
  table.grid span.cellfile svg { width: 16px; height: 16px; }
```

Then find the `.ja-card .photo.is-video` rule (~line 354):

```css
  .ja-card .photo.is-video { color: var(--silver-lo); background: var(--bg-3); }
```

Immediately after it, add:

```css
  .ja-card .photo.is-file { color: var(--silver-lo); background: var(--bg-3); }
```

- [ ] **Step 7: Run and watch it pass**

Run: `node docs/tests/file-field.test.js`
Expected: no `FAIL:` lines, exit 0.

- [ ] **Step 8: Commit**

```bash
git add index.html docs/tests/file-field.test.js
git commit -m "feat: mark documents in the grid cell and card cover"
```

---

## Task 5: Upload a file — public form and in-record editor

**Files:**
- Modify: `f/index.html` — the `photo || media` branch of `buildField` (~lines 543-585)
- Modify: `index.html` — the in-record editor accept (~line 3282)
- Test: `docs/tests/file-field.test.js`

- [ ] **Step 1: Add the source-regex tests for both accept paths**

Append to `docs/tests/file-field.test.js`, before the final `console.log`:

```javascript
// ---- the upload widgets (asserted by source, they touch the DOM) ----------
// The public form's one upload branch must accept a file question, with a "Choose file"
// button and no accept restriction, at the media ceiling (files reuse it, no new constant).
t('the public form handles a file question', () => {
  assert.ok(/f\.type === "photo" \|\| f\.type === "media" \|\| f\.type === "file"/.test(PUB_SRC),
    'the upload branch must include the file type');
  assert.ok(/Choose file/.test(PUB_SRC), 'a file question needs its own button label');
});
// The in-record editor must give a file question a file input with no accept restriction.
t('the in-record editor accepts any file for a file question', () => {
  assert.ok(/f\.type === "file" \? ""/.test(APP_SRC),
    'the editor must leave accept empty (any type) for a file question');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node docs/tests/file-field.test.js`
Expected: both new tests `FAIL` — neither file mentions the `file` type in those spots yet.

- [ ] **Step 3: Add the `file` case to the public form upload branch**

In `f/index.html`, find (~lines 543-575):

```javascript
    } else if (f.type === "photo" || f.type === "media") {
      // One branch, not two. A media question is the same upload as a photo question with a
      // wider accept and a bigger ceiling — splitting it would mean two copies of the rules
      // about what is chosen, what is too big and what is required, and they would drift.
      var isMedia = f.type === "media";
      var cap = isMedia ? MEDIA_MAX_BYTES : MAX_BYTES;
      var pickTxt = isMedia ? "Choose photo or video" : "Choose photo";
      var noneTxt = isMedia ? "No file chosen" : "No photo chosen";
      var frow = document.createElement("div"); frow.className = "file-row"; frow.id = "row-" + f.id;
      frow.innerHTML = '<button type="button" class="file-btn">' + esc(pickTxt) + '</button><span class="file-check">✓</span><span class="file-name">' + esc(noneTxt) + '</span>';
      var fin = document.createElement("input"); fin.type = "file";
      fin.accept = isMedia ? "image/*,video/*" : "image/*";
      fin.style.display = "none"; fin.id = id;
      var fhint = document.createElement("div"); fhint.className = "hint";
      if (isMedia) fhint.textContent = "A photo or a video, up to " + mbText(cap) + ".";
      wrap.appendChild(frow); wrap.appendChild(fin); wrap.appendChild(fhint);
      var fbtn = frow.querySelector(".file-btn"), fchk = frow.querySelector(".file-check"), fnm = frow.querySelector(".file-name");
      var overCap = false;
      fbtn.addEventListener("click", function () { fin.click(); });
      fin.addEventListener("change", function () {
        var file = fin.files[0] || null;
        overCap = !!(file && file.size > cap);
        // The size is shown next to the name because on a video it is the number that decides
        // whether this works, and a person cannot see it any other way on a phone.
        fnm.textContent = file ? file.name + " · " + sizeText(file.size) : noneTxt;
        fchk.style.display = (file && !overCap) ? "flex" : "none";
        fbtn.textContent = file ? (isMedia ? "Change file" : "Change photo") : pickTxt;
        // Said now rather than after Submit: uploading 80 MB on shop wifi and being refused at
        // the end is the failure worth designing out.
        fhint.textContent = overCap
          ? "That " + (isVideoFile(file) ? "video" : "photo") + " is " + sizeText(file.size) + " — the limit is " + mbText(cap) + "." +
            (isVideoFile(file) ? " A shorter clip, or your phone's lower video quality setting, will fit." : " Please choose a smaller one.")
          : (isMedia ? "A photo or a video, up to " + mbText(cap) + "." : "");
        fhint.style.color = overCap ? "var(--danger)" : "";
        if (overCap) frow.classList.add("invalid"); else frow.classList.remove("invalid");
      });
```

Replace with (adds `isFile`, widens the labels/accept/hints; `file` reuses the media 50 MB ceiling):

```javascript
    } else if (f.type === "photo" || f.type === "media" || f.type === "file") {
      // One branch, not three. A media question is a photo question with a wider accept and a
      // bigger ceiling; a file question is a media question with any accept at all — splitting
      // them would mean copies of the rules about what is chosen, what is too big and what is
      // required, and they would drift.
      var isMedia = f.type === "media";
      var isFile = f.type === "file";
      var cap = (isMedia || isFile) ? MEDIA_MAX_BYTES : MAX_BYTES;
      var pickTxt = isFile ? "Choose file" : (isMedia ? "Choose photo or video" : "Choose photo");
      var noneTxt = (isMedia || isFile) ? "No file chosen" : "No photo chosen";
      var frow = document.createElement("div"); frow.className = "file-row"; frow.id = "row-" + f.id;
      frow.innerHTML = '<button type="button" class="file-btn">' + esc(pickTxt) + '</button><span class="file-check">✓</span><span class="file-name">' + esc(noneTxt) + '</span>';
      var fin = document.createElement("input"); fin.type = "file";
      fin.accept = isFile ? "" : (isMedia ? "image/*,video/*" : "image/*");
      fin.style.display = "none"; fin.id = id;
      var fhint = document.createElement("div"); fhint.className = "hint";
      if (isMedia) fhint.textContent = "A photo or a video, up to " + mbText(cap) + ".";
      else if (isFile) fhint.textContent = "A file, up to " + mbText(cap) + ".";
      wrap.appendChild(frow); wrap.appendChild(fin); wrap.appendChild(fhint);
      var fbtn = frow.querySelector(".file-btn"), fchk = frow.querySelector(".file-check"), fnm = frow.querySelector(".file-name");
      var overCap = false;
      fbtn.addEventListener("click", function () { fin.click(); });
      fin.addEventListener("change", function () {
        var file = fin.files[0] || null;
        overCap = !!(file && file.size > cap);
        // The size is shown next to the name because on a video it is the number that decides
        // whether this works, and a person cannot see it any other way on a phone.
        fnm.textContent = file ? file.name + " · " + sizeText(file.size) : noneTxt;
        fchk.style.display = (file && !overCap) ? "flex" : "none";
        fbtn.textContent = file ? ((isMedia || isFile) ? "Change file" : "Change photo") : pickTxt;
        // Said now rather than after Submit: uploading 80 MB on shop wifi and being refused at
        // the end is the failure worth designing out.
        fhint.textContent = overCap
          ? (isFile
              ? "That file is " + sizeText(file.size) + " — the limit is " + mbText(cap) + ". Please choose a smaller one."
              : "That " + (isVideoFile(file) ? "video" : "photo") + " is " + sizeText(file.size) + " — the limit is " + mbText(cap) + "." +
                (isVideoFile(file) ? " A shorter clip, or your phone's lower video quality setting, will fit." : " Please choose a smaller one."))
          : (isMedia ? "A photo or a video, up to " + mbText(cap) + "." : (isFile ? "A file, up to " + mbText(cap) + "." : ""));
        fhint.style.color = overCap ? "var(--danger)" : "";
        if (overCap) frow.classList.add("invalid"); else frow.classList.remove("invalid");
      });
```

(The `controls.push({ ... isPhoto: true, cap: cap, ... })` block right after is unchanged — `isPhoto: true` is the "this control holds an upload" marker that `submitForm` filters on, and it must stay set for a file question too.)

- [ ] **Step 4: Widen the in-record editor accept**

In `index.html`, find (~line 3282):

```javascript
      inner = '<input type="file" accept="' + (f.type === "media" ? "image/*,video/*" : "image/*") + '" class="ed-in" id="' + id + '">';
```

Replace with:

```javascript
      inner = '<input type="file" accept="' + (f.type === "media" ? "image/*,video/*" : (f.type === "file" ? "" : "image/*")) + '" class="ed-in" id="' + id + '">';
```

- [ ] **Step 5: Run and watch it pass**

Run: `node docs/tests/file-field.test.js`
Expected: no `FAIL:` lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add index.html f/index.html docs/tests/file-field.test.js
git commit -m "feat: upload any file for a file question (public form + in-record editor)"
```

---

## Task 6: Full regression run and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run every test in the suite**

Run:
```bash
for f in docs/tests/*.test.js; do echo "== $f =="; node "$f"; done
```
Expected: every file prints its own summary/nothing and exits 0. Pay attention to `media-field.test.js` (shares the render paths) and `delete-selected.test.js` (asserts every file field's upload is removed on delete — `file` now counts as a file field, which is correct behaviour).

- [ ] **Step 2: Manual smoke test (local, no deploy)**

Open `index.html` in a browser against the live self-hosted DB (the app has no build step). Steps:
1. In a form's field builder, add a field and pick type **File** — confirm it saves.
2. Open the public form for that table (`f/?...`) and confirm the file question shows a **Choose file** button with hint "A file, up to 50 MB." and no type restriction in the picker.
3. Note: an actual document upload will be **rejected by the `r2` edge function with `images_only`** until Ali/Baker widen it (Task 7). Verifying end-to-end document upload waits on that. Image/video files will upload today.
4. In a record that already has an image answer, confirm the gallery still shows a thumbnail (no regression).

- [ ] **Step 3: Hand the edge-function change to Ali/Baker**

The spec's "external dependency" section is the handover. Summarise for Ali/Baker: widen the `r2` edge function's MIME gate to accept any content type up to a ceiling of ≥ 50 MB, keeping the size cap and (recommended) blocking executable types. Until then the `file` type is inert for documents.

- [ ] **Step 4: Final branch state**

The branch `feat/file-field-type` now carries the spec, the plan, and the implementation. Ready for a PR into `main` (prod). Do not merge until the manual smoke test in Step 2 passes; the edge-function change (Step 3) can land after the frontend PR.
```

## Self-Review

**Spec coverage:**
- Public form `file` case, widened accept, 50 MB cap, generalized copy → Task 5. ✅
- Admin `FIELD_TYPES`, `isFileField`/`isFileType`, `uploadCap` → Task 1. ✅
- In-record editor accept → Task 5. ✅
- Display fix (`isImagePath`, document → `.pc-file`) → Tasks 2, 3. ✅
- Heading "Files"/"Attachments" → Task 3. ✅
- Card cover for a document → Task 4. ✅
- Grid cell (implied by "display fix" everywhere the app shows an upload) → Task 4. ✅
- Tests mirroring `media-field.test.js` → built across Tasks 1-5, regression run Task 6. ✅
- Edge-function handover → Task 6 Step 3 + spec. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows the full before/after. ✅

**Type/name consistency:** `isImagePath`, `IMAGE_EXT`, `FILE_SVG`, `uploadCap`, `photoSectionHtml`, `gridCell`, `coverHtml` used identically across tasks and match the real source. `file` uses `MEDIA_MAX_BYTES` (no invented constant) in both files. ✅
