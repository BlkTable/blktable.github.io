# World dial codes on the phone question: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every phone question offers all 245 dial codes, pre-filled from the device timezone, searchable, validated per country, and the record editor stops corrupting numbers it cannot parse.

**Architecture:** Two generated single-line tables (dial rows, zone to country) plus a block of pure lookup functions, inlined character-for-character into both `index.html` and `f/index.html`. The public form's phone branch and the dashboard's phone editor both read that one block, so the two four-country lists that drifted in `6cc5a29` are deleted. No database migration, no RPC change.

**Tech Stack:** Plain ES5-style browser JavaScript in two large single-file pages, no build step. Tests are plain Node scripts run through VS Code's bundled Node, plus headless-Chrome drivers. Data generated from pinned `libphonenumber-js@1.11.17` and `countries-and-timezones@3.6.0`.

**Spec:** `docs/superpowers/specs/2026-09-08-world-phone-codes-design.md`

## Global Constraints

- **Branch and worktree:** work in the existing worktree on branch `feat/world-phone-codes`, off `origin/main`. Never switch branches in the shared clone at `C:/Users/ASUS/blktable`, and never `git add -A` (another session's uncommitted work lives in that clone). Stage named files only.
- **Node:** not on PATH. Run everything as `ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" <script>` from the repo root, with an absolute script path.
- **Line endings are CRLF** in the working tree. Any script that rewrites a page must preserve them, and any test regex anchored on `;\n` will match nothing. Anchor on `[^\n]*;` or `(?=\r?\n)`. Never splice these pages with `awk`: it strips every CR and the parity tests then report drift that is not there.
- **No em-dashes** in copy or comments (house style, commit `51b792d`). Use commas or parentheses.
- **Theme tokens in `index.html` CSS:** never hand-write white rgba. Use `rgba(var(--wash),alpha)` and `var(--accent-ink)`; `theme.test.js` fails literal `rgba(255,255,255,...)`. `f/index.html` is not under that test and its existing `.cc-menu` rules use literal rgba: follow each file's local convention.
- **The shared block must be byte identical in both pages.** It is compared character for character by a test, the way the date and time block is.
- **Each generated table is a single-line `var` declaration.** The harness's `grabVar` matches `var NAME = [^\n]*;`; a multi-line declaration reads as missing.
- **Packed format:** fields separated by `~`, rows by `;`, lengths as base36 single characters. Verified absent from every pattern, name and example: `|`, `,` and `:` all occur inside patterns and must never be used as separators.
- **Never rewrite a stored phone answer that the user did not edit.** This is the corruption being fixed; reintroducing it is the one unacceptable outcome.

---

## File Structure

| File | Responsibility |
|---|---|
| `tools/gen-phone-data.js` | Create. Fetches the three pinned sources, applies the seven name overrides, emits the two packed tables, and rewrites the marked block in both pages. Refuses to write if any assertion fails. |
| `index.html` | Modify. Delete `COUNTRIES` (line 4659) and `COUNTRIES_ED` (line 5801); host the generated block and shared helpers; rewrite `parsePhone`, `edPhone`, `wireEdPhone` (5809 to 5834); adapt `phoneCountry` (4665) and `countryFlag` (~8120); extend `.cc-*` CSS (864 to 873, and the mobile clamp at ~1922). |
| `f/index.html` | Modify. Delete `COUNTRIES` (line 497); host the generated block and shared helpers; rewrite `splitPhone` (624) and the `phone` branch (2294 to 2311); add the pre-fill and its note; extend `.cc-*` CSS (154 to 167). Part F touches `zoneCountryName` (1971). |
| `docs/tests/phone-data.test.js` | Create. Pins the generated tables: shape, counts, the four house rows, name reconciliation, and both copies identical. |
| `docs/tests/phone-world.test.js` | Create. Pins the lookup functions from both pages: splitting, per-country validation, all 245 example numbers, the zone map, the Jordan fallback. |
| `docs/tests/phone-picker.chrome.js` | Create. Drives the real picker on the real public form: search, keyboard, pre-fill with a stubbed zone, and submitted value. |
| `docs/tests/phone-editor.chrome.js` | Create. Drives the dashboard editor: the `+971` and legacy `0…` regressions, saved unchanged. |
| `docs/tests/README.md` | Modify. One row per new test file, in the house voice. |
| `STATUS.md` | Modify. Current state, next steps, dated log line. |

---

## Task 1: The generator and the two data tables

**Files:**
- Create: `tools/gen-phone-data.js`
- Modify: `index.html` (insert block, replacing `var COUNTRIES` at line 4659), `f/index.html` (insert block, replacing `var COUNTRIES` at line 497)
- Test: `docs/tests/phone-data.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: two page-level single-line vars, in both pages, between literal marker comments.
  - `var PHONE_ROWS = "<245 rows of iso~dial~lengths~example~pattern~name~pri joined by ;>";`
  - `var TZ_ISO = "<541 pairs of zone~iso2 joined by ;>";`
  - Markers, exactly: `// ---- BEGIN GENERATED phone data (tools/gen-phone-data.js) ----` and `// ---- END GENERATED phone data ----`
  - Field 7, `pri`, is `1` for the primary country of a shared dial code and empty otherwise. It exists because 12 dial codes are shared and alphabetical order would show an Antigua flag for every US number: `country_calling_codes` in the metadata lists the primary first (`"1":["US","AG",...]`, `"44":["GB","GG","IM","JE"]`).

- [ ] **Step 1: Write the failing test**

Create `docs/tests/phone-data.test.js`:

```js
// The two generated tables, pinned. Nothing here tests behaviour: it tests that the DATA in
// the page is the data we think it is, because every function in the next file is only as
// right as these two strings. Both pages carry the same copy, so the last test is the one
// that matters most: a table right on one page and stale on the other is the shape of the
// outage in 6cc5a29.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
// Anchored to the end of the LINE, not to a following "\n": the working tree is CRLF, so a
// pattern ending `;\n` matches nothing here and the declaration reads as missing.
function grabVar(js, name, file) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name + ' in ' + file);
  return m[0];
}
function vars(js, names, file) {
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grabVar(js, n, file)).join('\n') +
                '\nthis.OUT={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.OUT;
}
const SRC = scripts('index.html'), FSRC = scripts('f/index.html');
const D = vars(SRC, ['PHONE_ROWS', 'TZ_ISO'], 'index.html');
const F = vars(FSRC, ['PHONE_ROWS', 'TZ_ISO'], 'f/index.html');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const rows = D.PHONE_ROWS.split(';').map(r => {
  const p = r.split('~');
  return { iso: p[0], cc: p[1], len: p[2].split('').map(x => parseInt(x, 36)), ph: p[3], pat: p[4], name: p[5], pri: p[6] };
});
const byIso = {}; rows.forEach(r => { byIso[r.iso] = r; });

// ---- the dial table ------------------------------------------------------------------
t('245 countries, every field present', () => {
  assert.strictEqual(rows.length, 245);
  rows.forEach(r => {
    assert.ok(/^[A-Z]{2}$/.test(r.iso), 'bad iso ' + r.iso);
    assert.ok(/^[0-9]{1,4}$/.test(r.cc), r.iso + ' has a bad dial code: ' + r.cc);
    assert.ok(r.len.length > 0 && r.len.every(x => x >= 2 && x <= 17), r.iso + ' has bad lengths');
    assert.ok(r.ph && /^[0-9]+$/.test(r.ph), r.iso + ' has no example number');
    assert.ok(r.pat && r.pat.length > 1, r.iso + ' has no pattern');
    assert.ok(r.name && r.name.length > 1, r.iso + ' has no name');
  });
});
t('the separators never appear inside a field', () => {
  // ~ and ; were chosen by measurement: the patterns contain |, , and : and would corrupt
  // exactly one country each, silently.
  rows.forEach(r => {
    [r.ph, r.pat, r.name].forEach(v => {
      assert.ok(v.indexOf('~') === -1, r.iso + ' has a ~ in a field');
      assert.ok(v.indexOf(';') === -1, r.iso + ' has a ; in a field');
    });
  });
});
t('the four house countries read as expected', () => {
  assert.strictEqual(byIso.JO.cc, '962');
  assert.strictEqual(byIso.LB.cc, '961');
  assert.strictEqual(byIso.SY.cc, '963');
  assert.strictEqual(byIso.IQ.cc, '964');
  // Per country rather than hand written, so these are libphonenumber's and include
  // landlines. Jordan was "exactly 9" before this change.
  assert.deepStrictEqual(byIso.JO.len, [8, 9]);
  assert.deepStrictEqual(byIso.LB.len, [7, 8]);
  assert.deepStrictEqual(byIso.SY.len, [8, 9]);
  assert.deepStrictEqual(byIso.IQ.len, [8, 9, 10]);
  assert.strictEqual(byIso.JO.name, 'Jordan');
});
t('every example number satisfies its own row', () => {
  // 245 assertions the generator gives away free, and the whole validation approach in one
  // line: if a country's own example fails its own rule, the rule is wrong.
  rows.forEach(r => {
    assert.ok(r.len.indexOf(r.ph.length) !== -1, r.iso + ' example is not a valid length');
    assert.ok(new RegExp('^(?:' + r.pat + ')$').test(r.ph), r.iso + ' example does not match its pattern');
  });
});
t('a shared dial code names exactly one primary country', () => {
  const byDial = {};
  rows.forEach(r => { (byDial[r.cc] = byDial[r.cc] || []).push(r); });
  const shared = Object.keys(byDial).filter(d => byDial[d].length > 1);
  assert.strictEqual(shared.length, 12, 'expected 12 shared dial codes, got ' + shared.length);
  shared.forEach(d => {
    const pri = byDial[d].filter(r => r.pri);
    assert.strictEqual(pri.length, 1, '+' + d + ' has ' + pri.length + ' primary countries');
  });
  // The ones that would be visibly wrong without it.
  assert.strictEqual(byDial['1'].filter(r => r.pri)[0].iso, 'US');
  assert.strictEqual(byDial['44'].filter(r => r.pri)[0].iso, 'GB');
  assert.strictEqual(byDial['7'].filter(r => r.pri)[0].iso, 'RU');
  assert.strictEqual(byDial['39'].filter(r => r.pri)[0].iso, 'IT');
});

// ---- the names the country question already stores -----------------------------------
t('every country name the page stores has a dial row', () => {
  // The picker and the country question must read the same, and a changed name string is a
  // country question whose stored answers stop resolving. Seven names disagree with the
  // packages and are overridden in the generator; this is what proves all seven landed.
  const ours = JSON.parse(grabVar(FSRC, 'COUNTRY_NAMES_ALL', 'f/index.html').match(/\[.*\]/)[0]);
  assert.strictEqual(ours.length, 197);
  const emitted = {}; rows.forEach(r => { emitted[r.name] = (emitted[r.name] || 0) + 1; });
  const missing = ours.filter(x => !emitted[x]);
  assert.deepStrictEqual(missing, [], 'names with no dial row: ' + JSON.stringify(missing));
  ['Cote d\'Ivoire', 'Turkey', 'United States', 'Vatican City', 'Kosovo',
   'Congo (Brazzaville)', 'Congo (Kinshasa)'].forEach(x => {
    assert.strictEqual(emitted[x], 1, x + ' appears ' + emitted[x] + ' times');
  });
});

// ---- the zone map --------------------------------------------------------------------
const zones = {};
D.TZ_ISO.split(';').forEach(p => { const i = p.indexOf('~'); zones[p.slice(0, i)] = p.slice(i + 1); });
t('541 zones, each naming one country', () => {
  assert.strictEqual(Object.keys(zones).length, 541);
  Object.keys(zones).forEach(z => assert.ok(/^[A-Z]{2}$/.test(zones[z]), z + ' maps to ' + zones[z]));
});
t('a zone shared between countries resolves to the one it is named for', () => {
  // tzdata gives one canonical zone to every country sharing its rules, so Africa/Abidjan
  // covers twelve countries including Iceland. Read naively, this map sends Dubai to the
  // French Southern Territories, Riyadh to Yemen and Berlin to Svalbard.
  assert.strictEqual(zones['Africa/Abidjan'], 'CI');
  assert.strictEqual(zones['Asia/Dubai'], 'AE');
  assert.strictEqual(zones['Asia/Riyadh'], 'SA');
  assert.strictEqual(zones['Europe/Berlin'], 'DE');
  assert.strictEqual(zones['Europe/London'], 'GB');
});
t('deprecated zone names are present', () => {
  // Browsers still report these, and ICU treats several as canonical. Without them India,
  // Ukraine, Myanmar and Argentina silently stop pre-filling.
  assert.strictEqual(zones['Asia/Calcutta'], 'IN');
  assert.strictEqual(zones['Asia/Kolkata'], 'IN');
  assert.strictEqual(zones['Europe/Kiev'], 'UA');
  assert.strictEqual(zones['Europe/Kyiv'], 'UA');
  assert.strictEqual(zones['Asia/Rangoon'], 'MM');
  assert.strictEqual(zones['America/Buenos_Aires'], 'AR');
});
t('our four are there, and so is the shape of a non-answer', () => {
  assert.strictEqual(zones['Asia/Amman'], 'JO');
  assert.strictEqual(zones['Asia/Beirut'], 'LB');
  assert.strictEqual(zones['Asia/Baghdad'], 'IQ');
  assert.strictEqual(zones['Asia/Damascus'], 'SY');
  assert.ok(!zones['UTC'], 'UTC must not map to a country: a hardened browser reporting it is a non-answer, not a guess');
});

// ---- one copy, two pages -------------------------------------------------------------
t('both pages carry the same tables, character for character', () => {
  assert.strictEqual(F.PHONE_ROWS, D.PHONE_ROWS, 'PHONE_ROWS differs between the pages');
  assert.strictEqual(F.TZ_ISO, D.TZ_ISO, 'TZ_ISO differs between the pages');
});
t('the generated block is marked as generated in both pages', () => {
  [['index.html', SRC], ['f/index.html', FSRC]].forEach(([f, js]) => {
    assert.ok(js.indexOf('BEGIN GENERATED phone data') !== -1, f + ' has no begin marker');
    assert.ok(js.indexOf('END GENERATED phone data') !== -1, f + ' has no end marker');
  });
});
t('the old four-country lists are gone', () => {
  assert.ok(!/\n  var COUNTRIES = \[/.test(SRC), 'index.html still declares var COUNTRIES');
  assert.ok(!/\n  var COUNTRIES = \[/.test(FSRC), 'f/index.html still declares var COUNTRIES');
  assert.ok(!/COUNTRIES_ED/.test(SRC), 'index.html still mentions COUNTRIES_ED');
});

console.log(n + ' passed');
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
cd C:/Users/ASUS/AppData/Local/Temp/claude/C--Users-ASUS/65a91843-24c6-49c6-b5a2-088c58d472fa/scratchpad/wt-phone
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/phone-data.test.js
```

Expected: it throws before any test runs, with `could not find var PHONE_ROWS in index.html`. That is the correct failure. If it instead reports individual FAIL lines, the vars exist already and something is wrong with the starting state.

- [ ] **Step 3: Write the generator**

Create `tools/gen-phone-data.js`:

```js
// Generates the two phone data tables and writes them into both pages, between the markers.
// Run it when the metadata needs refreshing; the output is committed, so the pages never
// fetch anything at runtime and the tests never need the network.
//
//   ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
//     tools/gen-phone-data.js
//
// Sources are pinned by version in the URLs below. Bumping a version is a deliberate act:
// re-run, read the diff, and check the tests before committing.
const fs = require("fs");
const path = require("path");

const LPN = "1.11.17";
const CAT = "3.6.0";
const SOURCES = {
  meta: "https://cdn.jsdelivr.net/npm/libphonenumber-js@" + LPN + "/metadata.min.json",
  examples: "https://cdn.jsdelivr.net/npm/libphonenumber-js@" + LPN + "/examples.mobile.json",
  zones: "https://cdn.jsdelivr.net/npm/countries-and-timezones@" + CAT + "/dist/index.js"
};
const BEGIN = "  // ---- BEGIN GENERATED phone data (tools/gen-phone-data.js) ----";
const END = "  // ---- END GENERATED phone data ----";

// Seven country names where the packages disagree with what the country question already
// stores. A changed name string is a country question whose stored answers stop resolving,
// so the page's vocabulary wins and this map is what makes it win.
const NAME_OVERRIDE = {
  CG: "Congo (Brazzaville)",
  CD: "Congo (Kinshasa)",
  CI: "Cote d'Ivoire",
  TR: "Turkey",
  US: "United States",
  VA: "Vatican City",
  XK: "Kosovo"          // libphonenumber knows XK on +383; the zone package has no such country
};

function die(msg) { console.error("REFUSING TO WRITE: " + msg); process.exit(1); }

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) die("could not fetch " + url + " (" + r.status + ")");
  return r.json();
}
async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) die("could not fetch " + url + " (" + r.status + ")");
  return r.text();
}

(async function main() {
  const meta = await getJson(SOURCES.meta);
  const examples = await getJson(SOURCES.examples);
  const catSrc = await getText(SOURCES.zones);
  const mod = { exports: {} };
  new Function("module", "exports", "require", catSrc)(mod, mod.exports, require);
  const ct = mod.exports.default || mod.exports;

  const C = meta.countries;
  const b36 = function (n) { return n.toString(36); };

  // The primary country of a dial code is the FIRST one listed against it, which is why this
  // is read from country_calling_codes rather than worked out from the country list. Twelve
  // codes are shared, +1 by 25 countries, and alphabetical order would put an Antigua flag
  // on every American number.
  const primary = {};
  Object.keys(meta.country_calling_codes).forEach(function (dial) {
    primary[meta.country_calling_codes[dial][0]] = 1;
  });

  const isos = Object.keys(C).sort();
  const rows = isos.map(function (iso) {
    const c = ct.getCountry(iso);
    const name = NAME_OVERRIDE[iso] || (c && c.name) || iso;
    const lens = (C[iso][3] || []).map(b36).join("");
    const fields = [iso, C[iso][0], lens, examples[iso] || "", C[iso][2] || "", name, primary[iso] ? "1" : ""];
    fields.forEach(function (f, i) {
      if (String(f).indexOf("~") !== -1 || String(f).indexOf(";") !== -1) {
        die(iso + " field " + i + " contains a separator: " + f);
      }
    });
    if (!lens) die(iso + " has no possible lengths");
    if (!examples[iso]) die(iso + " has no example number");
    if (!C[iso][2]) die(iso + " has no pattern");
    return fields.join("~");
  });
  const phoneRows = rows.join(";");

  // Deprecated zone names are included deliberately: browsers still report Asia/Calcutta and
  // Europe/Kiev, and ICU treats several of them as canonical. Without them India, Ukraine,
  // Myanmar and Argentina never pre-fill. getCountryForTimezone returns the country the zone
  // is NAMED for, which is the only reading that survives the 109 zones tzdata shares between
  // countries.
  const zonePairs = Object.keys(ct.getAllTimezones({ deprecated: true })).sort().map(function (z) {
    const c = ct.getCountryForTimezone(z);
    if (!c) return null;                      // Etc/UTC, Antarctica: safe non-answers
    if (z.indexOf("~") !== -1 || z.indexOf(";") !== -1) die("zone contains a separator: " + z);
    return z + "~" + c.id;
  }).filter(Boolean);
  const tzIso = zonePairs.join(";");

  // ---- assertions that must hold before anything is written ----------------------------
  rows.forEach(function (r) {
    const p = r.split("~");
    const lens = p[2].split("").map(function (ch) { return parseInt(ch, 36); });
    const ex = p[3];
    if (lens.indexOf(ex.length) === -1) die(p[0] + " example " + ex + " is not a valid length");
    if (!new RegExp("^(?:" + p[4] + ")$").test(ex)) die(p[0] + " example " + ex + " fails its own pattern");
  });
  if (!/JO~962~89~/.test(phoneRows)) die("Jordan is not where it should be in the table");
  if (!/Asia\/Amman~JO;/.test(tzIso + ";")) die("Asia/Amman does not map to JO");

  // The page's own country vocabulary is the authority. Read it out of f/index.html rather
  // than restated here, so this cannot quietly diverge from the list the question offers.
  const fsrc = fs.readFileSync("f/index.html", "utf8");
  const m = fsrc.match(/\n  var COUNTRY_NAMES_ALL = \[[^\n]*\];/);
  if (!m) die("could not find COUNTRY_NAMES_ALL in f/index.html");
  const ours = JSON.parse(m[0].match(/\[.*\]/)[0]);
  const emitted = {};
  rows.forEach(function (r) { const nm = r.split("~")[5]; emitted[nm] = (emitted[nm] || 0) + 1; });
  const missing = ours.filter(function (nm) { return !emitted[nm]; });
  if (missing.length) die("these country names have no dial row, add them to NAME_OVERRIDE: " + JSON.stringify(missing));

  // ---- write the block into both pages -------------------------------------------------
  // Emitted through JSON.stringify so the 779 backslashes in the patterns survive as \d
  // rather than becoming d, and each table is ONE line because the test harness's grabVar
  // matches `var NAME = [^\n]*;`.
  const block = [
    BEGIN,
    "  // libphonenumber-js " + LPN + " and countries-and-timezones " + CAT + ". Do not edit by hand:",
    "  // re-run tools/gen-phone-data.js instead. " + rows.length + " countries, " + zonePairs.length + " zones.",
    "  var PHONE_ROWS = " + JSON.stringify(phoneRows) + ";",
    "  var TZ_ISO = " + JSON.stringify(tzIso) + ";",
    END
  ];

  ["index.html", "f/index.html"].forEach(function (file) {
    const src = fs.readFileSync(file, "utf8");
    const eol = src.indexOf("\r\n") !== -1 ? "\r\n" : "\n";   // the tree is CRLF; keep it
    const lines = src.split(/\r?\n/);
    const from = lines.indexOf(BEGIN), to = lines.indexOf(END);
    if (from === -1 || to === -1 || to < from) die("markers not found in " + file + " (add them by hand first)");
    const out = lines.slice(0, from).concat(block, lines.slice(to + 1));
    fs.writeFileSync(file, out.join(eol));
    console.log("wrote " + (to - from + 1) + " lines -> " + block.length + " into " + file);
  });
  console.log("PHONE_ROWS " + Buffer.byteLength(JSON.stringify(phoneRows)) + " bytes, TZ_ISO " +
              Buffer.byteLength(JSON.stringify(tzIso)) + " bytes");
})();
```

- [ ] **Step 4: Add the markers by hand, once, in both pages**

The generator replaces what is between the markers and refuses to invent them, so they go in
by hand on the first run. In `f/index.html`, replace the whole `var COUNTRIES = [ ... ];`
declaration at line 497 (four lines plus the closing `];`) with:

```js
  // ---- BEGIN GENERATED phone data (tools/gen-phone-data.js) ----
  // ---- END GENERATED phone data ----
```

In `index.html`, replace `var COUNTRIES = [ ... ];` at line 4659 the same way. Leave
`COUNTRIES_ED` at 5801 alone for now: Task 5 deletes it, and deleting it here would break
`edPhone` before its replacement exists.

Note `flagUrl` in `f/index.html:503` and `edFlagUrl` in `index.html:5807` stay exactly as
they are. Flag codes are lowercased ISO2, which is what the new rows carry.

- [ ] **Step 5: Run the generator**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  tools/gen-phone-data.js
```

Expected output: two `wrote ... into ...` lines and a byte count of about 16274 and 10228. If
it prints `REFUSING TO WRITE`, read the reason: a missing name means `NAME_OVERRIDE` needs an
entry, and every other message names the country and field at fault.

- [ ] **Step 6: Run the test and watch it pass**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/phone-data.test.js
```

Expected: `13 passed` and no FAIL lines. The `COUNTRIES_ED` assertion inside "the old
four-country lists are gone" will still fail here, because Task 5 removes it. Split that
assertion out now rather than leaving a known-red test: move the `COUNTRIES_ED` line into its
own `t()` named `COUNTRIES_ED is gone (Task 5)` and leave it failing deliberately, or comment
it with a `// Task 5` note and add it there. Prefer the second: a suite that is red by design
teaches people to ignore red.

- [ ] **Step 7: Falsify the two tests that would pass vacuously**

A green first run proves nothing here. Prove these two actually bite:

1. Edit the page's `PHONE_ROWS` by hand, changing `JO~962~89` to `JO~962~9`, re-run the test,
   and confirm "the four house countries read as expected" FAILS. Undo by re-running the
   generator.
2. Edit `f/index.html`'s copy of `TZ_ISO`, deleting `Asia/Calcutta~IN;`, re-run, and confirm
   "both pages carry the same tables" FAILS. Re-run the generator to restore.

If either passes with the data broken, the test is reading something other than the page.

- [ ] **Step 8: Commit**

```bash
git add tools/gen-phone-data.js docs/tests/phone-data.test.js index.html f/index.html
git commit -m "feat: generate the world dial code and timezone tables into both pages

245 countries with their own dial code, valid lengths, example number and
number pattern, plus 541 IANA zones mapped to the country each is named
for. Generated from pinned libphonenumber-js and countries-and-timezones
rather than hand written, and asserted against the 197 country names the
country question already stores.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The shared lookup functions

**Files:**
- Modify: `index.html` (append to the block inserted in Task 1), `f/index.html` (same)
- Test: `docs/tests/phone-world.test.js`

**Interfaces:**
- Consumes: `PHONE_ROWS`, `TZ_ISO` from Task 1.
- Produces, identical in both pages:
  - `phoneTable()` returns the array of rows, each `{ iso, cc, len:[int], ph, pat, name, pri, flag }` where `flag` is the lowercased ISO2. Built once, cached.
  - `phoneRow(iso)` returns one row or `null`.
  - `phoneByDial(cc)` returns the primary row for a dial code (string or number, `+` tolerated) or `null`.
  - `phoneMenuRows()` returns `{ pinned: [rows], rest: [rows] }`, pinned being JO, LB, IQ, SY in that order and rest the other 241 sorted by name.
  - `phoneMatch(row, q)` returns true when the row matches a lowercased query by name, ISO2 or dial code.
  - `splitPhone(v)` returns `{ iso, row, local }` or `null`. Requires a leading `+`.
  - `phoneValid(row, digits)` returns true when the digit count is one the country uses and the digits match its pattern.
  - `phoneValidOnDial(row, digits)` returns true when `phoneValid` holds for any country sharing that row's dial code.
  - `tzIsoOf(zone)` returns an ISO2 or `null`.
  - `phoneRowForZone(zone)` returns a row, falling back to Jordan.

- [ ] **Step 1: Write the failing test**

Create `docs/tests/phone-world.test.js`:

```js
// The rules under the phone box, loaded from BOTH pages and asserted against each. The
// public form collects the number and the record panel edits it, and each page carries its
// own copy of the block, so a rule right on one and wrong on the other is a number that
// changes when somebody opens the record. That is not hypothetical: parsePhone used to fall
// back to Jordan for anything it could not read, so opening a UAE number and saving it wrote
// a Jordanian one.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('no fn ' + name + ' in ' + file);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function grabVar(js, name, file) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name + ' in ' + file);
  return m[0];
}
const FNS = ['phoneTable', 'phoneRow', 'phoneByDial', 'phoneMenuRows', 'phoneMatch',
             'splitPhone', 'phoneValid', 'phoneValidOnDial', 'tzIsoOf', 'phoneRowForZone'];
