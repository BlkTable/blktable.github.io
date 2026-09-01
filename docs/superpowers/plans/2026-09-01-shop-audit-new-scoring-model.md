# Shop Audit on the builder's scoring model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shop Audit scores through the model the builder writes (`app_fields.scoring` on the question plus `points` on each answer, computed by `score_submission()`), so its scorecard can be read and edited in the app instead of only in SQL — and it scores again at all.

**Architecture:** The rules move off the 68 hidden `<Question> Score` columns (`options.score`, read by `compute_scores()`) and onto the questions themselves. The two engines are gated on different keys and cannot both act on a table: `apply_scores()` wants `config.scoring` or a field with `options.score`; `score_submission()` wants `config.scorecard = true`. The migration therefore prices the answers, writes the `scoring` column, then flips the gate in one transaction. Every step is proved by replaying the 15 live records through both engines and requiring the same number out.

**Tech Stack:** Postgres (self-hosted Supabase at `db.blktable.blk.jo`), plain ES5 in `index.html`, node test scripts run through VS Code's bundled node, headless Chrome for DOM tests.

**Spec:** none — this plan is the spec. It supersedes STATUS next-step `0-A` for Shop Audit only; QC and Mystery Shopper stay on the old engine until this one is proved in production.

## Global Constraints

- **The live database is production and has no staging copy.** Every migration runs first with `sed 's/^commit;$/rollback;/'` and is read back before the real run. Recipe and SSH details: memory `project_blktable_selfhost_deploy_access`.
- **Shop Audit has 15 live records and 0 imported ones.** `apply_scores()` and `score_submission()` both step aside for `extra._import`; **neither steps aside here**, so any write to `data` rescores real records that people have already been shown. Bulk corrections go inside `set local session_replication_role = replica`.
- **The new engine matches answer text exactly** (`choice_points`: `o->>'en' = answer`). The old one compares `btrim(val) = btrim(expect)`. Whitespace that the old engine forgave is a lost point under the new one.
- **Parity is the acceptance test, not a nicety.** 14 of the 15 records carry a score somebody has already reported on (80.9%, 79.4%, 88.2%, …). A migration that moves those numbers without a stated reason is a regression.
- The denominator is constant on this table today and must stay that way: **0 of the 68 scored questions is conditional, and no choice is marked N/A.** If either becomes true later the denominator starts varying per record, which is the new engine's intended behaviour but is *not* what this migration is allowed to introduce.
- Do not touch **Shop Spot Check (QC)** or **Mystery Shopper**. QC is the only intact copy of the rules and is the reference for anything ambiguous.
- Every table has both a **question** and its retired **score column**. The rules move onto the *question*; the score columns are left in place and stop being written (Task 7 decides their fate).

## The starting state, measured 2026-09-01

| | |
| --- | --- |
| Shop Audit rules in the live DB | **0** — all 68 erased by a builder save on 2026-08-31 11:31:50 UTC |
| Recovered rule set | 70, in `workspaces/42` + `43` (the 68th point) + `50` + `51` |
| by kind | 63 `match`, 5 `contains_all`, 1 `compare`, 1 `match_any` |
| by question type | 59 dropdown, 8 multi-select, 2 number, 1 dropdown (match_any) |
| penalties (`else: -2`) | 3 |
| `expect` not among the question's choices | **8** |
| live records | **15** (0 imported); the newest reads 0/68 |
| `config` | `score_field` = `6243fd52…` (the %), `score_raw_field` = `0bda441e…` (out of 68), `score_max` = 68, `scoring` = the two roll-ups |

## File Structure

- `C:\Users\ASUS\blktable-migration\workspaces\57-shop-audit-choice-lists-restored.sql` — **new.** Undoes the two choice lists the 2026-08-31 save re-split. Stands alone because it is correct under either engine and should ship first.
- `C:\Users\ASUS\blktable-migration\workspaces\58-shop-audit-new-scoring-model.sql` — **new.** The migration itself: prices the answers, writes `scoring`, flips the gate, asserts parity, rescores the 15.
- `docs/tests/shop-audit-parity.test.js` — **new.** Replays the 15 real records through the JS mirrors of both engines and requires the same score. The fixture is committed, so the check survives the migration that makes it moot.
- `docs/tests/fixtures/shop-audit-2026-09-01.json` — **new.** The 15 records' answers, the 70 questions with their choices, and the score each carries today. Anonymous: field ids and answers only, no names.
- `index.html` — **modified.** Only if Task 4 chooses `all_of`: the JS mirror of the new engine (`questionMaxPoints`, `questionEarned`) gains that rule beside `choices`.
- `docs/tests/scoring-rules.test.js` — **modified.** Same condition: the new rule is tested where the other new-model rules are.
- `STATUS.md` — **modified.** `0-D` closed, `0-A` narrowed to QC and Mystery Shopper.

