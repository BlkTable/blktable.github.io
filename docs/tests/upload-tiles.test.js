// Seeing what you attached, and taking one back off.
//
// A public form used to answer an upload question with a filename and a green tick. That is
// enough to know SOMETHING was chosen and nothing else: not which photo, not whether it is
// the right one, and — the part that made people re-submit whole forms — no way to remove
// one photo picked by mistake.
//
// The reason it could not be removed is worth stating, because it shapes everything here:
// the control read `fin.files` straight off the input, and a browser's FileList is
// read-only. Nothing can be taken out of it, and a second pick REPLACES it. So the page now
// owns a plain array of its own, and these are the rules of that array.
//
// Nothing is uploaded until Submit, so removing a file here costs nothing and leaves no
// orphan object in R2. That is why the remove lives at pick time and not after.

const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(path) {
  const src = fs.readFileSync(path, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
const PUB = scripts('f/index.html');
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

const P = load(PUB, ['MAX_FILES', 'IMAGE_EXT_RE', 'VIDEO_EXT_RE'],
  ['fileKey', 'addFiles', 'fileKind', 'extLabel', 'isVideoFile']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// A stand-in for a File. The three properties the identity rule reads, and the two the
// tile reads, are all a real File gives us before an upload.
const file = (name, size, type, lastModified) =>
  ({ name, size: size == null ? 1024 : size, type: type == null ? '' : type, lastModified: lastModified == null ? 1700000000000 : lastModified });

// ---- which file is which ----------------------------------------------------
// Identity matters for one reason: on a phone, "Add photos" reopens a picker that often
// comes back with the previous selection still ticked. Appending blindly would attach
// every earlier photo a second time.
t('the same file picked twice is recognised as the same file', () => {
  assert.strictEqual(P.fileKey(file('shelf.jpg', 2048, 'image/jpeg')),
                     P.fileKey(file('shelf.jpg', 2048, 'image/jpeg')));
});
t('two different files are never the same file', () => {
  const a = P.fileKey(file('shelf.jpg', 2048, 'image/jpeg'));
  assert.notStrictEqual(a, P.fileKey(file('other.jpg', 2048, 'image/jpeg')), 'a different name');
  assert.notStrictEqual(a, P.fileKey(file('shelf.jpg', 4096, 'image/jpeg')), 'a different size');
  assert.notStrictEqual(a, P.fileKey(file('shelf.jpg', 2048, 'image/jpeg', 1800000000000)), 'a different moment');
});
// Two photos taken seconds apart really can share a name and a size (IMG_0001.jpg off two
// phones, or a picker that renames everything "image.jpg"). Losing one of those silently
// would be worse than a duplicate tile, so the moment is part of the identity.
t('two genuinely different photos sharing a name and size both survive', () => {
  const got = P.addFiles([], [file('image.jpg', 2048, 'image/jpeg', 1),
                              file('image.jpg', 2048, 'image/jpeg', 2)], 10);
  assert.strictEqual(got.files.length, 2);
});
t('nothing is not a file', () => {
  assert.strictEqual(P.fileKey(null), '');
  assert.strictEqual(P.fileKey(undefined), '');
});

// ---- adding, not replacing --------------------------------------------------
// The old behaviour: pick three, pick one more, and you have one. This is the rule that
// makes "Add photos" mean what it says.
t('a second pick adds to what was already chosen', () => {
  const first = P.addFiles([], [file('a.jpg'), file('b.jpg')], 10);
  const then = P.addFiles(first.files, [file('c.jpg')], 10);
  assert.deepEqual(then.files.map(f => f.name), ['a.jpg', 'b.jpg', 'c.jpg'],
    'the earlier photos must still be there, in the order they were chosen');
});
t('re-picking a photo already chosen does not attach it twice', () => {
  const cur = P.addFiles([], [file('a.jpg', 2048, 'image/jpeg')], 10).files;
  const got = P.addFiles(cur, [file('a.jpg', 2048, 'image/jpeg'), file('b.jpg')], 10);
  assert.deepEqual(got.files.map(f => f.name), ['a.jpg', 'b.jpg']);
  assert.strictEqual(got.dupes, 1, 'and it says so, rather than silently ignoring the pick');
});
t('the list never grows past the cap, and says how many did not fit', () => {
  const many = Array.from({ length: 14 }, (_, i) => file('p' + i + '.jpg', 2048, 'image/jpeg', i));
  const got = P.addFiles([], many, P.MAX_FILES);
  assert.strictEqual(got.files.length, P.MAX_FILES, 'the cap is the cap');
  assert.strictEqual(got.over, 14 - P.MAX_FILES, 'the refused count is what the message is built from');
});
// Refusing the overflow at pick time, rather than blocking the form, is the point: the
// selection you are left with is always a legal one.
t('a full question refuses more without losing what is already there', () => {
  const full = P.addFiles([], Array.from({ length: 10 }, (_, i) => file('p' + i + '.jpg', 2048, 'image/jpeg', i)), 10).files;
  const got = P.addFiles(full, [file('late.jpg')], 10);
  assert.strictEqual(got.files.length, 10);
  assert.strictEqual(got.over, 1);
  assert.ok(!got.files.some(f => f.name === 'late.jpg'), 'the refused file must not push an earlier one out');
});
t('picking nothing changes nothing', () => {
  const cur = [file('a.jpg')];
  assert.deepEqual(P.addFiles(cur, [], 10).files.map(f => f.name), ['a.jpg']);
  assert.deepEqual(P.addFiles(cur, null, 10).files.map(f => f.name), ['a.jpg']);
});
t('a hole in the picker list is skipped, not turned into a blank tile', () => {
  const got = P.addFiles([], [file('a.jpg'), null, undefined], 10);
  assert.strictEqual(got.files.length, 1);
});
// The array handed in is the live selection; growing it in place would mean a removed file
// reappearing on the next pick.
t('adding does not mutate the list it was given', () => {
  const cur = [file('a.jpg')];
  P.addFiles(cur, [file('b.jpg')], 10);
  assert.strictEqual(cur.length, 1, 'the caller decides when the selection changes');
});

// ---- what a tile draws ------------------------------------------------------
t('an image is drawn as an image and a video as a video', () => {
  assert.strictEqual(P.fileKind(file('shelf.jpg', 2048, 'image/jpeg')), 'image');
  assert.strictEqual(P.fileKind(file('clip.mp4', 2048, 'video/mp4')), 'video');
});
// Android's picker and several in-app browsers hand over a File with type === "". A photo
// with no preview is exactly the failure these tiles exist to fix, so the extension is
// read when the MIME type is missing.
t('a photo whose browser gave no MIME type is still previewed', () => {
  ['photo.JPG', 'x.jpeg', 'a.png', 'b.webp', 'IMG_1.heic', 'c.gif', 'd.avif'].forEach(nm => {
    assert.strictEqual(P.fileKind(file(nm, 2048, '')), 'image', nm + ' should preview as an image');
  });
});
t('a video whose browser gave no MIME type is still known to be a video', () => {
  ['clip.mp4', 'IMG_2.MOV', 'x.m4v', 'y.webm', 'z.3gp', 'w.mkv'].forEach(nm => {
    assert.strictEqual(P.fileKind(file(nm, 2048, '')), 'video', nm + ' should read as a video');
  });
});
t('anything else is a document, not a broken picture', () => {
  ['cv.pdf', 'sheet.xlsx', 'notes.txt', 'noextension'].forEach(nm => {
    assert.strictEqual(P.fileKind(file(nm, 2048, '')), 'other', nm);
  });
});
t('nothing has no kind rather than throwing', () => {
  assert.strictEqual(P.fileKind(null), 'other');
});
// One rule for "is this a video", not two: the size hint offers "a shorter clip" and the
// tile draws a play badge, and those two must never disagree about the same file.
t('the video hint and the video tile agree, including on a typeless .mov', () => {
  assert.strictEqual(P.isVideoFile(file('clip.mp4', 2048, 'video/mp4')), true);
  assert.strictEqual(P.isVideoFile(file('IMG_2.MOV', 2048, '')), true);
  assert.strictEqual(P.isVideoFile(file('shelf.jpg', 2048, 'image/jpeg')), false);
});

// ---- the badge on a tile with no picture ------------------------------------
t('a document tile is badged with its type', () => {
  assert.strictEqual(P.extLabel('contract.pdf'), 'PDF');
  assert.strictEqual(P.extLabel('sheet.XLSX'), 'XLSX');
});
t('a file with no extension is still badged with something', () => {
  assert.strictEqual(P.extLabel('scan'), 'FILE');
  assert.strictEqual(P.extLabel(''), 'FILE');
  assert.strictEqual(P.extLabel(null), 'FILE');
});

// ---- the widgets (asserted by source: they touch the DOM) -------------------
// The whole fix rests on the page owning its own list. If anything still reads the input's
// FileList as the answer, removal silently does nothing.
t('the chosen files are the page own array, not the input read-only FileList', () => {
  assert.ok(/var picked = \[\]/.test(PUB_SRC), 'the branch must keep its own list of files');
  assert.ok(/function chosenFiles\(\) \{ return picked\.slice\(\); \}/.test(PUB_SRC),
    'everything downstream — validate, the count, the upload loop — must read that list');
  // The input's FileList is read in exactly one place and for one purpose: to learn what
  // was just picked, on its way into addFiles. Reading it anywhere else would be reading it
  // as the selection, and a FileList cannot have a file taken out of it.
  assert.ok(/addFiles\(picked, justPicked, MAX_FILES\)/.test(PUB_SRC),
    'a pick must be merged into the list we own, not become the list');
  assert.strictEqual((PUB_SRC.match(/fin\.files/g) || []).length, 1,
    'fin.files should be read once, by that merge, and nowhere else');
});
// Without this the same photo can never be re-picked after being removed: the input still
// holds it, so choosing it again fires no change event at all.
t('the input is emptied after each pick', () => {
  assert.ok(/fin\.value = "";/.test(PUB_SRC),
    'a removed photo must be choosable again, which means the input must not still hold it');
});
t('every chosen file gets a tile with its own remove button', () => {
  assert.ok(/className = "file-tiles"/.test(PUB_SRC), 'the tiles need a grid to live in');
  assert.ok(/"ft-del"/.test(PUB_SRC), 'each tile needs its own remove');
  assert.ok(/aria-label", "Remove /.test(PUB_SRC), 'and it must say what it removes');
});
// Removing by position breaks the moment a tile is added or removed above it; removing by
// identity is right whatever the list has done since.
t('a remove takes off the file it is drawn on, not a position', () => {
  assert.ok(/picked\.indexOf\(fl\)/.test(PUB_SRC),
    'the remove must find its own file in the list rather than trust a stale index');
});
t('a preview URL is handed back when its tile goes away', () => {
  assert.ok(/revokeObjectURL/.test(PUB_SRC),
    'ten unreleased photo previews is ten photos held in memory on a phone');
});
// "Change photos" was the honest label for a picker that replaced everything. It is the
// wrong word now, and the wrong word is what made people think a mistake was permanent.
t('the button offers to add once something is chosen', () => {
  assert.ok(/"Add photos"/.test(PUB_SRC) && /"Add files"/.test(PUB_SRC),
    'a second pick adds to the selection, so the button must say add');
  assert.ok(!/"Change photos"/.test(PUB_SRC) && !/"Change files"/.test(PUB_SRC),
    'the replacing behaviour is gone, so its label must go with it');
});
// The old message named the offending file in prose. With ten tiles on screen, pointing at
// the tile is the part that makes it findable.
t('the file that is too big is marked on its own tile', () => {
  assert.ok(/\.file-tile\.invalid/.test(PUB_SRC), 'the over-size tile needs a visible state');
});
t('the tiles are styled', () => {
  ['\\.file-tiles\\s*\\{', '\\.file-tile\\s*\\{', '\\.ft-del\\s*\\{', '\\.ft-cap\\s*\\{', '\\.ft-shot\\s*\\{']
    .forEach(re => assert.ok(new RegExp(re).test(PUB_SRC), re + ' has no stylesheet rule'));
});
// Everything above is one branch of buildField, shared by photo, media and file questions,
// so every upload question on every form gets the tiles at once.
t('the tiles serve photo, media and file questions from the one branch', () => {
  assert.ok(/f\.type === "photo" \|\| f\.type === "media" \|\| f\.type === "file"/.test(PUB_SRC),
    'three copies of this would drift');
});

console.log(n + ' tests defined');
