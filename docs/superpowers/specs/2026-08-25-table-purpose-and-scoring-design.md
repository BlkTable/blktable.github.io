# Table purpose at creation, and a scorecard you can build in the UI

Date: 2026-08-25
Status: design, approved in conversation, not yet implemented

## The problem

Clicking **Create** opens one long modal: name, intro, questions, stages, actions,
review layers. Every table that comes out of it is the same shape. Nobody is ever
asked what they are making, so an admin building a QC scorecard and an admin
building an event signup stare at the same blank form and the same six sections,
most of which do not apply to either of them.

`app_tables.kind` already exists and already has two values, `form` and `task`, but
`task` has only ever been set by the Operate import script. No human has ever chosen
it, because the UI does not offer it.

The second half of the problem is that a scorecard cannot be built here at all. The
app *displays* per-question scores well (`scoredDetail`, `scoreHeadHtml`,
`scoreBreakdownHtml`), but the points themselves come from Airtable formula columns
imported as "scorer" fields, and the arithmetic that fills them is hand-written
PL/pgSQL for QC and Mystery Shopper specifically. Build a new scored table today and
its score is permanently blank.

## What we are building

Two things, in one flow.

**A purpose picker as step one of creation.** Three types, each of which reshapes
step two rather than merely labelling the result. The picker teaches by what it
removes: a checklist stops showing a public link, a scorecard starts showing points.

**Scorecard rules in the builder.** Points per question, points per choice, and a
total that works itself out.

## Part A: the picker

Create opens a short first screen, "What are you making?", with three choices:

| Choice | What it says | What it sets |
| --- | --- | --- |
| **Form** | Collects answers from people through a public link. | `kind='form'` (today's behaviour, unchanged) |
| **Scorecard** | A form whose answers earn points and produce a percentage. | `kind='form'`, `config.scored=true` |
| **Checklist** | Work your team completes. No public link. | `kind='task'` |

Step two is then the builder as it is today, minus what does not apply:

- **Form**: exactly what exists now. This path must be byte-for-byte the current
  behaviour, because it is how all 226 tables were made.
- **Scorecard**: every question row grows a Points box, and a running total sits at
  the foot of the question list. On save the builder also creates the field that
  holds the percentage and points `config.score_field` at it.
- **Checklist**: the public-link and QR sections are hidden, as they already are for
  the 33 imported Operate tables (`kind === "task"` is checked in six places
  already, so this is a matter of setting the value, not writing new rules).

The picker is skipped entirely when editing an existing table. Its answer is a
property of creation, and changing a live table's type is a different feature with
different questions (what happens to records already scored under the old shape).

### Deliberately not in the picker: Signup

An event signup type is the obvious fourth entry, and all its machinery is already
live: `config.parent` for one link per record, `config.capacity` for places and a
backup list. What it does not have is any builder UI. A parent table has to be
chosen, the fields the public may see have to be named, places and backup counts
have to be set. That is its own screen and its own spec.

Three types that work end to end beat four with one that opens onto nothing. Adding
Signup later is one more card in the picker plus that screen; nothing in this design
blocks it.

## Part B: how a scorecard scores

### The shape, from the worked example

> First question is worth 4 points. The second is worth 3, with three answers, each
> giving a different amount. It ends up out of 64. Get 60 and it reads 94%.

- A question is scored when it has been given points. Questions without points are
  ordinary questions and sit on the form as they always did.
- A choice question is priced per choice: "Excellent" 3, "Acceptable" 1, "Poor" 0.
  The question's maximum is the highest of its choices, worked out, never typed.
- The total is the sum of the maximums. It is not a number anybody enters, so it
  cannot drift out of step with the questions. It moves when a question is added or
  repriced, and the builder shows it live while you build.
- The percentage is earned over total, `60 / 64 = 94%`.

### The denominator rule

A question that was never asked leaves the total. A question that was asked and
missed scores zero and stays in it.

Two things count as never asked:

1. **Hidden by "ask only if"** (`app_fields.show_if`). A question about the kitchen
   that only appears for branches with a kitchen was genuinely unaskable elsewhere.
2. **Answered with a choice marked N/A.** That is a person saying this does not
   apply here.

Both shrink the total for that record, so it is scored out of 61 rather than 64. A
branch with no kitchen must not score worse than a branch with a spotless one for
the same work.

This is the rule `scoredDetail` already applies to QC and Mystery Shopper: a scorer
field holding null adds to neither `earned` nor `possible`. The new path is the same
rule, decided from the answer instead of read from an imported column.

### Data model

**New column: `app_fields.scoring jsonb`, nullable.** Question-level rules:

```json
{ "rule": "choices", "section": "Cleanliness" }
{ "rule": "equals", "earn": ["Yes"], "points": 4 }
{ "rule": "threshold", "op": "<", "value": 5, "points": 2 }
{ "rule": "answered", "points": 1 }
```

`rule: "choices"` carries no `points`, deliberately. Its maximum comes from the
choices themselves and storing it twice invites the two to disagree. The other three
rules have no choices to read it from, so they state it.

For a **dropdown**, earned is the chosen choice's points and the maximum is the
highest-priced choice. For a **multi-select**, earned is the sum of what was chosen
and the maximum is the sum of every choice worth more than zero, so ticking
everything scores full marks and ticking nothing scores none.

A new nullable column rather than a key inside `options`, because `options` is
already two different shapes depending on field type: an array of choices for
dropdowns, an object for link fields and for imported scorer fields. Hanging a
question-level object off an array is the kind of thing that survives in memory and
is lost the moment it is written as JSON. `NULL` on all existing rows means all 226
tables are untouched by definition.

**Choice-level points live on the choice objects** inside `options`, which are
already objects and already carry flags:

```json
{ "en": "Excellent", "ar": "ممتاز", "points": 3 }
{ "en": "Not applicable", "ar": "لا ينطبق", "na": true }
```

Co-located with the choice, so renaming a choice keeps its price. The builder's
Options textarea round-trip (`optsToString` and the parser in the save handler)
gains two tokens, `pts:3` and `na`, alongside the existing `other`.

**Table level:** `config.scored = true` marks a scorecard. `config.score_field`
keeps its current meaning, the field holding the percentage, so the grid, filters,
sort, cards and CSV export all work with no changes at all.

> The builder must write `config` by **merging**, not replacing. Replacing four keys
> and wiping the other sixteen was a real bug, found and fixed on 2026-08-19.

### Where the arithmetic happens

**In the database, for the stored value.** A new `score_submission()` trigger on
`app_submissions` reads the table's scored fields, applies the rules above, and
writes the fraction into `data[score_field]`. A trigger rather than the client
because there are four write paths and all of them must score: the public form RPC,
the reviewer PATCH, `create_record()`, and imports.

Guards, following the pattern the notify trigger established:

- The whole body sits in an exception block. A scoring bug must not be able to break
  a submit on the 226 tables that do not score.
- It returns immediately unless the table carries `config.scored`. QC and Mystery
  Shopper do not, and their fields have no `scoring` value, so the new trigger is
  inert for them and their hand-written engine keeps running untouched.
- No historical rescoring. It fires on the row being written, nothing else. The
  reason older records keep the score their own form produced has not changed.
- A total of zero writes no score rather than dividing by zero.

**In the browser, for the breakdown.** `scoredDetail` gains a second path: when
`config.scored` is set, compute earned and possible from the rules and the answers
instead of reading scorer fields. It returns the same
`{html, earned, possible, sections}`, so `scoreHeadHtml` and `scoreBreakdownHtml`
are unchanged and a new scorecard looks exactly like QC in the record view.

Two implementations of one rule is a real risk, and it is the reason the pure
functions below are extracted and tested rather than left inline.

### The builder

A scorecard's question row gains a **Points** box. Filling it in makes the question
scored.

- **Dropdown or multi-select**: the Options box expands into one row per choice,
  each with a small points input and an N/A tick. The question's maximum shows
  beside the label, worked out from the choices.
- **Yes/No**: a points box and which answer earns them.
- **Number**: points, and "earns when" with an operator and a value.
- **Everything else**: points for answering at all.

A footer under the question list reads the total live: `Total: 64 points across 21
questions`. That is the number the person is really building, and it should never
have to be added up by hand.

The public form is not touched. Nothing about points reaches it, and it could not
leak if it tried: `config_public` is a generated whitelist column, and `scoring` is
not on it.

## Testing

`docs/tests/scoring-rules.test.js`, pulling the pure functions out of `index.html`
the way every other test in that folder does:

- `questionPoints(field, answer)` returns earned and max for one question.
- `scorecardTotals(fields, data)` returns `{earned, possible}` for a record.

Cases, each one a way the arithmetic could be wrong about somebody's work:

- The worked example end to end: 4 + per-choice 3, earning 60 of 64, reading 94%.
- A choice marked N/A leaves both earned and possible.
- A question hidden by `show_if` leaves both.
- A question that was asked and not answered earns 0 and stays in possible.
- A record where every scored question is N/A produces no score, not a divide by zero.
- A question with no points is ignored entirely.
- A renamed choice keeps its points.
- The DB trigger and `scorecardTotals` agree on the same record.

## What this does not do

- No formulas, weights, roll-ups or cross-question rules. The six formula shapes in
  the imported engine exist because Airtable had them; nobody has asked for them here.
- No rescoring of anything that already exists.
- No change to QC or Mystery Shopper, which keep their imported scorer fields and
  their own trigger.
- No conversion of an existing table into a scorecard.

## Rollout

One SQL file, additive: `ALTER TABLE app_fields ADD COLUMN scoring jsonb`, plus the
trigger. Numbered at apply time, since other sessions claim numbers too (34 is the
highest referenced today). The app ships before the SQL is applied and behaves:
a table with no `config.scored` is today's table, and the picker's Scorecard option
is the only thing that needs the column.