---

### Task 1: Restore the two choice lists the 2026-08-31 save re-split

The save that erased the rules also re-split two answer lists on their own internal commas — the exact defect PR #120 removed, running one last time under the old code. Migration 42 had repaired both on 2026-08-26.

| question | Shop Audit today | QC (untouched) |
| --- | --- | --- |
| `Is the Maestro On? / المايسترو شغال؟` | **6** choices (`No` / `there is no Maestro…` / `Yes` / `but not effective…` / `Yes` / `and they are good…`) | **3** |
| `Sink Area` | **4** (`Clean` / `Neat or Organized` / `Dirty` / `Messy or Unorganized`) | **2** |

Nobody filling the form today can pick the answer either rule scores on, and the migration in Task 5 cannot price a choice that is not there.

**Files:**
- Create: `C:\Users\ASUS\blktable-migration\workspaces\57-shop-audit-choice-lists-restored.sql`

**Interfaces:**
- Produces: the two questions `1043447c-8b94-4e84-a8c9-4f50f87ea686` (Maestro) and `5ea102f5-555a-430a-abf1-65712663683d` (Sink Area) hold Airtable's own 3- and 2-choice lists. Task 5 relies on every rule's expected answer existing as a choice.

- [ ] **Step 1: Write the check that fails**

Save as `/tmp/57-check.sql` and run it (three calls: `scp`, `docker cp`, `psql -f`):

```sql
select f.label, jsonb_array_length(f.options) as choices
from app_fields f
where f.id in ('1043447c-8b94-4e84-a8c9-4f50f87ea686','5ea102f5-555a-430a-abf1-65712663683d');
```

Expected now: 6 and 4. Required after: 3 and 2.

- [ ] **Step 2: Write the migration**

```sql
begin;
-- The lists are Airtable's own, copied from workspaces/42 section 3, which repaired the
-- same two questions on 2026-08-26. The builder save of 2026-08-31 re-split them on their
-- internal commas -- the old Options box joined answers with ", " and re-split on commas,
-- so an answer containing a comma could not survive a round trip. PR #120 removed that
-- round trip; this puts back what the last run of it broke.
update public.app_fields set options = '[
  {"en":"No, there is no Maestro / لا، ما في مايسترو","ar":""},
  {"en":"Yes, but not effective / نعم، موجود بس عل فاضي","ar":""},
  {"en":"Yes, and they are good / نعم، موجود و قوي","ar":""}]'::jsonb
 where id = '1043447c-8b94-4e84-a8c9-4f50f87ea686';

update public.app_fields set options = '[
  {"en":"Clean, Neat or Organized","ar":""},
  {"en":"Dirty, Messy or Unorganized","ar":""}]'::jsonb
 where id = '5ea102f5-555a-430a-abf1-65712663683d';

-- refuse to commit if this did not do exactly what it says
do $$
declare n int;
begin
  select count(*) into n from public.app_fields
   where id in ('1043447c-8b94-4e84-a8c9-4f50f87ea686','5ea102f5-555a-430a-abf1-65712663683d')
     and jsonb_array_length(options) in (2, 3);
  if n <> 2 then raise exception 'choice lists not restored (got % of 2)', n; end if;
end $$;
commit;
```

- [ ] **Step 3: Dry-run it**

```bash
sed 's/^commit;$/rollback;/' 57-shop-audit-choice-lists-restored.sql > /tmp/57-dry.sql
```
Copy and run. Expected: `ROLLBACK`, no exception raised.

- [ ] **Step 4: Apply, then re-run the Step 1 check**

Expected: 3 and 2. No `app_submissions` row was written, so nothing was rescored.

- [ ] **Step 5: Confirm the answers already stored still match**

