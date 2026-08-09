# BLKTable — Airtable-parity redesign (design)

Date: 2026-08-09
Status: approved direction (prototype `/tmp/blktable_prototype.html` reviewed), spec pending sign-off
Branch: `redesign-airtable-parity`

## Goal

Make the BLKTable dashboard read and behave like the Airtable views it replaced —
cleaner cards, clearer toolbar (views / filter / sort / group / color), and scoring
that shows how each answer moves the score — matching the Airtable screenshots for
QC, Mystery Shopper, Customer Complaints and Job Applications. Fix the existing app;
do not rebuild. The scoring engine, RLS, migration and R2 are untouched.

## Non-goals (explicitly out of scope)

- **Assignment / review-chain UI.** The assignment model is being reworked separately.
  This redesign removes assignment chrome from the cards it touches (the corner badge,
  the inline "For you" tag, the yellow left-edge bar) and does **not** add a new
  assignment mechanism. `current_assignee` and the review chain keep working as-is in
  the record panel; we just stop decorating cards with it.
- Backend/schema engine changes to scoring — we surface existing computed scores, we do
  not change how they are computed.
- The Operate task engine, chain-workflow upgrade, and the remaining Airtable migration
  (separate tracks in STATUS.md).

## Architecture

Single static `index.html` (~4,730 lines, no build step, Supabase JS via CDN). All work
lands in the render layer:

- `renderCustom()` (line ~2876) — card / row list, the toolbar, view switch.
- `renderCustomGrid()` (line ~3245) — grid/table view.
- `openCustomDetail()` (line ~3548) — the record panel (where per-answer scoring goes).
- `renderApps()` / `renderCasting()` (lines ~1863 / ~2338) — the built-in Job Application
  and Casting card lists (their own render, not the generic one).
- The public Job Application form under `apply/index.html` — the new Country question.
- CSS block at the top of `index.html` (`:root` at line 16, card/pill/score styles
  ~lines 259–481).

Configuration continues to live on `app_tables.config` (`card_fields`, `detail_fields`,
`table_columns`, `score_field`) and `app_fields.options` — no migration needed for the
UI work. The one new per-field pointer (question→scorer mapping) is additive.

## Component A — Airtable-style toolbar

Replace the current scattered toolbar controls with one Airtable-style bar above every
custom table:

`[ ▦ Gallery | ▤ Grid | (▥ Kanban where stages exist) ]  ⚙ Customize cards  ⛃ Filter  ↕ Sort  ▚ Group  ◧ Color   … <count>`

- **View switch** reuses the existing `customView` state (`cards` / `table`) plus a
  disabled-for-now Kanban affordance where `customStages()` is non-empty (visual only
  this pass; no new engine).
- **Filter / Sort / Group / Color** buttons show an *active* highlight and a summary
  ("Sorted by 1 field", "Filtered by Branch") mirroring Airtable. Filter, Sort, Group
  reuse the existing panels (`renderConds`, `customSort`, `renderGroupPanel`); they are
  re-skinned, not rebuilt. **Color** is new-but-small: colour cards/rows by a chosen
  single-select field (maps a choice → the existing pill colours).
- **Customize cards** opens the column/field picker (`renderColsPanel`) retargeted to
  choose which fields show on a *card* (`config.card_fields`), matching Airtable's
  "Customize cards".

## Component B — Gallery card redesign

Rework the `.ja-card` render in `renderCustom()` (lines ~2956–2986) to the labelled-field
layout from the prototype:

