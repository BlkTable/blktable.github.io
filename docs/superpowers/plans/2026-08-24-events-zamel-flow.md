# Events — the Zamel flow, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One public link on which a barista ticks the events they can work; Zamel then assigns people to each event by hand and the newly-assigned are messaged with that event's details.

**Architecture:** Three new tables in BLKTable (`Events (Zamel)`, `Barista availability (Zamel)`, `Event assignments (Zamel)`). Intake is one ordinary table-level form carrying a new `record_multi` question whose choices are the live `open` rows of the events table — the same shape the existing `branch` question already uses to read the `branches` table. The multi-tick is expanded per event **at read time**, so nothing fans out on submit and `submit_public_form` is untouched. Roster rows are written only from a manager-only Assign panel, and a row trigger on INSERT queues the WhatsApp message.

**Tech Stack:** Plain ES5-style JavaScript inline in `index.html` and `f/index.html` (no build step, no framework), Supabase JS v2 against self-hosted Postgres at `db.blktable.blk.jo`, PL/pgSQL migrations, Deno edge functions, `node:assert` tests run through VS Code's bundled Node.

**Spec:** `docs/superpowers/specs/2026-08-24-events-zamel-flow-design.md`

## Global Constraints

- **Never add, remove or rename an argument of an existing public-form RPC.** PostgREST resolves an RPC by the keys in the body: a three-key body against a two-argument function resolves to nothing and every one of the 226 live forms gets a dead submit button. This is the 2026-08-09 outage. `submit_public_form` is not touched by this plan.
- **New page helpers must be declared as `  function name(...)` — a top-level `function` at exactly two spaces of indentation.** `docs/tests/*.test.js` lifts functions out of the HTML with the regex `\n  function <name>\s*\([\s\S]*?\n  \}`. A helper nested inside another function, or indented differently, cannot be tested.
- **Read field ids off `config`** (`config.assign`, `config.payroll`, `config.parent`) — never look a field up by its label.
- **Every new field id is captured from the `insert … returning` that created it.** Nothing is typed twice.
- **Name identity is `trim().toLowerCase()`**, and an empty name displays as `(no name)`. This is what `payrollRows` already does; the assign screen must agree with it or the roster and the payroll export disagree about who a person is.
- **Test command**, run from the worktree root:
  ```bash
  ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/<file>.test.js
  ```
  A pass prints nothing but the count; a failure prints `FAIL: …` and sets a non-zero exit code.
- **Worktree:** all page work happens in `C:\Users\ASUS\blktable-zamel` on branch `feat/events-zamel-flow`. Never switch branches in the shared clone at `C:\Users\ASUS\blktable` — another session works there.
- **`git add` named files only. Never `git add -A`** — it sweeps another session's uncommitted work into the commit, and merging deploys it.
- **SQL files** go in `C:\Users\ASUS\blktable-migration\workspaces\`, numbered after the highest existing file (`31-…`), `\set ON_ERROR_STOP on`, wrapped `begin; … commit;`, ending in verification `select`s that print what a human should read.
- **Running SQL** against the live database (see `project_blktable_selfhost_deploy_access`): `scp` the file to the server, then `docker exec … psql -f`. The hosted Supabase project `cisqemycewkqakyqmusw` is a **different database** — the Supabase MCP cannot reach the live data.
- **Merging to `main` is what deploys** (GitHub Pages). PRs squash-merge and the branch is deleted, so `git fetch --prune` and rebase onto a fresh `origin/main` before follow-up work.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `C:\Users\ASUS\blktable-migration\workspaces\32-events-zamel-tables.sql` | Creates the three tables, their questions, and all four config blocks. New file. |
| `…\33-ballot-options.sql` | `ballot_options(p_slug text)` — the anon-readable RPC that serves the open events to the form page. New file. |
| `…\34-assignment-notify.sql` | The INSERT-only trigger that queues a message per newly-assigned row, and the removal notice. New file. |
| `…\TEST-zamel-flow-seed.sql` / `…-cleanup.sql` | Tagged test data plus its expected payroll answer. New files. |
| `f/index.html` | The public form. Gains `ballotOptions`, `ballotLabel`, a `record_multi` branch in `buildField`, and a `ballotReady` fetch at boot. |
| `index.html` | The dashboard. Gains `assignConfig`, `ballotNames`, `assignCandidates`, `eventsOverlap`, `assignClashCount`, `assignMonthCount`, `assignDiff`, `submitAssignments`, and the Assign panel that calls them. |
| `docs/tests/ballot-field.test.js` | `ballotOptions` / `ballotLabel` from `f/index.html`, plus `ballotNames` from `index.html`. New file. |
| `docs/tests/assign.test.js` | `assignConfig`, `assignCandidates`, `eventsOverlap`, `assignClashCount`, `assignMonthCount`, `assignDiff`. New file. |
| `docs/tests/assign-submit.test.js` | `submitAssignments` with a stubbed database — the **caller**, because `payroll.test.js` passing 16/16 while the export was broken proved a helper tested alone says nothing about who calls it. New file. |
| `docs/tests/README.md` | One table row per new test file. |

Helpers live beside the feature they serve rather than in a new file: both pages are single-file by design and the test harness reads them out of the HTML by name.

---

## Task 1: The three tables

**Files:**
- Create: `C:\Users\ASUS\blktable-migration\workspaces\32-events-zamel-tables.sql`

**Interfaces:**
- Consumes: nothing. `09`–`14` are already applied, so `config.parent`, `config.payroll`, `config.child_only` and the `＋ New record` button all already work.
- Produces: three table ids, and these config blocks that every later task reads —
  - on `events-zamel`: `config.statuses`, `config.assign = {from, match, name, phone, roster, capacity}`
  - on `event-assignments-zamel`: `config.parent = {table, title, show}`, `config.payroll = {date, group, rate, only_slot}`, `config.child_only = true`
  - question labels: `Event name · Date · Start time · End time · Location · Description · Places · Rate per person (JD)` on events; `Your name · Phone · Events you can work` on availability; `Barista name · Phone · Slot · Message state` on assignments.

- [ ] **Step 1: Write the file, ending in `rollback` so the first run is a dry run**

`09-create-record.sql` set this precedent: prove the whole transaction against live data, read the printed checks, then change one word.

```sql
-- ============================================================================
-- Events — the Zamel flow: three tables.
--
--   Events (Zamel)               one record per event, created from the dashboard
--   Barista availability (Zamel) ONE public link; tick the events you can work
--   Event assignments (Zamel)    one row per assigned barista per event, written
--                                only from inside the app
--
-- Three and not two: a barista ticking six events is ONE submit that must become
-- six paid rows. Splitting intake from roster puts that fan-out inside the app,
-- so `submit_public_form` is untouched — and an argument added to that function
-- is a dead submit button on all 226 forms (the 2026-08-09 outage).
--
-- Field ids are captured from the inserts that make them, so no config can point
-- at the wrong question.
--
-- Depends on 09-14 (already applied). Ends in ROLLBACK: run it, read the checks,
-- then change the last word to `commit` and run it again.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_events uuid; v_avail uuid; v_roster uuid;
  f_name uuid; f_date uuid; f_start uuid; f_end uuid; f_loc uuid;
  f_desc uuid; f_places uuid; f_rate uuid;
  a_name uuid; a_phone uuid; a_events uuid;
  r_name uuid; r_phone uuid; r_slot uuid; r_msg uuid;
  v_staff jsonb;
begin
  -- ---- The slugs must be free ---------------------------------------------
  -- Stop rather than rename: a slug is a public link key, and taking one that
  -- something else owns silently kills that form.
  if exists (select 1 from public.app_tables
              where slug in ('events-zamel','barista-availability-zamel','event-assignments-zamel')) then
    raise exception 'one of the three Zamel slugs already exists — this file has already run';
  end if;

  -- ---- Events (Zamel) -----------------------------------------------------
  -- `assigned` replaces the old `filled`: nothing sets itself in this flow, so a
  -- status that claims to be automatic would be a lie. Zamel moves them all.
  insert into public.app_tables (slug, name, name_ar, kind, category, is_active, workspace, config)
  values ('events-zamel', 'Events (Zamel)', 'الفعاليات (زامل)', 'form', null, true, 'Main',
    jsonb_build_object(
      'statuses', jsonb_build_array(
        jsonb_build_object('key','draft',   'label','Draft',    'color','gray'),
        jsonb_build_object('key','open',    'label','Open',     'color','blue'),
        jsonb_build_object('key','assigned','label','Assigned', 'color','green'),
        jsonb_build_object('key','running', 'label','Running',  'color','purple'),
        jsonb_build_object('key','done',    'label','Done',     'color','gray')),
      'card_no_cover', true))
  returning id into v_events;

  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_events, 'Event name', 'اسم الفعالية', 'short_text', true, 1) returning id into f_name;
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_events, 'Date', 'التاريخ', 'date', true, 2) returning id into f_date;
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_events, 'Start time', 'وقت البداية', 'time', true, 3) returning id into f_start;
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_events, 'End time', 'وقت النهاية', 'time', false, 4) returning id into f_end;
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_events, 'Location', 'الموقع', 'short_text', true, 5) returning id into f_loc;
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_events, 'Description', 'الوصف', 'long_text', false, 6) returning id into f_desc;
  -- Advisory in this flow — shown while assigning, never enforced. Not required,
  -- because an event Zamel staffs by hand does not need a number first.
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_events, 'Places', 'عدد الأماكن', 'number', false, 7) returning id into f_places;
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_events, 'Rate per person (JD)', 'الأجر للشخص', 'number', true, 8) returning id into f_rate;

  -- ---- Barista availability (Zamel) — the one link ------------------------
  -- NOT parent-scoped: one submission spans many events, so it cannot carry a
  -- single parent_id. This is an ordinary table-level form.
  insert into public.app_tables (slug, name, name_ar, kind, category, is_active, workspace, config)
  values ('barista-availability-zamel', 'Barista availability (Zamel)', 'جدول الباريستا (زامل)',
          'form', null, true, 'Main', jsonb_build_object('card_no_cover', true))
  returning id into v_avail;

  -- The staff list is COPIED from the Health certificate form, not retyped, so no
  -- two forms can disagree about how a person's name is spelled. 292 choices render
  -- as the type-to-search combobox on the public page.
  select f.options into v_staff
  from public.app_fields f join public.app_tables t on t.id = f.table_id
  where t.slug = 'health-certificate-rfil' and f.label = 'Name' and f.type = 'dropdown';
  if v_staff is null or jsonb_array_length(v_staff) = 0 then
    raise exception 'could not find the staff list on the Health certificate form';
  end if;

  insert into public.app_fields (table_id, label, label_ar, type, options, required, position) values
    (v_avail, 'Your name', 'اسمك', 'dropdown', v_staff, true, 1) returning id into a_name;
  -- Phone is required here and nowhere else in this feature: it is the only place a
  -- number is ever collected, and with no number there is nothing to message. The
  -- existing signups table asks for no phone at all, which is why the built flow
  -- could never have messaged anybody.
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_avail, 'Phone', 'رقم الهاتف', 'phone', true, 2) returning id into a_phone;
  -- The ballot. `record_multi` is added to the public form in Task 3; `source` names
  -- the table whose rows are the choices and `when_status` which of them count.
  insert into public.app_fields (table_id, label, label_ar, type, options, required, position) values
    (v_avail, 'Events you can work', 'الفعاليات التي يمكنك العمل بها', 'record_multi',
     jsonb_build_object('source', 'events-zamel', 'when_status', jsonb_build_array('open')),
     true, 3)
  returning id into a_events;

  -- ---- Event assignments (Zamel) — the roster ----------------------------
  insert into public.app_tables (slug, name, name_ar, kind, category, is_active, workspace, config)
  values ('event-assignments-zamel', 'Event assignments (Zamel)', 'تعيينات الفعاليات (زامل)',
          'form', null, true, 'Main',
    jsonb_build_object(
      'parent', jsonb_build_object(
        'table', v_events,
        'title', f_name,
        'show',  jsonb_build_array(f_date, f_start, f_end, f_loc, f_rate)),
      -- Written only from inside the app, so its public form is never live and it is
      -- read inside its parent rather than as a sidebar entry of its own.
      'child_only', true,
      'card_no_cover', true))
  returning id into v_roster;

  update public.app_tables set is_active = false where id = v_roster;

  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_roster, 'Barista name', 'اسم الباريستا', 'short_text', true, 1) returning id into r_name;
  -- Copied onto the row at assign time, not joined back to availability: this row is
  -- the record of what was actually sent, and a later re-submission must not silently
  -- change the number a message went to.
  insert into public.app_fields (table_id, label, label_ar, type, required, position) values
    (v_roster, 'Phone', 'رقم الهاتف', 'phone', false, 2) returning id into r_phone;
  insert into public.app_fields (table_id, label, label_ar, type, options, required, position) values
    (v_roster, 'Slot', 'الدور', 'dropdown',
     jsonb_build_array(jsonb_build_object('en','confirmed','ar','مؤكد'),
                       jsonb_build_object('en','backup','ar','احتياطي')),
     true, 3)
  returning id into r_slot;
  insert into public.app_fields (table_id, label, label_ar, type, options, required, position) values
    (v_roster, 'Message state', 'حالة الرسالة', 'dropdown',
     jsonb_build_array(jsonb_build_object('en','queued','ar','في الانتظار'),
                       jsonb_build_object('en','sent','ar','أُرسلت'),
                       jsonb_build_object('en','failed','ar','فشلت')),
     false, 4)
  returning id into r_msg;

  -- ---- Config that points at questions ------------------------------------
  update public.app_tables
     set config = config || jsonb_build_object(
           'card_fields',   jsonb_build_array(f_name, f_date),
           'detail_fields', jsonb_build_array(f_name, f_date, f_start, f_end, f_loc, f_places, f_rate),
           -- Standard 7. `capacity` is SHOWN while assigning and never enforced.
           'assign', jsonb_build_object(
             'from',     'barista-availability-zamel',
             'match',    a_events,
             'name',     a_name,
             'phone',    a_phone,
             'roster',   'event-assignments-zamel',
             'capacity', f_places))
   where id = v_events;

  update public.app_tables
     set config = config || jsonb_build_object(
           'card_fields',   jsonb_build_array(a_name),
           'detail_fields', jsonb_build_array(a_name, a_phone, a_events))
   where id = v_avail;

  update public.app_tables
     set config = config || jsonb_build_object(
           'card_fields',   jsonb_build_array(r_name),
           'detail_fields', jsonb_build_array(r_name, r_phone, r_slot, r_msg),
           -- `date` and `rate` are the EVENT's questions: pay is earned by working
           -- the event. `only_slot` is confirmed, because a backup did not work.
           'payroll', jsonb_build_object(
             'date',      f_date,
             'group',     r_name,
             'rate',      f_rate,
             'only_slot', 'confirmed'),
           'assign_slot', r_slot,
           'assign_name', r_name,
           'assign_phone', r_phone,
           'assign_msg',  r_msg)
   where id = v_roster;

  raise notice 'events=%  availability=%  roster=%', v_events, v_avail, v_roster;
  raise notice 'ballot field=%  name=%  phone=%', a_events, a_name, a_phone;
