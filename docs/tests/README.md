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
| `payroll.test.js` | the date-range export (`payrollRows`, `payrollConfig`, `inDateRange`, `payrollNumber`) — the output is money somebody is paid, so every test is either "a row was quietly dropped" or "money went out twice": both ends of the range inclusive, an event with no date never in range, a rate that is not a number reading as 0 rather than NaN, a backup who never worked not paid, a signup whose event was deleted earning nothing, `Ahmad`/` ahmad ` counted as one person while genuinely different spellings stay separate (as decided), and a nameless signup kept as `(no name)` rather than dropped |
| `swap.test.js` | moving somebody between confirmed and backup (`slotPillHtml`, `slotActions`, `slotCountText`) — that a table where nothing holds a place is untouched, that confirmed and backup differ by colour and not only wording, that the pill's classes actually exist in the stylesheet, that only the move you are *not* on is offered and only to a manager, and that a place move is intercepted before the WhatsApp/Call/Email dispatcher it borrows its menu from. The two rules that protect the count — the trigger promoting the oldest backup on delete *only*, and a promotion into full places being refused under a lock — are database behaviour and are checked in `13-swap-and-promote.sql` |
| `one-per-browser.test.js` | one submission per browser (`alreadyText`, `deviceKey` from `f/index.html`) — that a backup is never told they have a place, that the key is minted only for a form that opted in, that `p_device` is added to the payload conditionally (a fourth key against a three-argument function is a dead submit button on every form), and that a browser refusing storage returns no key and submits anyway rather than locking a real person out. It pulls `DEVICE_STORE` out of the page too, so the test cannot use a different storage key than the page does |
| `capacity.test.js` | capacity and backup places (`slotsText` from `f/index.html`) — that a form with no capacity says nothing at all, that places count down and read as singular at one, that a backup is told plainly they would be on the backup list rather than have a place, that a closed event says *closed* rather than *full*, and that an over-booked capacity never shows a negative number. The counting itself is done in the database under a row lock and is covered by the checks in `11-capacity-and-backup.sql` |
| `parent-links.test.js` | parent-scoped form links (`recordFormLink`, `childTableOf` from `index.html`, `fmtParentValue` from `f/index.html`) — that a record link is the ordinary form link plus an encoded token on the same page, that the child table is found from the children rather than a pointer on the parent, and that a date on the public page reads as a date but an impossible one (31 February) is shown as recorded instead of silently rolling over to 3 March |
| `new-record.test.js` | adding a record by hand (`newRecordVisible`, `newRecordMissing`, `newRecordData`) — that a question which does not apply carries no answer, that an empty answer stores no key, that only questions being asked can be required, and how the free text behind an "other" choice is kept or dropped. This path writes straight into `app_submissions` with no form page to eyeball, so a row it builds wrongly lands in a live table |