const VARS = ['PHONE_ROWS', 'TZ_ISO', 'PHONE_PINNED'];
function load(file) {
  const js = scripts(file);
  const body = VARS.map(v => grabVar(js, v, file)).join('\n') + '\n' +
               '  var PHONE_LIST = null, PHONE_BY_ISO = null, PHONE_BY_DIAL = null, TZ_MAP = null;\n' +
               FNS.map(n => grab(js, n, file)).join('\n');
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + body + '\nthis.API={' + FNS.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}
const A = load('index.html'), B = load('f/index.html');
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
// Every rule is asserted on both pages, so `each` is how the file is written.
const each = fn => { fn(A, 'index.html'); fn(B, 'f/index.html'); };

// ---- splitting a stored answer -------------------------------------------------------
t('a stored number splits into its country and its local part', () => {
  each((API, where) => {
    const jo = API.splitPhone('+962791234567');
    assert.strictEqual(jo.iso, 'JO', where);
    assert.strictEqual(jo.local, '791234567', where);
    const ae = API.splitPhone('+971501234567');
    assert.strictEqual(ae.iso, 'AE', where);
    assert.strictEqual(ae.local, '501234567', where);
  });
});
t('the longest dial code wins, so +1 is not read as +1 something', () => {
  each((API, where) => {
    // 962 begins with 9; several codes begin with 96. A short code matching first would read
    // a Jordanian number as Yemeni and hand back a local part with a digit missing.
    assert.strictEqual(API.splitPhone('+96791234567').iso, 'YE', where);
    assert.strictEqual(API.splitPhone('+962791234567').iso, 'JO', where);
  });
});
t('a shared dial code resolves to its primary country', () => {
  each((API, where) => {
    assert.strictEqual(API.splitPhone('+14165551234').iso, 'US', where);
    assert.strictEqual(API.splitPhone('+447911123456').iso, 'GB', where);
  });
});
t('an unsplittable value returns null rather than guessing at Jordan', () => {
  // This IS the corruption fix. Returning a Jordanian row for these is what wrote
  // +962971501234567 over a UAE number on save.
  each((API, where) => {
    assert.strictEqual(API.splitPhone('0791234567'), null, where);      // 33,795 legacy rows
    assert.strictEqual(API.splitPhone('791234567'), null, where);
    assert.strictEqual(API.splitPhone('+170123'), null, where);         // junk, ~100 rows
    assert.strictEqual(API.splitPhone(''), null, where);
    assert.strictEqual(API.splitPhone(null), null, where);
    assert.strictEqual(API.splitPhone(undefined), null, where);
  });
});
t('a number round trips for every one of the 245 countries', () => {
  each((API, where) => {
    API.phoneTable().forEach(r => {
      const back = API.splitPhone('+' + r.cc + r.ph);
      assert.ok(back, r.iso + ' does not split at all on ' + where);
      // A shared dial code legitimately resolves to its primary country, so compare the
      // number rather than the flag: the digits must survive, the flag is a guess.
      assert.strictEqual('+' + back.row.cc + back.local, '+' + r.cc + r.ph, r.iso + ' on ' + where);
    });
  });
});

