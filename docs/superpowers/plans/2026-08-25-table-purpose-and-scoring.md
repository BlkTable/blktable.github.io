# Table purpose at creation, and a builder-made scorecard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask what a table is for at creation (Form / Scorecard / Checklist), and let a scorecard's points be set in the builder so the percentage works itself out.

**Architecture:** Scoring rules become data on `app_fields.scoring` (new nullable jsonb column) plus per-choice points on the existing choice objects. Pure functions in `index.html` compute earned and possible from those rules; a database trigger writes the stored percentage so the grid, filters, sort and CSV export keep working. The existing imported-scorer path for QC and Mystery Shopper is left alone and the new trigger is inert for them.

**Tech Stack:** Single static `index.html` (no build step, `@supabase/supabase-js` v2 via CDN), self-hosted Supabase/Postgres at `db.blktable.blk.jo`, tests are plain Node scripts in `docs/tests/`.

**Spec:** `docs/superpowers/specs/2026-08-25-table-purpose-and-scoring-design.md`

## Global Constraints

- **Worktree:** all work happens in `C:\Users\ASUS\blktable-scoring` on branch `feat/table-purpose-scoring`. Never switch branches in the shared clone at `C:\Users\ASUS\blktable`; another session is working there.
- **Never `git add -A`.** Stage named files only. Another session's uncommitted work must not ride along.
- **No em-dashes in new UI copy or code comments.** House style, set by commit `51b792d`.
- **`config` is merged, never replaced.** Writing a fresh object over `app_tables.config` wiped sixteen keys once already (fixed 2026-08-19). Go through `builderConfig()`.
- **New functions sit at two-space indentation inside the page's IIFE**, declared as `function name(...)`. The test harness (`grab()` in `docs/tests/*.test.js`) finds them with `/\n  function <name>\s*\(/`. A differently indented function is silently untested.
- **Existing tables must be untouched.** `scoring` is NULL on every existing row and `config.scored` is absent on all 226 tables. Every new code path checks one of those before doing anything.
- **Never rescore history.** The trigger fires on the row being written and nothing else.
- **Run tests with the Node inside VS Code:**
  ```bash
  cd /c/Users/ASUS/blktable-scoring
  ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/<file>.test.js
  ```
  Silent output with exit code 0 is a pass; failures print `FAIL: <name> -> <reason>`.

---

### Task 1: Per-choice points survive the Options box round-trip

The builder stores a choice list as a comma or newline separated string and parses it back into `{en, ar, other}`. Points and an N/A marker need to survive that trip, or the builder UI in Task 5 will silently drop them on every save.

Today's format is positional: `English|عربي|other`. Positional breaks down with two more flags, so the third slot onward becomes token based: `pts:3` and `na` in any order. `other` keeps working in its current position and as a token.

**Files:**
- Modify: `index.html` — the choice parser inside `runBuilderSave` (near line 10863), and `optsToString` (near line 10652)
- Test: `docs/tests/scoring-options.test.js` (create)

**Interfaces:**
- Produces: `parseChoiceList(raw)` returning `[{en, ar, other?, na?, points?}]`, and `optsToString(options)` (existing, extended) returning the string form.

- [ ] **Step 1: Write the failing test**

Create `docs/tests/scoring-options.test.js`:

```js
// Points on a choice have to survive the Options box. The builder rebuilds the whole
// choice list from that text on every save, so a token it cannot read is a price that
// silently becomes zero the next time somebody edits an unrelated question.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const { parseChoiceList, optsToString } = load('index.html', ['parseChoiceList', 'optsToString', 'linkRecordOptions']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- what the box already had to do, still working ----
t('plain English choices parse', () => {
  assert.deepStrictEqual(parseChoiceList('Yes, No'), [{ en: 'Yes', ar: '' }, { en: 'No', ar: '' }]);
});
t('English|Arabic still pairs up', () => {
  assert.deepStrictEqual(parseChoiceList('Yes|نعم'), [{ en: 'Yes', ar: 'نعم' }]);
});
t('other in its old third position still reads', () => {
  assert.strictEqual(parseChoiceList('Something else|غير ذلك|other')[0].other, true);
});
t('other with no Arabic still reads', () => {
  assert.strictEqual(parseChoiceList('Something else||other')[0].other, true);
});

// ---- the new tokens ----
t('pts: prices a choice', () => {
  assert.strictEqual(parseChoiceList('Excellent|ممتاز|pts:3')[0].points, 3);
});
t('a price with no Arabic still reads', () => {
  assert.strictEqual(parseChoiceList('Excellent||pts:3')[0].points, 3);
});
t('na marks a choice as not applicable', () => {
  assert.strictEqual(parseChoiceList('Not applicable|لا ينطبق|na')[0].na, true);
});
t('tokens are order independent and can combine', () => {
  const o = parseChoiceList('Other|أخرى|na|other|pts:2')[0];
  assert.strictEqual(o.na, true);
  assert.strictEqual(o.other, true);
  assert.strictEqual(o.points, 2);
});
t('a price of zero is kept, not dropped as falsy', () => {
  assert.strictEqual(parseChoiceList('Poor||pts:0')[0].points, 0);
});
t('a fractional price is kept', () => {
  assert.strictEqual(parseChoiceList('Half||pts:0.5')[0].points, 0.5);
});
t('a price that is not a number does not become NaN', () => {
  const o = parseChoiceList('Broken||pts:abc')[0];
  assert.ok(!('points' in o) || o.points === 0, 'expected no price rather than NaN, got: ' + JSON.stringify(o));
});
t('an unknown token is ignored rather than becoming a choice', () => {
  const list = parseChoiceList('Fine||wat');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].en, 'Fine');
});
t('blank entries are dropped', () => {
  assert.deepStrictEqual(parseChoiceList('Yes,,No').map(o => o.en), ['Yes', 'No']);
});

// ---- the trip back out ----
t('a priced choice round-trips through the text box', () => {
  const before = parseChoiceList('Excellent|ممتاز|pts:3, Poor||pts:0, N/A||na');
  const after = parseChoiceList(optsToString(before));
  assert.deepStrictEqual(after, before, 'round trip changed the list: ' + optsToString(before));
});
t('an unpriced choice does not gain a price on the way out', () => {
  assert.strictEqual(optsToString([{ en: 'Yes', ar: '' }]), 'Yes');
});
t('other still round-trips', () => {
  const before = parseChoiceList('Something else|غير ذلك|other');
  assert.deepStrictEqual(parseChoiceList(optsToString(before)), before);
});

if (!process.exitCode) console.log(n + ' passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-options.test.js
```
Expected: throws `could not find function parseChoiceList in index.html`.

- [ ] **Step 3: Add `parseChoiceList` next to `optsToString`**

Insert immediately above `function optsToString(options) {` (near line 10652):

```js
  // The Options box, read back into choices. The first two slots are English and Arabic;
  // everything after them is a token rather than a position, because three flags in fixed
  // slots is how "other" ends up meaning "priced at 3" the day somebody adds a price.
  // Tokens: "other" opens a free-text box, "na" takes the question out of the score total,
  // "pts:3" prices the choice.
  function parseChoiceList(raw) {
    return String(raw || "").split(/[\r\n,]+/).map(function (p) {
      var kv = p.split("|");
      var o = { en: (kv[0] || "").trim(), ar: (kv[1] || "").trim() };
      for (var i = 2; i < kv.length; i++) {
        var tok = (kv[i] || "").trim().toLowerCase();
        if (tok === "other") o.other = true;
        else if (tok === "na") o.na = true;
        else if (tok.indexOf("pts:") === 0) {
          var n = parseFloat(tok.slice(4));
          if (!isNaN(n)) o.points = n;      // a price that is not a number is no price at all
        }
      }
      return o;
    }).filter(function (o) { return o.en; });
  }
```

- [ ] **Step 4: Emit the tokens in `optsToString`**

In `optsToString`, replace the final `return options.map(...)` block with:

```js
    return options.map(function (o) {
      var en = (typeof o === "string" ? o : o.en) || "", ar = (typeof o === "string" ? "" : o.ar) || "";
      var toks = [];
      if (typeof o === "object" && o) {
        if (o.other) toks.push("other");
        if (o.na) toks.push("na");
        if (typeof o.points === "number" && !isNaN(o.points)) toks.push("pts:" + o.points);
      }
      return en + (ar || toks.length ? "|" + ar : "") + (toks.length ? "|" + toks.join("|") : "");
    }).join(", ");
```

- [ ] **Step 5: Use the new parser in the save handler**

In `runBuilderSave`, replace the inline dropdown/multi_select parse (the `options = raw.split(/[\r\n,]+/).map(...)` block near line 10868) with:

```js
        options = parseChoiceList(raw);
```