```sql
select count(*) filter (where data->>'5ea102f5-555a-430a-abf1-65712663683d' = 'Clean, Neat or Organized') as sink_ok,
       count(*) filter (where data->>'1043447c-8b94-4e84-a8c9-4f50f87ea686' = 'Yes, and they are good / نعم، موجود و قوي') as maestro_ok
from app_submissions where table_id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b';
```
Expected: 11 and 10 — the stored answers always kept their full text, which is why history still scored while the form could not.

---

### Task 2: Freeze the 15 records and the 70 rules as a test fixture

Parity cannot be argued from a migration that has already run. Capture the input and the answer first.

**Files:**
- Create: `docs/tests/fixtures/shop-audit-2026-09-01.json`

**Interfaces:**
- Produces: `{ fields: [{id, label, type, options, show_if}], records: [{id, data, pct_today, raw_today}], rules: [{source, scorer, kind, expect|expect_any|tokens|op|threshold, points, else}] }`. Tasks 3 and 6 read it.

- [ ] **Step 1: Pull the three parts out of the live database**

```sql
\pset format unaligned
\pset tuples_only on
select jsonb_pretty(jsonb_build_object(
  'fields', (select jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label, 'type', f.type,
                                                 'options', f.options, 'show_if', f.show_if)
                              order by f.position)
             from app_fields f where f.table_id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b'),
  'records', (select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data,
                       'raw_today', s.data->>'0bda441e-f860-44ea-b169-5c3d6042ec0d',
                       'pct_today', s.data->>'6243fd52-92d5-48c3-9ea2-6071b46d3e60')
                      order by s.created_at)
              from app_submissions s where s.table_id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b')));
```

- [ ] **Step 2: Add the 70 rules to the same file**

They are not in the database any more — they were erased. Take them from `workspaces/42` (Shop Audit block, between `-- ---- Shop Audit ---` and `-- ---- 2.`), then apply the amendments in `43` (the 68th point: `expect` becomes `"Excellent ( > 85%)"`), `50` and `51` in that order. Record which file each rule's final form came from, in a `from` key.

- [ ] **Step 3: Assert the fixture is complete before trusting it**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" -e "
const f = require('./docs/tests/fixtures/shop-audit-2026-09-01.json');
console.log(f.rules.length, f.records.length, f.fields.length);
"
```
Expected: `70 15 265`. Anything else means the extraction dropped something; fix it before continuing.

- [ ] **Step 4: Commit**

```bash
git add docs/tests/fixtures/shop-audit-2026-09-01.json
git commit -m "test: freeze Shop Audit's 15 records and 70 rules before the model change"
```

---

### Task 3: A failing parity test — the new model must reproduce today's score

This is the gate the whole migration hangs on. It runs entirely in node against the fixture, using the page's own mirrors of both engines, so it can be iterated in seconds instead of against production.

**Files:**
- Create: `docs/tests/shop-audit-parity.test.js`

**Interfaces:**
- Consumes: the fixture from Task 2.
- Produces: `mapRuleToScoring(rule, question)` → `{ scoring, pricedOptions }`, the single function that decides how one old rule becomes new-model data. Task 5's SQL is generated from exactly this function's output, so the tested mapping and the applied mapping cannot drift.

- [ ] **Step 1: Write the failing test**

```javascript
// Shop Audit's scorecard, moved from the rules compute_scores() reads to the ones the
// builder writes. The migration is only allowed to change WHERE a rule lives, not what any
// of the 15 real records scores -- 14 of them carry a percentage somebody has already been
// shown. Both engines are mirrored in index.html, so both run here against the same data.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const FIX = require('./fixtures/shop-audit-2026-09-01.json');

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