// ---- per country validation ----------------------------------------------------------
t('every country accepts its own example number', () => {
  each((API, where) => {
    API.phoneTable().forEach(r => {
      assert.ok(API.phoneValid(r, r.ph), r.iso + ' rejects its own example on ' + where);
    });
  });
});
t('Jordan takes 8 or 9 digits now, and refuses nonsense of the right length', () => {
  each((API, where) => {
    const jo = API.phoneRow('JO');
    assert.ok(API.phoneValid(jo, '791234567'), 'a real mobile, ' + where);
    assert.ok(API.phoneValid(jo, '65001234'), 'an Amman landline, 8 digits, ' + where);
    assert.ok(!API.phoneValid(jo, '79123456'), 'one digit short must fail, ' + where);
    // Length alone would accept this. It is the pattern that refuses it, which is the whole
    // reason the pattern is in the table.
    assert.ok(!API.phoneValid(jo, '999999999'), '999999999 must fail, ' + where);
  });
});
t('a country with a wide length set is still validated', () => {
  each((API, where) => {
    // The UAE accepts 5 to 12 digits and Germany 4 to 15, so for 29 countries a length rule
    // is barely a rule.
    assert.ok(API.phoneValid(API.phoneRow('AE'), '501234567'), where);
    assert.ok(!API.phoneValid(API.phoneRow('AE'), '111111111'), where);
  });
});
t('an empty or absent number is not valid on its own', () => {
  each((API, where) => {
    assert.strictEqual(API.phoneValid(API.phoneRow('JO'), ''), false, where);
    assert.strictEqual(API.phoneValid(null, '791234567'), false, where);
  });
});
t('a shared dial code accepts a number valid for any country on it', () => {
  each((API, where) => {
    // Somebody who picked the United States and typed a Canadian number has not made a
    // mistake worth refusing a submission over.
    assert.ok(API.phoneValidOnDial(API.phoneRow('US'), '4165551234'), where);
    assert.ok(!API.phoneValidOnDial(API.phoneRow('US'), '1234'), where);
  });
});

// ---- the zone map --------------------------------------------------------------------
t('a zone resolves to the country it is named for', () => {
  each((API, where) => {
    assert.strictEqual(API.tzIsoOf('Asia/Amman'), 'JO', where);
    assert.strictEqual(API.tzIsoOf('Asia/Dubai'), 'AE', where);
    assert.strictEqual(API.tzIsoOf('Africa/Abidjan'), 'CI', where);
    assert.strictEqual(API.tzIsoOf('Asia/Calcutta'), 'IN', where);
  });
});
t('an unknown zone, and a browser that will not say, both fall back to Jordan', () => {
  each((API, where) => {
    // A hardened browser reports UTC and a research station reports Antarctica/Troll. Both
    // are non-answers, and today's behaviour for everybody is Jordan, so that is what a
    // non-answer must produce: no change, no note, nothing to correct.
    assert.strictEqual(API.tzIsoOf('UTC'), null, where);
    assert.strictEqual(API.phoneRowForZone('UTC').iso, 'JO', where);
    assert.strictEqual(API.phoneRowForZone('Not/AZone').iso, 'JO', where);
    assert.strictEqual(API.phoneRowForZone(null).iso, 'JO', where);
    assert.strictEqual(API.phoneRowForZone('').iso, 'JO', where);
  });
});
t('a zone whose country has no dial code falls back too', () => {
  each((API, where) => {
    // AQ, GS, TF, UM and PN are in the zone map and not in libphonenumber.
    assert.strictEqual(API.phoneRowForZone('Antarctica/McMurdo').iso, 'JO', where);
  });
});
t('a real foreign zone lands on the right dial code', () => {
  each((API, where) => {
    assert.strictEqual(API.phoneRowForZone('Europe/Berlin').cc, '49', where);
    assert.strictEqual(API.phoneRowForZone('Asia/Dubai').cc, '971', where);
    assert.strictEqual(API.phoneRowForZone('Asia/Beirut').cc, '961', where);
  });
});

// ---- the menu ------------------------------------------------------------------------
t('the four house countries are pinned first, the rest sorted by name', () => {
  each((API, where) => {
    const m = API.phoneMenuRows();
    assert.deepStrictEqual(m.pinned.map(r => r.iso), ['JO', 'LB', 'IQ', 'SY'], where);
    assert.strictEqual(m.pinned.length + m.rest.length, 245, where);
    assert.ok(m.rest.every(r => ['JO', 'LB', 'IQ', 'SY'].indexOf(r.iso) === -1), 'a pinned country is also in the rest, ' + where);
    const names = m.rest.map(r => r.name);
    assert.deepStrictEqual(names, names.slice().sort(), 'the rest is not sorted by name, ' + where);
  });
});
t('search finds a country by name, code or dial, with or without a plus', () => {
  each((API, where) => {
    const de = API.phoneRow('DE');
    assert.ok(API.phoneMatch(de, 'ger'), 'by name, ' + where);
    assert.ok(API.phoneMatch(de, 'germany'), where);
    assert.ok(API.phoneMatch(de, 'de'), 'by iso, ' + where);
    assert.ok(API.phoneMatch(de, '49'), 'by dial, ' + where);
    assert.ok(API.phoneMatch(de, '+49'), 'by dial with a plus, ' + where);
    assert.ok(API.phoneMatch(de, ''), 'an empty query matches everything, ' + where);
    assert.ok(!API.phoneMatch(de, 'jordan'), where);
    assert.ok(!API.phoneMatch(de, '962'), where);
  });
});

// ---- one block, two pages ------------------------------------------------------------
t('the shared block is character for character identical in both pages', () => {
  // The stronger claim, and the one that catches a rule nobody thought to test being right
  // on one page and wrong on the other.
  const a = scripts('index.html'), b = scripts('f/index.html');
  const cut = js => {
    const from = js.indexOf('// ---- BEGIN GENERATED phone data');
    const to = js.indexOf('// ---- END SHARED phone helpers');
    assert.ok(from !== -1 && to !== -1 && to > from, 'the block markers are missing');
    return js.slice(from, to);
  };
  assert.strictEqual(cut(a), cut(b), 'the phone block differs between index.html and f/index.html');
});

console.log(n + ' passed');
```

- [ ] **Step 2: Run it and watch it fail**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/phone-world.test.js
```

Expected: throws `no fn phoneTable in index.html`.

- [ ] **Step 3: Write the helpers into both pages**

Insert this immediately after the `END GENERATED phone data` marker, in **both** pages,
character for character the same. Note the closing marker: the parity test slices from
`BEGIN GENERATED phone data` to `END SHARED phone helpers`, so both must be present.