end $$;

-- ============================== VERIFICATION ================================
\echo '--- the three tables (expect 3 rows; the roster is_active = f) ---'
select slug, name, kind, is_active, workspace
from public.app_tables
where slug in ('events-zamel','barista-availability-zamel','event-assignments-zamel')
order by slug;

\echo '--- config.assign on the events table (expect from/match/name/phone/roster/capacity) ---'
select jsonb_pretty(config -> 'assign') from public.app_tables where slug = 'events-zamel';

\echo '--- config.payroll + parent on the roster (date and rate must be EVENT field ids) ---'
select jsonb_pretty(config -> 'payroll') as payroll,
       jsonb_pretty(config -> 'parent')  as parent,
       config -> 'child_only'            as child_only
from public.app_tables where slug = 'event-assignments-zamel';

\echo '--- every config field id must resolve to a real question (expect 0 rows) ---'
with pointers as (
  select 'assign.match' as which, (config #>> '{assign,match}')::uuid as fid from public.app_tables where slug='events-zamel'
  union all select 'assign.name',    (config #>> '{assign,name}')::uuid    from public.app_tables where slug='events-zamel'
  union all select 'assign.phone',   (config #>> '{assign,phone}')::uuid   from public.app_tables where slug='events-zamel'
  union all select 'assign.capacity',(config #>> '{assign,capacity}')::uuid from public.app_tables where slug='events-zamel'
  union all select 'payroll.date',   (config #>> '{payroll,date}')::uuid   from public.app_tables where slug='event-assignments-zamel'
  union all select 'payroll.rate',   (config #>> '{payroll,rate}')::uuid   from public.app_tables where slug='event-assignments-zamel'
  union all select 'payroll.group',  (config #>> '{payroll,group}')::uuid  from public.app_tables where slug='event-assignments-zamel'
)
select p.which, p.fid from pointers p
left join public.app_fields f on f.id = p.fid
where f.id is null;

\echo '--- the ballot question (expect type record_multi, source events-zamel) ---'
select f.label, f.type, f.required, f.options
from public.app_fields f join public.app_tables t on t.id = f.table_id
where t.slug = 'barista-availability-zamel' order by f.position;

rollback;
```

- [ ] **Step 2: Dry-run it against the live database and read the checks**

```bash
scp C:/Users/ASUS/blktable-migration/workspaces/32-events-zamel-tables.sql blk-server:/tmp/32.sql
ssh blk-server 'docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/32.sql'
```

Expected: three rows with the roster's `is_active` showing `f`; `config.assign` printing all six keys; `config.payroll.date` and `.rate` being **events-zamel** field ids; **zero rows** from the pointer check; the ballot question reading `record_multi`. Then `ROLLBACK` — nothing is kept.

If the pointer check returns any row, a config key points at a question that does not exist. Stop and fix the file; do not commit it.

- [ ] **Step 3: Change the last word to `commit` and run it again**

```bash
ssh blk-server 'docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/32.sql'
```
Expected: the same verification output, this time kept.

- [ ] **Step 4: Confirm it in the app by hand**

Open `https://blktable.blk.jo`, and check all four:
1. **Events (Zamel)** is in the sidebar; **Event assignments (Zamel)** is **not** (that is `child_only`).
2. `＋ New record` on Events (Zamel) offers the eight questions.
3. Create one real event, leave the status alone, and confirm the **Payroll** button appears on Events (Zamel) — `payrollHost` finds it through the child.
4. Open Payroll over any range: it must say it found nothing, **not** throw. An empty roster is the correct answer here.

- [ ] **Step 5: Commit the SQL**

```bash
cd C:/Users/ASUS/blktable-migration
git add workspaces/32-events-zamel-tables.sql
git commit -m "Events (Zamel): the three tables, applied"
```

---

## Task 2: `ballot_options` — the anon-readable RPC

**Files:**
- Create: `C:\Users\ASUS\blktable-migration\workspaces\33-ballot-options.sql`

**Interfaces:**
- Consumes: `config.assign.from` / the `record_multi` question's `options.source` and `options.when_status` written in Task 1.
- Produces: `ballot_options(p_slug text) returns jsonb` — a **json array**, each element `{id, name, date, start, end, location}`, ordered by date then name, `[]` when the form has no ballot question. Granted to `anon`. Task 3 consumes it as `BALLOT`.

Why an RPC and not a view or a direct select: the source table's *field ids* live in config, so the pivot from `data->>'<uuid>'` to `name`/`date`/`location` has to be resolved at call time. `branches` can be read directly because its columns are real columns; an event's answers are not.

- [ ] **Step 1: Write the function with its own verification, ending in `rollback`**

```sql
-- ============================================================================
-- ballot_options(slug) — the live choices for a `record_multi` question.
--
-- A `record_multi` question offers the rows of ANOTHER table as tick boxes. The
-- question names the source table and which statuses count; this function reads
-- that, pivots the source records out of their jsonb answers using the source
-- table's own detail_fields order, and returns a small json array.
--
-- Rows, not counts — but only of a table whose contents are not sensitive (an
-- event's name, date and place, which is exactly what the barista is being asked
-- about). Submissions of any other table stay unreadable to anon.
--
-- Ends in ROLLBACK. Read the checks, then change the last word.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function public.ballot_options(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form   uuid;
  v_opts   jsonb;
  v_src    uuid;
  v_when   jsonb;
  f_name uuid; f_date uuid; f_start uuid; f_end uuid; f_loc uuid;
  v_out  jsonb;
begin
  -- The form must be a live form, the same gate /f/ itself applies. A ballot on a
  -- switched-off form returns nothing rather than leaking a list of events.
  select id into v_form from public.app_tables
   where slug = p_slug and is_active = true;
  if v_form is null then return '[]'::jsonb; end if;

  select f.options into v_opts from public.app_fields f
   where f.table_id = v_form and f.type = 'record_multi'
   order by f.position limit 1;
  if v_opts is null then return '[]'::jsonb; end if;

  select id into v_src from public.app_tables where slug = (v_opts ->> 'source');
  if v_src is null then return '[]'::jsonb; end if;

  v_when := coalesce(v_opts -> 'when_status', jsonb_build_array('open'));

  -- The five questions are taken from the source table's own field list by label,
  -- ONCE, here, and never by the app: this function is the only place that mapping
  -- exists, so the page never has to know an event's field ids.
  select max(case when label = 'Event name' then id end),
         max(case when label = 'Date' then id end),
         max(case when label = 'Start time' then id end),
         max(case when label = 'End time' then id end),
         max(case when label = 'Location' then id end)
    into f_name, f_date, f_start, f_end, f_loc
    from public.app_fields where table_id = v_src;

  select coalesce(jsonb_agg(x order by x ->> 'date', x ->> 'name'), '[]'::jsonb)
    into v_out
  from (
    select jsonb_build_object(
             'id',       s.id,
             'name',     s.data ->> f_name::text,
             'date',     s.data ->> f_date::text,
             'start',    s.data ->> f_start::text,
             'end',      s.data ->> f_end::text,
             'location', s.data ->> f_loc::text) as x
    from public.app_submissions s
    where s.table_id = v_src
      -- `status` is NULL on a record created from the dashboard and merely DISPLAYS
      -- as the first stage. Testing membership explicitly is what keeps a brand-new
      -- event off the ballot; anything phrased as "not draft" would put every one of
      -- them in front of the baristas the moment Zamel pressed New record.
      and s.status is not null
      and v_when ? s.status
  ) q;

  return v_out;
end $$;

revoke all on function public.ballot_options(text) from public;
grant execute on function public.ballot_options(text) to anon, authenticated;

-- ============================== VERIFICATION ================================
\echo '--- a live form with no ballot question returns [] ---'
select public.ballot_options('health-certificate-rfil') as expect_empty_array;

\echo '--- a slug that does not exist returns [] rather than erroring ---'
select public.ballot_options('no-such-form-at-all') as expect_empty_array;

\echo '--- the ballot: only events whose status is open, never a null status ---'
select public.ballot_options('barista-availability-zamel') as ballot;

\echo '--- proof for the line above: what the events table actually holds ---'
select s.status, count(*) from public.app_submissions s
join public.app_tables t on t.id = s.table_id
where t.slug = 'events-zamel' group by s.status order by 1 nulls first;

rollback;
```

- [ ] **Step 2: Dry-run and read the checks**

```bash
scp C:/Users/ASUS/blktable-migration/workspaces/33-ballot-options.sql blk-server:/tmp/33.sql
ssh blk-server 'docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/33.sql'
```
Expected: `[]` for both non-ballot checks. For the ballot: **exactly the events whose status is `open`**. Cross-check against the status counts printed underneath — an event created in Task 1 Step 4 and left alone has a null status and **must not** appear.

- [ ] **Step 3: Prove the null-status rule deliberately, before committing**

Move the event from Task 1 to `Open` in the app, re-run the dry run, and confirm it now appears. Move it back to Draft, re-run, confirm it is gone. This is the single most important behaviour of this function and it costs two clicks to prove.

- [ ] **Step 4: Change `rollback` to `commit`, run, then verify as anon**

```bash
ssh blk-server 'docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/33.sql'
curl -s -X POST 'https://db.blktable.blk.jo/rest/v1/rpc/ballot_options' \
  -H 'apikey: <the anon key from f/index.html>' \
  -H 'Content-Type: application/json' \
  -d '{"p_slug":"barista-availability-zamel"}'
```
Expected: the same JSON array over HTTP as anon. If this returns `42501` the grant did not take — an anon path that works as `postgres` and fails over HTTP is the whole class of bug this step exists to catch.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/ASUS/blktable-migration
git add workspaces/33-ballot-options.sql
git commit -m "ballot_options: live choices for a record_multi question, readable by anon"
```

---

## Task 3: The `record_multi` question on the public form

**Files:**
- Modify: `f/index.html` — add `ballotLabel` and `ballotOptions` beside `fmtParentValue` (~line 397); add a `record_multi` branch in `buildField` after the `multi_select` branch (~line 590); add `ballotReady` to the boot `Promise.all` (~line 983).
- Create: `docs/tests/ballot-field.test.js`
- Modify: `docs/tests/README.md`

**Interfaces:**
- Consumes: `ballot_options(p_slug)` from Task 2.
- Produces: `ballotLabel(row) -> string`, `ballotOptions(rows) -> [{value, label}]`, and a `BALLOT` page global. The submitted answer is a **comma-joined string of event ids**, stored under the question's field id like every other answer, which Task 4 renders and Task 5 matches on.

**Why ids and not names.** `multi_select` stores the visible text. Storing event names here would make the assign screen match people to events by label — the exact thing this project forbids everywhere else — and renaming an event would silently orphan every vote for it. The checkbox `value` is the record id; the label is what the barista reads.

- [ ] **Step 1: Write the failing test**

`docs/tests/ballot-field.test.js`:

```js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const F = load('f/index.html', ['ballotLabel','ballotOptions']);
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

const EV = [
  {id:'e-2', name:'Wedding',    date:'2026-09-14', start:'18:00:00', end:'23:00:00', location:'Abdoun'},
  {id:'e-1', name:'Autumn Fair',date:'2026-09-10', start:'10:00:00', end:'16:00:00', location:'Khalda'}
];

// ---- The label is what a barista reads, so it has to identify the shift -----
t('the label carries name, date, start time and place', () => {
  assert.strictEqual(F.ballotLabel(EV[1]), 'Autumn Fair — 2026-09-10 10:00 · Khalda');
});
t('the time is trimmed to hours and minutes, not seconds', () => {
  assert.ok(!/10:00:00/.test(F.ballotLabel(EV[1])));
});
t('a missing date, time or place drops that part instead of printing "undefined"', () => {
  assert.strictEqual(F.ballotLabel({id:'x', name:'Pop-up'}), 'Pop-up');
  assert.strictEqual(F.ballotLabel({id:'x', name:'Pop-up', date:'2026-09-01'}), 'Pop-up — 2026-09-01');
});
t('an event with no name still reads as something rather than as blank', () => {
  assert.strictEqual(F.ballotLabel({id:'x', date:'2026-09-01'}), '(untitled) — 2026-09-01');
});

// ---- The VALUE is the id. This is the test that protects every vote. -------
t('the value is the record id, never the name', () => {
  const opts = F.ballotOptions(EV);
  assert.deepStrictEqual(opts.map(o => o.value), ['e-1','e-2']);
});
t('renaming an event cannot orphan a vote, because the value never mentions the name', () => {
  const before = F.ballotOptions(EV).map(o => o.value);
  const renamed = EV.map(e => Object.assign({}, e, {name: e.name + ' (moved)'}));
  assert.deepStrictEqual(F.ballotOptions(renamed).map(o => o.value), before);
});

// ---- Order: a barista reads a list of dates, so it is sorted by date -------
t('options are ordered by date, not by the order the rows arrived', () => {
  assert.deepStrictEqual(F.ballotOptions(EV).map(o => o.label.split(' — ')[0]),
    ['Autumn Fair','Wedding']);
});
t('two events on one date fall back to the name, so the order is never arbitrary', () => {
  const same = [{id:'b', name:'Zed', date:'2026-09-10'}, {id:'a', name:'Alpha', date:'2026-09-10'}];
  assert.deepStrictEqual(F.ballotOptions(same).map(o => o.value), ['a','b']);
});
t('a dateless event sorts last rather than first, so it cannot head the ballot', () => {
  const mixed = [{id:'n', name:'No date'}, {id:'d', name:'Dated', date:'2026-09-10'}];
  assert.deepStrictEqual(F.ballotOptions(mixed).map(o => o.value), ['d','n']);
});

// ---- Nothing to vote on is a normal state, not an error -------------------
t('no events, a failed RPC, or a database without the function all read as empty', () => {
  assert.deepStrictEqual(F.ballotOptions([]), []);
  assert.deepStrictEqual(F.ballotOptions(null), []);
  assert.deepStrictEqual(F.ballotOptions(undefined), []);
});
t('ballotOptions never mutates the array it was handed', () => {
  const rows = EV.slice();
  F.ballotOptions(rows);
  assert.strictEqual(rows[0].id, 'e-2');
});

// ---- The page must not send a key the database has not got ---------------
// Same rule as p_token and p_device: PostgREST resolves an RPC by the keys in the
// body, and a form that hard-fails when ballot_options is missing is a form that
// cannot be deployed before the migration.
const SRC = fs.readFileSync('f/index.html','utf8');
t('the ballot fetch tolerates a missing function instead of killing the page', () => {
  const m = /ballotReady\s*=[\s\S]{0,400}?;/.exec(SRC);
  assert.ok(m, 'no ballotReady in the boot sequence');
  assert.ok(/\.catch\(/.test(m[0]), 'ballotReady must catch — a database without ballot_options must still render the form');
});
t('record_multi is rendered by buildField', () => {
  assert.ok(/f\.type === "record_multi"/.test(SRC), 'buildField has no record_multi branch');
});
t('the ballot checkbox value is the id and the text is the label', () => {
  const b = /f\.type === "record_multi"[\s\S]*?else if/.exec(SRC);
  assert.ok(b, 'could not isolate the record_multi branch');
  assert.ok(/cb\.value\s*=\s*o\.value/.test(b[0]), 'the checkbox value must be the record id');
  assert.ok(/o\.label/.test(b[0]), 'the checkbox text must be the label');
});

console.log(n + ' passed');
```

- [ ] **Step 2: Run it and watch it fail**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/ballot-field.test.js
```
Expected: it throws `no fn ballotLabel in f/index.html` before any test runs.

- [ ] **Step 3: Add the two helpers to `f/index.html`**

Insert immediately after `fmtParentValue` (~line 418), at two spaces of indentation so the harness can find them:

```js
  // ---- The ballot: another table's live rows as tick boxes -----------------
  // What a barista reads. Enough to tell two shifts apart — which is the whole job
  // of this string, since the thing being stored is the id underneath it.
  function ballotLabel(r) {
    var name = String((r && r.name) || "").trim() || "(untitled)";
    var d = String((r && r.date) || "").slice(0, 10);
    var tm = String((r && r.start) || "").slice(0, 5);
    var loc = String((r && r.location) || "").trim();
    return name + (d ? " — " + d : "") + (d && tm ? " " + tm : "") + (loc ? " · " + loc : "");
  }
  // The VALUE is the record id, never the label. A vote has to survive an event
  // being renamed, and matching people to events by their printed name is the one
  // thing this app refuses to do anywhere else.
  function ballotOptions(rows) {
    return (rows || []).slice().sort(function (a, b) {
      // No date sorts last: a dateless event heading the list reads as the next one up.
      var ad = String((a && a.date) || "9999-12-31").slice(0, 10);
      var bd = String((b && b.date) || "9999-12-31").slice(0, 10);
      if (ad !== bd) return ad < bd ? -1 : 1;
      var an = String((a && a.name) || ""), bn = String((b && b.name) || "");
      return an < bn ? -1 : (an > bn ? 1 : 0);
    }).map(function (r) {
      return { value: String((r && r.id) || ""), label: ballotLabel(r) };
    });
  }
```

- [ ] **Step 4: Run the helper tests and watch them pass**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/ballot-field.test.js
```
Expected: the eleven helper tests pass; the last three (which read the file as source) still fail.

- [ ] **Step 5: Add the `BALLOT` global and the boot fetch**

Beside the other page globals (next to `var BRANCHES = [];`, ~line 300) add:

```js
  var BALLOT = [];
```

Then in the boot `Promise.all`, beside `branchesReady` (~line 983):

```js
        // The choices for a `record_multi` question. Fetched with the branches and the
        // countries rather than after the field list, because it rides the same round
        // trip — and like them it NEVER blocks the form: a database that does not have
        // ballot_options yet must still render every other question, so the page and
        // the migration can land in either order.
        var ballotReady = db.rpc("ballot_options", { p_slug: slug })
          .then(function (r) { BALLOT = (r && !r.error && Array.isArray(r.data)) ? r.data : []; })
          .catch(function () { BALLOT = []; });
```

and add it to the array:

```js
        Promise.all([fieldsReady, branchesReady, countriesReady, ballotReady]).then(function (results) {
```

`results[0]` is still `fRes`, so nothing downstream changes.

- [ ] **Step 6: Add the `record_multi` branch to `buildField`**

Immediately after the `multi_select` branch closes (~line 590), before `else if (f.type === "dropdown" …)`:

```js
    } else if (f.type === "record_multi") {
      // Tick as many as apply, where the choices are another table's live rows. The
      // answer is stored comma-joined like a multi_select, so the grid, the filter and
      // the CSV export all read it with no special case — but the values are record
      // ids, so nothing depends on what an event is called.
      var rbox = document.createElement("div");
      rbox.className = "checks"; rbox.id = id;
      var ropts = ballotOptions(BALLOT);
      if (!ropts.length) {
        // Not an error: there is simply nothing open to vote on yet. Saying so is
        // better than an empty box that reads as a page that failed to load.
        var rnone = document.createElement("div");
        rnone.className = "combo-empty";
        rnone.textContent = "Nothing is open for signup at the moment. Please check back later.";
        rbox.appendChild(rnone);
      }
      ropts.forEach(function (o) {
        var rl = document.createElement("label");
        rl.className = "chk";
        var cb = document.createElement("input");
        cb.type = "checkbox"; cb.value = o.value;
        rl.appendChild(cb);
        rl.appendChild(document.createTextNode(" " + o.label));
        rbox.appendChild(rl);
      });
      wrap.appendChild(rbox);
      var rpicked = function () {
        return [].slice.call(rbox.querySelectorAll("input:checked"))
          .map(function (i) { return i.value; });
      };
      controls.push({
        f: f, el: rbox,
        validate: function () { return !f.required || rpicked().length > 0; },
        value: function () { return rpicked().join(", ") || null; }
      });
```

- [ ] **Step 7: Run the whole file — all fourteen must pass**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/ballot-field.test.js
```

- [ ] **Step 8: Prove no other form changed**

The boot sequence and `buildField` are shared by 226 live forms, so run every test that touches either page:

```bash
for f in conditional-questions capacity one-per-browser parent-links form-country form-live media-field builtin-public-title; do
  ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/$f.test.js
done
```
Expected: every file passes. A `record_multi` branch that broke `dropdown` would show up here.

- [ ] **Step 9: Add the row to `docs/tests/README.md`**

```markdown
| `ballot-field.test.js` | the ballot — a `record_multi` question whose choices are another table's live rows (`ballotLabel`, `ballotOptions` from `f/index.html`, plus `ballotNames` from `index.html`). The tests that matter are about the stored **value**: it is the record id and never the printed name, so renaming an event cannot orphan a vote — the same rule that stops every other config in this app matching questions by label. The rest are the ways an empty ballot reads: no events, a failed RPC and a database that does not have `ballot_options` yet must all render the form with a "nothing open" line rather than a blank box or a dead page, because the page and the migration have to be deployable in either order (the `p_token` lesson). A dateless event sorts last rather than heading the list |
```

- [ ] **Step 10: Commit**

```bash
git add f/index.html docs/tests/ballot-field.test.js docs/tests/README.md
git commit -m "The ballot: a record_multi question offering another table's live rows"
```

---

## Task 4: The availability grid reads event names, not ids

**Files:**
- Modify: `index.html` — add `ballotNames` beside `payrollConfig` (~line 6437); call it from the grid cell renderer and the record panel.
- Modify: `docs/tests/ballot-field.test.js` — extend with the `ballotNames` block.

**Interfaces:**
- Consumes: the comma-joined id string stored by Task 3.
- Produces: `ballotNames(value, byId) -> string`, used wherever a `record_multi` answer is displayed.

Without this, Zamel opens Barista availability and reads six uuids per row. The ids are correct storage and useless display — this is the display half, and it is why storing ids costs nothing.

- [ ] **Step 1: Write the failing test — append to `docs/tests/ballot-field.test.js`**

Insert before the final `console.log`:

```js
// ---- Ids are correct storage and useless display -------------------------
const D = load('index.html', ['ballotNames']);
const BY = {'e-1': {id:'e-1', name:'Autumn Fair', date:'2026-09-10'},
            'e-2': {id:'e-2', name:'Wedding',     date:'2026-09-14'}};

t('a stored id list is shown as names', () => {
  assert.strictEqual(D.ballotNames('e-1, e-2', BY), 'Autumn Fair, Wedding');
});
t('spacing in the stored string does not matter', () => {
  assert.strictEqual(D.ballotNames('e-1,e-2', BY), 'Autumn Fair, Wedding');
  assert.strictEqual(D.ballotNames('  e-1 ,  e-2  ', BY), 'Autumn Fair, Wedding');
});
t('an id whose event was deleted is shown as a deleted event, not dropped', () => {
  // Dropping it would make a vote for a deleted event look like a vote never cast.
  assert.strictEqual(D.ballotNames('e-1, gone', BY), 'Autumn Fair, (deleted event)');
});
t('an empty or absent answer is empty, never the word undefined', () => {
  assert.strictEqual(D.ballotNames('', BY), '');
  assert.strictEqual(D.ballotNames(null, BY), '');
  assert.strictEqual(D.ballotNames(undefined, BY), '');
});
t('no lookup table yet reads as deleted rather than throwing', () => {
  assert.strictEqual(D.ballotNames('e-1', null), '(deleted event)');
});
t('order follows what the barista ticked, not the lookup table', () => {
  assert.strictEqual(D.ballotNames('e-2, e-1', BY), 'Wedding, Autumn Fair');
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: `no fn ballotNames in index.html`.

- [ ] **Step 3: Add the helper to `index.html`**

Immediately before `function payrollHost(t)` (~line 6437):

```js
  // A `record_multi` answer is stored as record ids, so it is exact — and unreadable.
  // This is the display half: the ids are resolved to names wherever the answer is
  // shown. An id with no row left is named as deleted rather than dropped, because a
  // vote for a deleted event must not look like a vote nobody cast.
  function ballotNames(value, byId) {
    return String(value == null ? "" : value).split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (id) {
        var r = byId && byId[id];
        return (r && String(r.name || "").trim()) || "(deleted event)";
      })
      .join(", ");
  }
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/ballot-field.test.js
```
Expected: all twenty pass.

- [ ] **Step 5: Wire it into the grid and the record panel**

The availability table's rows need the events keyed by id. In `openCustom` (~line 5358), after `currentCustom` is created, load them once per table open:

```js
    // The ballot's lookup table. Loaded once when the table is opened, not per cell:
    // a `record_multi` answer is a list of ids and every one of them needs a name.
    currentCustom.ballotById = {};
    var ballotSrc = (currentCustom.fields || []).filter(function (f) { return f.type === "record_multi"; })[0];
```

Because `fields` arrive asynchronously, do the load in the same `.then` that sets `currentCustom.fields` (~line 5385), after that assignment:

```js
    var bf = (currentCustom.fields || []).filter(function (f) { return f.type === "record_multi"; })[0];
    if (bf && bf.options && bf.options.source) {
      db.from("app_tables").select("id,config").eq("slug", bf.options.source).single().then(function (tr) {
        if (tr.error || !tr.data) return;
        var srcId = tr.data.id;
        var titleF = ((tr.data.config || {}).parent || {}).title || null;
        return db.from("app_fields").select("id,label").eq("table_id", srcId).then(function (fr) {
          var nameF = titleF;
          if (!nameF) {
            var hit = ((fr && fr.data) || []).filter(function (x) { return x.label === "Event name"; })[0];
            nameF = hit && hit.id;
          }
          return db.from("app_submissions").select("id,data").eq("table_id", srcId).then(function (sr) {
            var by = {};
            ((sr && sr.data) || []).forEach(function (s) { by[s.id] = { id: s.id, name: (s.data || {})[nameF] }; });
            currentCustom.ballotById = by;
            renderCustom();
          });
        });
      });
    }
```

Then wherever a cell's value is turned into text for display, route a `record_multi` field through the helper. Find the field-type switch used by the grid cell renderer and add, before the default text case:

```js
    if (f.type === "record_multi") return esc(ballotNames(v, currentCustom && currentCustom.ballotById));
```

- [ ] **Step 6: Confirm by hand in the app**

Open Barista availability (Zamel) after casting one vote from the public link, and check the "Events you can work" column reads event names. Open the record panel on that row and check the same. Then delete one of the events and confirm the cell reads `(deleted event)` beside the surviving name rather than going blank.

- [ ] **Step 7: Commit**

```bash
git add index.html docs/tests/ballot-field.test.js
git commit -m "Show a record_multi answer as event names rather than record ids"
```

---

## Task 5: Who is available for this event

**Files:**
- Modify: `index.html` — add `assignConfig`, `assignCandidates`, `assignMonthCount` beside `ballotNames`.
- Create: `docs/tests/assign.test.js`

**Interfaces:**
- Consumes: `config.assign` from Task 1; availability rows as `app_submissions` rows (`{id, data, created_at}`).
- Produces:
  - `assignConfig(t) -> {from, match, name, phone, roster, capacity} | null`
  - `assignCandidates(availRows, eventId, cfg) -> [{key, name, phone, at}]` — one entry per **person**, latest submission only, sorted by name
  - `assignMonthCount(rosterRows, eventsById, monthKey, nameField) -> {<personKey>: n}`

- [ ] **Step 1: Write the failing test**

`docs/tests/assign.test.js`:

```js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API = load('index.html', ['assignConfig','assignCandidates','assignMonthCount']);
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

const CFG = {from:'barista-availability-zamel', match:'F_EV', name:'F_NM', phone:'F_PH',
             roster:'event-assignments-zamel', capacity:'F_CAP'};
const row = (id, name, phone, evs, at) =>
  ({id, created_at: at, data: {F_NM: name, F_PH: phone, F_EV: evs}});

// ---- assignConfig: a half-written config is no config --------------------
t('a complete config is returned', () => {
  assert.deepStrictEqual(API.assignConfig({config:{assign:CFG}}), CFG);
});
t('a config missing from, match or roster is null, not half-usable', () => {
  assert.strictEqual(API.assignConfig({config:{assign:{from:'x', match:'y'}}}), null);
  assert.strictEqual(API.assignConfig({config:{assign:{match:'y', roster:'z'}}}), null);
  assert.strictEqual(API.assignConfig({config:{}}), null);
  assert.strictEqual(API.assignConfig(null), null);
});

// ---- The rule Zamel described: who ticked THIS event ---------------------
t('only people who ticked this event are candidates', () => {
  const rows = [row('s1','Ahmad','+962791','e-1, e-2','2026-08-01T10:00:00Z'),
                row('s2','Sara','+962792','e-2','2026-08-01T11:00:00Z')];
  assert.deepStrictEqual(API.assignCandidates(rows,'e-1',CFG).map(c=>c.name), ['Ahmad']);
  assert.deepStrictEqual(API.assignCandidates(rows,'e-2',CFG).map(c=>c.name), ['Ahmad','Sara']);
});
t('a substring is not a tick — e-1 must not match e-12', () => {
  const rows = [row('s1','Ahmad','+962791','e-12','2026-08-01T10:00:00Z')];
  assert.deepStrictEqual(API.assignCandidates(rows,'e-1',CFG), []);
});
t('spacing in the stored tick list does not matter', () => {
  const rows = [row('s1','Ahmad','+962791','  e-1 ,e-2 ','2026-08-01T10:00:00Z')];
  assert.strictEqual(API.assignCandidates(rows,'e-1',CFG).length, 1);
});

// ---- Voting again replaces, never duplicates ----------------------------
// The link is permanent and events keep coming, so a barista fills it in repeatedly.
t('three submissions from one person are one candidate', () => {
  const rows = [row('s1','Ahmad','+962791','e-1','2026-08-01T10:00:00Z'),
                row('s2','Ahmad','+962791','e-1','2026-08-05T10:00:00Z'),
                row('s3','Ahmad','+962799','e-1','2026-08-09T10:00:00Z')];
  const got = API.assignCandidates(rows,'e-1',CFG);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].phone, '+962799', 'the latest submission wins, so a new number is used');
});
t('the LATEST submission decides, so withdrawing a tick actually withdraws it', () => {
  const rows = [row('s1','Ahmad','+962791','e-1, e-2','2026-08-01T10:00:00Z'),
                row('s2','Ahmad','+962791','e-2','2026-08-09T10:00:00Z')];
  assert.deepStrictEqual(API.assignCandidates(rows,'e-1',CFG), []);
  assert.strictEqual(API.assignCandidates(rows,'e-2',CFG).length, 1);
});
t('row order in the array never decides — only created_at does', () => {
  const a = [row('s1','Ahmad','+962791','e-1','2026-08-09T10:00:00Z'),
             row('s2','Ahmad','+962791','','2026-08-01T10:00:00Z')];
  assert.strictEqual(API.assignCandidates(a,'e-1',CFG).length, 1);
  assert.strictEqual(API.assignCandidates(a.slice().reverse(),'e-1',CFG).length, 1);
});

// ---- One person, spelled two ways: same rule as the payroll export ------
t('Ahmad and "  ahmad  " are one person, and the display keeps the typed spelling', () => {
  const rows = [row('s1','Ahmad','+962791','e-1','2026-08-01T10:00:00Z'),
                row('s2','  ahmad  ','+962792','e-1','2026-08-09T10:00:00Z')];
  const got = API.assignCandidates(rows,'e-1',CFG);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].name, 'ahmad', 'the latest spelling, trimmed — not the lowercase key');
  assert.strictEqual(got[0].key, 'ahmad');
});
t('a nameless vote is kept as (no name) rather than silently dropped', () => {
  const rows = [row('s1','','+962791','e-1','2026-08-01T10:00:00Z')];
  const got = API.assignCandidates(rows,'e-1',CFG);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].name, '(no name)');
});
t('candidates come back sorted by name, so the list does not reshuffle on reload', () => {
  const rows = [row('s1','Sara','+1','e-1','2026-08-01T10:00:00Z'),
                row('s2','Ahmad','+2','e-1','2026-08-02T10:00:00Z'),
                row('s3','Mego','+3','e-1','2026-08-03T10:00:00Z')];
  assert.deepStrictEqual(API.assignCandidates(rows,'e-1',CFG).map(c=>c.name), ['Ahmad','Mego','Sara']);
});
t('no rows, or a null config, is an empty list rather than a throw', () => {
  assert.deepStrictEqual(API.assignCandidates([], 'e-1', CFG), []);
  assert.deepStrictEqual(API.assignCandidates(null, 'e-1', CFG), []);
  assert.deepStrictEqual(API.assignCandidates([row('s1','A','+1','e-1','2026-08-01T10:00:00Z')], 'e-1', null), []);
});

// ---- Spreading the work: how many events has this person already got? ---
const EVS = {'e-1':{id:'e-1',date:'2026-09-10'}, 'e-2':{id:'e-2',date:'2026-09-14'},
             'e-3':{id:'e-3',date:'2026-10-02'}};
const rrow = (pid, name) => ({id:'r'+name+pid, parent_id: pid, data:{R_NM: name}});

t('counts a person\'s events in the given month only', () => {
  const roster = [rrow('e-1','Ahmad'), rrow('e-2','Ahmad'), rrow('e-3','Ahmad'), rrow('e-1','Sara')];
  const c = API.assignMonthCount(roster, EVS, '2026-09', 'R_NM');
  assert.strictEqual(c['ahmad'], 2, 'October must not be counted into September');
  assert.strictEqual(c['sara'], 1);
});
t('the same name spelled differently counts as one person here too', () => {
  const roster = [rrow('e-1','Ahmad'), rrow('e-2','  ahmad ')];
  assert.strictEqual(API.assignMonthCount(roster, EVS, '2026-09', 'R_NM')['ahmad'], 2);
});
t('a roster row whose event is gone is not counted into any month', () => {
  const roster = [rrow('e-nope','Ahmad')];
  assert.deepStrictEqual(API.assignMonthCount(roster, EVS, '2026-09', 'R_NM'), {});
});
t('an empty roster is an empty count, not a throw', () => {
  assert.deepStrictEqual(API.assignMonthCount([], EVS, '2026-09', 'R_NM'), {});
  assert.deepStrictEqual(API.assignMonthCount(null, EVS, '2026-09', 'R_NM'), {});
});

console.log(n + ' passed');
```

- [ ] **Step 2: Run it and watch it fail**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/assign.test.js
```
Expected: `no fn assignConfig in index.html`.

- [ ] **Step 3: Add the three helpers to `index.html`**

Immediately after `ballotNames` from Task 4:

```js
  // ---- Standard 7: assign from a source table -----------------------------
  // A half-written config is treated as no config: a panel that opened knowing where
  // to read candidates but not where to write them would lose Zamel's roster.
  function assignConfig(t) {
    var a = t && t.config && t.config.assign;
    return (a && a.from && a.match && a.roster && a.name) ? a : null;
  }
  // One person, spelled once. The same identity rule as payrollRows — if these two
  // ever disagree, the roster and the money disagree about who somebody is.
  function assignPersonKey(name) { return String(name == null ? "" : name).trim().toLowerCase(); }

  // Everyone whose LATEST availability submission ticks this event. Latest and not
  // all, because the link is permanent and events keep arriving, so a barista fills
  // it in again and again: counting every submission would list one person five times
  // and, worse, would honour a tick they had since withdrawn.
  function assignCandidates(availRows, eventId, cfg) {
    if (!cfg || !eventId) return [];
    var latest = {};
    (availRows || []).forEach(function (r) {
      var k = assignPersonKey((r.data || {})[cfg.name]);
      var prev = latest[k];
      // created_at decides, never the order the array happens to be in.
      if (!prev || String(r.created_at || "") > String(prev.created_at || "")) latest[k] = r;
    });
    var out = [];
    Object.keys(latest).forEach(function (k) {
      var r = latest[k];
      var ticked = String(((r.data || {})[cfg.match]) || "").split(",")
        .map(function (s) { return s.trim(); }).filter(Boolean);
      if (ticked.indexOf(String(eventId)) === -1) return;   // exact, so e-1 never matches e-12
      out.push({
        key: k,
        name: String(((r.data || {})[cfg.name]) || "").trim() || "(no name)",
        phone: String(((r.data || {})[cfg.phone]) || "").trim(),
        at: r.created_at || null
      });
    });
    return out.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
  }

  // How many events each person already has in one month, so the work can be spread
  // instead of the same four people getting everything. Keyed by month because that
  // is the period Zamel thinks in and the one payroll is run over.
  function assignMonthCount(rosterRows, eventsById, monthKey, nameField) {
    var out = {};
    (rosterRows || []).forEach(function (r) {
      var ev = eventsById && eventsById[r.parent_id];
      if (!ev) return;                                     // an event since deleted counts nowhere
      if (String(ev.date || "").slice(0, 7) !== String(monthKey || "")) return;
      var k = assignPersonKey((r.data || {})[nameField]);
      if (!k) return;
      out[k] = (out[k] || 0) + 1;
    });
    return out;
  }
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/assign.test.js
```
Expected: all eighteen pass.

- [ ] **Step 5: Commit**

```bash
git add index.html docs/tests/assign.test.js
git commit -m "Assign: who is available for an event, and how loaded they already are"
```

---

## Task 6: The clash warning

**Files:**
- Modify: `index.html` — add `eventsOverlap` and `assignClashes` after `assignMonthCount`.
- Modify: `docs/tests/assign.test.js` — extend, and add the two names to the `load` call.

**Interfaces:**
- Produces: `eventsOverlap(a, b) -> bool` over `{date, start, end}`; `assignClashes(rosterRows, event, eventsById, nameField) -> {<personKey>: [<event name>]}`.

`eventPhase` already treats an end time before its own start as the end of the day. This must agree with it — two rules about the same times that disagree is how an event reads as over before it began.

- [ ] **Step 1: Write the failing test — append to `docs/tests/assign.test.js`**

Change the `load` line to:

```js
const API = load('index.html', ['assignConfig','assignCandidates','assignMonthCount','eventsOverlap','assignClashes']);
```

and insert before the final `console.log`:

```js
// ---- Double-booking is the obvious real failure, and the data is right here ----
const ev = (date, start, end) => ({date, start, end});

t('two events on different days never clash', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00','16:00'), ev('2026-09-11','10:00','16:00')), false);
});
t('overlapping times on one day clash', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00','16:00'), ev('2026-09-10','15:00','20:00')), true);
});
t('touching but not overlapping does not clash — 10-16 and 16-20 are two shifts', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00','16:00'), ev('2026-09-10','16:00','20:00')), false);
});
t('one event inside another clashes', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','09:00','23:00'), ev('2026-09-10','12:00','14:00')), true);
});
t('seconds on the stored time do not change the answer', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00:00','16:00:00'), ev('2026-09-10','16:00:00','20:00:00')), false);
});
t('a missing end time counts as the end of the day, as eventPhase already treats it', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00',null), ev('2026-09-10','20:00','22:00')), true);
});
t('an end before its own start is the end of the day, not a negative shift', () => {
  // Otherwise the window collapses and a real clash reads as free.
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','18:00','02:00'), ev('2026-09-10','20:00','22:00')), true);
});
t('a missing start counts from the beginning of the day rather than never', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10',null,'09:00'), ev('2026-09-10','08:00','10:00')), true);
});
t('a dateless event clashes with nothing rather than with everything', () => {
  assert.strictEqual(API.eventsOverlap(ev(null,'10:00','16:00'), ev('2026-09-10','10:00','16:00')), false);
  assert.strictEqual(API.eventsOverlap(null, ev('2026-09-10','10:00','16:00')), false);
});

const THIS = {id:'e-1', name:'Autumn Fair', date:'2026-09-10', start:'10:00', end:'16:00'};
const ALL  = {'e-1': THIS,
              'e-9': {id:'e-9', name:'Brunch',  date:'2026-09-10', start:'12:00', end:'14:00'},
              'e-8': {id:'e-8', name:'Evening', date:'2026-09-10', start:'18:00', end:'22:00'},
              'e-7': {id:'e-7', name:'Next day',date:'2026-09-11', start:'10:00', end:'16:00'}};

t('a person already on an overlapping event is flagged, and the event is named', () => {
  const roster = [{id:'r1', parent_id:'e-9', data:{R_NM:'Ahmad'}}];
  assert.deepStrictEqual(API.assignClashes(roster, THIS, ALL, 'R_NM'), {ahmad: ['Brunch']});
});
t('a non-overlapping same-day event is not a clash', () => {
  const roster = [{id:'r1', parent_id:'e-8', data:{R_NM:'Ahmad'}}];
  assert.deepStrictEqual(API.assignClashes(roster, THIS, ALL, 'R_NM'), {});
});
t('this event\'s own roster is never a clash with itself', () => {
  const roster = [{id:'r1', parent_id:'e-1', data:{R_NM:'Ahmad'}}];
  assert.deepStrictEqual(API.assignClashes(roster, THIS, ALL, 'R_NM'), {});
});
t('two clashes for one person are both named', () => {
  const roster = [{id:'r1', parent_id:'e-9', data:{R_NM:'Ahmad'}},
                  {id:'r2', parent_id:'e-6', data:{R_NM:'Ahmad'}}];
  const all = Object.assign({}, ALL, {'e-6': {id:'e-6', name:'Lunch', date:'2026-09-10', start:'11:00', end:'13:00'}});
  assert.deepStrictEqual(API.assignClashes(roster, THIS, all, 'R_NM').ahmad.sort(), ['Brunch','Lunch']);
});
t('an empty roster clashes with nothing', () => {
  assert.deepStrictEqual(API.assignClashes([], THIS, ALL, 'R_NM'), {});
  assert.deepStrictEqual(API.assignClashes(null, THIS, ALL, 'R_NM'), {});
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: `no fn eventsOverlap in index.html`.

- [ ] **Step 3: Add the two helpers to `index.html`**

```js
  // Do two events collide in time? Half-open on purpose: 10-16 and 16-20 are two
  // shifts one person can work, not a clash. A missing end is the end of the day and
  // an end before its own start is too — the same reading `eventPhase` already uses,
  // because two rules about one pair of times that disagree is how an event comes to
  // read as over before it began.
  function eventsOverlap(a, b) {
    if (!a || !b) return false;
    var ad = String(a.date || "").slice(0, 10), bd = String(b.date || "").slice(0, 10);
    if (!ad || !bd || ad !== bd) return false;
    var t = function (v, dflt) { var s = String(v == null ? "" : v).slice(0, 5); return /^\d{2}:\d{2}$/.test(s) ? s : dflt; };
    var as = t(a.start, "00:00"), ae = t(a.end, "23:59");
    var bs = t(b.start, "00:00"), be = t(b.end, "23:59");
    if (ae <= as) ae = "23:59";
    if (be <= bs) be = "23:59";
    return as < be && bs < ae;
  }
  // Who on this event's candidate list is already booked somewhere that overlaps, and
  // where. Named rather than counted: "clashes with Brunch" is actionable and "1 clash"
  // sends Zamel hunting.
  function assignClashes(rosterRows, event, eventsById, nameField) {
    var out = {};
    (rosterRows || []).forEach(function (r) {
      if (!event || r.parent_id === event.id) return;       // its own roster is not a clash
      var other = eventsById && eventsById[r.parent_id];
      if (!other || !eventsOverlap(event, other)) return;
      var k = assignPersonKey((r.data || {})[nameField]);
      if (!k) return;
      out[k] = out[k] || [];
      var nm = String(other.name || "").trim() || "(untitled)";
      if (out[k].indexOf(nm) === -1) out[k].push(nm);
    });
    return out;
  }
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/assign.test.js
```
Expected: all thirty-two pass.

- [ ] **Step 5: Commit**

```bash
git add index.html docs/tests/assign.test.js
git commit -m "Assign: warn when a barista is already booked on an overlapping event"
```

---

## Task 7: The diff, and the write that must not re-message

**Files:**
- Modify: `index.html` — add `assignDiff` and `submitAssignments` after `assignClashes`.
- Create: `docs/tests/assign-submit.test.js`

**Interfaces:**
- Produces:
  - `assignDiff(existing, ticked) -> {insert:[…], remove:[…], update:[…], keep:[…]}`
  - `submitAssignments(ctx) -> Promise` where `ctx = {db, rosterTableId, eventId, cfg, rosterCfg, existing, ticked, myUserId}`

**This is the task the whole feature lives or dies on.** Re-submitting a roster after adding one person must not re-message the other seven. Two rules make that true, and both are asserted here:

1. Unchanged people produce **no write at all** — no insert, and not a delete-then-insert either.
2. A slot change is an **update**, never a delete plus an insert. Delete-and-insert would re-fire the INSERT trigger from Task 9 and message somebody a second time for a shift they already knew about.

- [ ] **Step 1: Write the failing test**

`docs/tests/assign-submit.test.js`:

```js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API = load('index.html', ['assignPersonKey','assignDiff','submitAssignments']);
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};
const T = async (name,fn)=>{try{await fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

const R = (id, name, slot) => ({id, data:{R_NM:name, R_SLOT:slot}});
const P = (name, phone, slot) => ({key:name.trim().toLowerCase(), name, phone, slot});

// ---- The diff --------------------------------------------------------------
t('a first roster is all inserts', () => {
  const d = API.assignDiff([], [P('Ahmad','+1','confirmed'), P('Sara','+2','confirmed')]);
  assert.deepStrictEqual(d.insert.map(x=>x.name), ['Ahmad','Sara']);
  assert.deepStrictEqual(d.remove, []); assert.deepStrictEqual(d.update, []);
});
t('an unchanged person is KEPT — never inserted, never removed', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed')], [P('Ahmad','+1','confirmed')]);
  assert.deepStrictEqual(d.insert, []);
  assert.deepStrictEqual(d.remove, []);
  assert.deepStrictEqual(d.update, []);
  assert.deepStrictEqual(d.keep.map(x=>x.id), ['r1']);
});
t('adding one person to a roster of seven inserts exactly one', () => {
  const have = ['A','B','C','D','E','F','G'].map((x,i)=>R('r'+i,x,'confirmed'));
  const want = ['A','B','C','D','E','F','G','H'].map(x=>P(x,'+1','confirmed'));
  const d = API.assignDiff(have, want);
  assert.deepStrictEqual(d.insert.map(x=>x.name), ['H']);
  assert.strictEqual(d.keep.length, 7);
});
t('a cleared tick is a removal', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed'), R('r2','Sara','confirmed')], [P('Ahmad','+1','confirmed')]);
  assert.deepStrictEqual(d.remove.map(x=>x.id), ['r2']);
});
t('a slot change is an UPDATE, not a remove plus an insert', () => {
  // delete+insert would re-fire the INSERT trigger and message somebody twice.
  const d = API.assignDiff([R('r1','Ahmad','confirmed')], [P('Ahmad','+1','backup')]);
  assert.deepStrictEqual(d.insert, []);
  assert.deepStrictEqual(d.remove, []);
  assert.deepStrictEqual(d.update.map(x=>[x.id, x.slot]), [['r1','backup']]);
});
t('the same person spelled differently is still the same person', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed')], [P('  ahmad ','+1','confirmed')]);
  assert.deepStrictEqual(d.insert, []);
  assert.strictEqual(d.keep.length, 1);
});
t('a duplicate row for one person is removed down to one rather than kept twice', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed'), R('r2','ahmad','confirmed')], [P('Ahmad','+1','confirmed')]);
  assert.strictEqual(d.keep.length + d.remove.length, 2);
  assert.strictEqual(d.keep.length, 1, 'one row is kept');
  assert.strictEqual(d.remove.length, 1, 'the duplicate goes');
});
t('an empty tick list removes everybody and inserts nobody', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed')], []);
  assert.deepStrictEqual(d.remove.map(x=>x.id), ['r1']);
  assert.deepStrictEqual(d.insert, []);
});

