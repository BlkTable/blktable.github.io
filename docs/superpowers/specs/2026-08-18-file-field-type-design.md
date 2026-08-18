# File field type for BLKTable forms

Date: 2026-08-18

## Goal

Let a form question collect an uploaded file of any type (PDF, Office
documents, archives, images, video) rather than only images (`photo`) or
images and video (`media`).

## Background

BLKTable forms already do file upload through two field types:

- `photo`: images only, 10 MB cap
- `media`: images and video, 50 MB cap

Both share one path: `storageUpload()` posts the file to the `r2` edge
function, which stores it in a private R2 bucket and returns an object key
(`<uuid>_<original filename>`). That key is stored as the answer. The admin
app treats "photo or media" as one concept, `isFileField()`, meaning "does
this answer hold an uploaded file?".

`file` is the widest member of that family:

    photo (images, 10 MB) -> media (+ video, 50 MB) -> file (any type, 50 MB)

No new upload path and no new storage shape. The stored answer is the same
kind of R2 object key.

## The one external dependency: the `r2` edge function

The MIME whitelist is enforced server-side by the `r2` edge function, whose
source lives on the self-hosted server, not in this repo. It rejects
non-image/video uploads with `images_only`. Document uploads stay blocked
until that function is widened.

Yazan drives that change with Ali/Baker. Spec to hand over:

- Accept any content type up to the existing size ceiling (ceiling must be
  >= 50 MB so a `file` answer at the client cap is not refused).
- Keep the hard size cap.
- Recommended: block executable types (`.exe`, `.sh`, `.bat`, `.cmd`,
  `.msi`, `.scr`, and similar) even under "accept anything". The endpoint is
  anon-facing; stored objects are private and only served to authenticated
  admins, so risk is low, but blocking executables costs nothing.

The frontend work in this spec can ship first; the `file` type is inert for
documents until the edge function is widened.

## Frontend: public form (`f/index.html`)

Add `file` to the existing `photo || media` upload branch, parameterized the
way `media` already parameterizes off `photo`:

- `accept`: unset (any file).
- cap: `FILE_MAX_BYTES = 50 * 1024 * 1024`.
- button text: "Choose file"; empty state: "No file chosen".
- Generalize the over-cap warning copy, which hardcodes "photo"/"video", to
  say "file" for this type.

## Frontend: admin app (`index.html`)

- `FIELD_TYPES`: add `{ v: "file", label: "File" }`.
- `isFileField` / `isFileType`: include `"file"`.
- `uploadCap`: `file` returns the 50 MB cap.
- In-record edit input (buildEditor, ~line 3282): `file` gets no `accept`
  restriction.
- Display fix (needed regardless of this feature): today any non-video path
  renders as `<img>`, so a PDF answer shows as a broken image. New rule in
  the answer-section renderer:
  - image extension, or extensionless legacy key -> thumbnail (`<img>`)
  - playable video -> `.pc-video` player
  - anything else (documents, unplayable video) -> the existing `.pc-file`
    download tile
  Add an `isImagePath()` helper. Extensionless keys keep reading as images,
  matching the existing rule for rows written before this existed.
- Answer-section heading: today it reads "Photos (n)" / "Videos (n)" /
  "Photos and videos (n)". When a document answer is present, the heading
  reads "Files (n)". Photo/video-only wording is unchanged.
- Card cover for a document answer -> the file/download tile, not a grey box.

## Testing

New `docs/tests/file-field.test.js`, mirroring `media-field.test.js`:

- the `file` type appears in the builder's `FIELD_TYPES`
- the public form renders an upload widget for a `file` question
- a document answer (e.g. `<uuid>_report.pdf`) renders as a `.pc-file`
  download link in the record view, not an `<img>`
- an image answer still renders as a thumbnail (no regression)

## Decisions

- Cap = 50 MB, reusing the media ceiling rather than adding a third constant.
- Heading label = "Files".
- `file` shares the existing upload branch rather than getting its own, per
  the code's stated intent that splitting the branches duplicates the rules.

## Out of scope

- The `r2` edge function change itself (handed to Ali/Baker).
- Per-field allowed-type restrictions (e.g. "PDF only"). Every `file`
  question accepts any type.