```js
  // ---- BEGIN SHARED phone helpers (identical in index.html and f/index.html) ----
  // The packed tables above, read into objects once. Kept packed in the page because 245
  // objects written longhand is 60 KB of source, and because a single string is what the
  // parity test can compare between the two pages.
  var PHONE_LIST = null, PHONE_BY_ISO = null, PHONE_BY_DIAL = null, TZ_MAP = null;
  // The four the traffic is in. Pinned at the top of the picker, and the fallback for a
  // device that will not say where it is.
  var PHONE_PINNED = ["JO", "LB", "IQ", "SY"];
  function phoneTable() {
    if (PHONE_LIST) return PHONE_LIST;
    PHONE_LIST = []; PHONE_BY_ISO = {}; PHONE_BY_DIAL = {};
    PHONE_ROWS.split(";").forEach(function (r) {
      var p = r.split("~");
      var row = { iso: p[0], cc: p[1], ph: p[3], pat: p[4], name: p[5], pri: p[6] === "1",
                  flag: p[0].toLowerCase(),
                  len: p[2].split("").map(function (ch) { return parseInt(ch, 36); }) };
      PHONE_LIST.push(row);
      PHONE_BY_ISO[row.iso] = row;
      (PHONE_BY_DIAL[row.cc] = PHONE_BY_DIAL[row.cc] || []).push(row);
    });
    return PHONE_LIST;
  }
  function phoneRow(iso) { phoneTable(); return PHONE_BY_ISO[iso] || null; }
  // The primary country of a dial code. Twelve codes are shared, +1 by 25 countries, so
  // without this the flag beside an American number is Antigua's.
  function phoneByDial(cc) {
    phoneTable();
    var rows = PHONE_BY_DIAL[String(cc == null ? "" : cc).replace(/[^0-9]/g, "")] || [];
    for (var i = 0; i < rows.length; i++) { if (rows[i].pri) return rows[i]; }
    return rows[0] || null;
  }
  function phoneMenuRows() {
    var all = phoneTable(), pinned = [];
    PHONE_PINNED.forEach(function (iso) { if (PHONE_BY_ISO[iso]) pinned.push(PHONE_BY_ISO[iso]); });
    var rest = all.filter(function (r) { return PHONE_PINNED.indexOf(r.iso) === -1; })
      .sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    return { pinned: pinned, rest: rest };
  }
  // Matches a country by name, by ISO2 code, or by dial code with or without a leading plus,
  // so "ger", "de", "49" and "+49" all find Germany. `q` arrives lowercased and trimmed.
  function phoneMatch(r, q) {
    if (!q) return true;
    if (r.name.toLowerCase().indexOf(q) !== -1) return true;
    if (r.iso.toLowerCase() === q) return true;
    var d = q.charAt(0) === "+" ? q.slice(1) : q;
    return !!d && /^[0-9]+$/.test(d) && r.cc.indexOf(d) === 0;
  }
  // A stored answer is one string ("+962791234567"); the row shows it as a country and a
  // local number. Longest dial code first, so a code beginning with another's cannot be read
  // as the wrong one, and a tie on length goes to the primary country.
  //
  // Returns null when the value cannot be split, and that is the point of the function: the
  // caller must then leave the value ALONE. Guessing at Jordan here is what rewrote 600
  // foreign numbers and 33,795 legacy local ones on save.
  function splitPhone(v) {
    var s = String(v == null ? "" : v).replace(/[^\d+]/g, "");
    if (s.charAt(0) !== "+") return null;
    var d = s.slice(1), best = null;
    phoneTable().forEach(function (r) {
      if (d.indexOf(r.cc) !== 0) return;
      if (!best || r.cc.length > best.cc.length || (r.cc.length === best.cc.length && r.pri && !best.pri)) best = r;
    });
    if (!best) return null;
    return { iso: best.iso, row: best, local: d.slice(best.cc.length) };
  }
  // Per country, not one rule for everybody: the digit count must be one the country uses AND
  // the digits must match the country's own pattern. Length alone is no rule at all for the
  // 29 countries whose sets span six or more values, and for Jordan it would accept
  // 999999999.
  function phoneValid(row, digits) {
    if (!row || !digits) return false;
    if (row.len.indexOf(digits.length) === -1) return false;
    if (!row.pat) return true;
    return new RegExp("^(?:" + row.pat + ")$").test(digits);
  }
  // Somebody who picked the United States and typed a Canadian number has not made a mistake
  // worth losing a submission over: 12 dial codes are shared, so any country on the code will
  // do. The number stores identically either way; only the flag was ever a guess.
  function phoneValidOnDial(row, digits) {
    if (!row) return false;
    phoneTable();
    var rows = PHONE_BY_DIAL[row.cc] || [row];
    for (var i = 0; i < rows.length; i++) { if (phoneValid(rows[i], digits)) return true; }
    return false;
  }
  function tzIsoOf(zone) {
    if (!TZ_MAP) {
      TZ_MAP = {};
      TZ_ISO.split(";").forEach(function (p) {
        var i = p.indexOf("~");
        TZ_MAP[p.slice(0, i)] = p.slice(i + 1);
      });
    }
    return zone ? (TZ_MAP[zone] || null) : null;
  }
  // The country the device implies. Falls back to Jordan for a zone the map does not know, a
  // zone with no country (Etc/UTC, Antarctica, and a hardened browser reporting UTC), and the
  // five territories with a zone and no dial code. That fallback is today's behaviour for
  // everybody, so a non-answer changes nothing and is announced to nobody.
  function phoneRowForZone(zone) {
    phoneTable();
    var iso = tzIsoOf(zone);
    return (iso && PHONE_BY_ISO[iso]) || PHONE_BY_ISO.JO;
  }
  // ---- END SHARED phone helpers ----
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/phone-world.test.js
```

Expected: `16 passed`, no FAIL lines. Nothing calls these functions yet, so the pages behave
exactly as before; the public form still has its old `splitPhone` further down, which now
shadows nothing because Task 3 deletes it. If `f/index.html` reports a duplicate declaration
of `splitPhone`, delete the old one at line 624 now rather than in Task 3.

- [ ] **Step 5: Falsify the parity test**

Add a single space inside the helper block in `f/index.html` only, re-run, and confirm "the
shared block is character for character identical" FAILS. Remove the space. A parity test
that cannot see a one-character difference is not pinning anything.

- [ ] **Step 6: Commit**

```bash
git add docs/tests/phone-world.test.js index.html f/index.html
git commit -m "feat: shared phone lookups over the world dial table

splitPhone now returns null instead of guessing at Jordan when it cannot
read a value, which is the corruption fix the record editor needs, and
validation is per country: the digit count the country uses and the
country's own pattern. Asserted from both pages and compared character
for character between them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The searchable picker on the public form

**Files:**
- Modify: `f/index.html` CSS (154 to 167), the `phone` branch (2294 to 2311), delete the old `splitPhone` (624 to 634) if Task 2 left it
- Test: `docs/tests/phone-picker.chrome.js` (first half; the pre-fill half arrives in Task 4)

**Interfaces:**
- Consumes: `phoneMenuRows`, `phoneMatch`, `phoneRow`, `phoneValidOnDial`, `splitPhone`, `flagUrl`.
- Produces: the phone control object, now carrying `wrap` and two hooks the pre-fill in Task 4
  needs, because the picker settles a choice in code and fires no DOM event:
  - `ccSet(row)` applies a country as a guess and appends the note
  - `ccIso()` returns the currently selected ISO2

- [ ] **Step 1: Replace the CSS**

In `f/index.html`, replace the `.cc-menu` and `.cc-menu li` rules (lines 162 to 167) with the
block below. `.cc-menu` stops being the `<ul>` and becomes the panel around the search box and
the list. Literal rgba matches this file's existing convention; `index.html` gets the token
form in Task 5.

```css
  .cc-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; padding: 6px; min-width: 270px;
    background: var(--card); border: 1px solid var(--line); border-radius: 10px; display: none;
    box-shadow: 0 12px 32px rgba(0,0,0,0.45); }
  .cc-menu.open { display: block; }
  /* Flipped above the button when the field is near the bottom of a long form, which on a
     phone is where a phone question usually is. */
  .cc-menu.up { top: auto; bottom: calc(100% + 6px); }
  .cc-search { width: 100%; box-sizing: border-box; margin-bottom: 6px; }
  /* Capped, because the list is 245 long. The search box is what makes that usable, and the
     scroll is only there for people who would rather look than type. */
  .cc-list { margin: 0; padding: 0; list-style: none; max-height: 264px; overflow-y: auto; }
  .cc-list li { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; cursor: pointer; }
  .cc-list li:hover, .cc-list li.hi { background: rgba(255,255,255,0.06); }
  .cc-list li b { margin-left: auto; color: var(--muted); font-weight: 600; }
  /* The four we actually serve, held above the other 241. */
  .cc-list li.pin-last { border-bottom: 1px solid var(--line); margin-bottom: 6px; padding-bottom: 12px; }
  .cc-empty { padding: 10px 12px; color: var(--muted); }
```

Check the variable names against the file before saving: this page uses `--card`, `--line` and
`--muted` in its existing rules. If any is absent, use the neighbouring rule's variable rather
than inventing one.

- [ ] **Step 2: Write the failing Chrome test**

Create `docs/tests/phone-picker.chrome.js`. The launch, stub and teardown mechanics are
`country-prefill.chrome.js`'s, including its skip when no browser is installed:

```js
// The picker driven in a real browser, because "the function returns the right row" was never
// what was broken. What was broken was that a picker of four could not represent the number
// somebody was typing, and there was no way to look for theirs.
//
// The value is read by pressing the real Submit button and catching the RPC payload, not by
// reading the input: the answer is composed from the picker and the local box together, and
// the composition is the part that can be wrong. An invalid number never reaches the RPC at
// all, so the same hook tests validation.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/phone-picker.chrome.js
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log('SKIPPED: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run this file.');
  process.exit(0);
}

const PAGE = fs.readFileSync('f/index.html', 'utf8');
const CDN = /<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/;
if (!CDN.test(PAGE)) throw new Error('could not find the Supabase CDN script tag to stub');

const P_ID = 'q-phone';
const COUNTRY_ROWS = [
  { code: 'jo', name_en: 'Jordan', name_ar: 'الأردن', timezones: ['Asia/Amman'] },
  { code: 'lebanon', name_en: 'Lebanon', name_ar: 'لبنان', timezones: ['Asia/Beirut'] }
];

// `zone` is the timezone the page will believe it is in. Chrome on Windows ignores the TZ
// environment variable and reports the OS zone regardless, measured, so the only way to test
// a device outside Amman is to replace Intl before the page's own script runs. The stub takes
// the CDN script tag's place, which is line 246 of the page, above everything that reads a
// zone. Passing null leaves Intl alone, which on this machine means Asia/Amman.
function build(zone, fieldOpts) {
  const fields = [
    { id: P_ID, position: 0, label: 'Phone Number', type: 'phone', required: true, internal: false, options: fieldOpts || {} },
    { id: 'q-what', position: 1, label: 'Your Complaint', type: 'long_text', required: false, internal: false }
  ];
  const tz = zone ? `
  (function () {
    var real = Intl.DateTimeFormat;
    function Fake() {
      var f = real.apply(this, arguments);
      var ro = f.resolvedOptions.bind(f);
      f.resolvedOptions = function () { var o = ro(); o.timeZone = ${JSON.stringify(zone)}; return o; };
      return f;
    }
    Fake.supportedLocalesOf = real.supportedLocalesOf;
    Intl.DateTimeFormat = Fake;
  })();` : '';
  const stub = `<script>${tz}
  try { window.localStorage.removeItem('blk_draft_phone-test'); } catch (e) {}
  window.__err = null; window.__sent = null;
  window.onerror = function (m, u, l) { window.__err = m + ' (line ' + l + ')'; };
  var TABLE = { id: 't-ph', name: 'Phone test', name_ar: '', slug: 'phone-test',
                is_active: true, kind: 'form', config_public: {} };
  function rowsFor(t) {
    if (t === 'app_tables') return TABLE;
    if (t === 'app_fields') return ${JSON.stringify(fields)};
    if (t === 'branches') return [];
    if (t === 'countries') return ${JSON.stringify(COUNTRY_ROWS)};
    return [];
  }
  function builder(t) {
    var o = {}, res = { data: rowsFor(t), error: null };
    ['select','eq','order','limit','in','is','neq'].forEach(function (m) { o[m] = function () { return o; }; });
    o.single = function () { return Promise.resolve(res); };
    o.then = function (f, r) { return Promise.resolve(res).then(f, r); };
    o.catch = function (f) { return Promise.resolve(res).catch(f); };
    return o;
  }
  window.supabase = { createClient: function () {
    return { from: builder,
             rpc: function (name, args) {
               // What the form WOULD store. Captured rather than sent, so the assertions read
               // the composed answer instead of recomputing it.
               if (name === 'submit_public_form') window.__sent = args;
               return Promise.resolve({ data: { ok: true }, error: null });
             },
             storage: { from: function () { return { upload: function () { return Promise.resolve({}); } }; } } };
  } };
<\/script>`;
  return PAGE.replace(CDN, stub);
}

