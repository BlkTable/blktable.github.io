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