- [ ] **Step 6: Run the test to verify it passes**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-options.test.js
```
Expected: exit code 0 and an `N passed` line, with no `FAIL:` lines.

- [ ] **Step 7: Confirm nothing else that reads choices regressed**

Run the two suites that touch choice lists:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/conditional-questions.test.js
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/ballot-field.test.js
```
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add index.html docs/tests/scoring-options.test.js
git commit -m "feat: choices carry a price and an N/A marker through the Options box"
```

---

### Task 2: The scoring arithmetic, as pure functions

The rules from the spec, with nothing rendered and nothing stored. This is the task that decides what a score means, so it carries the largest test.

**Files:**
- Modify: `index.html` — add a block after `condMet` (near line 5195)
- Test: `docs/tests/scoring-rules.test.js` (create)

**Interfaces:**
- Consumes: `condMet(f, data)` (existing, line 5183) for "hidden by ask only if".
- Produces:
  - `choicePoints(o)` → number, a choice's price (0 when unpriced)
  - `questionMaxPoints(f)` → number, the most this question can give
  - `questionApplies(f, data)` → boolean, whether it counts towards this record's total
  - `questionEarned(f, data)` → number, what this answer earned
  - `scorecardTotals(fields, data)` → `{earned, possible}`

- [ ] **Step 1: Write the failing test**

Create `docs/tests/scoring-rules.test.js`:

```js
// What a score means. Every case here is a way the arithmetic could be wrong about
// somebody's work: a question they were never asked counting against them, a question
// they skipped quietly forgiven, or a total that moves when nothing about the form did.
//
// The rule, decided 2026-08-25: a question that was never asked leaves the total, whether
// it was hidden by "ask only if" or answered N/A. A question that was asked and missed
// stays in the total and earns nothing.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

// naChoices and condMet are not tested directly, but questionApplies calls both, so they
// have to come along or the whole file dies on a ReferenceError rather than a failed assert.
const API = load('index.html',
  ['choicePoints', 'questionMaxPoints', 'naChoices', 'questionApplies', 'questionEarned',
   'scorecardTotals', 'condMet']);
const { choicePoints, questionMaxPoints, questionApplies, questionEarned, scorecardTotals } = API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// A scored yes/no worth 4, and a priced three-way choice worth 3 at most.
const Q_CLEAN = { id: 'q1', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 4 } };
const Q_RATE = {
  id: 'q2', type: 'dropdown', scoring: { rule: 'choices' },
  options: [{ en: 'Excellent', points: 3 }, { en: 'Acceptable', points: 1 }, { en: 'Poor', points: 0 }]
};
const Q_PLAIN = { id: 'q3', type: 'short_text' };   // no scoring: an ordinary question

// ---- one question at a time ----
t('a priced choice list is worth its dearest choice', () => {
  assert.strictEqual(questionMaxPoints(Q_RATE), 3);
});
t('a flat question is worth what it says', () => {
  assert.strictEqual(questionMaxPoints(Q_CLEAN), 4);
});
t('an unscored question is worth nothing', () => {
  assert.strictEqual(questionMaxPoints(Q_PLAIN), 0);
});
t('each choice earns its own price', () => {
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Excellent' }), 3);
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Acceptable' }), 1);
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Poor' }), 0);
});
t('the earning answer takes the points and the other does not', () => {
  assert.strictEqual(questionEarned(Q_CLEAN, { q1: 'Yes' }), 4);
  assert.strictEqual(questionEarned(Q_CLEAN, { q1: 'No' }), 0);
});
t('a choice nobody priced earns nothing rather than NaN', () => {
  const q = { id: 'q', type: 'dropdown', scoring: { rule: 'choices' }, options: [{ en: 'Fine' }] };
  assert.strictEqual(questionEarned(q, { q: 'Fine' }), 0);
  assert.strictEqual(questionMaxPoints(q), 0);
});
t('an answer that is not one of the choices earns nothing', () => {
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Something the form never offered' }), 0);
});

// ---- multi-select adds up, and can reach full marks ----
const Q_MULTI = {
  id: 'm', type: 'multi_select', scoring: { rule: 'choices' },
  options: [{ en: 'Gloves', points: 2 }, { en: 'Hairnet', points: 1 }, { en: 'Apron', points: 1 }]
};
t('a multi-select is worth all its priced choices together', () => {
  assert.strictEqual(questionMaxPoints(Q_MULTI), 4);
});
t('ticking some earns those', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: 'Gloves, Apron' }), 3);
});
t('ticking everything is full marks', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: 'Gloves, Hairnet, Apron' }), 4);
});
t('ticking nothing earns nothing', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: '' }), 0);
});

// ---- a number over or under a line ----
const Q_FRIDGE = { id: 'f', type: 'number', scoring: { rule: 'threshold', op: '<', value: 5, points: 2 } };
t('a number under the line earns the points', () => {
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '3' }), 2);
});
t('a number over the line earns nothing', () => {
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '7' }), 0);
});
t('a blank number earns nothing rather than passing as zero', () => {
  // Airtable read an empty number as 0 and gave the point away. Deliberately not copied:
  // this is a new form and a non-answer should not pass.
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '' }), 0);
});

// ---- the denominator rule ----
t('a question that was asked and missed stays in the total and earns nothing', () => {
  assert.strictEqual(questionApplies(Q_CLEAN, {}), true);
  assert.strictEqual(questionEarned(Q_CLEAN, {}), 0);
});
t('an N/A answer takes the question out of the total', () => {
  const q = {
    id: 'k', type: 'dropdown', scoring: { rule: 'choices' },
    options: [{ en: 'Clean', points: 2 }, { en: 'Not applicable', na: true }]
  };
  assert.strictEqual(questionApplies(q, { k: 'Not applicable' }), false);
  assert.strictEqual(questionApplies(q, { k: 'Clean' }), true);
});
t('a question hidden by "ask only if" leaves the total', () => {
  const gate = { id: 'g', type: 'yesno' };
  const q = { id: 'k', type: 'yesno', show_if: { field: 'g', equals: ['Yes'] },
              scoring: { rule: 'equals', earn: ['Yes'], points: 5 } };
  assert.strictEqual(questionApplies(q, { g: 'No' }), false, 'hidden question must leave the total');
  assert.strictEqual(questionApplies(q, { g: 'Yes' }), true);
});
t('an unscored question never enters the total, answered or not', () => {
  assert.strictEqual(questionApplies(Q_PLAIN, { q3: 'anything' }), false);
});
t('a multi-select answered only with N/A choices leaves the total', () => {
  const q = {
    id: 'm2', type: 'multi_select', scoring: { rule: 'choices' },
    options: [{ en: 'Gloves', points: 2 }, { en: 'Not applicable', na: true }]
  };
  assert.strictEqual(questionApplies(q, { m2: 'Not applicable' }), false);
  assert.strictEqual(questionApplies(q, { m2: 'Gloves, Not applicable' }), true);
});

// ---- the whole record ----
t('the worked example: 60 of 64 reads as 94%', () => {
  // 20 questions worth 3 each, plus one worth 4, is 64. Answering the 4 and 56 of the 60.
  const fields = [Q_CLEAN];
  const data = { q1: 'Yes' };
  for (let i = 0; i < 20; i++) {
    const id = 'r' + i;
    fields.push({ id, type: 'dropdown', scoring: { rule: 'choices' },
                  options: [{ en: 'Full', points: 3 }, { en: 'Part', points: 1 }, { en: 'None', points: 0 }] });
    // 18 full (54) + 2 part (2) = 56, plus the 4 above = 60
    data[id] = i < 18 ? 'Full' : 'Part';
  }
  const r = scorecardTotals(fields, data);
  assert.strictEqual(r.possible, 64, 'total should be 64, got ' + r.possible);
  assert.strictEqual(r.earned, 60, 'earned should be 60, got ' + r.earned);
  assert.strictEqual(Math.round(r.earned / r.possible * 100), 94);
});
t('an N/A question shrinks the total for that record only', () => {
  const na = { id: 'na', type: 'dropdown', scoring: { rule: 'choices' },
               options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] };
  const fields = [Q_CLEAN, na];
  assert.deepStrictEqual(scorecardTotals(fields, { q1: 'Yes', na: 'Clean' }), { earned: 7, possible: 7 });
  assert.deepStrictEqual(scorecardTotals(fields, { q1: 'Yes', na: 'Not applicable' }), { earned: 4, possible: 4 });
});
t('a record where everything was N/A produces no total, not a divide by zero', () => {
  const na = { id: 'na', type: 'dropdown', scoring: { rule: 'choices' },
               options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] };
  const r = scorecardTotals([na], { na: 'Not applicable' });
  assert.strictEqual(r.possible, 0);
  assert.strictEqual(r.earned, 0);
});
t('a table with no scored questions at all totals nothing', () => {
  assert.deepStrictEqual(scorecardTotals([Q_PLAIN], { q3: 'hello' }), { earned: 0, possible: 0 });
});
t('renaming a choice keeps its price, because the price is on the choice', () => {
  const renamed = JSON.parse(JSON.stringify(Q_RATE));
  renamed.options[0].en = 'Outstanding';
  assert.strictEqual(questionMaxPoints(renamed), 3);
  assert.strictEqual(questionEarned(renamed, { q2: 'Outstanding' }), 3);
});
t('no fields and no data is a total of nothing, not a crash', () => {
  assert.deepStrictEqual(scorecardTotals(null, null), { earned: 0, possible: 0 });
});