const DRIVER = `<pre id="out">pending</pre>
<script>
  var out = [], pass = 0, fail = 0;
  function t(name, fn) {
    try { var why = fn(); if (why) { fail++; out.push('FAIL ' + name + ' -> ' + why); } else pass++; }
    catch (e) { fail++; out.push('FAIL ' + name + ' -> threw ' + e.message); }
  }
  // An assertion that has to wait. The submit path builds its payload inside a .then, after
  // the upload promises settle, so anything reading window.__sent straight after the click
  // reads null and every value assertion would pass by accident.
  var chain = Promise.resolve();
  function ta(name, fn) {
    chain = chain.then(function () {
      return Promise.resolve().then(fn).then(function (why) {
        if (why) { fail++; out.push('FAIL ' + name + ' -> ' + why); } else pass++;
      }, function (e) { fail++; out.push('FAIL ' + name + ' -> threw ' + e.message); });
    });
    return chain;
  }
  function row() { return document.querySelector('.phone-row'); }
  function q(sel) { return row().querySelector(sel); }
  function local() { return document.getElementById('fld-${P_ID}'); }
  function dial() { return q('.cc-dial').textContent.trim(); }
  function isOpen() { return q('.cc-menu').classList.contains('open'); }
  function rows() { return [].slice.call(row().querySelectorAll('.cc-list li')); }
  function labels() { return rows().map(function (li) { return li.textContent.replace(/\\s+/g, ' ').trim(); }); }
  function open() { q('.cc-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  function type(v) { var s = q('.cc-search'); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); }
  function key(k) { q('.cc-search').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
  // mousedown, not click: the list settles a choice on mousedown so that dragging off a row
  // does not select it. A dispatched click picks nothing and reads as a broken picker.
  function pickNth(i) { rows()[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
  function typeNumber(v) { var el = local(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  // Given an id by prefillPhone in Task 4, the way the country question's note is
  // country-guess-note. Absent until then, which is correct: this run does not pre-fill.
  function note() { return document.getElementById('phone-guess-note'); }
  // Presses the real Submit button and returns what the form WOULD store, or null when the
  // number was refused and the submit never reached the RPC. Resolves either way, so a
  // refusal is an assertable outcome rather than a hang.
  function submitted() {
    window.__sent = null;
    document.getElementById('submit-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return new Promise(function (res) {
      var give = Date.now() + 2000;
      (function poll() {
        if (window.__sent && window.__sent.p_data) return res(window.__sent.p_data['${P_ID}']);
        if (Date.now() > give) return res(null);
        setTimeout(poll, 20);
      })();
    });
  }
  var deadline = Date.now() + 5000;
  (function wait() {
    var ready = document.querySelector('.phone-row') && document.getElementById('fld-${P_ID}');
    if (!ready && Date.now() < deadline) return setTimeout(wait, 40);
    function finish() {
      out.push('RESULT ' + pass + ' passed, ' + fail + ' failed');
      document.getElementById('out').textContent = out.join('\\n');
    }
    var p;
    try { p = window.CHECKS(); } catch (e) { fail++; out.push('FAIL driver threw ' + e.message); }
    // CHECKS returns the async chain when it has one, so the results are not printed before
    // the submits have been answered. --virtual-time-budget gives them room.
    Promise.resolve(p).then(finish, function (e) {
      fail++; out.push('FAIL driver threw ' + e.message); finish();
    });
  })();
<\/script>`;