// ---- The caller. A helper tested alone says nothing about who calls it. ----
function stubDb(){
  const calls = [];
  const chain = (kind) => ({
    insert(rows){ calls.push({kind:'insert', rows}); return Promise.resolve({error:null}); },
    update(patch){ return { in(col, ids){ calls.push({kind:'update', patch, ids}); return Promise.resolve({error:null}); },
                            eq(col, id){ calls.push({kind:'update', patch, ids:[id]}); return Promise.resolve({error:null}); } }; },
    delete(){ return { in(col, ids){ calls.push({kind:'delete', ids}); return Promise.resolve({error:null}); } }; }
  });
  return { calls, from(tbl){ calls.push({kind:'from', tbl}); return chain(tbl); } };
}
const CFG = {name:'F_NM', phone:'F_PH'};
const RCFG = {assign_name:'R_NM', assign_phone:'R_PH', assign_slot:'R_SLOT', assign_msg:'R_MSG'};
const ctx = (existing, ticked, db) => ({db, rosterTableId:'T_ROSTER', eventId:'e-1',
  cfg:CFG, rosterCfg:RCFG, existing, ticked, myUserId:'u1'});

T('an unchanged roster writes NOTHING — the rule the feature lives on', async () => {
  const db = stubDb();
  await API.submitAssignments(ctx([R('r1','Ahmad','confirmed')], [P('Ahmad','+1','confirmed')], db));
  const writes = db.calls.filter(c => c.kind !== 'from');
  assert.deepStrictEqual(writes, [], 'a re-submit with no change must not touch the database at all');
});

