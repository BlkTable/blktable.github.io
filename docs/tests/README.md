# Tests

There is no build step and Node is not installed standalone on the dev machine,
so the tests are plain scripts run with the Node that ships inside VS Code:

```bash
cd C:/Users/ASUS/blktable
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/shell-helpers.test.js
```

Run them from the repo root — each one reads `index.html` and pulls the functions
it tests out of the page by name, so there is nothing to keep in sync by hand and
a renamed function fails loudly instead of silently going untested.

| file | covers |
| --- | --- |
| `shell-helpers.test.js` | Home's recently-opened grouping (`periodOf`, `groupByPeriod`, `agoText`), per-table colour and glyph (`tableTint`, `tableGlyph`), and the filter engine's condition groups (`passesList`, `filterCount`, `pruneConds`, `condSlot`) |
| `conditional-questions.test.js` | "ask this only if" (`condMet`, `condLabel`) — and it loads `condMet` from **both** `index.html` and `f/index.html`, asserting the same answer from each, because the public form and the review panel each carry a copy of the rule |
| `flag-tag.test.js` | the red "needs noticing" mark (`flagTagHtml`) — which answers trip it, that a blank answer never does, that matching ignores case, and that the admin-typed label is escaped |
| `new-record.test.js` | adding a record by hand (`newRecordVisible`, `newRecordMissing`, `newRecordData`) — that a question which does not apply carries no answer, that an empty answer stores no key, that only questions being asked can be required, and how the free text behind an "other" choice is kept or dropped. This path writes straight into `app_submissions` with no form page to eyeball, so a row it builds wrongly lands in a live table |