function run(html, checks, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-ph-'));
  const file = path.join(dir, 'index.html');
  const page = html.replace('</body>',
    '<script>window.CHECKS = function () {' + checks + '};<\/script>' + DRIVER + '</body>');
  if (page.indexOf('id="out"') === -1) throw new Error('driver was not appended');
  fs.writeFileSync(file, page);
  const r = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files',
    '--virtual-time-budget=9000', '--dump-dom',
    'file:///' + file.replace(/\\/g, '/') + '?t=phone-test'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const block = ((r.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/) || [])[1];
  if (block === undefined) {
    console.log('FAILED (' + name + '): no results. Chrome said:\n' + (r.stderr || '').slice(0, 1500));
    process.exitCode = 1;
  } else {
    const lines = block.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
    lines.filter(l => l.startsWith('FAIL')).forEach(l => console.log('  ' + l));
    const res = lines.filter(l => l.startsWith('RESULT'))[0] || 'RESULT missing (page never finished)';
    console.log(res.replace('RESULT ', '') + '  (' + name + ')');
    if (!/ 0 failed/.test(res)) process.exitCode = 1;
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

// ---- 1. searching 245 countries ----
run(build(null), `
  t('the page did not throw', function () { if (window.__err) return window.__err; });
  t('it opens on Jordan, showing the Jordanian example number as the placeholder', function () {
    if (dial() !== '+962') return 'the button reads ' + dial();
    if (local().placeholder !== '790123456') return 'placeholder is ' + JSON.stringify(local().placeholder);
  });
  t('the picker opens with every country in it', function () {
    open();
    if (!isOpen()) return 'the menu did not open';
    if (rows().length !== 245) return 'the list has ' + rows().length + ' rows, expected 245';
  });
  t('the four we serve are held above the other 241', function () {
    var l = labels();
    if (!/^Jordan/.test(l[0]) || !/^Lebanon/.test(l[1]) || !/^Iraq/.test(l[2]) || !/^Syria/.test(l[3]))
      return 'the first four are ' + l.slice(0, 4).join(' | ');
    if (!rows()[3].classList.contains('pin-last')) return 'the divider is not after the fourth row';
  });
  t('typing a name finds it, and Enter picks it', function () {
    type('ger');
    var l = labels();
    if (l.length !== 1 || l[0].indexOf('Germany') !== 0) return 'searching "ger" gave ' + l.join(' | ');
    key('Enter');
    if (isOpen()) return 'the menu stayed open after Enter';
    if (dial() !== '+49') return 'the button reads ' + dial();
    if (local().placeholder !== '15123456789') return 'the placeholder is still ' + JSON.stringify(local().placeholder);
  });
  t('typing a dial code finds it too, with or without a plus', function () {
    open(); type('49');
    if (!labels().some(function (x) { return x.indexOf('Germany') === 0; })) return '"49" did not find Germany';
    type('+49');
    if (!labels().some(function (x) { return x.indexOf('Germany') === 0; })) return '"+49" did not find Germany';
    type('de');
    if (labels().length !== 1 || labels()[0].indexOf('Germany') !== 0) return '"de" gave ' + labels().join(' | ');
  });
  t('a search with no matches says so and offers nothing', function () {
    type('zzzz');
    if (rows().length !== 0) return 'still showing ' + rows().length + ' rows';
    if (q('.cc-empty').hidden) return 'the No matches line is hidden';
  });
  t('the arrow keys move the highlight and Enter takes it', function () {
    type(''); key('ArrowDown'); key('ArrowDown');
    var hi = labels()[1];
    key('Enter');
    // Second row of the unfiltered list is Lebanon, so this proves Enter took the HIGHLIGHT
    // and not simply the first row.
    if (dial() !== '+961') return 'picked ' + dial() + ' after highlighting ' + hi;
  });
  t('Escape closes the menu and changes nothing', function () {
    open(); type('ger'); key('Escape');
    if (isOpen()) return 'the menu is still open';
    if (dial() !== '+961') return 'the country changed to ' + dial();
  });
  ta('a number is composed from the picker and the box together', async function () {
    open(); type('jordan'); pickNth(0);
    typeNumber('0791234567');
    var v = await submitted();
    // The leading zero is still stripped, which is the fix for the commonest entry mistake
    // here.
    if (v !== '+962791234567') return 'submitted ' + JSON.stringify(v);
  });
  ta('an Amman landline is accepted now, and nonsense of the right length is not', async function () {
    typeNumber('65001234');
    var landline = await submitted();
    if (landline !== '+96265001234') return '8 digit landline was refused, got ' + JSON.stringify(landline);
    typeNumber('999999999');
    var junk = await submitted();
    if (junk !== null) return '999999999 was accepted as ' + JSON.stringify(junk);
    typeNumber('79123456');
    var short = await submitted();
    if (short !== null) return 'a number one digit short was accepted as ' + JSON.stringify(short);
  });
  return ta('validation is the chosen country rule, not one rule for everybody', async function () {
    open(); type('ger'); key('Enter');
    typeNumber('15123456789');
    var de = await submitted();
    if (de !== '+4915123456789') return 'a real German number was refused';
    // A Jordanian mobile is not a German number. Under one generic length rule this would
    // pass, which is the whole reason the pattern is in the table.
    typeNumber('791234567');
    var wrong = await submitted();
    if (wrong !== null) return 'a Jordanian number was accepted as German: ' + JSON.stringify(wrong);
  });
`, 'search and per-country validation');
```

Two things about that file worth not rediscovering. The checks are passed in as a **string**
inside a template literal, so an apostrophe in a test name ends the string early: the names
above are worded around it, and any new one should be too. And the assertions that submit are
`ta`, not `t`, because the payload is built inside a `.then` after the upload promises settle;
`CHECKS` returns the chain so the results are not printed before the submits are answered.

- [ ] **Step 3: Run it and watch it fail**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/phone-picker.chrome.js
```

Expected: fails at assertion 2, no search box in the panel. If it skips, Chrome was not found
at `C:/Program Files/Google/Chrome/Application/chrome.exe`; find it before continuing, because
this is the only test in the plan that sees what a person sees.

- [ ] **Step 4: Rewrite the phone branch**

Replace the whole `} else if (f.type === "phone") {` branch in `f/index.html` (2294 to 2311)
with:

```js
    } else if (f.type === "phone") {
      var row = document.createElement("div"); row.className = "phone-row";
      row.innerHTML = '<div class="cc-picker">' +
        '<button type="button" class="cc-btn" aria-haspopup="listbox"><img class="cc-flag" alt=""><span class="cc-dial"></span><span class="cc-caret">▾</span></button>' +
        '<div class="cc-menu"><input type="text" class="cc-search" placeholder="Search country or code… / ابحث" autocomplete="off">' +
        '<ul class="cc-list" role="listbox"></ul><div class="cc-empty" hidden>No matches / لا نتائج</div></div>' +
        '</div><input type="tel" inputmode="numeric" id="' + id + '">';
      wrap.appendChild(row);
      var hint = document.createElement("div"); hint.className = "hint"; hint.textContent = "We may contact you on WhatsApp."; wrap.appendChild(hint);
      var btn = row.querySelector(".cc-btn"), menu = row.querySelector(".cc-menu"),
          flag = row.querySelector(".cc-flag"), dial = row.querySelector(".cc-dial"),
          picker = row.querySelector(".cc-picker"), local = row.querySelector("input[type=tel]"),
          search = row.querySelector(".cc-search"), list = row.querySelector(".cc-list"),
          empty = row.querySelector(".cc-empty");
      var sc = phoneRow("JO"), shown = [], hi = -1, noteEl = null;
      // The placeholder is the country's own example number, so a German picker stops showing
      // a Jordanian shape. maxLength is the longest the country allows, plus one so a person
      // who types one digit too many sees it rather than having it swallowed.
      function apply(r) {
        sc = r || phoneRow("JO");
        flag.src = flagUrl(sc.flag); flag.alt = sc.name;
        dial.textContent = "+" + sc.cc;
        local.placeholder = sc.ph;
        local.maxLength = Math.max.apply(null, sc.len) + 1;
      }
      function render() {
        var q = search.value.trim().toLowerCase();
        var m = phoneMenuRows();
        // Unfiltered, the four we serve sit above the other 241. Filtered, there is one list:
        // somebody who typed "ger" is not looking for Jordan.
        shown = q ? m.pinned.concat(m.rest).filter(function (r) { return phoneMatch(r, q); })
                  : m.pinned.concat(m.rest);
        var pinCount = q ? 0 : m.pinned.length;
        empty.hidden = shown.length > 0;
        list.innerHTML = shown.map(function (r, i) {
          return '<li role="option" data-i="' + i + '"' +
            (i === hi ? ' class="hi"' : (pinCount && i === pinCount - 1 ? ' class="pin-last"' : '')) +
            '><img src="' + flagUrl(r.flag) + '" alt=""> <span>' + esc(r.name) + "</span> <b>+" + r.cc + "</b></li>";
        }).join("");
      }
      function openMenu() {
        hi = -1; search.value = ""; render();
        menu.classList.add("open");
        // Flipped up when the field is near the bottom of the page, which on a phone is where
        // a phone question usually is.
        var space = window.innerHeight - btn.getBoundingClientRect().bottom;
        menu.classList.toggle("up", space < menu.offsetHeight + 12);
        try { search.focus(); } catch (e) {}
      }
      function closeMenu() { menu.classList.remove("open"); menu.classList.remove("up"); }
      // A guess is withdrawn the moment the person makes a choice of their own, because the
      // note under the field is then simply untrue.
      function dropNote() { if (noteEl && noteEl.parentNode) noteEl.parentNode.removeChild(noteEl); noteEl = null; }
      function pick(r) { apply(r); dropNote(); closeMenu(); try { local.focus(); } catch (e) {} }
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (menu.classList.contains("open")) closeMenu(); else openMenu();
      });
      search.addEventListener("input", function () { hi = -1; render(); });
      search.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); hi = Math.min(hi + 1, shown.length - 1); render(); scrollHi(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); hi = Math.max(hi - 1, 0); render(); scrollHi(); }
        else if (e.key === "Enter") { e.preventDefault(); if (shown[hi >= 0 ? hi : 0]) pick(shown[hi >= 0 ? hi : 0]); }
        else if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
      });
      function scrollHi() { var el = list.querySelector("li.hi"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }
      // mousedown, not click: a person dragging off a row should not select it, and the
      // document-level close below fires on click.
      list.addEventListener("mousedown", function (e) {
        var li = e.target.closest ? e.target.closest("li") : null;
        if (!li) return;
        e.preventDefault();
        pick(shown[+li.getAttribute("data-i")]);
      });
      document.addEventListener("click", function (e) { if (!picker.contains(e.target)) closeMenu(); });
      local.addEventListener("input", function () { local.value = local.value.replace(/\D/g, ""); });
      apply(phoneRow("JO"));
      function digitsOf() { return local.value.replace(/\D/g, "").replace(/^0+/, ""); }
      controls.push({ f: f, el: local, wrap: wrap,
        validate: function () { var d = digitsOf(); return (!f.required && d === "") || phoneValidOnDial(sc, d); },
        value: function () { var d = digitsOf(); return d ? "+" + sc.cc + d : null; },
        setDraft: function (v) { var p = splitPhone(v); if (!p) return; apply(p.row); local.value = p.local; },
        // The pre-fill reaches the picker through these rather than through the DOM, because
        // settling a choice here fires no event a listener could hear.
        ccSet: function (r, note) { apply(r); if (note) { noteEl = note; wrap.appendChild(note); } },
        ccIso: function () { return sc.iso; } });
```

- [ ] **Step 5: Run both test files**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/phone-picker.chrome.js
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/form-draft.test.js
```

Expected: the picker test passes assertions 1 to 12; `form-draft.test.js` still passes,
because a phone question's answer must still survive a refresh. If the draft test fails, the
control's `setDraft` is the thing to look at: a field type with no working `setDraft` loses its
answer silently.

- [ ] **Step 6: Commit**

```bash
git add f/index.html docs/tests/phone-picker.chrome.js
git commit -m "feat: search the country code on a public form, over all 245 of them

The picker keeps its shape and gains a search box, a capped scrolling
list, and our four countries pinned above the other 241. Validation is
now the chosen country's own lengths and pattern, so an Amman landline
is accepted and 999999999 is not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The pre-fill and its note

**Files:**
- Modify: `f/index.html` (add `prefillPhone` beside `prefillCountry` at ~1999, call it at ~2536)
- Test: `docs/tests/phone-prefill.test.js` (create), `docs/tests/phone-picker.chrome.js` (extend)

**Interfaces:**
- Consumes: `phoneRowForZone`, `deviceZone` (already at `f/index.html:263`), the control's `ccSet` and `ccIso` from Task 3.
- Produces: `prefillPhoneRow(f, current, zone)`, the pure rule, and `prefillPhone()`, which does the DOM.

- [ ] **Step 1: Write the failing test**

Create `docs/tests/phone-prefill.test.js`:

```js
// Whether the guess is made, and whether it is allowed to overwrite anything. The DOM half is
// in phone-picker.chrome.js; this is the rule on its own, which is the half that can be got
// wrong in a way no screenshot shows.
//
// The zone is stubbed rather than read, deliberately: on a machine in Amman, hardcoding
// "Asia/Amman" passes every comparison in this file, so the only proof the zone is read at
// all is handing the page a different one.
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
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
const js = scripts('f/index.html');
const ctx = { console };
vm.createContext(ctx);
new vm.Script('(function(){' +
  [grabVar(js, 'PHONE_ROWS'), grabVar(js, 'TZ_ISO'), grabVar(js, 'PHONE_PINNED')].join('\n') +
  '\n  var PHONE_LIST = null, PHONE_BY_ISO = null, PHONE_BY_DIAL = null, TZ_MAP = null;\n' +
  ['phoneTable', 'phoneRow', 'phoneByDial', 'tzIsoOf', 'phoneRowForZone', 'prefillPhoneRow'].map(n => grab(js, n)).join('\n') +
  '\nthis.API={phoneRowForZone,prefillPhoneRow,phoneRow};}).call(this)').runInContext(ctx);
const API = ctx.API;
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const q = {};                                  // a phone question with no options
const optedOut = { options: { prefill: false } };

t('the device zone decides the country code', () => {
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Europe/Berlin').iso, 'DE');
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Asia/Dubai').iso, 'AE');
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Asia/Beirut').iso, 'LB');
});
t('an answer that already exists always wins', () => {
  // A restored draft is an answer. Putting the guess back over it is the one way this could
  // destroy real work, which is the same rule prefillCountryName states for the country box.
  assert.strictEqual(API.prefillPhoneRow(q, '+962791234567', 'Europe/Berlin'), null);
  assert.strictEqual(API.prefillPhoneRow(q, '+49123', 'Asia/Amman'), null);
});
t('a question can opt out', () => {
  // Opt OUT only: absent, or anything other than an explicit false, still pre-fills.
  assert.strictEqual(API.prefillPhoneRow(optedOut, '', 'Europe/Berlin'), null);
  assert.strictEqual(API.prefillPhoneRow({ options: { prefill: true } }, '', 'Europe/Berlin').iso, 'DE');
  assert.strictEqual(API.prefillPhoneRow({ options: {} }, '', 'Europe/Berlin').iso, 'DE');
});
t('a non-answer changes nothing and is announced to nobody', () => {
  // Jordan is what everybody gets today. Landing there is not a guess worth a note, whether
  // the device said Amman or said nothing at all.
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Asia/Amman'), null);
  assert.strictEqual(API.prefillPhoneRow(q, '', 'UTC'), null);
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Not/AZone'), null);
  assert.strictEqual(API.prefillPhoneRow(q, '', ''), null);
  assert.strictEqual(API.prefillPhoneRow(q, '', null), null);
});
console.log(n + ' passed');
```

- [ ] **Step 2: Run it and watch it fail**

Expected: throws `no fn prefillPhoneRow`.

- [ ] **Step 3: Write the rule and the DOM half**

Add immediately after `syncPrefillNote` in `f/index.html` (after line 2033):

```js
  // ---- The country code the device implies -----------------------------------------------
  // The country question has been pre-filled from the timezone since PR #146; this is the
  // same idea one field down, on the answer that actually gets dialled.
  //
  // Returns null for "leave it alone", which covers four cases worth separating: the question
  // already has an answer (a restored draft, or a correction), the question opted out, the
  // device said nothing usable, and the guess is Jordan anyway. The last one matters because
  // Jordan is what every form shows today, so landing there is not a guess and must not be
  // announced as one.
  function prefillPhoneRow(f, current, zone) {
    if (current) return null;
    if (f && f.options && f.options.prefill === false) return null;
    var r = phoneRowForZone(zone);
    return (r && r.iso !== "JO") ? r : null;
  }
  // A pre-filled answer gets accepted by default where an empty one forces a decision, so a
  // wrong guess here would store an unreachable number more confidently than an empty box
  // ever could. A Jordanian in Germany gets +49, types 0791234567, and it PASSES: nine digits
  // is inside Germany's length set and the digits match its pattern. So the page says out loud
  // that it guessed, and the four we serve stay pinned at the top of the picker so putting it
  // right is one tap.
  function prefillPhone() {
    var zone = deviceZone(), filled = [];
    controls.forEach(function (c) {
      if (!c.f || c.f.type !== "phone" || !c.ccSet) return;
      var r = prefillPhoneRow(c.f, c.value(), zone);
      if (!r) return;
      var note = document.createElement("div");
      note.className = "hint";
      note.id = "phone-guess-note";
      note.textContent = "Country code set from your location, change it if your number is from somewhere else. / تم تحديد رمز الدولة من موقعك، عدّله إذا كان رقمك من مكان آخر.";
      c.ccSet(r, note);
      // The picker refuses nothing, but read it back anyway: a note over a box that did not
      // change is worse than no note at all.
      if (c.ccIso() !== r.iso) { if (note.parentNode) note.parentNode.removeChild(note); return; }
      filled.push(r.iso);
    });
    return filled;
  }
```

Then call it beside the country pre-fill at line 2536:

```js
    var guessedCountry = prefillCountry();
    var guessedDials = prefillPhone();
```

Both run after `restoreAnswers` for the same reason: a restored answer wins.

- [ ] **Step 4: Run the test and watch it pass**

Expected: `4 passed`.

- [ ] **Step 5: Falsify it, by moving the machine**

This is the step that matters, and `build(zone)` from Task 3 already carries the Intl stub.
Append three more runs to `docs/tests/phone-picker.chrome.js`:

```js
// ---- 2. the guess, for a device that is not in Amman ----
// If this passes with the zone hardcoded, the test is worthless: the machine is in Amman, so
// "+962" would be right by accident. Europe/Berlin is a zone this machine is never in.
run(build('Europe/Berlin'), `
  t('the page did not throw', function () { if (window.__err) return window.__err; });
  t('the country code is the device zone, not Jordan', function () {
    if (dial() !== '+49') return 'the button reads ' + dial() + ', expected +49 for Europe/Berlin';
  });
  t('the placeholder came with it', function () {
    if (local().placeholder !== '15123456789') return 'placeholder is ' + JSON.stringify(local().placeholder);
  });
  t('the page says out loud that it guessed', function () {
    // A pre-filled answer is accepted by default where an empty one forces a decision, so an
    // unannounced guess turns a wrong code into a confidently stored unreachable number.
    if (!note()) return 'there is no note under the field';
    if (!/from your location/.test(note().textContent)) return 'the note reads ' + JSON.stringify(note().textContent);
  });
  t('correcting the guess withdraws the note', function () {
    open(); type('jordan'); pickNth(0);
    if (dial() !== '+962') return 'the country did not change, it reads ' + dial();
    if (note()) return 'the note is still there after the code was corrected';
  });
  return ta('a corrected number stores the country the person chose', async function () {
    typeNumber('791234567');
    var v = await submitted();
    if (v !== '+962791234567') return 'submitted ' + JSON.stringify(v);
  });
`, 'pre-filled from Europe/Berlin');

// ---- 3. a guess that is indistinguishable from the default is not announced ----
run(build('Asia/Amman'), `
  t('a device in Amman gets Jordan, and no note', function () {
    if (dial() !== '+962') return 'the button reads ' + dial();
    // Jordan is what every form shows today. Announcing it as a guess would put a note under
    // a field that did not change.
    if (note()) return 'a note was shown for a guess that changed nothing';
  });
`, 'Asia/Amman needs no note');

// ---- 4. a device that will not say, and a question that opted out ----
run(build('Etc/UTC'), `
  t('a hardened browser reporting UTC falls back to Jordan silently', function () {
    if (dial() !== '+962') return 'the button reads ' + dial();
    if (note()) return 'a non-answer was announced as a guess';
  });
`, 'UTC is a non-answer');

run(build('Europe/Berlin', { prefill: false }), `
  t('options.prefill false opts the question out', function () {
    if (dial() !== '+962') return 'the button reads ' + dial() + ' on a question that opted out';
    if (note()) return 'an opted-out question still showed a note';
  });
`, 'opted out of the guess');
```

Then prove the stub bites, which is the whole point of this step: comment out the
`prefillPhone()` call added in Step 3, re-run, and confirm run 2 FAILS with "the button reads
+962, expected +49 for Europe/Berlin". Restore the call. If run 2 passes without the call
site, the Intl stub is not reaching the page and nothing here is being tested.

- [ ] **Step 6: Commit**

```bash
git add f/index.html docs/tests/phone-prefill.test.js docs/tests/phone-picker.chrome.js
git commit -m "feat: pre-fill the country code from the device timezone

Same rule as the country question one field up: the guess never
overwrites an existing answer, options.prefill false opts a question
out, and a device that says nothing usable lands on Jordan, which is
what every form shows today. A guess says so under the field and
withdraws the note as soon as it is corrected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The record editor, and the corruption fix

**Files:**
- Modify: `index.html` CSS (864 to 873, mobile clamp at ~1922), `phoneCountry` (4665), delete `COUNTRIES_ED` (5801 to 5806), rewrite `parsePhone` (5809), `edPhone` (5814), `wireEdPhone` (5821), adapt `countryFlag` (~8120)
- Test: `docs/tests/phone-editor.chrome.js` (create), `docs/tests/phone-data.test.js` (re-enable the `COUNTRIES_ED` assertion)

**Interfaces:**
- Consumes: the shared block from Task 2.
- Produces: `parsePhone(value)` returning `{ row, local }` for a value it can read and `null` otherwise; `edPhoneReg[id]()` returning the original string for an untouched unparsed value.

- [ ] **Step 1: Write the failing test**

Create `docs/tests/phone-editor.chrome.js`. It lifts the real builders and the real `edValues`
into a synthetic page exactly as `date-keeps-time.chrome.js` does, because that file exists for
this same failure shape: every function returned something sensible while the save quietly
destroyed the answer.

```js
// What a save WOULD write, for a phone answer the panel cannot parse.
//
// The bug: parsePhone fell back to { idx: 0 } for any value not starting with 962, 961, 963 or
// 964, so a record holding +971501234567 opened showing a Jordanian flag beside
// 971501234567, and saving wrote +962971501234567. About 600 stored answers carry a code the
// old list could not represent and 33,795 are legacy local numbers, so this was reachable on
// a third of the phone answers in the database.
//
// The real edPhone builds the row, the real wireEdPhone wires it, and the real edValues reads
// it back, because what is on test is the three of them together.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/phone-editor.chrome.js
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) {
  console.log('SKIPPED: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run this file.');
  process.exit(0);
}

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const style = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1];