T('adding one to seven inserts one row and leaves the seven alone', async () => {
  const db = stubDb();
  const have = ['A','B','C','D','E','F','G'].map((x,i)=>R('r'+i,x,'confirmed'));
  const want = ['A','B','C','D','E','F','G','H'].map(x=>P(x,'+1','confirmed'));
  await API.submitAssignments(ctx(have, want, db));
  const ins = db.calls.filter(c=>c.kind==='insert');
  assert.strictEqual(ins.length, 1);
  assert.strictEqual(ins[0].rows.length, 1, 'exactly one row inserted');
  assert.strictEqual(ins[0].rows[0].data.R_NM, 'H');
  assert.strictEqual(db.calls.filter(c=>c.kind==='delete').length, 0);
  assert.strictEqual(db.calls.filter(c=>c.kind==='update').length, 0);
});

T('an inserted row carries the event as its parent, the phone, the slot and no message state', async () => {
  const db = stubDb();
  await API.submitAssignments(ctx([], [P('Ahmad','+962791','backup')], db));
  const row = db.calls.filter(c=>c.kind==='insert')[0].rows[0];
  assert.strictEqual(row.table_id, 'T_ROSTER');
  assert.strictEqual(row.parent_id, 'e-1', 'without parent_id the row is invisible and earns nothing');
  assert.strictEqual(row.data.R_NM, 'Ahmad');
  assert.strictEqual(row.data.R_PH, '+962791', 'the number is copied onto the row, not looked up later');
  assert.strictEqual(row.data.R_SLOT, 'backup');
  assert.ok(!row.data.R_MSG, 'message state is written by the sender, not by the app');
});