if (!process.exitCode) console.log(n + ' passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-rules.test.js
```
Expected: throws `could not find function choicePoints in index.html`.

- [ ] **Step 3: Write the implementation**

Insert directly after the closing brace of `condMet` (near line 5195), so `condMet` is defined above the code that calls it:

```js
  // ---- Scorecard rules -----------------------------------------------------------
  // A scorecard prices its own questions. `app_fields.scoring` holds the question-level
  // rule and the choice objects hold their own prices, so renaming a choice keeps what it
  // is worth. Everything here is arithmetic over one record: nothing renders, nothing is
  // stored, and the same rules are mirrored in SQL by score_submission() so that a public
  // submit, a staff edit, an added record and an import all agree.
  //
  // The rule that matters most: a question that was never asked leaves the total. Hidden
  // by "ask only if", or answered with a choice marked N/A. A branch with no kitchen must
  // not score worse than a branch with a spotless one for the same work. A question that
  // was asked and missed is a different thing and stays in the total, earning nothing.
  function choicePoints(o) {
    if (!o || typeof o !== "object") return 0;
    var n = parseFloat(o.points);
    return isNaN(n) ? 0 : n;
  }
  // The most a question can give. A priced choice list works it out from the choices and
  // never stores it, because a maximum stored beside the choices is a maximum that
  // disagrees with them the first time one is repriced.
  function questionMaxPoints(f) {
    var sc = f && f.scoring;
    if (!sc) return 0;
    if (sc.rule === "choices") {
      var list = Array.isArray(f.options) ? f.options : [];
      if (f.type === "multi_select") {
        return list.reduce(function (a, o) { var p = choicePoints(o); return a + (p > 0 ? p : 0); }, 0);
      }
      return list.reduce(function (a, o) { return Math.max(a, choicePoints(o)); }, 0);
    }
    var n = parseFloat(sc.points);
    return isNaN(n) ? 0 : n;
  }
  // The choices this question treats as "does not apply here".
  function naChoices(f) {
    return (Array.isArray(f && f.options) ? f.options : [])
      .filter(function (o) { return o && typeof o === "object" && o.na; })
      .map(function (o) { return o.en; });
  }
  function questionApplies(f, data) {
    if (!f || !f.scoring) return false;
    if (!condMet(f, data)) return false;              // never asked on this record
    var v = (data || {})[f.id];
    var txt = v == null ? "" : String(v);
    if (!txt) return true;                            // asked and missed still counts
    var na = naChoices(f);
    if (!na.length) return true;
    // Stored comma-joined for a multi-select. Only a wholly N/A answer takes the question
    // out: ticking N/A alongside a real answer is still an answer.
    return !txt.split(/\s*,\s*/).every(function (p) { return na.indexOf(p) !== -1; });
  }
  function questionEarned(f, data) {
    var sc = f && f.scoring;
    if (!sc) return 0;
    var v = (data || {})[f.id];
    var txt = v == null ? "" : String(v);
    if (sc.rule === "choices") {
      if (!txt) return 0;
      var by = {};
      (Array.isArray(f.options) ? f.options : []).forEach(function (o) { if (o && o.en) by[o.en] = o; });
      var parts = txt.split(/\s*,\s*/);
      if (f.type === "multi_select") {
        return parts.reduce(function (a, p) { return a + choicePoints(by[p]); }, 0);
      }
      return choicePoints(by[parts[0]]);
    }
    var max = questionMaxPoints(f);
    if (sc.rule === "equals") {
      return (sc.earn || []).some(function (w) {
        return String(w).toLowerCase() === txt.toLowerCase();
      }) ? max : 0;
    }
    if (sc.rule === "threshold") {
      var n = parseFloat(txt), tv = parseFloat(sc.value);
      if (isNaN(n) || isNaN(tv)) return 0;   // a blank number is a non-answer, not a pass
      if (sc.op === "<") return n < tv ? max : 0;
      if (sc.op === ">") return n > tv ? max : 0;
      return n === tv ? max : 0;
    }
    return txt ? max : 0;                    // rule "answered": the points are for answering
  }
  function scorecardTotals(fields, data) {
    var earned = 0, possible = 0;
    (fields || []).forEach(function (f) {
      if (!questionApplies(f, data)) return;
      possible += questionMaxPoints(f);
      earned += questionEarned(f, data);
    });
    return { earned: earned, possible: possible };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-rules.test.js
```
Expected: exit code 0 and an `N passed` line, with no `FAIL:` lines.

- [ ] **Step 5: Check the page still parses**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" -e "const fs=require('fs');const s=fs.readFileSync('index.html','utf8');const js=[...s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');new (require('vm').Script)(js);console.log('parses')"
```
Expected: `parses`.

- [ ] **Step 6: Commit**

```bash
git add index.html docs/tests/scoring-rules.test.js
git commit -m "feat: the scorecard rules, as pure functions"
```

---

### Task 3: The record view shows the breakdown for a builder-made scorecard

`scoredDetail` already renders a per-question breakdown and a headline percentage, driven by imported scorer fields. It gains a second path for tables carrying `config.scored`, returning the same shape so `scoreHeadHtml` and `scoreBreakdownHtml` need no changes at all.

**Files:**
- Modify: `index.html` — `scoredDetail` (near line 8946 in the pre-Task-2 numbering; find it by name)
- Test: `docs/tests/scoring-rules.test.js` (extend)

**Interfaces:**
- Consumes: `scorecardTotals`, `questionApplies`, `questionEarned`, `questionMaxPoints` (Task 2); `esc`, `cellValueHtml` (existing).
- Produces: `scoredDetail(table, fields, d)` returning `{html, earned, possible, sections}` or `null`, unchanged in shape.

- [ ] **Step 1: Write the failing test**

Append to `docs/tests/scoring-rules.test.js`, before the final `if (!process.exitCode)` line:

```js
// ---- the record view's own totals ----
// scoredDetail is what the record header reads. It has two paths now: the imported
// scorer-field path that QC and Mystery Shopper use, and the rules path a builder-made
// scorecard uses. They must not interfere with each other.
const SD = load('index.html', ['scoredDetail', 'questionScorerMap', 'questionApplies', 'questionEarned',
  'questionMaxPoints', 'choicePoints', 'naChoices', 'condMet', 'esc', 'cellValueHtml', 'scorecardTotals']);

t('a table that is not scored at all returns nothing', () => {
  assert.strictEqual(SD.scoredDetail({ config: {} }, [Q_CLEAN], { q1: 'Yes' }), null);
});
t('a builder-made scorecard totals from its rules', () => {
  const table = { config: { scored: true, score_field: 'pct' } };
  const sd = SD.scoredDetail(table, [Q_CLEAN, Q_RATE], { q1: 'Yes', q2: 'Acceptable' });
  assert.ok(sd, 'expected a breakdown');
  assert.strictEqual(sd.possible, 7);
  assert.strictEqual(sd.earned, 5);
});
t('the breakdown names every scored question', () => {
  const table = { config: { scored: true, score_field: 'pct' } };
  const labelled = [Object.assign({ label: 'Floors clean' }, Q_CLEAN)];
  const sd = SD.scoredDetail(table, labelled, { q1: 'Yes' });
  assert.ok(sd.html.includes('Floors clean'), 'expected the question in the breakdown');
});
t('an N/A question is shown as n/a rather than as a zero', () => {
  const table = { config: { scored: true, score_field: 'pct' } };
  const q = { id: 'k', label: 'Kitchen', type: 'dropdown', scoring: { rule: 'choices' },
              options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] };
  const sd = SD.scoredDetail(table, [q], { k: 'Not applicable' });
  assert.strictEqual(sd.possible, 0, 'an N/A question must not be in the total');
  assert.ok(sd.html.includes('n/a'), 'expected the row to read n/a, got: ' + sd.html);
});
t('sections group and each carries its own total', () => {
  const table = { config: { scored: true, score_field: 'pct' } };
  const a = { id: 'a', label: 'A', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 2, section: 'Cleanliness' } };
  const b = { id: 'b', label: 'B', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 3, section: 'Service' } };
  const sd = SD.scoredDetail(table, [a, b], { a: 'Yes', b: 'No' });
  assert.strictEqual(sd.sections.length, 2);
  const clean = sd.sections.filter(s => s.name === 'Cleanliness')[0];
  assert.deepStrictEqual([clean.earned, clean.possible], [2, 2]);
});
t('a scorecard with no priced questions yet returns nothing rather than an empty box', () => {
  assert.strictEqual(SD.scoredDetail({ config: { scored: true, score_field: 'pct' } }, [Q_PLAIN], {}), null);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-rules.test.js
```
Expected: `FAIL: a builder-made scorecard totals from its rules -> expected a breakdown` (the current `scoredDetail` returns null when `questionScorerMap` is empty).

- [ ] **Step 3: Add the rules path to `scoredDetail`**

In `scoredDetail`, replace these three lines:

```js
    var map = questionScorerMap(table, fields);      // questionFieldId -> scorerField
    var qIds = Object.keys(map);
    if (!qIds.length) return null;
```

with:

```js
    var map = questionScorerMap(table, fields);      // questionFieldId -> scorerField
    // A builder-made scorecard has no scorer fields. Its points are rules on the questions
    // themselves, so the breakdown is worked out here instead of read out of a column. The
    // shape returned is identical, which is why the header and the section totals below
    // need to know nothing about which kind of scorecard they are showing.
    if (cfg.scored) return scoredDetailFromRules(fields, d);
    var qIds = Object.keys(map);
    if (!qIds.length) return null;
```

Then add the new function immediately after `scoredDetail`'s closing brace:

```js
  // The same breakdown as the imported path, computed from app_fields.scoring. Grouped by
  // scoring.section, and a question that does not apply on this record reads "n/a" and is
  // in neither total, exactly as an imported scorer holding null does.
  function scoredDetailFromRules(fields, d) {
    var scored = (fields || []).filter(function (f) { return f && f.scoring; });
    if (!scored.length) return null;
    var bySection = {}, order = [];
    scored.forEach(function (f) {
      var sec = (f.scoring && f.scoring.section) || "Score";
      if (!bySection[sec]) { bySection[sec] = []; order.push(sec); }
      bySection[sec].push(f);
    });
    var earned = 0, possible = 0, sections = [], html = "";
    order.forEach(function (sec) {
      var se = 0, sp = 0, rows = "";
      bySection[sec].forEach(function (f) {
        var applies = questionApplies(f, d);
        var maxP = questionMaxPoints(f);
        var pts = applies ? questionEarned(f, d) : 0;
        if (applies) { se += pts; sp += maxP; earned += pts; possible += maxP; }
        var answered = d && d[f.id] != null && d[f.id] !== "";
        var cls = !applies ? "na" : (pts >= maxP ? "plus" : (pts > 0 ? "na" : "zero"));
        var lbl = !applies ? "n/a" : (pts > 0 ? "+" + pts : "0");
        rows += '<div class="q-scored"><div class="ql"><div class="qq">' + esc(f.label) + '</div>' +
          '<div class="qa">' + (answered ? cellValueHtml(f, d, null) : '<span class="empty-box"></span>') + '</div></div>' +
          '<div class="qp ' + cls + '">' + lbl + '</div></div>';
      });
      sections.push({ name: sec, earned: se, possible: sp });
      var showHead = !(order.length === 1 && sec === "Score");
      html += (showHead ? '<div class="qsec-head"><span>' + esc(sec) + '</span><span class="sub">' + se + '/' + sp + '</span></div>' : "") + rows;
    });
    return { html: html, earned: earned, possible: possible, sections: sections };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-rules.test.js
```
Expected: exit code 0 and an `N passed` line, six cases higher than the previous run.

- [ ] **Step 5: Commit**

```bash
git add index.html docs/tests/scoring-rules.test.js
git commit -m "feat: the record view builds a scorecard's breakdown from its rules"
```

---

### Task 4: The column and the trigger

The stored percentage is what the grid, filters, sort, group-by and CSV export read. It is written by the database so that all four write paths agree: the public form RPC, the reviewer PATCH, `create_record()`, and imports.

This SQL is **not applied in this task**. It is written, reviewed and committed; applying it to the live database is a separate, deliberate step at the end.

**Files:**
- Create: `blktable-migration/workspaces/40-scorecard-rules.sql` in the PRIVATE folder. `*.sql` is gitignored in this repo because it is public and served at blktable.blk.jo, and 39 is the real highest number there
- Modify: `docs/tests/README.md` — add the two new suites to the table

- [ ] **Step 1: Check whether the database already has a conditional-question helper**

The app's `condMet` has a SQL counterpart from `06-conditional-questions-and-education-table.sql`. Reusing it keeps one rule in one place.

Run (see the self-host access recipe in the private runbook for the three-call form):
```sql
select proname, pg_get_function_identity_arguments(oid)
from pg_proc where proname in ('cond_met', 'condition_met', 'show_if_met');
```

If a helper exists, use its name in Step 2 instead of defining `cond_met`. If none exists, keep the definition below.

- [ ] **Step 2: Write the SQL**

Create `/c/Users/ASUS/blktable-migration/workspaces/40-scorecard-rules.sql`:

```sql
-- Scorecards built in the app: points live on app_fields.scoring and on the choice
-- objects, and the percentage is written here so that every write path agrees.
--
-- Inert by design for everything that exists today. It returns immediately unless the
-- table carries config.scored, which none of the 226 current tables do, and the imported
-- QC / Mystery Shopper engine is untouched and keeps running as it is. Nothing is ever
-- rescored: this fires on the row being written and on nothing else.

alter table app_fields add column if not exists scoring jsonb;

-- Does this question apply on this record? Mirrors condMet() in index.html.
create or replace function cond_met(show_if jsonb, data jsonb) returns boolean as $$
declare
  fid text;
  want jsonb;
  v text;
  parts text[];
begin
  if show_if is null or show_if->>'field' is null then return true; end if;
  fid := show_if->>'field';
  v := coalesce(data->>fid, '');
  want := show_if->'equals';
  if want is null or jsonb_typeof(want) = 'null' then return v <> ''; end if;
  if jsonb_typeof(want) <> 'array' then want := jsonb_build_array(want); end if;
  parts := regexp_split_to_array(v, '\s*,\s*');
  return exists (
    select 1 from jsonb_array_elements_text(want) w
    where w = v or w = any(parts)
  );
end;
$$ language plpgsql immutable;

-- What one choice is worth, and whether it means "does not apply here".
create or replace function choice_points(options jsonb, answer text) returns numeric as $$
declare p numeric := 0;
begin
  if options is null or jsonb_typeof(options) <> 'array' then return 0; end if;
  select coalesce((o->>'points')::numeric, 0) into p
  from jsonb_array_elements(options) o where o->>'en' = answer limit 1;
  return coalesce(p, 0);
exception when others then return 0;   -- a price somebody typed as text is no price
end;
$$ language plpgsql immutable;

create or replace function answer_is_na(options jsonb, answer text) returns boolean as $$
declare na text[];
begin
  if options is null or jsonb_typeof(options) <> 'array' or coalesce(answer,'') = '' then
    return false;
  end if;
  select array_agg(o->>'en') into na
  from jsonb_array_elements(options) o where coalesce((o->>'na')::boolean, false);
  if na is null then return false; end if;
  -- only a wholly N/A answer takes the question out of the total
  return not exists (
    select 1 from unnest(regexp_split_to_array(answer, '\s*,\s*')) p where not (p = any(na))
  );
end;
$$ language plpgsql immutable;

create or replace function score_submission() returns trigger as $$
declare
  cfg jsonb;
  sfield text;
  f record;
  ans text;
  sc jsonb;
  rule text;
  qmax numeric;
  qearn numeric;
  earned numeric := 0;
  possible numeric := 0;
begin
  select config into cfg from app_tables where id = new.table_id;
  if cfg is null or coalesce((cfg->>'scored')::boolean, false) = false then
    return new;
  end if;
  sfield := cfg->>'score_field';
  if sfield is null then return new; end if;

  for f in
    select id::text as id, type, options, show_if, scoring
    from app_fields where table_id = new.table_id and scoring is not null
  loop
    sc := f.scoring;
    rule := coalesce(sc->>'rule', 'answered');
    ans := coalesce(new.data->>f.id, '');

    -- never asked: hidden by "ask only if", or answered N/A. Both leave the total.
    if not cond_met(f.show_if, new.data) then continue; end if;
    if answer_is_na(f.options, ans) then continue; end if;

    if rule = 'choices' then
      if f.type = 'multi_select' then
        select coalesce(sum(greatest(coalesce((o->>'points')::numeric, 0), 0)), 0) into qmax
          from jsonb_array_elements(coalesce(f.options,'[]'::jsonb)) o;
        select coalesce(sum(choice_points(f.options, p)), 0) into qearn
          from unnest(regexp_split_to_array(nullif(ans,''), '\s*,\s*')) p;
        qearn := coalesce(qearn, 0);
      else
        select coalesce(max(coalesce((o->>'points')::numeric, 0)), 0) into qmax
          from jsonb_array_elements(coalesce(f.options,'[]'::jsonb)) o;
        qearn := choice_points(f.options, ans);
      end if;
    else
      qmax := coalesce((sc->>'points')::numeric, 0);
      qearn := 0;
      if rule = 'equals' then
        if exists (select 1 from jsonb_array_elements_text(coalesce(sc->'earn','[]'::jsonb)) w
                   where lower(w) = lower(ans)) then qearn := qmax; end if;
      elsif rule = 'threshold' then
        begin
          if ans <> '' and sc->>'value' is not null then
            if (sc->>'op') = '<' and ans::numeric <  (sc->>'value')::numeric then qearn := qmax;
            elsif (sc->>'op') = '>' and ans::numeric >  (sc->>'value')::numeric then qearn := qmax;
            elsif (sc->>'op') = '=' and ans::numeric =  (sc->>'value')::numeric then qearn := qmax;
            end if;
          end if;
        exception when others then qearn := 0;   -- a number that is not a number scores nothing
        end;
      else
        if ans <> '' then qearn := qmax; end if;
      end if;
    end if;

    possible := possible + coalesce(qmax, 0);
    earned := earned + coalesce(qearn, 0);
  end loop;

  -- everything was N/A, or nothing is priced yet: no score rather than a division by zero
  if possible > 0 then
    new.data := coalesce(new.data, '{}'::jsonb)
      || jsonb_build_object(sfield, round(earned / possible, 4));
  end if;
  return new;
exception when others then
  -- A scoring bug must never be able to break a submit. 226 tables do not score at all
  -- and must not learn to fail because one that does has a bad rule.
  return new;
end;
$$ language plpgsql;

drop trigger if exists score_submission_trg on app_submissions;
create trigger score_submission_trg
  before insert or update of data on app_submissions
  for each row execute function score_submission();
```

- [ ] **Step 3: Check the SQL parses without applying it**

Run it inside a transaction that is rolled back, so nothing is installed:
```sql
begin;
i /tmp/scoring.sql
rollback;
```
Expected: no errors, and `rollback` leaves the database exactly as it was. If `alter table ... add column if not exists` reports it already exists, that is fine and means a previous run reached that line.

- [ ] **Step 4: Record the new suites in the tests README**

Add two rows to the table in `docs/tests/README.md`:

```markdown
| `scoring-options.test.js` | prices and the N/A marker surviving the Options box (`parseChoiceList`, `optsToString`) — that the tokens are order independent, that a price of zero is kept rather than dropped as falsy, that a price which is not a number becomes no price rather than NaN, and that a full list round-trips unchanged. The builder rebuilds every choice from this text on each save, so a token it cannot read is a price that quietly becomes zero |
| `scoring-rules.test.js` | what a score means (`questionMaxPoints`, `questionApplies`, `questionEarned`, `scorecardTotals`, `scoredDetail`) — the worked example of 60 out of 64 reading 94%, per-choice prices, multi-select adding up, a blank number not passing as zero the way Airtable's did, and above all the denominator rule: a question hidden by "ask only if" or answered N/A leaves the total, while one that was asked and missed stays in it. The same rules are mirrored in `blktable-migration/workspaces/40-scorecard-rules.sql`, and the two must agree |
```

- [ ] **Step 5: Commit**

```bash
git add docs/tests/README.md   # the SQL itself is gitignored and lives in the private folder
git commit -m "feat: app_fields.scoring and the trigger that writes a scorecard's percentage"
```

---

### Task 5: Points in the builder

Every question row gains a Points box on a scorecard, choice questions get a price per choice, and a running total sits under the question list. This is the part the request was really about: making it obvious what you are building while you build it.

**Files:**
- Modify: `index.html` — `addBuilderField` (near line 10254), `serializeBuilder` (near line 10319), `runBuilderSave`, `fieldRowsFor`, `openBuilderEdit`, plus CSS near `.bld-field` (line 1193)
- Test: `docs/tests/scoring-builder.test.js` (create)

**Interfaces:**
- Consumes: `parseChoiceList` (Task 1), `questionMaxPoints` (Task 2).
- Produces:
  - `rowScoring(row)` → the `scoring` object for one builder row, or `null`
  - `builderTotalPoints(rows)` → number, the sum of every row's maximum
  - `scoringToInputs(scoring)` → `{points, rule, earn, op, value, section}` for filling the row back in

- [ ] **Step 1: Write the failing test**

Create `docs/tests/scoring-builder.test.js`:

```js
// The builder's own arithmetic. The total under the question list is the number somebody
// is really building, and it has to be right while they are still typing: a total that
// only becomes true on save is a total nobody can trust.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const { builderTotalPoints, scoringToInputs, choicePoints, questionMaxPoints } =
  load('index.html', ['builderTotalPoints', 'scoringToInputs', 'questionMaxPoints', 'choicePoints']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// builderTotalPoints takes the same {type, options, scoring} shape the save produces, so
// the number under the list and the number the database stores cannot come apart.
t('the total is the sum of every question maximum', () => {
  const rows = [
    { type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 4 } },
    { type: 'dropdown', scoring: { rule: 'choices' },
      options: [{ en: 'Excellent', points: 3 }, { en: 'Poor', points: 0 }] }
  ];
  assert.strictEqual(builderTotalPoints(rows), 7);
});
t('unpriced questions add nothing', () => {
  assert.strictEqual(builderTotalPoints([{ type: 'short_text' }]), 0);
});
t('an empty form totals zero rather than NaN', () => {
  assert.strictEqual(builderTotalPoints([]), 0);
  assert.strictEqual(builderTotalPoints(null), 0);
});
t('an N/A choice does not raise the maximum', () => {
  const rows = [{ type: 'dropdown', scoring: { rule: 'choices' },
                  options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] }];
  assert.strictEqual(builderTotalPoints(rows), 3);
});
t('a multi-select contributes all its priced choices', () => {
  const rows = [{ type: 'multi_select', scoring: { rule: 'choices' },
                  options: [{ en: 'A', points: 2 }, { en: 'B', points: 1 }] }];
  assert.strictEqual(builderTotalPoints(rows), 3);
});

// ---- filling a saved question back into the row ----
t('a saved rule comes back as inputs', () => {
  const i = scoringToInputs({ rule: 'threshold', op: '<', value: 5, points: 2, section: 'Kitchen' });
  assert.strictEqual(i.points, 2);
  assert.strictEqual(i.op, '<');
  assert.strictEqual(i.value, 5);
  assert.strictEqual(i.section, 'Kitchen');
});
t('no rule at all comes back as an empty points box, not a zero', () => {
  const i = scoringToInputs(null);
  assert.strictEqual(i.points, '');
});
t('a choices rule has no points of its own, because the choices carry them', () => {
  assert.strictEqual(scoringToInputs({ rule: 'choices' }).points, '');
});

if (!process.exitCode) console.log(n + ' passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-builder.test.js
```
Expected: throws `could not find function builderTotalPoints in index.html`.

- [ ] **Step 3: Add the two pure helpers**

Insert after `scorecardTotals` (Task 2's block):

```js
  // The total under the builder's question list. Takes the same {type, options, scoring}
  // shape the save writes, so the number somebody watches while building and the number
  // the database stores are produced by one function rather than two that agree by luck.
  function builderTotalPoints(rows) {
    return (rows || []).reduce(function (a, r) { return a + questionMaxPoints(r); }, 0);
  }
  // A saved rule, back into the row's boxes. A priced choice list shows no points box of
  // its own: its maximum is the choices, and a second place to type it is a second answer.
  function scoringToInputs(sc) {
    sc = sc || {};
    var flat = sc.rule && sc.rule !== "choices";
    return {
      points: flat && sc.points != null ? sc.points : "",
      rule: sc.rule || "",
      earn: (sc.earn || []).join(", "),
      op: sc.op || "<",
      value: sc.value == null ? "" : sc.value,
      section: sc.section || ""
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-builder.test.js
```
Expected: exit code 0 and an `N passed` line, with no `FAIL:` lines.

- [ ] **Step 5: Add the CSS for the points row**

Insert after the `.bld-field .rm` rule (near line 1203):

```css
  /* Scorecard only: the price of a question, and the running total under the list. */
  .bld-field .r3 { display: none; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px;
                   padding-top: 8px; border-top: 1px dashed var(--line); }
  .scored-build .bld-field .r3 { display: flex; }
  .bld-field .r3 .pl { color: var(--muted); font-size: var(--fs-3); }
  .bld-field input.fpts, .bld-field input.fscval { width: 74px; min-height: 34px; padding: 6px 8px;
    border-radius: 8px; border: 1px solid var(--field-border); background: var(--field-bg);
    color: var(--text); font-size: var(--fs-3); box-sizing: border-box; }
  .bld-field input.fsec { flex: 1; min-width: 110px; min-height: 34px; padding: 6px 8px;
    border-radius: 8px; border: 1px solid var(--field-border); background: var(--field-bg);
    color: var(--text); font-size: var(--fs-3); box-sizing: border-box; }
  .bld-field select.fscop, .bld-field select.fscearn { height: 34px; padding: 0 24px 0 8px;
    border-radius: 8px; border: 1px solid var(--field-border); background: var(--field-bg);
    color: var(--text); font-size: var(--fs-3); appearance: none; -webkit-appearance: none; }
  .bld-field .qmax { color: var(--silver); font-size: var(--fs-3); font-family: var(--font-mono, monospace); }
  #bld-total { display: none; margin: 10px 0 2px; padding: 10px 12px; border-radius: 10px;
    border: 1px solid var(--line); background: rgba(255,255,255,0.03);
    color: var(--silver); font-size: var(--fs-3); }
  .scored-build #bld-total { display: block; }
  #bld-total b { font-family: var(--font-mono, monospace); font-size: var(--fs-4); color: var(--text); }
```

- [ ] **Step 6: Add the points row to every question**

In `addBuilderField`, append to `row.innerHTML` (after the `.r2` div, before the closing of the template):

```js
      '<div class="r3">' +
        '<span class="pl">Points</span><input class="fpts" type="number" min="0" step="0.5" placeholder="0">' +
        '<select class="fscearn"><option value="">for answering</option><option value="Yes">for Yes</option><option value="No">for No</option></select>' +
        '<select class="fscop"><option value="">no number rule</option><option value="&lt;">when under</option><option value="&gt;">when over</option><option value="=">when exactly</option></select>' +
        '<input class="fscval" type="number" step="any" placeholder="value">' +
        '<span class="qmax"></span>' +
        '<input class="fsec" placeholder="Section (optional), e.g. Cleanliness">' +
      '</div>'
```

Then, still inside `addBuilderField`, after the existing `if (data) { ... }` block, fill and wire the row:

```js
    if (data && data.scoring) {
      var si = scoringToInputs(data.scoring);
      row.querySelector(".fpts").value = si.points;
      row.querySelector(".fscearn").value = si.earn.split(",")[0].trim();
      row.querySelector(".fscop").value = si.op === "<" && si.rule !== "threshold" ? "" : si.op;
      row.querySelector(".fscval").value = si.value;
      row.querySelector(".fsec").value = si.section;
    }
    bldScoreVisibility(row);
    [".fpts", ".fscearn", ".fscop", ".fscval", ".fsec"].forEach(function (s) {
      row.querySelector(s).addEventListener("input", function () { bldScoreVisibility(row); refreshBuilderTotal(); saveDraft(); });
      row.querySelector(s).addEventListener("change", function () { bldScoreVisibility(row); refreshBuilderTotal(); saveDraft(); });
    });
    row.querySelector(".opts").addEventListener("input", refreshBuilderTotal);
    row.querySelector(".ftype").addEventListener("change", function () { bldScoreVisibility(row); refreshBuilderTotal(); });
```

- [ ] **Step 7: Add the row-level helpers and the running total**

Insert immediately before `addBuilderField`:

```js
  // Which of the points boxes make sense for this question's type. A priced choice list
  // prices its choices in the Options box, so it shows its worked-out maximum instead of
  // a points box; everything else needs a number typed.
  function bldScoreVisibility(row) {
    var type = row.querySelector(".ftype").value;
    var choices = type === "dropdown" || type === "multi_select";
    row.querySelector(".fpts").style.display = choices ? "none" : "";
    row.querySelector(".fscearn").style.display = type === "yesno" ? "" : "none";
    var num = type === "number";
    row.querySelector(".fscop").style.display = num ? "" : "none";
    row.querySelector(".fscval").style.display = num && row.querySelector(".fscop").value ? "" : "none";
    row.querySelector(".pl").textContent = choices ? "Priced per choice in Options" : "Points";
    var max = questionMaxPoints(rowFieldShape(row));
    row.querySelector(".qmax").textContent = max ? "max " + max : "";
  }
  // One builder row, in the same {type, options, scoring} shape the save and the database
  // use, so the total on screen is computed from exactly what will be stored.
  function rowFieldShape(row) {
    var type = row.querySelector(".ftype").value;
    var options = (type === "dropdown" || type === "multi_select")
      ? parseChoiceList(row.querySelector(".opts").value) : null;
    return { type: type, options: options, scoring: rowScoring(row) };
  }
  // The scoring rule for one row, or null when this question is not priced. Reading it
  // from the boxes rather than from a flag means a question stops being scored the moment
  // its points are cleared, with nothing left behind to disagree with the total.
  function rowScoring(row) {
    var type = row.querySelector(".ftype").value;
    var section = row.querySelector(".fsec").value.trim();
    if (type === "dropdown" || type === "multi_select") {
      var list = parseChoiceList(row.querySelector(".opts").value);
      var priced = list.some(function (o) { return typeof o.points === "number"; });
      if (!priced) return null;
      var sc = { rule: "choices" };
      if (section) sc.section = section;
      return sc;
    }
    var pts = parseFloat(row.querySelector(".fpts").value);
    if (isNaN(pts)) return null;
    var out = { points: pts };
    if (section) out.section = section;
    if (type === "yesno" && row.querySelector(".fscearn").value) {
      out.rule = "equals"; out.earn = [row.querySelector(".fscearn").value];
    } else if (type === "number" && row.querySelector(".fscop").value) {
      out.rule = "threshold"; out.op = row.querySelector(".fscop").value;
      out.value = parseFloat(row.querySelector(".fscval").value);
      if (isNaN(out.value)) return null;    // a threshold with no number is not a rule
    } else {
      out.rule = "answered";
    }
    return out;
  }
  function refreshBuilderTotal() {
    var el = document.getElementById("bld-total");
    if (!el) return;
    var rows = [].slice.call(bldHost().querySelectorAll(".bld-field"));
    var shapes = rows.map(rowFieldShape);
    var scored = shapes.filter(function (s) { return s.scoring; }).length;
    var total = builderTotalPoints(shapes);
    el.innerHTML = scored
      ? "Total: <b>" + total + "</b> points across " + scored + " scored question" + (scored === 1 ? "" : "s") +
        ". Every record is scored out of the questions that applied to it."
      : "No points set yet. Give a question points and it starts counting towards the total.";
  }
```

- [ ] **Step 8: Add the total element to the modal**

In the builder modal HTML, immediately after `<div class="bld-fields" id="bld-fields"></div>` (near line 1811):

```html
        <div id="bld-total"></div>
```

- [ ] **Step 9: Carry scoring through the save and the draft**

In `runBuilderSave`, inside the per-row loop, add `scoring` to the pushed object by appending to the `fields.push({...})` call:

```js
scoring: rowScoring(rows[i]),
```

In `fieldRowsFor`, add `scoring` to the returned row:

```js
               options: f.options, show_if: f.show_if, scoring: f.scoring || null };
```

In `saveTableEdit`, add `scoring: f.scoring || null` to both the `update({...})` object and the `toInsert.push({...})` object, so clearing a question's points actually clears it.

In `serializeBuilder`, add to the per-row object so a draft keeps its prices:

```js
          pts: r.querySelector(".fpts").value, scEarn: r.querySelector(".fscearn").value,
          scOp: r.querySelector(".fscop").value, scVal: r.querySelector(".fscval").value,
          scSec: r.querySelector(".fsec").value
```

And in `openBuilder`'s draft restore path, after `addBuilderField(f)`, the values are set from `data` only if `addBuilderField` reads them; add to `addBuilderField`'s `if (data)` block:

```js
      if (data.pts != null) row.querySelector(".fpts").value = data.pts;
      if (data.scEarn) row.querySelector(".fscearn").value = data.scEarn;
      if (data.scOp) row.querySelector(".fscop").value = data.scOp;
      if (data.scVal != null) row.querySelector(".fscval").value = data.scVal;
      if (data.scSec) row.querySelector(".fsec").value = data.scSec;
```

In `openBuilderEdit`, where each existing field is turned into a row, pass `scoring: f.scoring` through in the object handed to `addBuilderField`.

- [ ] **Step 10: Run the tests and check the page parses**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-builder.test.js
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-rules.test.js
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" -e "const fs=require('fs');const s=fs.readFileSync('index.html','utf8');const js=[...s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');new (require('vm').Script)(js);console.log('parses')"
```
Expected: all pass, then `parses`.

- [ ] **Step 11: Commit**

```bash
git add index.html docs/tests/scoring-builder.test.js
git commit -m "feat: price a question in the builder, with the total kept in front of you"
```

---

### Task 6: The picker

The front door. Three types, each reshaping step two.

**Files:**
- Modify: `index.html` — the builder modal HTML (near line 1795), `openBuilder`, `setBuilderChrome`, `builderConfig`, the create branch of `runBuilderSave`, and CSS near the modal styles
- Test: `docs/tests/table-purpose.test.js` (create)

**Interfaces:**
- Consumes: `builderConfig(extra)`, `slugify(s)` (existing).
- Produces:
  - `TABLE_PURPOSES` → `[{v, label, blurb, kind, scored}]`
  - `purposeOf(v)` → the entry, falling back to the plain form
  - `purposeConfig(v)` → `{kind, scored}` for the insert

- [ ] **Step 1: Write the failing test**

Create `docs/tests/table-purpose.test.js`:

```js
// What a table is for, asked once at creation. The picker is the whole point of this
// feature: it is the moment somebody finds out that a checklist has no public link and a
// scorecard has points. These tests hold the mapping steady, because the type decides
// which parts of the builder somebody is shown and getting it wrong is a table built with
// the wrong half of the editor.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  (?:var ' + name + ' = \\[[\\s\\S]*?\\n  \\];|function ' + name + '\\s*\\([\\s\\S]*?\\n  \\})', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find ' + name + ' in ' + file);
  return m[0];
}
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const { TABLE_PURPOSES, purposeOf, purposeConfig } =
  load('index.html', ['TABLE_PURPOSES', 'purposeOf', 'purposeConfig']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

t('three types are offered', () => {
  assert.strictEqual(TABLE_PURPOSES.length, 3);
});
t('every type says what it is in plain words', () => {
  TABLE_PURPOSES.forEach(p => {
    assert.ok(p.label && p.blurb, 'a type with no label or blurb teaches nobody: ' + JSON.stringify(p));
    assert.ok(!/—/.test(p.label + p.blurb), 'house style: no em-dashes in copy');
  });
});
t('a plain form is what the app already made', () => {
  assert.deepStrictEqual(purposeConfig('form'), { kind: 'form', scored: false });
});
t('a scorecard is a form that scores', () => {
  assert.deepStrictEqual(purposeConfig('scorecard'), { kind: 'form', scored: true });
});
t('a checklist is a task and has no public form', () => {
  assert.deepStrictEqual(purposeConfig('checklist'), { kind: 'task', scored: false });
});
t('an unknown type falls back to a plain form rather than nothing', () => {
  assert.deepStrictEqual(purposeConfig('nonsense'), { kind: 'form', scored: false });
  assert.strictEqual(purposeOf('nonsense').v, 'form');
});
t('the fallback also covers an empty pick', () => {
  assert.strictEqual(purposeOf('').v, 'form');
  assert.strictEqual(purposeOf(undefined).v, 'form');
});

if (!process.exitCode) console.log(n + ' passed');
```

- [ ] **Step 2: Run it to make sure it fails**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/table-purpose.test.js
```
Expected: throws `could not find TABLE_PURPOSES in index.html`.

- [ ] **Step 3: Define the types**

Insert immediately before `function openBuilder()`:

```js
  // ---- What are you making? ------------------------------------------------------
  // Creation used to hand everybody the same blank form and the same six sections, most
  // of which did not apply to what they were doing. The pick is made once, at creation,
  // and its job is to take things away: a checklist stops showing a public link, a
  // scorecard starts showing points. Editing an existing table never asks again, because
  // changing a live table's type is a different question with records already in it.
  var TABLE_PURPOSES = [
    { v: "form", label: "Form", kind: "form", scored: false,
      blurb: "Collects answers from people through a public link." },
    { v: "scorecard", label: "Scorecard", kind: "form", scored: true,
      blurb: "A form whose answers earn points and produce a percentage." },
    { v: "checklist", label: "Checklist", kind: "task", scored: false,
      blurb: "Work your team completes. No public link." }
  ];
  function purposeOf(v) {
    return TABLE_PURPOSES.filter(function (p) { return p.v === v; })[0] || TABLE_PURPOSES[0];
  }
  function purposeConfig(v) {
    var p = purposeOf(v);
    return { kind: p.kind, scored: p.scored };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/table-purpose.test.js
```
Expected: exit code 0 and an `N passed` line, with no `FAIL:` lines.

- [ ] **Step 5: Add the picker screen to the modal**

Insert immediately before `<div class="m-name" id="bld-title">` (near line 1799):

```html
        <div id="bld-purpose">
          <div class="m-name">What are you making?</div>
          <div class="m-sub">This sets up the next screen. You can change the questions later, but not the type.</div>
          <div class="bp-list" id="bld-purpose-list"></div>
        </div>
```

Add the CSS beside the other builder styles:

```css
  /* The first screen of creation: three types, each saying what it is. */
  .bp-list { display: grid; gap: 10px; margin: 16px 0 4px; }
  .bp-card { display: block; width: 100%; text-align: left; padding: 14px 16px; border-radius: 12px;
    border: 1px solid var(--line); background: rgba(255,255,255,0.02); color: var(--text);
    cursor: pointer; font: inherit; }
  .bp-card:hover { border-color: var(--silver); background: rgba(255,255,255,0.05); }
  .bp-card .bp-name { font-size: var(--fs-4); margin-bottom: 3px; }
  .bp-card .bp-blurb { color: var(--muted); font-size: var(--fs-3); }
  #bld-purpose { display: none; }
  .picking #bld-purpose { display: block; }
  .picking #bld-title, .picking #bld-sub, .picking .bld-two, .picking #bld-fields,
  .picking #bld-total, .picking #bld-add-field, .picking .bld-stages-wrap,
  .picking .bld-actions-wrap, .picking .bld-layers-wrap, .picking .m-actions { display: none; }
```

- [ ] **Step 6: Show the picker when creating, and act on the pick**

Add a module-level variable beside `builderMode`:

```js
  var builderPurpose = "form";
```

Replace the body of `openBuilder()` so it shows the picker first:

```js
  function openBuilder() {
    useBuilderHost();               // claim the question editor back from any Form tab
    editingTableId = null; editingFieldIds = [];
    builder.classList.add("picking");
    var host = document.getElementById("bld-purpose-list");
    host.innerHTML = TABLE_PURPOSES.map(function (p) {
      return '<button type="button" class="bp-card" data-v="' + p.v + '">' +
        '<div class="bp-name">' + esc(p.label) + '</div>' +
        '<div class="bp-blurb">' + esc(p.blurb) + '</div></button>';
    }).join("");
    [].slice.call(host.querySelectorAll(".bp-card")).forEach(function (b) {
      b.addEventListener("click", function () { startBuilderFor(b.getAttribute("data-v")); });
    });
    builder.classList.add("open");
  }
  // Step two, now that we know what it is for.
  function startBuilderFor(v) {
    builderPurpose = v;
    builder.classList.remove("picking");
    builder.classList.toggle("scored-build", purposeOf(v).scored);
    setBuilderChrome("create");
    document.getElementById("bld-msg").textContent = "";
    var d = loadDraft();
    if (draftHasContent(d) && (d.purpose || "form") === v) {
      document.getElementById("bld-name").value = d.name || "";
      document.getElementById("bld-name-ar").value = d.nameAr || "";
      setIntroInputs({ en: d.intro, ar: d.introAr });
      bldHost().innerHTML = "";
      (d.fields && d.fields.length ? d.fields : [null]).forEach(function (f) { addBuilderField(f); });
      resolveCondPending();
      var note = document.getElementById("bld-draft-note"); if (note) note.textContent = "Restored your unsaved draft";
    } else {
      resetBuilder();
    }
    refreshBuilderTotal();
    requestAnimationFrame(growAllBld);
  }
```

Add `purpose: builderPurpose` to the object `serializeBuilder()` returns, so a restored draft cannot land in the wrong type of builder.

- [ ] **Step 7: Say what is being built, and hide what does not apply**

In `setBuilderChrome`, replace the `bld-sub` line with a version that reads from the pick:

```js
    document.getElementById("bld-sub").textContent = isCreate ? purposeOf(builderPurpose).blurb
      : (isBuiltin ? "The built-in questions are fixed. Add your own extra questions below — they appear on the form and in each entry."
      : "Add, edit, or remove questions. Changes apply to new submissions.");
```

And add, at the end of `setBuilderChrome`:

```js
    // A checklist is worked through by staff, so the sections that only mean something to
    // a public form come off the screen rather than sitting there inviting a wrong answer.
    var isTaskBuild = isCreate && purposeOf(builderPurpose).kind === "task";
    var iw = document.querySelector("#builder-modal .bld-intro-wrap") ||
             document.getElementById("bld-intro") && document.getElementById("bld-intro").parentNode;
    if (iw) iw.style.display = isTaskBuild ? "none" : "";
```

In `openBuilderEdit`, add `builder.classList.remove("picking");` and set the scored class from the table being edited, right after `setBuilderChrome("edit")`:

```js
    builder.classList.remove("picking");
    builder.classList.toggle("scored-build", !!(table.config && table.config.scored));
```

- [ ] **Step 8: Write the type on create**

In the create branch of `runBuilderSave`, replace the insert with one that carries the type, and create the score field for a scorecard. Replace:

```js
    db.from("app_tables").insert({ slug: slug, name: name, name_ar: nameAr || null, config: builderConfig({ country: scope.country }) }).select().single().then(function (tRes) {
```

with:

```js
    var pc = purposeConfig(builderPurpose);
    db.from("app_tables").insert({ slug: slug, name: name, name_ar: nameAr || null, kind: pc.kind,
      config: builderConfig({ country: scope.country, scored: pc.scored || null }) }).select().single().then(function (tRes) {
```

Then, in the same chain, after the fields are inserted, point `config.score_field` at a percentage field. Replace the `.then(function () { return tRes.data; })` with:

```js
        .then(function () { return pc.scored ? addScoreField(tid) : null; })
        .then(function () { return tRes.data; });
```

And add the helper beside `fieldRowsFor`:

```js
  // A scorecard needs somewhere to keep its percentage, because the grid, the filters, the
  // sort and the CSV export all read a field rather than recompute the rules. It is marked
  // as a percentage so it prints as 94% rather than 0.9444, and staff-only because it is
  // worked out rather than answered.
  function addScoreField(tid) {
    return db.from("app_fields").insert({
      table_id: tid, position: 9000, label: "Score", label_ar: "النتيجة", type: "number",
      required: false, internal: true, options: { score_fmt: "percent" }
    }).select().single().then(function (r) {
      if (r.error) throw r.error;
      return db.from("app_tables").select("config").eq("id", tid).single().then(function (c) {
        if (c.error) throw c.error;
        // merged, never replaced: writing a fresh object here wiped sixteen keys once
        var cfg = Object.assign({}, c.data.config || {}, { score_field: r.data.id });
        return db.from("app_tables").update({ config: cfg }).eq("id", tid);
      });
    });
  }
```

- [ ] **Step 9: Say the right thing when it is made**

In the `.then(function (t) {...})` that follows creation, replace the `window.prompt` line so a checklist is not offered a public link it does not have:

```js
      setTimeout(function () {
        openCustomTable(t);
        if (purposeOf(builderPurpose).kind !== "task") {
          window.prompt("Table created! Public form link (share this):", publicFormLink(t.slug));
        }
      }, 400);
```

- [ ] **Step 10: Run every suite**

Run:
```bash
for f in docs/tests/*.test.js; do
  echo "== $f"
  ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" "$f"
done
```
Expected: every suite passes. Any `FAIL:` line is a regression to fix before committing.

- [ ] **Step 11: Check the page parses**

Run:
```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" -e "const fs=require('fs');const s=fs.readFileSync('index.html','utf8');const js=[...s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');new (require('vm').Script)(js);console.log('parses')"
```
Expected: `parses`.

- [ ] **Step 12: Commit**

```bash
git add index.html docs/tests/table-purpose.test.js
git commit -m "feat: creation asks what you are making, and sets up the builder for it"
```

---

### Task 7: Apply the SQL and check it against the app on one real table

Everything so far is code that behaves whether or not the database has changed. This is where the two meet, and it is the only task that touches the live database.

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Apply the SQL**

Number the file at this point, since other sessions claim numbers too (34 is the highest referenced today):
```bash
# already named 40-scorecard-rules.sql in the private folder
```
Apply it against the live database using the three-call recipe in the private self-host runbook. Confirm afterwards:
```sql
select column_name from information_schema.columns
 where table_name = 'app_fields' and column_name = 'scoring';
select tgname from pg_trigger where tgname = 'score_submission_trg';
```
Expected: one row each.

- [ ] **Step 2: Prove the trigger is inert for everything that exists**

```sql
select count(*) from app_tables where config ? 'scored';
select count(*) from app_fields where scoring is not null;
```
Expected: `0` and `0`. If either is non-zero before a scorecard has been built, stop: something wrote where it should not have.

- [ ] **Step 3: Build a real scorecard through the UI**

In the app, click Create, pick **Scorecard**, and build a small one: a Yes/No worth 4 for Yes, and a dropdown priced Excellent 3, Acceptable 1, Poor 0, plus a choice `Not applicable|لا ينطبق|na`. Confirm the total under the list reads **7**.

- [ ] **Step 4: Submit through the public form and check the arithmetic**

Open the form's public link, answer Yes and Acceptable, and submit. Then in the record:

Expected: the header reads **71%** with **5 / 7 points**, and the breakdown shows `+4` and `+1`.

- [ ] **Step 5: Check the N/A rule end to end**

Submit again, answering Yes and **Not applicable**.

Expected: **100%** with **4 / 4 points**, and the N/A question reading `n/a` rather than `0`. This is the rule the whole design turns on, so if it reads 57% here, stop and compare `scorecardTotals` against `score_submission()` before going further.

- [ ] **Step 6: Check the stored value agrees with the screen**

```sql
select data->>'<scoreFieldId>' from app_submissions
 where table_id = '<tid>' order by created_at desc limit 2;
```
Expected: `1.0000` and `0.7143`. A disagreement between this and the record header means the two implementations of the rule have come apart, which is exactly what the mirrored tests exist to catch.

- [ ] **Step 7: Check nothing else moved**

Open QC and Mystery Shopper. Expected: their headline scores and per-question breakdowns are exactly as before, and `select count(*) from app_submissions where table_id in (<qc>, <ms>)` is unchanged. Their tables carry no `config.scored`, so the new trigger returned on its second line.

- [ ] **Step 8: Update STATUS.md**

Add to Current state, in the list of table-wide standards:

```markdown
- **A table says what it is for when you make it (all future tables, 2026-08-25):** Create asks first, with three types. **Form** is what the app always made. **Checklist** is `kind='task'`, with no public link, the shape the 33 Operate imports already had but which no human could choose. **Scorecard** prices its own questions: points per question, or a price per choice so "Excellent" 3 and "Acceptable" 1, with the total worked out from the questions rather than typed, shown live under the list while you build. A record is scored out of what applied to it: a question hidden by "ask only if", or answered with a choice marked N/A, leaves the total, so a branch with no kitchen is not marked down for not having one. A question that was asked and missed stays in the total and earns nothing. Rules live on `app_fields.scoring` and on the choice objects, so renaming a choice keeps its price; the percentage is written by a trigger so the public form, a staff edit, an added record and an import all agree, and the grid, filters, sort and CSV export read it as an ordinary field. **QC and Mystery Shopper are untouched**: they carry no `config.scored` and no `scoring`, so the new trigger returns on its second line and their imported engine keeps running. Nothing is ever rescored. `blktable-migration/workspaces/40-scorecard-rules.sql`; tests across `scoring-rules`, `scoring-options`, `scoring-builder` and `table-purpose`.
```

Add a dated line to the Log:

```markdown
- 2026-08-25: table purpose at creation (Form / Scorecard / Checklist) and builder-made scorecards. Applied `35-scorecard-rules.sql`. Deliberately left out: an event Signup type, whose machinery is all live but which needs a parent-table screen of its own.
```

- [ ] **Step 9: Commit and open the PR**

```bash
git add STATUS.md
git commit -m "docs: STATUS for table purpose and builder-made scorecards"
git push -u origin feat/table-purpose-scoring
gh pr create --title "A table says what it is for, and a scorecard you can build in the UI" --body "..."
```

Remember the squash-merge trap: the branch is deleted on merge, so before any follow-up work run `git fetch --prune` and start again from fresh `origin/main` rather than reusing this branch.

---

## Self-Review

**Spec coverage.** Picker with three types: Task 6. Builder reshaping by type: Tasks 5 and 6. Points per question and per choice: Tasks 1 and 5. Total worked out and shown live: Task 5. Denominator rule: Task 2, mirrored in Task 4's SQL, proven end to end in Task 7. `app_fields.scoring` column: Task 4. Per-choice points on choice objects: Task 1. `config.scored` and `config.score_field`: Tasks 4 and 6. Trigger with its guards: Task 4. Browser breakdown path: Task 3. QC and Mystery Shopper untouched: asserted in Task 7 Steps 2 and 7. Signup deliberately absent: recorded in Task 7's STATUS line. Tests: Tasks 1, 2, 3, 5, 6.

**Naming consistency.** `parseChoiceList`, `choicePoints`, `questionMaxPoints`, `naChoices`, `questionApplies`, `questionEarned`, `scorecardTotals`, `scoredDetailFromRules`, `rowFieldShape`, `rowScoring`, `bldScoreVisibility`, `builderTotalPoints`, `scoringToInputs`, `refreshBuilderTotal`, `TABLE_PURPOSES`, `purposeOf`, `purposeConfig`, `addScoreField`, `startBuilderFor` are each defined once and used under the same name everywhere.

**Known sharp edge, called out rather than hidden.** The rule now exists twice, in JS and in PL/pgSQL. Task 7 Step 6 compares them on real data and the test file says so in its header. If they ever disagree, the SQL is the one that is stored and the JS is the one people see, so both have to be fixed together.