// The generated tables plus the shared lookups, lifted as one slab rather than function by
// function: they are written to be one block and the parity test pins them as one.
const A = js.indexOf('  // ---- BEGIN GENERATED phone data');
const B = js.indexOf('  // ---- END SHARED phone helpers');
if (A === -1 || B === -1 || B < A) throw new Error('could not find the phone block in index.html');
const block = js.slice(A, B);

function grab(name) {
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
const esc = grab('esc'), edFlagUrl = grab('edFlagUrl'), edPhone = grab('edPhone'),
      wireEdPhone = grab('wireEdPhone'), edValues = grab('edValues'), placeMenuInView = grab('placeMenuInView');

// One field per stored shape that exists in the database.
const FIELDS = [
  { id: 'jo', label: 'a number we can read', type: 'phone', stored: '+962791234567' },
  { id: 'ae', label: 'a foreign number we could not read before', type: 'phone', stored: '+971501234567' },
  { id: 'junk', label: 'a code that is not a country', type: 'phone', stored: '+170123' },
  { id: 'legacy', label: 'a legacy local number', type: 'phone', stored: '0791234567' },
  { id: 'blank', label: 'no answer at all', type: 'phone', stored: '' }
];

const page = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="host"></div><pre id="out"></pre>
<script>
var out = [], pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push('ok ' + name); }
  else { fail++; out.push('FAIL ' + name + (extra === undefined ? '' : ' -> ' + extra)); }
}
${esc}
${block}
${edFlagUrl}
${placeMenuInView}
var edPhoneReg = {};
${edPhone}
${wireEdPhone}
// edValues' other branches are not on test here; these keep it honest and unchanged.
function isFileField(f) { return false; }
function isScorerField(f) { return false; }
function edChecksValue(el) { return []; }
function dtmValueOf(el) { return el.value; }
function keptStampOf(v) { return v; }
${edValues}

var FIELDS = ${JSON.stringify(FIELDS)};
var host = document.getElementById('host');
FIELDS.forEach(function (f) {
  var d = document.createElement('div');
  d.innerHTML = edPhone('ed-' + f.id, f.stored);   // exactly what the record panel builds
  host.appendChild(d);
  wireEdPhone('ed-' + f.id);
});
function rowOf(id) { return document.getElementById('ed-' + id + '-row'); }
function dialOf(id) { return document.getElementById('ed-' + id + '-dial').textContent.trim(); }
function inputOf(id) { return document.getElementById('ed-' + id); }

// 1. what the panel shows
ok('a readable number splits into its country and its local part',
  dialOf('jo') === '+962' && inputOf('jo').value === '791234567',
  dialOf('jo') + ' / ' + inputOf('jo').value);
ok('a foreign number shows ITS country, not Jordan',
  dialOf('ae') === '+971' && inputOf('ae').value === '501234567',
  dialOf('ae') + ' / ' + inputOf('ae').value);
ok('a code that is not a country is shown raw rather than guessed at',
  dialOf('junk') === '+ ?' && inputOf('junk').value === '+170123',
  dialOf('junk') + ' / ' + inputOf('junk').value);
ok('a legacy local number is shown raw',
  dialOf('legacy') === '+ ?' && inputOf('legacy').value === '0791234567',
  dialOf('legacy') + ' / ' + inputOf('legacy').value);

// 2. THE ONE THAT MATTERS: what a save would write, having touched nothing.
var got = edValues(FIELDS);
FIELDS.forEach(function (f) {
  var want = f.stored === '' ? null : f.stored;
  ok('an untouched answer is written back exactly as stored: ' + f.label,
    got[f.id] === want, JSON.stringify(got[f.id]) + ' wanted ' + JSON.stringify(want));
});

// 3. and the raw value is not a trap: editing it still works
var el = inputOf('legacy');
el.value = '791234567';
el.dispatchEvent(new Event('input', { bubbles: true }));
// Still no country on the row, so the edited value goes back as typed rather than being
// silently given a Jordanian code nobody chose.
ok('editing an unparsed number writes what was typed',
  edValues(FIELDS).legacy === '791234567', JSON.stringify(edValues(FIELDS).legacy));

// 4. choosing a country for it composes a real number
(function () {
  var btn = document.getElementById('ed-legacy-btn');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  var s = document.getElementById('ed-legacy-search');
  s.value = 'jordan'; s.dispatchEvent(new Event('input', { bubbles: true }));
  var li = document.getElementById('ed-legacy-list').querySelector('li');
  li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  ok('picking a country for a legacy number composes it properly',
    edValues(FIELDS).legacy === '+962791234567', JSON.stringify(edValues(FIELDS).legacy));
})();

// 5. the picker searches, in the panel as well as on the form
(function () {
  document.getElementById('ed-jo-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  var s = document.getElementById('ed-jo-search');
  s.value = 'ger'; s.dispatchEvent(new Event('input', { bubbles: true }));
  var rows = document.getElementById('ed-jo-list').querySelectorAll('li');
  ok('searching the panel picker finds one country', rows.length === 1, rows.length + ' rows');
  rows[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  ok('and picking it recomposes the number under the new code',
    dialOf('jo') === '+49' && edValues(FIELDS).jo === '+49791234567',
    dialOf('jo') + ' / ' + JSON.stringify(edValues(FIELDS).jo));
})();

// 6. clearing a box clears the answer, because half an answer is not one
(function () {
  var e2 = inputOf('ae');
  e2.value = '';
  e2.dispatchEvent(new Event('input', { bubbles: true }));
  ok('clearing the box clears the answer', edValues(FIELDS).ae === null, JSON.stringify(edValues(FIELDS).ae));
})();

out.push(pass + ' passed, ' + fail + ' failed (the phone round trip, in chrome.exe)');
document.getElementById('out').textContent = out.join('\\n');
console.log('@@' + out.join('\\n@@'));
</script></body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-phed-'));
const f = path.join(dir, 'p.html');
fs.writeFileSync(f, page);
const r = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=5000',
  '--enable-logging=stderr', '--v=0', 'file:///' + f.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 3e7 });
const lines = (r.stderr || '').split('\n').filter(l => l.indexOf('@@') > -1)
  .join('\n').replace(/^.*?"?@@/gm, '').replace(/",? source:.*$/gm, '');
if (!lines.trim()) {
  console.log('FAILED: the page produced no results. Chrome said:');
  console.log((r.stderr || '').split('\n').slice(-20).join('\n'));
  process.exit(1);
}
console.log(lines);
if (/^FAIL/m.test(lines)) process.exitCode = 1;
fs.rmSync(dir, { recursive: true, force: true });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/phone-editor.chrome.js
```

Expected, against the code as it stands: it throws `could not find the phone block in
index.html`, because Task 2 put the block in `f/index.html`'s neighbour but this file also
needs `edPhone` to have been rewritten. If you would rather see the corruption itself first,
point the lift at the current `parsePhone`/`edPhone` and run it: the failures are

- `a foreign number shows ITS country, not Jordan` reading `+962 / 971501234567`
- `an untouched answer is written back exactly as stored: a legacy local number` reading
  `"+962791234567"` where `"0791234567"` was stored

That second line is the corruption, reproduced.

- [ ] **Step 3: Rewrite the editor**

Delete `COUNTRIES_ED` (5801 to 5806) entirely. Replace `parsePhone`, `edPhone` and
`wireEdPhone` with:

```js
  // Reads a stored answer into the two halves the panel edits, and returns null when it
  // cannot. Null is not a failure to handle politely: it is the instruction to leave the
  // value alone. The old version answered "Jordan, and the whole string is the local part"
  // for every value it could not read, which is how opening a UAE record and saving it wrote
  // a Jordanian number.
  function parsePhone(value) {
    var p = splitPhone(value);
    return p ? { row: p.row, local: p.local } : null;
  }
  function edPhone(id, value) {
    var p = parsePhone(value);
    var r = p ? p.row : null;
    var raw = value == null ? "" : String(value);
    // data-kept carries the stored value through the panel untouched, and data-touched says
    // whether anybody has edited it. Without the second, an unparsed value and a cleared box
    // look identical, and one of them must be given back exactly as it arrived.
    return '<div class="phone-row" id="' + id + '-row" data-iso="' + esc(r ? r.iso : "") + '"' +
      ' data-kept="' + esc(raw) + '" data-touched="0">' +
      '<div class="cc-picker" id="' + id + '-picker">' +
      '<button type="button" class="cc-btn" id="' + id + '-btn">' +
      (r ? '<img class="cc-flag" id="' + id + '-flag" src="' + edFlagUrl(r.flag) + '" alt="">' : '<img class="cc-flag" id="' + id + '-flag" alt="">') +
      '<span class="cc-dial" id="' + id + '-dial">' + (r ? "+" + r.cc : "+ ?") + '</span><span class="cc-caret">▾</span></button>' +
      '<div class="cc-menu" id="' + id + '-menu"><input type="text" class="cc-search" id="' + id + '-search" placeholder="Search country or code…" autocomplete="off">' +
      '<ul class="cc-list" id="' + id + '-list" role="listbox"></ul><div class="cc-empty" id="' + id + '-empty" hidden>No matches</div></div>' +
      '</div>' +
      '<input type="tel" inputmode="numeric" class="ed-in" id="' + id + '" value="' + esc(p ? p.local : raw) + '">' +
      "</div>";
  }
  function wireEdPhone(id) {
    var row = document.getElementById(id + "-row"); if (!row) return;
    var btn = document.getElementById(id + "-btn"), menu = document.getElementById(id + "-menu"),
        flag = document.getElementById(id + "-flag"), dial = document.getElementById(id + "-dial"),
        picker = document.getElementById(id + "-picker"), local = document.getElementById(id),
        search = document.getElementById(id + "-search"), list = document.getElementById(id + "-list"),
        empty = document.getElementById(id + "-empty");
    var sc = phoneRow(row.getAttribute("data-iso")) || null, shown = [], hi = -1;
    var kept = row.getAttribute("data-kept") || "";
    function apply(r) {
      sc = r;
      flag.src = edFlagUrl(r.flag); flag.alt = r.name;
      dial.textContent = "+" + r.cc;
      local.placeholder = r.ph;
      local.maxLength = Math.max.apply(null, r.len) + 1;
    }
    function render() {
      var q = search.value.trim().toLowerCase();
      var m = phoneMenuRows();
      shown = q ? m.pinned.concat(m.rest).filter(function (r) { return phoneMatch(r, q); })
                : m.pinned.concat(m.rest);
      var pinCount = q ? 0 : m.pinned.length;
      empty.hidden = shown.length > 0;
      list.innerHTML = shown.map(function (r, i) {
        return '<li role="option" data-i="' + i + '"' +
          (i === hi ? ' class="hi"' : (pinCount && i === pinCount - 1 ? ' class="pin-last"' : '')) +
          '><img src="' + edFlagUrl(r.flag) + '" alt=""> <span>' + esc(r.name) + "</span> <b>+" + r.cc + "</b></li>";
      }).join("");
    }
    function touched() { row.setAttribute("data-touched", "1"); }
    function pick(r) {
      apply(r); touched();
      menu.classList.remove("open");
      // The panel autosaves off input and change, and settling a choice in code fires
      // neither, so it is dispatched by hand. Same reason the date box dispatches both.
      try { local.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.classList.contains("open")) { menu.classList.remove("open"); return; }
      hi = -1; search.value = ""; render();
      menu.classList.add("open");
      // Every other floating menu in this page goes through placeMenuInView, and a 245 row
      // list opened from a record panel is exactly the case it exists for.
      placeMenuInView(btn, menu, "left");
      try { search.focus(); } catch (e) {}
    });
    search.addEventListener("input", function () { hi = -1; render(); });
    search.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); hi = Math.min(hi + 1, shown.length - 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); hi = Math.max(hi - 1, 0); render(); }
      else if (e.key === "Enter") { e.preventDefault(); if (shown[hi >= 0 ? hi : 0]) pick(shown[hi >= 0 ? hi : 0]); }
      else if (e.key === "Escape") { e.preventDefault(); menu.classList.remove("open"); }
    });
    list.addEventListener("mousedown", function (e) {
      var li = e.target.closest ? e.target.closest("li") : null;
      if (!li) return;
      e.preventDefault();
      pick(shown[+li.getAttribute("data-i")]);
    });
    document.addEventListener("click", function (e) { if (!picker.contains(e.target)) menu.classList.remove("open"); });
    local.addEventListener("input", function () {
      touched();
      // Only a parsed number is digits-only. An unparsed value is shown raw and must stay
      // typeable, because a legacy 0-prefixed number is corrected by editing it.
      if (sc) local.value = local.value.replace(/\D/g, "");
    });
    local.addEventListener("change", touched);
    if (sc) apply(sc);
    // What a save writes. An untouched value the panel could not parse goes back exactly as
    // it arrived: 33,795 legacy local numbers and about 600 with a code we could not read
    // reach this line, and rewriting them is the bug being fixed.
    edPhoneReg[id] = function () {
      var edited = row.getAttribute("data-touched") === "1";
      if (!edited) return kept === "" ? null : kept;
      var d = local.value.replace(/\D/g, "").replace(/^0+/, "");
      if (!d) return null;
      return sc ? "+" + sc.cc + d : local.value.trim() || null;
    };
  }