T('a slot change issues an update and no insert or delete', async () => {
  const db = stubDb();
  await API.submitAssignments(ctx([R('r1','Ahmad','confirmed')], [P('Ahmad','+1','backup')], db));
  assert.strictEqual(db.calls.filter(c=>c.kind==='insert').length, 0, 'no insert: it would message again');
  assert.strictEqual(db.calls.filter(c=>c.kind==='delete').length, 0);
  const up = db.calls.filter(c=>c.kind==='update');
  assert.strictEqual(up.length, 1);
  assert.deepStrictEqual(up[0].ids, ['r1']);
});

T('removals are deleted in one call rather than one round trip each', async () => {
  const db = stubDb();
  const have = ['A','B','C'].map((x,i)=>R('r'+i,x,'confirmed'));
  await API.submitAssignments(ctx(have, [], db));
  const del = db.calls.filter(c=>c.kind==='delete');
  assert.strictEqual(del.length, 1);
  assert.deepStrictEqual(del[0].ids.sort(), ['r0','r1','r2']);
});

T('a failed delete stops before anything is inserted', async () => {
  const db = stubDb();
  db.from = (tbl) => ({
    insert(){ db.calls.push({kind:'insert'}); return Promise.resolve({error:null}); },
    delete(){ return { in(){ db.calls.push({kind:'delete'}); return Promise.resolve({error:{message:'nope'}}); } }; },
    update(){ return { in(){ return Promise.resolve({error:null}); }, eq(){ return Promise.resolve({error:null}); } }; }
  });
  let threw = false;
  try { await API.submitAssignments(ctx([R('r1','Ahmad','confirmed')], [P('Sara','+1','confirmed')], db)); }
  catch (e) { threw = true; }
  assert.ok(threw, 'a failed write must surface, not be swallowed');
  assert.strictEqual(db.calls.filter(c=>c.kind==='insert').length, 0, 'nothing inserted after a failed delete');
});