// the new engine's arithmetic, and condMet which both engines share
const NEW = load('index.html', ['choicePoints', 'questionMaxPoints', 'naChoices',
                                'questionApplies', 'questionEarned', 'condMet']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// One old rule, as the new model would hold it. Returns the question's `scoring` column and
// the answer list with prices on it. This is the only place the mapping is decided.
function mapRuleToScoring(rule, q) {
  const price = (en, pts) => (q.options || []).map(function (o) {
    const name = typeof o === 'string' ? o : o.en;
    const out = { en: name, ar: (typeof o === 'string' ? '' : o.ar) || '' };
    if (name === en) out.points = rule.points;
    else if (Number(rule.else) !== 0) out.points = Number(rule.else);
    return out;
  });
  if (rule.kind === 'match' && (q.type === 'dropdown' || q.type === 'multi_select')) {
    return { scoring: { rule: 'choices' }, pricedOptions: price(String(rule.expect).trim(), rule.points) };
  }
  if (rule.kind === 'match_any') {
    const want = rule.expect_any.map(String);
    return { scoring: { rule: 'choices' }, pricedOptions: (q.options || []).map(function (o) {
      const name = typeof o === 'string' ? o : o.en;
      const out = { en: name, ar: (typeof o === 'string' ? '' : o.ar) || '' };
      if (want.indexOf(name) !== -1) out.points = rule.points;
      return out;
    }) };
  }
  if (rule.kind === 'compare') {
    return { scoring: { rule: 'threshold', op: rule.op, value: rule.threshold, points: rule.points },
             pricedOptions: q.options || null };
  }
  if (rule.kind === 'match' && q.type === 'number') {
    return { scoring: { rule: 'threshold', op: '=', value: Number(rule.expect), points: rule.points },
             pricedOptions: q.options || null };
  }
  if (rule.kind === 'contains_all') {
    // decided in Task 4 — until then this is deliberately unmapped
    return null;
  }
  throw new Error('no mapping for ' + rule.kind + ' on a ' + q.type);
}

const byId = {};
FIX.fields.forEach(f => { byId[f.id] = f; });

// ---- every rule maps, and maps onto an answer that exists ----
t('every recovered rule has a mapping', () => {
  const unmapped = FIX.rules.filter(r => mapRuleToScoring(r, byId[r.source]) === null);
  assert.strictEqual(unmapped.length, 0, unmapped.length + ' rules have no mapping: ' +
    unmapped.map(r => r.kind).join(', '));
});
t('every priced question actually prices something', () => {
  const dead = FIX.rules.map(r => {
    const m = mapRuleToScoring(r, byId[r.source]);
    if (!m || m.scoring.rule !== 'choices') return null;
    const max = questionMax({ type: byId[r.source].type, options: m.pricedOptions, scoring: m.scoring });
    return max > 0 ? null : byId[r.source].label;
  }).filter(Boolean);
  assert.strictEqual(dead.length, 0, 'these questions can never earn a point: ' + dead.join(' | '));
});
function questionMax(f) { return NEW.questionMaxPoints(f); }

// ---- the 15 real records score the same as they do today ----
function newScore(record) {
  let earned = 0, possible = 0;
  FIX.rules.forEach(r => {
    const q = byId[r.source], m = mapRuleToScoring(r, q);
    if (!m) return;
    const f = { id: q.id, type: q.type, options: m.pricedOptions, scoring: m.scoring, show_if: q.show_if };
    if (!NEW.questionApplies(f, record.data)) return;
    possible += NEW.questionMaxPoints(f);
    earned += NEW.questionEarned(f, record.data);
  });
  return { earned: earned, possible: possible };
}

FIX.records.forEach(rec => {
  t('record ' + rec.id.slice(0, 8) + ' scores what it scores today', () => {
    const got = newScore(rec);
    assert.strictEqual(got.possible, 68, 'the denominator moved: ' + got.possible);
    assert.strictEqual(String(got.earned), String(rec.raw_today),
      'earned ' + got.earned + ', today it reads ' + rec.raw_today);
  });
});

if (!process.exitCode) console.log('ok - ' + n + ' assertions');
```

- [ ] **Step 2: Run it and watch it fail**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/shop-audit-parity.test.js
```

Expected: `FAIL: every recovered rule has a mapping -> 5 rules have no mapping: contains_all…`, and a list of records whose earned total is short. **Read the record failures before writing any code** — each one names a question whose answer text no longer matches its own choice list, and that list is the real output of this task.

- [ ] **Step 3: Record what the failures say**

Write the list into the plan file under Task 4 as the decisions actually needed. Do not fix them yet: a mapping changed to make a test pass is a mapping nobody chose.

- [ ] **Step 4: Commit the failing test**

```bash
git add docs/tests/shop-audit-parity.test.js
git commit -m "test: Shop Audit's 15 records must score the same on the new model (failing)"
```

---

### Task 4: Decide the three cases the new model cannot express, and make the test pass

Each of these is a real behaviour choice, not an implementation detail. **Do not start this task until the user has answered.** The recommendation is stated for each.

**4a. `contains_all` on 8 multi-select questions.** Old: all listed tokens must be ticked or the question earns nothing. New `choices`: each ticked answer adds its own price, so half the tokens earn half the points.

| question | tokens |
| --- | --- |
| Sandwich Press Area | Clean + Organized |
| Storage Room | Clean + Organized |
| Music | Sound level is Good + Choice of Music is Good |
| Back Shelf Clean & Stocked | Clean + Fully Stocked with Beans |
| Espresso Grinder | Hopper is clean + No Dust |

*Recommended:* add a fourth rule, `{"rule":"all_of","points":1}`, to the new model — the question earns its points only when every priced answer is ticked. It preserves the numbers exactly, it is ~10 lines in `score_submission()` and ~6 in the JS mirror, and it is a rule any future scorecard will want. *Alternative:* accept partial credit, which is defensible on its own terms but silently re-scores history.

**4b. The 3 penalties (`else: -2`).** A wrong answer costs two points. In the new model the wrong choices simply carry `points: -2`; `questionMaxPoints` takes the maximum, so the question still contributes 1 to the denominator and −2 to the total when missed. *Recommended:* map as described. No decision needed unless the test disagrees.

**4c. The raw column.** `score_submission()` writes one value, the fraction, into `config.score_field`. Nothing writes `score_raw_field` (`Final Score (out of 68)`), which is a column in the grid people read. *Recommended:* extend `score_submission()` to write `score_raw_field` with `earned` when the table has one — three lines, and it keeps the grid honest.

**Files:**
- Modify: `index.html` (the `all_of` rule beside `choices` in `questionMaxPoints` and `questionEarned`) — only under 4a-recommended
- Modify: `docs/tests/scoring-rules.test.js`
- Modify: `docs/tests/shop-audit-parity.test.js` (the `contains_all` branch of `mapRuleToScoring`)

- [ ] **Step 1: Write the failing test for `all_of` in the new model's own test file**

```javascript
// "all of these, or nothing" — a multi-select question that is only right when every priced
// answer is ticked. Airtable expressed it as a formula over the whole answer string; the
// choices rule cannot, because it adds each ticked answer up independently.
const allOf = { id: 'q', type: 'multi_select', scoring: { rule: 'all_of', points: 1 },
                options: [{ en: 'Clean', points: 1 }, { en: 'Organized', points: 1 }, { en: 'Dirty' }] };
t('all_of earns its points only when every priced answer is ticked', () => {
  assert.strictEqual(questionEarned(allOf, { q: 'Clean, Organized' }), 1);
});
t('all_of earns nothing for half of them', () => {
  assert.strictEqual(questionEarned(allOf, { q: 'Clean' }), 0);
});
t('all_of is worth its points, not the sum of its answers', () => {
  assert.strictEqual(questionMaxPoints(allOf), 1);
});
t('an unpriced answer alongside the priced ones does not block the point', () => {
  assert.strictEqual(questionEarned(allOf, { q: 'Clean, Organized, Dirty' }), 1);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-rules.test.js
```
Expected: the four new assertions fail (`all_of` falls through to the flat-points branch and earns 1 for any answer).

- [ ] **Step 3: Implement `all_of` in `questionMaxPoints` and `questionEarned`**

In `questionMaxPoints`, beside the `sc.rule === "choices"` branch:

```javascript
    if (sc.rule === "all_of") {
      var n = parseFloat(sc.points);
      return isNaN(n) ? 0 : n;                 // the question's price, not its answers' sum
    }
```

In `questionEarned`, beside the same:

```javascript
    if (sc.rule === "all_of") {
      var want = (Array.isArray(f.options) ? f.options : [])
        .filter(function (o) { return o && typeof o.points === "number" && o.points > 0; })
        .map(function (o) { return o.en; });
      if (!want.length || !txt) return 0;
      var ticked = txt.split(/\s*,\s*/);
      var all = want.every(function (w) { return ticked.indexOf(w) !== -1; });
      return all ? questionMaxPoints(f) : 0;
    }
```

- [ ] **Step 4: Run the new-model tests**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/scoring-rules.test.js
```
Expected: all pass, previous count + 4.

- [ ] **Step 5: Map `contains_all` onto it in the parity test**

Replace the `null` branch:

```javascript
  if (rule.kind === 'contains_all') {
    const toks = rule.tokens.map(String);
    return { scoring: { rule: 'all_of', points: rule.points }, pricedOptions: (q.options || []).map(function (o) {
      const name = typeof o === 'string' ? o : o.en;
      const out = { en: name, ar: (typeof o === 'string' ? '' : o.ar) || '' };
      if (toks.indexOf(name) !== -1) out.points = rule.points;
      return out;
    }) };
  }
```

- [ ] **Step 6: Run the parity test and fix what it names**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/shop-audit-parity.test.js
```
Every remaining failure is a real mismatch between a rule's expected answer and the question's choice list — the 8 counted above, minus the two Task 1 restored. Fix each by correcting the **choice list** to Airtable's own text (QC holds it), never by loosening the comparison: the new engine matches exactly and always will.

- [ ] **Step 7: Falsify the parity test before trusting it**

Change one record's `raw_today` in the fixture by 1 and re-run. It must fail. Change it back. A parity test that cannot fail is the whole risk of this migration.

- [ ] **Step 8: Commit**

```bash
git add index.html docs/tests/scoring-rules.test.js docs/tests/shop-audit-parity.test.js
git commit -m "feat: an all_of scoring rule, and Shop Audit's 15 records score identically on the new model"
```

---

### Task 5: The migration, dry-run against production

**Files:**
- Create: `C:\Users\ASUS\blktable-migration\workspaces\58-shop-audit-new-scoring-model.sql`

**Interfaces:**
- Consumes: `mapRuleToScoring` from Task 3 — the SQL is *generated* from it, not hand-written twice.

- [ ] **Step 1: Generate the SQL from the tested mapping**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
  docs/tests/shop-audit-parity.test.js --emit-sql > /tmp/58-body.sql
```

Add an `--emit-sql` branch to the parity test that prints, for each rule, one `update public.app_fields set options = …, scoring = … where id = '<question id>';`. Generating it means the applied mapping is the one the 15 records were proved against.

- [ ] **Step 2: Wrap it with the gate flip and the parity assertion**

```sql
begin;
-- Shop Audit scores through the builder's model. The rules move off the 68 hidden score
-- columns and onto the questions; the two engines are gated on different keys, so the gate
-- flips in the same transaction or both would run.
\i /tmp/58-body.sql

update public.app_tables
   set config = (config - 'scoring') || jsonb_build_object('scorecard', true)
 where id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b';

-- the old rules are gone from the fields already (erased on 2026-08-31); make it explicit so
-- a future restore of 42 cannot quietly switch the old engine back on underneath this one
update public.app_fields set options = options - 'score' - 'score_fmt'
 where table_id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b' and options ? 'score';

-- Refuse to commit unless every one of the 15 records still scores what it scored. The
-- rescore is a rewrite of data, so it is done here under replica mode and compared.
set local session_replication_role = replica;
create temp table before_ as
  select id, data->>'6243fd52-92d5-48c3-9ea2-6071b46d3e60' as pct,
             data->>'0bda441e-f860-44ea-b169-5c3d6042ec0d' as raw
    from public.app_submissions where table_id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b';
set local session_replication_role = origin;

update public.app_submissions set data = data where table_id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b';

do $$
declare bad int;
begin
  select count(*) into bad
    from before_ b join public.app_submissions s on s.id = b.id
   where coalesce(round((s.data->>'6243fd52-92d5-48c3-9ea2-6071b46d3e60')::numeric, 4), -1)
      <> coalesce(round(b.pct::numeric, 4), -1)
     and b.pct is not null and b.pct <> '0';
  if bad > 0 then raise exception '% of the 15 records changed score', bad; end if;
end $$;
commit;
```

Note the `and b.pct <> '0'` — the Khalda record of 2026-09-01 currently reads 0 and is **expected** to change. It is the one record this migration is meant to move.

- [ ] **Step 3: Dry-run**

```bash
sed 's/^commit;$/rollback;/' 58-shop-audit-new-scoring-model.sql > /tmp/58-dry.sql
```
Copy up and run. Expected: no exception, ends `ROLLBACK`. An exception here means the SQL engine and the JS mirror disagree — stop and find out which is right before going further.

- [ ] **Step 4: Print what the dry run would do to each record**

Add to the dry-run copy, before the rollback:

```sql
select b.id, b.raw as raw_before, s.data->>'0bda441e-f860-44ea-b169-5c3d6042ec0d' as raw_after,
       b.pct as pct_before, s.data->>'6243fd52-92d5-48c3-9ea2-6071b46d3e60' as pct_after
  from before_ b join public.app_submissions s on s.id = b.id order by b.id;
```
Read all 15 rows. Fourteen must be unchanged; Khalda goes from 0 to its real score. **Show this table to the user before Step 5.**

- [ ] **Step 5: Apply**

Three calls: `scp`, `docker cp`, `psql -f`. Expected: `COMMIT`.

---

### Task 6: Prove it on the deployed site, not only in the database

A scorecard that scores in SQL and cannot be read or edited in the app is the thing this migration exists to end.

- [ ] **Step 1: Open Shop Audit's question editor on blktable.blk.jo**

Every scored question shows its answers with a points box filled in — 1 on the right answer, −2 on the three penalties. This is the acceptance criterion of the whole plan: the scorecard is now visible in the app.

- [ ] **Step 2: Save the table without changing anything, then re-run the Task 1 check and the rules count**

```sql
select count(*) filter (where scoring is not null) as scored_questions,
       (select jsonb_array_length(options) from app_fields where id = '5ea102f5-555a-430a-abf1-65712663683d') as sink_choices
from app_fields where table_id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b';
```
Expected: unchanged. This is the regression that started all of it, now proved against the real editor — with the `keptOptions` fix from PR #121 underneath.

- [ ] **Step 3: Submit one real audit through the public form and read its score**

Fill the live form, submit, open the record. The header shows a percentage and the breakdown prices each answer. Delete the test record afterwards, and note that deleting it does not disturb the other 15.

- [ ] **Step 4: Update STATUS.md**

Close `0-D`. Narrow `0-A` to QC and Mystery Shopper, and record that Shop Audit is the worked example for both. Add a Log entry with the before/after table from Task 5 Step 4.

- [ ] **Step 5: Commit and open the PR**

```bash
git add STATUS.md docs/tests/ index.html
git commit -m "feat: Shop Audit scores through the builder's model"
```

---

### Task 7: The columns nobody writes any more (do last, or never)

After Task 5 the 68 `<Question> Score` columns are dead: nothing writes them, and the record panel computes its breakdown from `app_fields.scoring` at render time. They still hold the numbers every past record scored, so **deleting them destroys history**.

- [ ] **Step 1: Leave them in place and mark them internal**

```sql
update public.app_fields set internal = true
 where table_id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b'
   and id::text in (select jsonb_array_elements_text(item->'of')
                    from app_tables t, lateral jsonb_array_elements(t.config->'scoring') item
                    where t.id = 'dd3f984f-b617-4640-8412-4b1f0bd9079b');
```

Wait — `config.scoring` is removed by Task 5, so this must run **before** it or read the list from the fixture. Read it from the fixture.

- [ ] **Step 2: Do not delete them. Record the decision in STATUS.**

A column with two years of scores in it costs nothing to keep and cannot be recovered.

---

## Self-review

**Spec coverage.** Every measured fact in "The starting state" has a task: the 8 bad expects (Tasks 1 and 4 Step 6), the 5 `contains_all` (4a), the 3 penalties (4b), the raw column (4c), the 15 records (2, 3, 5), the erased rules (2, 5), the gate (5), the editor that caused it (6).

**Open decisions, all in Task 4, none of them mine to make:** the `all_of` rule versus partial credit; whether `score_raw_field` keeps being written. Task 4 says explicitly not to start before these are answered.

**Type consistency.** `mapRuleToScoring(rule, question)` returns `{scoring, pricedOptions}` in Tasks 3, 4 and 5. The new rule is spelled `all_of` in the JS, the SQL and the fixture. `score_field` is the fraction and `score_raw_field` the total in every task that names them.

**What this plan does not do.** QC and Mystery Shopper stay on the old engine. Nothing here touches `compute_scores()`, which 2 other tables and 1,588 imported QC rows still depend on.