```

Then adapt the two readers of the old four-country list. `phoneCountry` (4665) becomes:

```js
  // The country a stored number belongs to, for the flag beside an applicant. Reads the one
  // table now, so a UAE number stops reading as Jordanian here too. waEligible still compares
  // .dial against WA_DIAL, so the shape of what this returns is unchanged.
  function phoneCountry(phone) {
    var p = splitPhone(phone);
    return p ? { dial: p.row.cc, name: p.row.name, flag: p.row.flag } : null;
  }
```

And in `countryFlag` (~8120) replace the `COUNTRIES.filter(...)` lookup with `phoneByDial(d)`,
keeping the rest of the function as it is.

- [ ] **Step 4: Add the CSS to `index.html`**

Mirror Task 3's rules at lines 864 to 873, with `rgba(var(--wash),0.06)` instead of literal
white and `var(--field-border)` for the borders, because `theme.test.js` fails hand-written
white rgba in this page. Then extend the mobile clamp at ~1922, which already names
`.cc-menu`, to keep `.cc-list` scrollable inside the clamped panel.

- [ ] **Step 5: Re-enable the deleted-list assertion**

In `docs/tests/phone-data.test.js`, restore the `COUNTRIES_ED` line inside "the old
four-country lists are gone". It should now pass.

- [ ] **Step 6: Run everything**

```bash
for f in phone-data phone-world phone-prefill; do \
  ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
    docs/tests/$f.test.js; done
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/phone-editor.chrome.js
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/theme.test.js
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/ja-sections.test.js
```

Expected: all pass. `theme.test.js` is here because of the CSS, and `ja-sections.test.js`
because it exercises the applicant panel that `phoneCountry` feeds. Two Chrome tests
(`card-panel`, `upload-queue`) are already red on a clean `origin/main`: confirm that before
blaming this branch for them.

- [ ] **Step 7: Falsify the corruption test**

Reintroduce the bug on purpose: make `parsePhone` return `{ row: phoneRow("JO"), local: raw }`
when `splitPhone` gives null, re-run `phone-editor.chrome.js`, and confirm cases 3, 4 and 5
FAIL. Revert. A regression test that passes with the bug back in is not a regression test.

- [ ] **Step 8: Commit**

```bash
git add index.html docs/tests/phone-editor.chrome.js docs/tests/phone-data.test.js
git commit -m "fix: the record editor no longer rewrites a number it cannot read

parsePhone answered \"Jordan, and the whole string is the local part\"
for any value that did not start with one of four dial codes, so opening
a record holding +971501234567 and saving it wrote +962971501234567. An
untouched value it cannot parse now goes back exactly as it arrived,
which covers the 33,795 legacy local numbers as well. COUNTRIES_ED is
deleted: one table serves both pages, which is the condition that
produced 6cc5a29.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: The country question, worldwide

**Files:**
- Modify: `f/index.html` `zoneCountryName` (1971)
- Test: `docs/tests/form-country.test.js` or `country-prefill.chrome.js`, whichever already loads `zoneCountryName`

**Interfaces:**
- Consumes: `tzIsoOf`, `phoneRow` from Task 2, `COUNTRY_ROWS` and `countryChoiceNames` as they are.
- Produces: no new names. `zoneCountryName(zone, f)` keeps its signature and its meaning.

This is Part F of the spec, and it is separable: if it is dropped, everything else stands.

- [ ] **Step 1: Write the failing test**

Add to whichever existing file already loads `zoneCountryName` (check `country-prefill.chrome.js`
and `form-country.test.js` first, and only create a file if neither does):

```js
t('a zone outside the four in the database still names a country', () => {
  // countries.timezones holds four rows, so before this a Berlin visitor got +49 on the phone
  // question and nothing at all on Country, on a form offering all 197 names.
  const f = {};                                       // no options.only: offers everything
  assert.strictEqual(API.zoneCountryName('Europe/Berlin', f), 'Germany');
  assert.strictEqual(API.zoneCountryName('Asia/Dubai', f), 'United Arab Emirates');
  // The database still wins for the four it knows.
  assert.strictEqual(API.zoneCountryName('Asia/Amman', f), 'Jordan');
  // And a form scoped to two countries still fills in nothing for a visitor in a third.
  assert.strictEqual(API.zoneCountryName('Europe/Berlin', { options: { only: ['jo', 'lebanon'] } }), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: `Europe/Berlin` returns null.

- [ ] **Step 3: Add the fallback**

In `zoneCountryName`, after the `COUNTRY_ROWS` lookup fails, fall through to the embedded map:

```js
  function zoneCountryName(zone, f) {
    if (!zone) return null;
    var row = COUNTRY_ROWS.filter(function (c) {
      return (c.timezones || []).indexOf(zone) !== -1;
    })[0];
    var name = row && row.name_en;
    // The database stays authoritative, so an admin can still correct or add a zone without a
    // deploy. The embedded map only answers what those four rows do not, which is every
    // country outside the ones we operate in.
    if (!name) {
      var r = phoneRow(tzIsoOf(zone));
      name = r ? r.name : null;
    }
    if (!name) return null;
    // Only ever a country THIS question offers, unchanged: opening the Jordan and Lebanon
    // complaints form in Berlin must fill in nothing.
    return countryChoiceNames(f).indexOf(name) !== -1 ? name : null;
  }
```

The names line up because the generator asserts it: every one of the 197 names
`countryChoiceNames` can return is a name in `PHONE_ROWS`.

- [ ] **Step 4: Run it, plus the country tests it could disturb**

```bash
for f in form-country country-scope branch-country-scope; do \
  ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
    docs/tests/$f.test.js; done
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/country-prefill.chrome.js
```

Expected: all pass. The branch scope tests matter here: a country answer re-scopes the branch
question, so a country the form does not offer must still narrow nothing.

- [ ] **Step 5: Commit**

```bash
git add f/index.html docs/tests
git commit -m "feat: the country question pre-fills outside our four countries too

countries.timezones holds four zones, so a visitor in Berlin got a
country code and no country. The database still answers first; the
embedded zone map only answers what it does not, and the question's own
options.only still decides what may be filled in.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Documentation, and the PR

**Files:**
- Modify: `docs/tests/README.md`, `STATUS.md`

- [ ] **Step 1: Add the README rows**

Four rows in the house voice, which describes what each file *catches* rather than what it
covers. Draft:

| file | covers |
| --- | --- |
| `phone-data.test.js` | the two generated tables in both pages: 245 countries each with a dial code, valid lengths, a real example number and its own number pattern, and 541 IANA zones mapped to the country each is **named for**. The zone assertions are the ones worth having: tzdata gives one canonical zone to every country sharing its rules, so `Africa/Abidjan` covers twelve countries including Iceland, and read naively the map sends Dubai to the French Southern Territories and Berlin to Svalbard. Also pins the deprecated names browsers still report (`Asia/Calcutta`, `Europe/Kiev`), without which India and Ukraine silently stop pre-filling, and asserts the tables are character for character identical in the two pages |
| `phone-world.test.js` | the rules under the phone box, loaded from **both** pages and asserted against each: splitting a stored answer, longest dial code first, and validation per country rather than one length rule. The two that matter: an unreadable value returns **null** instead of guessing at Jordan, which is the corruption fix, and every one of the 245 countries accepts its own example number while `999999999` is refused for Jordan, which length alone would have allowed |
| `phone-prefill.test.js` | whether the country code is guessed from the device timezone, and what the guess is never allowed to do: overwrite an existing answer, override `options.prefill: false`, or announce itself when it landed on Jordan, which is what every form shows anyway. The zone is stubbed rather than read, because on a machine in Amman hardcoding `Asia/Amman` passes every comparison in the file |
| `phone-picker.chrome.js` | the picker driven in a real browser, which is where the original problem lived: a list of four could not represent the number somebody was typing and there was no way to find theirs. Searches by name, code and dial, moves on the arrow keys, and swaps `window.Intl` out from under the page to report `Europe/Berlin`, because Chrome on Windows ignores `TZ` and would otherwise only ever prove the machine is in Amman |
| `phone-editor.chrome.js` | what a save **would** write for a phone answer the panel cannot parse. The bug: `parsePhone` fell back to Jordan for anything not starting with one of four dial codes, so opening a record holding `+971501234567` and saving it wrote `+962971501234567`, and the same path rewrote 33,795 legacy local numbers. An untouched unparsed value now goes back byte identical, and editing it still works |

- [ ] **Step 2: Update `STATUS.md`**

Refresh Current state and Next steps, and add a dated log line for 2026-09-08 covering: all
245 dial codes on every phone question, pre-filled from the timezone, searchable, per-country
validation, and the record editor corruption fixed. Note in Next steps the two follow-ups this
work deliberately left: a read-only audit of stored numbers whose code matches no real country
(the `+170`, `+181`, `+146` rows), and the decision about whether to correct the 33,795 legacy
local numbers.

- [ ] **Step 3: Run the whole suite one file at a time**

```bash
for f in docs/tests/*.test.js; do echo "== $f"; \
  ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" "$f"; done
```

`node --test` does not work here: the flag goes to Electron. Expect green throughout; if
something unrelated fails, check it against a clean `origin/main` before treating it as this
branch's problem.

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/tests/README.md STATUS.md
git commit -m "docs: STATUS and test notes for the world dial codes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin feat/world-phone-codes
gh pr create --title "Every country's dial code on the phone question, pre-filled and searchable" --body "$(cat <<'BODY'
All 47 phone questions now offer all 245 dial codes, pre-filled from the
device timezone and searchable by name, ISO code or dial code. Our four
countries stay pinned at the top of the list.

**Validation is now per country**, which loosens Jordan rather than
tightening it: 8 or 9 digits matching Jordan's own pattern, instead of
exactly 9. An Amman landline is newly accepted and 999999999 is newly
refused. The rules come from libphonenumber, generated into the page by
tools/gen-phone-data.js rather than hand written.

**Fixes a live corruption in the record editor.** parsePhone answered
"Jordan, and the whole string is the local part" for any value not
starting with one of four dial codes, so opening a record holding
+971501234567 and saving it wrote +962971501234567. About 600 stored
answers carry a foreign code and 33,795 are legacy local numbers. An
untouched value the panel cannot parse now goes back byte identical.

COUNTRIES_ED is deleted: one table serves both pages, which is the
condition that produced 6cc5a29.

Not in this PR: no rewriting of existing answers, no migration, no RPC
change. Two follow-ups are recorded in STATUS.md.
BODY
)"
```

Two known traps at this point. `gh pr merge` from a worktree fails with "'main' is already
used by worktree" **after the remote merge has succeeded**, so check `gh pr view` before
retrying. And PRs here squash-merge with the branch deleted, so before any follow-up work run
`git fetch --prune` and rebase onto fresh `origin/main` rather than continuing on this branch.

- [ ] **Step 5: Verify on the deployed page, not in the suite**

Payload, functions and markup can all pass while the feature does nothing. Once the PR is
merged and GitHub Pages has served it:

1. Open `https://blktable.blk.jo/f/?t=franchise-apply` and `?t=customer-complaints` and confirm
   the flag button is pre-filled, the search box opens, and typing "ger" finds Germany.
2. Confirm the Franchise country question still says nothing (it carries `prefill: false`)
   while its phone question does pre-fill.
3. Submit one test answer through an alert-free form, then delete the row.
   `notify_on_submission` returns early unless `config->'alerts'` is an array, which is how to
   pick a form that will not message anybody.
4. Open a record in the dashboard holding a foreign number, save it without touching the phone
   row, and confirm the stored value is unchanged.

---

## Self-Review

**Spec coverage.** Part A is Task 1. Part B is Task 3. Part C is Task 4. Part D is Task 2
(the rules) and Task 3 (where they are applied). Part E is Task 5. Part F is Task 6. Testing
is spread across Tasks 1 to 6 with the falsification steps the spec asks for. Deployment and
rollback are Task 7 Steps 4 and 5. The spec's "deliberately not here" list needs no task, and
its two follow-ups are recorded in `STATUS.md` in Task 7 Step 2.

**The seventh field.** `pri`, marking the primary country of a shared dial code, was found
while writing this plan and folded back into the spec rather than left as a divergence.
Without it `splitPhone` resolves `+1` alphabetically and shows an Antigua flag on every
American number. Task 1's test pins US, GB, RU and IT.

**Two things the plan leaves visibly different from today, both called out in the spec.**
Jordan's rule loosens to 8 or 9 digits, so an Amman landline is accepted. And the local box's
placeholder becomes the country's own example number (`790123456` for Jordan) rather than
today's hand-written mask (`7X XXX XXXX`), because a per-country mask for 245 countries is a
dataset nobody will maintain. If the mask matters more than the coverage, the generator is
where to add an override for the four pinned countries.