// ---- Gating, read out of the page as source ------------------------------
const SRC = fs.readFileSync('index.html','utf8');
t('the Assign button is gated on canManage, like Payroll — it creates paid rows', () => {
  const m = /assign-btn[\s\S]{0,400}?canManage/.exec(SRC);
  assert.ok(m, 'the Assign button must be gated on canManage');
});
t('submitting a roster never changes the event status', () => {
  const fn = grab(scripts('index.html'), 'submitAssignments', 'index.html');
  assert.ok(!/status/.test(fn),
    'auto-closing the ballot on a half-finished roster would stop anyone voting into the gap still to fill');
});

setTimeout(()=>console.log(n + ' passed'), 50);
```

- [ ] **Step 2: Run it and watch it fail**

Expected: `no fn assignDiff in index.html`.

- [ ] **Step 3: Add `assignDiff` to `index.html`**

```js
  // What changed between the roster on the event and the boxes Zamel just ticked.
  // Four buckets, and the difference between them is the difference between a quiet
  // save and messaging the whole team a second time:
  //   insert — newly added. ONLY these are messaged (Task 9's trigger is INSERT-only).
  //   update — same person, different slot. An update and NOT delete+insert, because
  //            delete+insert re-fires that trigger and messages somebody twice.
  //   remove — the tick was cleared.
  //   keep   — unchanged. No write of any kind.
  function assignDiff(existing, ticked) {
    var have = {}, order = [];
    (existing || []).forEach(function (r) {
      var k = assignPersonKey((r.data || {})[(r._nameField || "R_NM")] !== undefined
        ? (r.data || {})[(r._nameField || "R_NM")] : "");
      if (!have[k]) { have[k] = r; order.push(k); } else { r._dupe = true; }
    });
    var want = {};
    (ticked || []).forEach(function (p) { want[assignPersonKey(p.name)] = p; });
    var insert = [], remove = [], update = [], keep = [];
    Object.keys(want).forEach(function (k) {
      var row = have[k], p = want[k];
      if (!row) { insert.push(p); return; }
      var was = String((row.data || {})["R_SLOT"] || "");
      if (String(p.slot || "") !== was) update.push({ id: row.id, slot: p.slot, name: p.name });
      else keep.push(row);
    });
    (existing || []).forEach(function (r) {
      var k = assignPersonKey((r.data || {})["R_NM"]);
      if (!want[k]) { if (remove.indexOf(r) === -1) remove.push(r); return; }
      if (have[k] !== r) remove.push(r);          // a duplicate row for one person
    });
    return { insert: insert, remove: remove, update: update, keep: keep };
  }