- Optional **cover** (the record's first photo field) at the top; letter-avatar fallback.
- Each card field rendered as **label (small, upper, muted) + value**, not
  `"Label: value"`. Values use the existing pill styles: single/multi-selects and yes/no
  as coloured pills (`pillClass`), Arabic long-text trimmed to 2–3 lines and RTL.
- **Score chip** carries both the raw and the percent (`63/68` + `91%`) with the existing
  colour band (`scoreTone`), shown in a card footer with the submitted date.
- Which fields appear is `config.card_fields` (already supported), so each table is tuned
  without code: QC → Branch, Date, Action plan, Final score; Mystery Shopper → Branch,
  # other customers, Full orchestra, closing comment, Feedback, Final score; Complaints →
  thread preview, name, phone, branch, complaint type, issue.
- The list/row view (`.ja-row`) gets the same pill/score treatment for parity.

## Component C — Per-answer scoring in the record (the core QC/Mystery ask)

In `openCustomDetail()`, when the table has `config.score_field`, render each scored
question with the points that answer earned, grouped into sections with running subtotals,
and a score sidebar (total, %, colour bar, per-section breakdown) computed from those
points — exactly the prototype's "QC record — scoring" tab.

**Data source — the one thing to confirm in implementation.** The scorer fields already
exist (QC ~70, Mystery Shopper ~30). We need a reliable pairing of *question field →
scorer field* so the panel can put "+1 / 0" beside each answer. Approach, in order of
preference:

1. If a naming/position convention already pairs them (e.g. scorer field label mirrors the
   question), detect it once and cache the map on `currentCustom`.
2. Otherwise add an additive pointer `app_fields.options.score_of = "<questionFieldId>"`
   on each scorer field (or `options.scorer = "<scorerFieldId>"` on each question),
   populated by a one-time script from the same rules the engine already encodes.

Either way the displayed number equals the stored engine score — we render existing data,
we never recompute. Sections come from `options.score_section` (additive; falls back to a
single "Score" section if unset). Imported/older records that were never rescored show
their stored final score and skip the per-answer breakdown (documented, matches STATUS).

## Per-table specifics

- **QC** — cover = storefront photo; card fields as above; detail = Component C with
  sections (Cleanliness / Service / Product …). Confirm the blank-fridge-temp quirk is
  still shown as scored (history parity) but visibly flagged.
- **Mystery Shopper** — card shows the two headline yes/no answers as green pills, feedback
  trimmed RTL, Orchestra sub-score on the chip; detail = Component C.
- **Customer Complaints** — card leads with a **WhatsApp thread preview** (render the
  screenshot photo field as the cover/thread block), then labelled name/phone/instagram/
  branch, with complaint-type and issue as colour-coded pills. No scoring.
- **Job Application** — applicant photo cover; Full Name / Gender / Age / Type / Living
  Area / Why-join; plus the new Country field (Component D). Built-in render in
  `renderApps()`.

## Component D — Job Application Country question + auto country code

- New question **"Country / الدولة"** with choices Jordan, Lebanon, Syria, Iraq.
  You asked for "multi-select"; I'm defaulting to a **single-select dropdown** because one
  applicant has one country and one dial code (multi makes the auto-code ambiguous). Say
  the word and I'll make it a true multi-select instead — flag this at spec review.
- On the public form (`apply/index.html`), selecting a country **auto-sets the phone
  dial-code** (Jordan +962, Lebanon +961, Syria +963, Iraq +964) via a static map
  `COUNTRY_DIAL = {Jordan:'+962', Lebanon:'+961', Syria:'+963', Iraq:'+964'}`; the map is
  the single source of truth so adding a country later is one line.
- Country is a real field: visible, editable and filterable in review, shown as a
  flag+code pill on the card. This complements (does not replace) the existing
  phone-prefix logic that already drives country grouping; where they disagree the
  explicit answer wins for display.
- Backfill: existing records already carry a phone-derived country — map it into the new
  field so old records show it too.

## Testing / verification

No test framework in this static repo; verification is by observation against the
screenshots plus a scoring-parity check:

1. Load each of the four tables in the dashboard; compare card layout side-by-side with
   the Airtable screenshot.
2. Open a QC and a Mystery Shopper record; confirm the per-answer points sum to the
   stored `score_field` value for several records (parity with the engine, hence Airtable).
3. Submit the Job Application public form for each country; confirm the dial code auto-fills
   and the record shows the Country pill and is filterable.
4. Confirm nothing assignment-related renders on cards; the record-panel chain still works.
5. Regression: filter, sort, group, column picker, saved views, CSV export still work.

## Rollout

- Work on `redesign-airtable-parity`; ship via PR to `main` (GitHub Pages auto-deploys
  `main`). Given this is a live prod site, land it as one reviewed PR, not direct pushes.
- Build order: (1) toolbar + card redesign (cross-cutting), (2) per-answer scoring,
  (3) per-table tuning via `config`, (4) Job Application Country field.