```

> **Note for the implementer:** the field ids above are written as the literals `R_NM` / `R_SLOT` only so this helper stays pure and testable. Do **not** hard-code them in the page — `assignDiff` receives rows whose `data` has already been re-keyed by `submitAssignments` onto the two literal keys `R_NM` and `R_SLOT`, using `rosterCfg.assign_name` and `rosterCfg.assign_slot` from `config`. That re-keying is the one place the real ids appear, and Step 4 does it.

- [ ] **Step 4: Add `submitAssignments` to `index.html`**

```js
  // Writes one event's roster. The order is deletes, then slot updates, then inserts —
  // and a failure at any stage stops the rest rather than leaving half a roster.
  //
  // Inserts go LAST on purpose: an insert is what queues a message, so nothing is
  // messaged until the removals and moves have actually landed.
  //
  // It deliberately does not touch the event's status. Flipping to `assigned` here
  // would drop the event off the ballot the moment a half-finished roster was saved,
  // so nobody could vote into the gap still to be filled.
  function submitAssignments(ctx) {
    var db = ctx.db, rcfg = ctx.rosterCfg;
    // Re-key onto the two literal keys assignDiff reads, so the diff stays pure and
    // the real field ids live in exactly one place.
    var norm = (ctx.existing || []).map(function (r) {
      return { id: r.id, _src: r,
               data: { R_NM: (r.data || {})[rcfg.assign_name], R_SLOT: (r.data || {})[rcfg.assign_slot] } };
    });
    var d = assignDiff(norm, ctx.ticked || []);
    var step = Promise.resolve();
    if (d.remove.length) {
      step = step.then(function () {
        return db.from("app_submissions").delete().in("id", d.remove.map(function (r) { return r.id; }))
          .then(function (res) { if (res && res.error) throw res.error; });
      });
    }
    d.update.forEach(function (u) {
      step = step.then(function () {
        var patch = {}; patch["data"] = null;   // replaced below; kept explicit for readability
        return db.from("app_submissions")
          .update({ data: Object.assign({}, ((ctx.existing || []).filter(function (r) { return r.id === u.id; })[0] || {}).data || {},
                                        (function (o) { o[rcfg.assign_slot] = u.slot; return o; })({})) })
          .eq("id", u.id)
          .then(function (res) { if (res && res.error) throw res.error; });
      });
    });
    if (d.insert.length) {
      step = step.then(function () {
        var rows = d.insert.map(function (p) {
          var data = {};
          data[rcfg.assign_name] = p.name;
          if (p.phone) data[rcfg.assign_phone] = p.phone;
          data[rcfg.assign_slot] = p.slot || "confirmed";
          // Message state is written by the sender, never here: this row claiming to
          // be `sent` before anything was sent is how a barista never gets told.
          return { table_id: ctx.rosterTableId, parent_id: ctx.eventId, data: data };
        });
        return db.from("app_submissions").insert(rows)
          .then(function (res) { if (res && res.error) throw res.error; });
      });
    }
    return step.then(function () { return d; });
  }
```

- [ ] **Step 5: Run both assign test files**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/assign.test.js
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/assign-submit.test.js
```
Expected: both pass. The two source-reading tests at the end of `assign-submit` will still fail until Task 8 adds the button — that is expected, and Task 8 Step 5 is where they go green.

- [ ] **Step 6: Commit**

```bash
git add index.html docs/tests/assign-submit.test.js
git commit -m "Assign: diff a roster so only newly-added people are ever messaged"
```

---

## Task 8: The Assign panel

**Files:**
- Modify: `index.html` — an `assign-btn` in the base bar beside the Payroll button (~line 5352), a panel, and the wiring.
- Modify: `docs/tests/README.md`

**Interfaces:**
- Consumes: everything from Tasks 5–7.
- Produces: the only user-facing entry point. No new exported helpers.

- [ ] **Step 1: Add the button, gated exactly like Payroll**

Beside the Payroll button's visibility line (~line 5352):

```js
    // Assigning creates the rows the payroll export pays, so it follows can_manage
    // rather than can_edit — the same gate, for the same reason.
    document.getElementById("assign-btn").style.display =
      (assignConfig(t) && canManage(t.id)) ? "inline-flex" : "none";
```

and the markup beside the Payroll button:

```html
        <button type="button" class="basebtn" id="assign-btn" style="display:none;">Assign</button>
```

- [ ] **Step 2: Load what the panel needs when it opens**

```js
  // Four reads, all at once: the availability rows (who voted), the whole roster
  // across every event (for the clash warning and the month count), the events (to
  // name a clash), and the roster table's own config (the field ids to write).
  function openAssign(ev) {
    var t = currentCustom && currentCustom.table, cfg = t && assignConfig(t);
    if (!cfg || !canManage(t.id)) return;
    var avail = db.from("app_tables").select("id").eq("slug", cfg.from).single()
      .then(function (r) { return r.data ? db.from("app_submissions").select("id,data,created_at").eq("table_id", r.data.id) : { data: [] }; });
    var roster = db.from("app_tables").select("id,config").eq("slug", cfg.roster).single()
      .then(function (r) {
        if (!r.data) return { rows: [], id: null, config: {} };
        return db.from("app_submissions").select("id,parent_id,data").eq("table_id", r.data.id)
          .then(function (s) { return { rows: (s && s.data) || [], id: r.data.id, config: r.data.config || {} }; });
      });
    var events = db.from("app_submissions").select("id,data").eq("table_id", t.id);
    return Promise.all([avail, roster, events]).then(function (out) {
      renderAssign(ev, cfg, ((out[0] && out[0].data) || []), out[1], ((out[2] && out[2].data) || []));
    });
  }
```

- [ ] **Step 3: Render the panel**

`renderAssign` draws, for this event: the header (name, date, time, location), then one row per candidate from `assignCandidates` carrying the name, the phone, the month count from `assignMonthCount`, a clash line from `assignClashes`, a checkbox pre-ticked for anyone already on the roster, and a confirmed/backup toggle. Beneath: `"<ticked> of <Places> places · <backups> backup"` from `cfg.capacity`, over capacity shown as a warning and **never** as a block. Then Submit.

```js
    // Over capacity warns and proceeds. Zamel is the manager and the number is
    // advisory in this flow — a hard stop here would be the app overruling him.
    var over = ticked.filter(function (p) { return p.slot === "confirmed"; }).length > places;
    countEl.className = over ? "assign-count over" : "assign-count";
```

- [ ] **Step 4: Wire Submit through `submitAssignments`**

```js
    submitEl.addEventListener("click", function () {
      submitEl.disabled = true;
      submitAssignments({
        db: db, rosterTableId: roster.id, eventId: ev.id, cfg: cfg,
        rosterCfg: roster.config, existing: mine, ticked: readTicked(), myUserId: myUserId
      }).then(function (d) {
        // Say what happened, in the terms that matter: how many people will be told.
        toast(d.insert.length + " added · " + d.remove.length + " removed · " +
              d.update.length + " moved · " + d.keep.length + " unchanged");
        closeAssign(); renderCustom();
      }).catch(function (e) {
        submitEl.disabled = false;
        window.alert("Could not save the roster. " + (e && e.message ? e.message : ""));
      });
    });
```

- [ ] **Step 5: Run the assign tests — the two source-reading ones now pass**

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" docs/tests/assign-submit.test.js
```
Expected: every test passes, including the `canManage` gate and "submitting never changes the event status".

- [ ] **Step 6: Prove it by hand, end to end**

1. Create two events, both `open`, **overlapping on the same day**.
2. Open the public link, vote for both as two different names.
3. Assign one person to the first event, Submit. Confirm one roster row appears with `parent_id` set.
4. Re-open Assign on that event, add the second person, Submit. **Confirm the toast reads `1 added · 0 removed · 0 moved · 1 unchanged`.** This is the whole feature in one line.
5. Open Assign on the second event and confirm the first person shows the clash warning naming the first event.
6. Tick more people than Places and confirm it warns and still saves.
7. Confirm the event's status did not move by itself.

- [ ] **Step 7: Add the README rows and commit**

```markdown
| `assign.test.js` | the assign screen's reading half (`assignConfig`, `assignCandidates`, `assignMonthCount`, `eventsOverlap`, `assignClashes`). The link is permanent and events keep arriving, so a barista fills the ballot in repeatedly: the tests that matter are that three submissions from one person are **one** candidate, that the **latest** one decides (so withdrawing a tick actually withdraws it), and that `e-1` never matches `e-12`. Identity is `trim().toLowerCase()`, the same rule `payrollRows` uses — if the two ever disagree, the roster and the money disagree about who somebody is. The clash tests pin the half-open reading of a shift: 10–16 and 16–20 are two shifts one person can work, a missing end time is the end of the day, and an end before its own start is too, which is what `eventPhase` already does |
| `assign-submit.test.js` | the **caller** that writes a roster (`assignDiff`, `submitAssignments`), with the database stubbed and the assertions about the calls made and their order. `payroll.test.js` passing 16/16 while the export was broken is why this file exists. The one test the feature lives on: **a re-submitted roster with no change must not touch the database at all** — every write is a queued message, so a careless save re-messages the whole team and the feature gets switched off in week one. Next to it: a slot change is an `update` and never a delete-plus-insert (which would re-fire the INSERT-only trigger and tell somebody twice), inserts go last so nothing is messaged before the removals land, a failed delete stops before anything is inserted, an inserted row carries `parent_id` (without it the row is invisible in every view and earns nothing) and carries no `Message state` (the sender writes that, or a barista is recorded as told when nobody told them). Two assertions read the page as source: the button is gated on `canManage` like Payroll, and `submitAssignments` never touches the event's status |
```

```bash
git add index.html docs/tests/README.md
git commit -m "The Assign panel: candidates, clashes, capacity as a warning, one Submit"
```

---

## Task 9: Queue the message on insert

**Files:**
- Create: `C:\Users\ASUS\blktable-migration\workspaces\34-assignment-notify.sql`

**Interfaces:**
- Consumes: the roster table and its `config.assign_*` field ids from Task 1; `notify_outbox` from `whatsapp/02-notify-outbox.sql`.
- Produces: an INSERT-only trigger on `app_submissions` scoped to the roster table, and a DELETE trigger for the removal notice.

**Before anything:** the dashboard already reads `notify_outbox` (`index.html` ~line 4215) and falls back gracefully when the table is absent, so the app half of the alerts work is merged. What is **not** confirmed is whether `whatsapp/02-notify-outbox.sql` has been applied to the live database. Step 1 finds out.

- [ ] **Step 1: Check whether the outbox exists at all**

```bash
ssh blk-server "docker exec -i supabase-db psql -U postgres -d postgres -c \
  \"select to_regclass('public.notify_outbox') as outbox, to_regclass('public.notify_config') as cfg;\""
```
- Both non-null → go to Step 2.
- Either null → apply `whatsapp/02-notify-outbox.sql` first, and **confirm it installed with `notify_config.enabled = false`** before continuing. Nothing here may send.

- [ ] **Step 2: Write the trigger, ending in `rollback`**

```sql
-- ============================================================================
-- A newly-assigned barista is told. Postgres decides and queues; the edge
-- function only sends — the decision kept from 02-notify-outbox.sql, because a
-- roster row is written by the Assign panel AND by a manager editing the grid,
-- and only a row trigger sees both.
--
-- INSERT ONLY, and that is the whole safety property. The app's diff does not
-- re-insert unchanged rows, so re-submitting a roster after adding one person
-- cannot re-message the other seven. The guarantee is structural rather than a
-- thing the page has to remember.
--
-- Installs while notify_config.enabled is false: real assignments queue real
-- addressed messages that go nowhere until one has been proven to one number.
--
-- Ends in ROLLBACK. Read the checks, then change the last word.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function public.assignment_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb; v_ev jsonb; v_parent uuid;
  f_name uuid; f_date uuid; f_start uuid; f_loc uuid;
  v_phone text; v_who text; v_evname text;
begin
  select config into v_cfg from public.app_tables where id = new.table_id;
  -- Only the table that declares the roster field ids takes part. Every other
  -- table's inserts fall straight through, so this trigger is inert app-wide.
  if v_cfg is null or v_cfg -> 'assign_phone' is null then return new; end if;

  v_phone := new.data ->> (v_cfg ->> 'assign_phone');
  v_who   := new.data ->> (v_cfg ->> 'assign_name');
  -- No number, no message — and say so on the row rather than dropping it, or a
  -- barista who was never told looks identical to one who was.
  if v_phone is null or btrim(v_phone) = '' then
    update public.app_submissions
       set data = data || jsonb_build_object(v_cfg ->> 'assign_msg', 'failed')
     where id = new.id;
    return new;
  end if;

  select (config -> 'parent' ->> 'table')::uuid into v_parent
    from public.app_tables where id = new.table_id;
  select max(case when label = 'Event name' then id end),
         max(case when label = 'Date' then id end),
         max(case when label = 'Start time' then id end),
         max(case when label = 'Location' then id end)
    into f_name, f_date, f_start, f_loc
    from public.app_fields where table_id = v_parent;

  select data into v_ev from public.app_submissions where id = new.parent_id;
  if v_ev is null then return new; end if;      -- an orphan row names no event
  v_evname := v_ev ->> f_name::text;

  -- Template variables only. Meta will not send free text to somebody who has not
  -- messaged the business in 24 hours, so the sentence is fixed at approval time
  -- and only these five values vary.
  insert into public.notify_outbox (to_phone, template, vars, source_table, source_row)
  values (v_phone, 'blk_event_assigned',
          jsonb_build_array(coalesce(v_who,''), coalesce(v_evname,''),
                            coalesce(v_ev ->> f_date::text,''),
                            coalesce(left(v_ev ->> f_start::text, 5),''),
                            coalesce(v_ev ->> f_loc::text,'')),
          new.table_id, new.id);

  update public.app_submissions
     set data = data || jsonb_build_object(v_cfg ->> 'assign_msg', 'queued')
   where id = new.id;
  return new;
end $$;

drop trigger if exists trg_assignment_notify on public.app_submissions;
create trigger trg_assignment_notify
  after insert on public.app_submissions
  for each row execute function public.assignment_notify();

-- ============================== VERIFICATION ================================
\echo '--- sending must still be OFF (expect f) ---'
select enabled from public.notify_config;

\echo '--- the trigger is AFTER INSERT and nothing else (expect one row, INSERT) ---'
select tgname, string_agg(t.event, ',') as events
from pg_trigger tg
join lateral (select unnest(array['INSERT','UPDATE','DELETE']) as event) t on true
where tg.tgname = 'trg_assignment_notify'
  and ((t.event='INSERT' and (tg.tgtype & 4) > 0)
    or (t.event='UPDATE' and (tg.tgtype & 16) > 0)
    or (t.event='DELETE' and (tg.tgtype & 8) > 0))
group by tgname;

\echo '--- an insert into a table that is not a roster queues nothing (expect 0) ---'
select count(*) from public.notify_outbox where source_table not in
  (select id from public.app_tables where config -> 'assign_phone' is not null);

rollback;
```

- [ ] **Step 3: Dry-run and read the checks**

```bash
scp C:/Users/ASUS/blktable-migration/workspaces/34-assignment-notify.sql blk-server:/tmp/34.sql
ssh blk-server 'docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/34.sql'
```
Expected: `enabled` is `f`; the trigger reports **`INSERT` only** — if `UPDATE` appears, every edit to any record in the app would message somebody; and zero stray outbox rows.

- [ ] **Step 4: Change to `commit`, run, and prove the INSERT-only rule with real rows**

```bash
ssh blk-server 'docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/34.sql'
```
Then in the app: assign two people to an event and confirm **two** `notify_outbox` rows and both roster rows reading `queued`. Re-open Assign, add a third, Submit, and confirm the outbox now holds **three, not five**. Move somebody from confirmed to backup and confirm the outbox is **still three**.

```bash
ssh blk-server "docker exec -i supabase-db psql -U postgres -d postgres -c \
  \"select to_phone, template, vars, created_at from notify_outbox order by created_at desc limit 10;\""
```

- [ ] **Step 5: Register the template and record what is still blocked**

The `blk_event_assigned` template must be submitted to Meta for approval with five variables in this order: barista name, event name, date, start time, location. English first. Until the credentials and the approval come back from Mego, `notify_config.enabled` stays `false` — queued rows are correct and go nowhere.

**On the day it is switched on, expire the backlog rather than draining it:**

```sql
delete from public.notify_outbox where created_at < now() - interval '2 days';
```
Flipping the boolean with a full outbox fires notices for events that have already happened.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/ASUS/blktable-migration
git add workspaces/34-assignment-notify.sql
git commit -m "Queue a WhatsApp message when a barista is newly assigned (INSERT only)"
```

---

## Task 10: Test seed and the payroll proof

**Files:**
- Create: `C:\Users\ASUS\blktable-migration\workspaces\TEST-zamel-flow-seed.sql`
- Create: `C:\Users\ASUS\blktable-migration\workspaces\TEST-zamel-flow-cleanup.sql`

- [ ] **Step 1: Write the seed, following the existing pattern**

Everything tagged `extra->>'_test'`, **deliberately fake names** (fake money against real staff names in a production payroll table is the thing that must not be left behind), and the expected answer printed by the file so the CSV can be diffed.

The traps to build in, each one a way the export lies:
- **One event at a different rate.** With every event at 15, no dataset can tell "sums each event's own rate" apart from "counts and multiplies by 15". That single odd event is the whole test.
- A person with two `backup` rows who must be paid for neither.
- A name stored `"  zzz test  "` that must merge with `"ZZZ Test"` into one person.
- An empty name that must read `(no name)` rather than being dropped.
- Two control events outside the pay period.
- One roster row whose event was deleted, which must earn nothing.

- [ ] **Step 2: Run the seed, then export and diff**

```bash
scp C:/Users/ASUS/blktable-migration/workspaces/TEST-zamel-flow-seed.sql blk-server:/tmp/seed.sql
ssh blk-server 'docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/seed.sql'
```
Open Payroll on Events (Zamel) over the seeded range and diff the CSV against the totals the file printed. **The row that matters is the person who worked the odd-rate event** — if their amount is `events × 15` the export is multiplying rather than summing, and the arithmetic is wrong in a way a flat-rate dataset would never show.

- [ ] **Step 3: Clean up and confirm nothing is left**

```bash
ssh blk-server 'docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/cleanup.sql'
```
The cleanup deletes exactly the tagged rows and re-runs the checks. Expect the tagged counts to be zero.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/ASUS/blktable-migration
git add workspaces/TEST-zamel-flow-seed.sql workspaces/TEST-zamel-flow-cleanup.sql
git commit -m "Test seed for the Zamel flow, with one event at a different rate"
```

---

## Task 11: Ship it

- [ ] **Step 1: Run every test in the folder**

```bash
for f in docs/tests/*.test.js; do
  echo "== $f"
  ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" "$f"
done
```
Expected: every file passes. Both pages were edited, so a regression anywhere in the suite belongs to this branch.

- [ ] **Step 2: Rebase onto a fresh `origin/main`**

PRs squash-merge and the branch is deleted, so the base moves under you:

```bash
git fetch --prune origin
git rebase origin/main
```

- [ ] **Step 3: Check the throttle before Zamel sends the link to 292 people**

This design's specific risk: one link to ~292 people who sit behind a handful of shop IPs, and Kong throttles per IP. Read the limit that applies to the form-submit path and confirm a branch filling the ballot in together will not start getting errors. If it would, raise it before launch — a barista told "couldn't submit" does not try again.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/events-zamel-flow
gh pr create --title "Events (Zamel): one link, a vote, assignment by hand, a message on submit" --body "$(cat <<'EOF'
Zamel manages Faisal and Waleed and asked for the opposite intake from the one that is
built: one link, a vote from the baristas, assignment by hand, and a message when he
submits. This goes in as a parallel `(Zamel)` set of tables; the existing flow is kept
as a fallback and only one of the two will end up in use.

Three tables and not two, so the multi-tick fan-out happens inside the app and
`submit_public_form` is never touched. The ballot is a new `record_multi` question whose
choices are another table's live rows — the same shape `branch` already uses to read the
`branches` table — and it stores record **ids**, so renaming an event cannot orphan a vote.

The rule the feature lives on: submitting a roster messages only the people newly added.
It is enforced structurally, by an INSERT-only trigger and a diff that does not re-insert
unchanged rows, rather than by careful UI code.

Sending is still off (`notify_config.enabled = false`) pending Meta credentials and
template approval.

SQL applied separately: `workspaces/32`, `33`, `34`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Do not merge until the ballot has been used for real**

Step 2 of the build order exists so Zamel uses the ballot before the assign screen is finalised. Let him vote on a real event and say whether the list reads the way he expects, then merge.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the three tables and all config → Task 1; Standard 6 → Tasks 2–4; Standard 7 → Tasks 5–8; Standard 4 staying off → Task 1 (never installed); the message, the template constraints and the backlog note → Task 9; payroll needing no work → proved in Task 1 Step 4 and Task 10; the Kong risk → Task 11 Step 3; all six hand tests → Task 8 Step 6, Task 9 Step 4, Task 2 Step 3, Task 10 Step 2.

**Three refinements to the spec, found while reading the code.** Worth carrying back into the design doc:
1. `config.assign` needs `name` and `phone` as well as `from`/`match`/`roster`/`capacity` — the candidate list cannot be built without knowing which questions hold them.
2. The spec said the ballot needs an RPC because `config_public` is a generated whitelist. The real reason is narrower and stronger: the source table's *field ids* live in config, so the pivot from jsonb answers to `name`/`date`/`location` has to happen at call time. The `branch` question proves a direct anon read is possible when the columns are real columns; an event's answers are not.
3. The spec did not say what the multi-tick stores. It stores **record ids**, with `ballotNames` resolving them for display — otherwise the assign screen would match people to events by printed name, which is the one thing this app refuses to do anywhere else.

**Placeholder scan.** No TBDs. The one deliberate loose end is `renderAssign`'s markup in Task 8 Step 3, which is described by what it must show and gets its two behavioural rules (over-capacity warns, status never moves) as code — the panel's HTML follows the existing base-bar panels and is not worth transcribing.

**Type consistency.** `assignPersonKey` is used by `assignCandidates`, `assignMonthCount`, `assignClashes` and `assignDiff`, and is exported for the test that pins it. `assignDiff` reads the literal keys `R_NM`/`R_SLOT` and `submitAssignments` is the only place that re-keys real field ids onto them — the note under Task 7 Step 3 says so, because an implementer reading Task 7 alone would otherwise hard-code them.
