# Create-table rights + branch normalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let specific non-admin users create and own tables (with an admin audit log), and make branch answers populate the structured `app_submissions.branch` column across all tables from one canonical branch list (franchises get their own).

**Architecture:** Two independent parts sharing one read-only inspection gate and rollout track. Frontend logic lives in `index.html` as small pure helpers tested by plain-node scripts under `docs/tests/`. DB changes are transactional SQL files in `~/Documents/blktable-migration/` (gitignored in the app repo), applied on the self-hosted Postgres by Yazan via `docker exec -i supabase-db psql`, each with a verify SELECT that acts as its test. RLS is the true enforcement for table creation because creation is a direct client insert, not an RPC.

**Tech Stack:** Vanilla JS single-file app (`index.html`, `f/index.html`), self-hosted Supabase/Postgres, plain-node test harness (`fs`+`vm`+`assert`), `psql` migrations.

**Execution notes:**
- Frontend tasks (F-*) are done by the implementer directly in this repo (branch `feat/table-rights-branch-fix`). Run tests with `node docs/tests/<file>.test.js`.
- DB tasks (D-*) are authored here as SQL files but **applied by Yazan** over SSH: `docker exec -i supabase-db psql -U postgres -d postgres < ~/Documents/blktable-migration/<file>.sql`. The implementer writes the file and Yazan pastes back the verify SELECT output. NEVER run these against the hosted decoy project.
- Two shippable PRs: **Part B (branch)** and **Part A (rights)**. Do Part B first (lower risk, no RLS changes).

---

## Phase 0 — Read-only inspection (GATE, run before any D-task)

### Task 0: Capture live DB state

**Files:**
- Create: `~/Documents/blktable-migration/inspect-rights-branch-2026-08-20.sql`

- [ ] **Step 1: Write the inspection SQL**

```sql
-- READ ONLY. Run: docker exec -i supabase-db psql -U postgres -d postgres < inspect-rights-branch-2026-08-20.sql
\echo '== is_admin helper =='
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='is_admin';

\echo '== policies on app_tables / app_fields / table_access / profiles =='
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname='public' and tablename in ('app_tables','app_fields','table_access','profiles')
order by tablename, cmd, policyname;

\echo '== app_tables columns (created_by? config?) =='
select column_name, data_type, column_default
from information_schema.columns
where table_schema='public' and table_name='app_tables' order by ordinal_position;

\echo '== profiles columns (role? can_create_tables?) =='
select column_name, data_type, column_default
from information_schema.columns
where table_schema='public' and table_name='profiles' order by ordinal_position;

\echo '== branches columns + row count =='
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='branches' order by ordinal_position;
select count(*) as branch_rows from branches;

\echo '== per-table branch dropdown fields + current branch-column fill rate =='
select t.slug, t.name, f.id as field_id, f.label, f.type,
       (select count(*) from app_submissions s where s.table_id=t.id) as rows,
       (select count(*) from app_submissions s where s.table_id=t.id and s.branch is not null) as with_branch
from app_tables t
join app_fields f on f.table_id=t.id
where f.label ilike '%branch%' or f.label like '%الفرع%'
order by t.slug, f.type;

\echo '== distinct legacy free-text branch answers (short_text/text branch fields) =='
select t.slug, s.data->>(f.id::text) as answer, count(*)
from app_tables t
join app_fields f on f.table_id=t.id and f.type in ('short_text','text')
   and (f.label ilike '%branch%' or f.label like '%الفرع%')
join app_submissions s on s.table_id=t.id
where s.data ? (f.id::text)
group by 1,2 order by 1,3 desc;
```

- [ ] **Step 2: Yazan applies it and pastes back output**

Run (Yazan): `docker exec -i supabase-db psql -U postgres -d postgres < ~/Documents/blktable-migration/inspect-rights-branch-2026-08-20.sql`
Expected: the six sections above print. Record: exact `is_admin` signature, current app_tables/app_fields INSERT/UPDATE/DELETE/SELECT policy `qual`/`with_check`, whether `created_by`/`can_create_tables` already exist, the `branches` column set (esp. any `name_ar`/`color`/`list_key`), and the list of legacy free-text branch values.

- [ ] **Step 3: Reconcile the plan**

If `branches` has no `name_ar`, drop `ar` from generated options (use `''`). If policies differ from the assumptions in D-tasks below, edit the `create policy` blocks to match the real helper/column names before applying. Note the legacy free-text value list for the Task B4 cleanup handoff.

---

## PART B — Branch as a first-class field type (ship first)

Design pivot (2026-08-20, after inspection): the branch field is on ~80 tables, most internal/imported and already populated, and the `%branch%` label match has many false positives. So instead of a fragile "detect a dropdown labelled branch + config.branch_field" heuristic, `branch` becomes a real field TYPE. A `type='branch'` field renders as a dropdown fed live from the `branches` table filtered by a `list` key (jo/iraq/lebanon for franchises). The DB trigger copies the `type='branch'` field's answer into `app_submissions.branch`. Existing genuine single-branch pickers are converted to the new type via a CURATED list (reviewed before running), never a blanket label match.

Inspection facts to build against: `is_admin()` takes NO args; auth reads gated by `can_access(text)`; `profiles.role` is enum `user_role`; `branches` has columns id, name, name_ar, is_active, position, created_at, code (NO list_key yet); `app_submissions.branch` column exists; public form keys answers by field UUID (`data[fieldId]`).

### File structure (Part B)
- `~/Documents/blktable-migration/branch-01-list-key-and-anon.sql` — add `branches.list_key`, seed jo, anon SELECT on branches.
- `~/Documents/blktable-migration/branch-02-trigger.sql` — trigger populating `app_submissions.branch` from the `type='branch'` field.
- `~/Documents/blktable-migration/branch-03-convert-candidates.sql` — READ-ONLY candidate list of fields to convert (for Yazan review).
- `~/Documents/blktable-migration/branch-04-convert-and-backfill.sql` — convert approved fields to `type='branch'` + backfill branch column.
- `index.html` — FIELD_TYPES, typeUsesOpts/optsPlaceholder, serialize, edit-render, full `allBranches` load; reuse `branchDropdownOptions`.
- `f/index.html` — load branches, render `type='branch'` via buildCombo.
- `docs/tests/branch-field.test.js` — extend for the field-type rendering helpers.

### Task B1 (D): branches.list_key + seed + anon read

**Files:** Create `~/Documents/blktable-migration/branch-01-list-key-and-anon.sql`

- [ ] **Step 1: Write the SQL**

```sql
begin;
alter table public.branches add column if not exists list_key text not null default 'jo';

-- Public forms (anon) must read the preset list to render a branch dropdown. Names are
-- already embedded in every existing branch dropdown, so this exposes nothing new.
grant select on public.branches to anon, authenticated;
alter table public.branches enable row level security;
drop policy if exists branches_anon_read on public.branches;
create policy branches_anon_read on public.branches for select to anon, authenticated using (true);

\echo 'VERIFY: list_key present, all jo, anon can see rows'
select list_key, count(*) from public.branches group by 1 order by 1;
select policyname, cmd, roles from pg_policies where schemaname='public' and tablename='branches';
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Run: `ssh ali@2.28.1.141 'docker exec -i supabase-db psql -U postgres -d postgres' < ~/Documents/blktable-migration/branch-01-list-key-and-anon.sql`
Expected: one row `jo | 38`; a `branches_anon_read` SELECT policy for {anon,authenticated}.

- [ ] **Step 3: Franchise lists (needs Yazan's data)**

When Yazan provides Iraq/Lebanon branch names, insert them with `list_key='iraq'` / `'lebanon'`. Until then, jo is the only list; contact-us-iraq/lebanon branch fields will show an empty list, which is acceptable (0 submissions today).

### Task B2 (D): trigger populating the branch column from the branch field

**Files:** Create `~/Documents/blktable-migration/branch-02-trigger.sql`

- [ ] **Step 1: Write the SQL**

```sql
begin;
-- The branch field is identified by TYPE. There is at most one per table. Copy its answer
-- (keyed by field id in the data blob) into the structured branch column on every write.
create or replace function public.app_submissions_set_branch()
returns trigger language plpgsql as $$
declare v_field text;
begin
  select f.id::text into v_field
  from public.app_fields f
  where f.table_id = new.table_id and f.type = 'branch'
  order by f.position limit 1;
  if v_field is not null and (new.data ? v_field) then
    new.branch := nullif(new.data->>v_field, '');
  end if;
  return new;
end $$;

drop trigger if exists trg_app_submissions_set_branch on public.app_submissions;
create trigger trg_app_submissions_set_branch
  before insert or update of data on public.app_submissions
  for each row execute function public.app_submissions_set_branch();

\echo 'VERIFY: trigger exists'
select tgname from pg_trigger where tgname = 'trg_app_submissions_set_branch';
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Expected: `trg_app_submissions_set_branch` listed. No data changes yet (no field is `type='branch'` until B4).

### Task B3 (D): produce the curated conversion candidate list (READ ONLY)

**Files:** Create `~/Documents/blktable-migration/branch-03-convert-candidates.sql`

- [ ] **Step 1: Write the SQL** — surfaces genuine single-branch pickers on active public forms and EXCLUDES the false-positive categories.

```sql
-- READ ONLY. Lists fields proposed for conversion to type='branch'.
-- Include: dropdown/short_text branch selectors on active public forms.
-- Exclude: link/number/yesno/long_text/multi_select, Airtable lookup "(from ...)" cols,
--          dual source/destination, bank branch, area/location free-text.
select t.slug, t.name, t.is_active, f.id, f.label, f.type,
  (select count(*) from app_submissions s where s.table_id=t.id) rows,
  (select count(*) from app_submissions s where s.table_id=t.id and s.branch is not null) with_branch
from app_tables t
join app_fields f on f.table_id = t.id
where t.kind = 'form' and t.is_active = true
  and f.type in ('dropdown','short_text')
  and (f.label ilike '%branch%' or f.label like '%الفرع%')
  and f.label not ilike '%(from %'          -- Airtable lookup columns
  and f.label not ilike '%bank%'            -- "which bank/branch"
  and f.label not ilike '%location%'        -- area/location pickers
  and f.label not ilike '%tawjihi%'         -- education branch
  and f.label not ilike '%source%'
  and f.label not ilike '%destination%'
  and f.label not ilike '%origin%'
order by t.slug, f.type;
```

- [ ] **Step 2: Yazan runs it; together we finalize the id list**

Yazan pastes the output. The controller reviews each row and produces the final approved id list for B4 (dropping any Yazan vetoes, tagging each with its `list` key: jo, or iraq/lebanon for the franchise contact-us forms). Content-creators "Branch Name" (short_text) is a definite include; contact-us JO/Iraq/Lebanon are definite includes with their respective list keys.

### Task B4 (D): convert approved fields + backfill

**Files:** Create `~/Documents/blktable-migration/branch-04-convert-and-backfill.sql` (ids filled from B3 review)

- [ ] **Step 1: Write the SQL** — `<IDS_JO>` / `<IDS_IRAQ>` / `<IDS_LEBANON>` are the approved field-id lists from B3.

```sql
begin;
-- Convert approved pickers to the branch field type, tagging which preset list to show.
update public.app_fields set type='branch', options = jsonb_build_object('list','jo')
  where id in (<IDS_JO>);
update public.app_fields set type='branch', options = jsonb_build_object('list','iraq')
  where id in (<IDS_IRAQ>);
update public.app_fields set type='branch', options = jsonb_build_object('list','lebanon')
  where id in (<IDS_LEBANON>);

-- Backfill the branch column from each converted field's existing answers (trigger does it
-- going forward). Only fills where currently null so already-populated rows are untouched.
update public.app_submissions s
set branch = nullif(s.data->>f.id::text, '')
from public.app_fields f
where f.table_id = s.table_id and f.type = 'branch'
  and s.branch is null and (s.data ? f.id::text);

\echo 'VERIFY: converted fields + fill rate'
select t.slug, f.label, f.options->>'list' as list,
  (select count(*) from app_submissions s where s.table_id=t.id) rows,
  (select count(*) from app_submissions s where s.table_id=t.id and s.branch is not null) with_branch
from app_tables t join app_fields f on f.table_id=t.id where f.type='branch' order by t.slug;

\echo 'REPORT: branch values not matching a canonical branch (manual cleanup, will not recur)'
select s.branch, count(*) from app_submissions s
join app_fields f on f.table_id=s.table_id and f.type='branch'
where s.branch is not null and not exists (select 1 from branches b where b.name=s.branch)
group by 1 order by 2 desc;
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Expected: converted fields listed with their list key; fill rate rises on the target forms. Save the REPORT for one-time manual cleanup.

### Task B5 (F): DONE — `branchDropdownOptions` helper

Already implemented and committed (`66880b0`), obsolete `detectBranchFieldId` removed. `branchDropdownOptions(rows, listKey)` returns `[{en,ar}]` for a list. Reused by B6/B7.

### Task B6 (F): builder offers the `branch` field type

**Files:** Modify `index.html`

- [ ] **Step 1: Add to FIELD_TYPES** (index.html ~4219): add `{ v: "branch", label: "Branch" }`.
- [ ] **Step 2: typeUsesOpts** (~4230): add `|| v === "branch"`. **optsPlaceholder** (~4231): branch case returns `"Branch list: jo, iraq, or lebanon (default jo)"`.
- [ ] **Step 3: serialize** (runBuilderSave, ~8734, in the per-type options branch): add
  `else if (type === "branch") { var lk = (rows[i].querySelector(".opts").value.trim() || "jo").toLowerCase(); options = { list: lk }; }`
- [ ] **Step 4:** Run `for f in docs/tests/*.test.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done` — only the pre-existing universal-form-editor failure may show; no new failures.
- [ ] **Step 5: Commit** `feat(branch): add 'branch' field type to the form builder`.

### Task B7 (F): render the `branch` field type (dashboard + public form)

**Files:** Modify `index.html` and `f/index.html`, extend `docs/tests/branch-field.test.js`.

- [ ] **Step 1 (index.html): full branches load.** Expand `loadBranchTints` (~5572) to also populate a module-global `allBranches` array of `{name,name_ar,position,list_key}` (select `name,name_ar,position,list_key` ordered by position; keep building `branchTint` as today).
- [ ] **Step 2 (index.html): edit/display render.** In `edFieldRowHtml` (~3445 dropdown case) and `edExtraRows` (~3509), add a branch case that renders a select from the branch list:
  `else if (f.type === "branch") inner = edSelect(id, v, [""].concat(branchDropdownOptions(allBranches, (f.options && f.options.list) || "jo").map(function(o){return o.en;})));`
- [ ] **Step 3 (f/index.html): load branches at form init** (near where form metadata loads, ~770-827): `db.from("branches").select("name,name_ar,position,list_key").order("position",{ascending:true})` into a global `BRANCHES` array (default `[]` on error).
- [ ] **Step 4 (f/index.html): render branch in buildField** (~530, after dropdown/country): 
  `else if (f.type === "branch") { var list=(f.options&&f.options.list)||"jo"; var src=BRANCHES.filter(function(b){return (b.list_key||"jo")===list;}).sort(function(a,b){return (a.position||0)-(b.position||0);}); var dopts=src.map(function(b){var v=b.name; var arv=b.name_ar||""; return {value:v,label:v+(arv?" / "+arv:"")};}); var combo=buildCombo(f, dopts, ...same args as dropdown...); ... }` — mirror the dropdown branch exactly, only the option source differs.
- [ ] **Step 5: test.** Extend `branch-field.test.js` with a pure helper if one is extracted, or assert `branchDropdownOptions` filtering used by both. At minimum keep the 2 passing tests green and add one asserting franchise filtering (list='iraq' returns only iraq rows). Run `node docs/tests/branch-field.test.js`.
- [ ] **Step 6: Commit** `feat(branch): render branch field type as a live preset dropdown`.
- [ ] **Step 7:** Manual live check deferred to Phase V: add a Branch question to a test form, confirm the public form shows the preset list and a submission lands in the branch column + sidebar grouping.

## PART A — Create-table rights, ownership, audit log (ship second)

### File structure (Part A)
- `~/Documents/blktable-migration/rights-01-columns.sql` — `profiles.can_create_tables`, `app_tables.created_by`, `table_audit`.
- `~/Documents/blktable-migration/rights-02-rls.sql` — rewrite app_tables/app_fields policies.
- `~/Documents/blktable-migration/rights-03-audit-triggers.sql` — audit triggers + table_audit RLS.
- `index.html` — `canCreateTablesFrom`, `mayModifyTable`, `auditLine`; load flag; gate create button + per-table controls; admin History view.
- `docs/tests/table-rights.test.js` — tests for the three pure helpers.

### Task A1 (D): columns + audit table

**Files:** Create `~/Documents/blktable-migration/rights-01-columns.sql`

- [ ] **Step 1: Write the SQL** (replace `<ADMIN_UUID>` with a real admin id from Task 0's profiles output)

```sql
begin;
alter table public.profiles  add column if not exists can_create_tables boolean not null default false;
alter table public.app_tables add column if not exists created_by uuid references public.profiles(id);
-- Existing tables predate ownership: attribute them to an admin so admins retain full control.
update public.app_tables set created_by = '<ADMIN_UUID>' where created_by is null;

create table if not exists public.table_audit (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  table_id uuid,
  table_name text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists table_audit_created_idx on public.table_audit (created_at desc);

\echo 'VERIFY: new columns + table exist'
select column_name from information_schema.columns where table_name='profiles' and column_name='can_create_tables';
select column_name from information_schema.columns where table_name='app_tables' and column_name='created_by';
select count(*) as unowned from public.app_tables where created_by is null;
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Expected: both columns listed; `unowned = 0`.

### Task A2 (D): RLS rewrite

**Files:** Create `~/Documents/blktable-migration/rights-02-rls.sql`

- [ ] **Step 1: Write the SQL** — reconcile policy names/`is_admin` signature with Task 0 output before applying. Assumes `is_admin(uuid)` exists.

```sql
begin;
-- app_tables: admins see/do everything; creators own what they make; shared users see theirs.
drop policy if exists app_tables_select on public.app_tables;
create policy app_tables_select on public.app_tables for select to authenticated
  using (
    is_admin(auth.uid())
    or created_by = auth.uid()
    or exists (select 1 from public.table_access ta
               where ta.table_key = app_tables.slug and ta.user_id = auth.uid())
  );

drop policy if exists app_tables_insert on public.app_tables;
create policy app_tables_insert on public.app_tables for insert to authenticated
  with check (
    (is_admin(auth.uid()) or exists (select 1 from public.profiles p
       where p.id = auth.uid() and p.can_create_tables))
    and created_by = auth.uid()
  );

drop policy if exists app_tables_modify on public.app_tables;
create policy app_tables_modify on public.app_tables for update to authenticated
  using (is_admin(auth.uid()) or created_by = auth.uid())
  with check (is_admin(auth.uid()) or created_by = auth.uid());

drop policy if exists app_tables_delete on public.app_tables;
create policy app_tables_delete on public.app_tables for delete to authenticated
  using (is_admin(auth.uid()) or created_by = auth.uid());

-- app_fields: writable when the parent table is writable by the caller. SELECT unchanged
-- (staff + anon read for form rendering) — do NOT touch the existing select policy/grant.
drop policy if exists app_fields_insert on public.app_fields;
create policy app_fields_insert on public.app_fields for insert to authenticated
  with check (exists (select 1 from public.app_tables t where t.id = app_fields.table_id
              and (is_admin(auth.uid()) or t.created_by = auth.uid())));

drop policy if exists app_fields_update on public.app_fields;
create policy app_fields_update on public.app_fields for update to authenticated
  using (exists (select 1 from public.app_tables t where t.id = app_fields.table_id
         and (is_admin(auth.uid()) or t.created_by = auth.uid())));

drop policy if exists app_fields_delete on public.app_fields;
create policy app_fields_delete on public.app_fields for delete to authenticated
  using (exists (select 1 from public.app_tables t where t.id = app_fields.table_id
         and (is_admin(auth.uid()) or t.created_by = auth.uid())));

\echo 'VERIFY: policy set'
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename in ('app_tables','app_fields') order by 1,3;
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify, then tests as two users**

Expected policies present. Then verify empirically (authenticated REST, not psql-superuser which bypasses RLS): a non-admin with `can_create_tables=false` gets an INSERT error on app_tables; after setting the flag true for a test user, the same insert succeeds and lands `created_by` = that user; that user can update/delete their own row but not another's; an admin selects a creator's table.

### Task A3 (D): audit triggers + table_audit RLS

**Files:** Create `~/Documents/blktable-migration/rights-03-audit-triggers.sql`

- [ ] **Step 1: Write the SQL**

```sql
begin;
create or replace function public.log_table_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_action text; v_row public.app_tables;
begin
  if tg_op='INSERT' then v_action:='table_created'; v_row:=new;
  elsif tg_op='DELETE' then v_action:='table_deleted'; v_row:=old;
  else
    v_row:=new;
    if coalesce(old.is_active,true) is distinct from coalesce(new.is_active,true) then
      v_action := case when new.is_active then 'table_activated' else 'table_deactivated' end;
    else v_action:='table_edited'; end if;
  end if;
  insert into public.table_audit(actor,action,table_id,table_name,detail)
  values (auth.uid(), v_action, v_row.id, v_row.name, null);
  return null;
end $$;
drop trigger if exists trg_log_table_change on public.app_tables;
create trigger trg_log_table_change
  after insert or update or delete on public.app_tables
  for each row execute function public.log_table_change();

create or replace function public.log_access_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_action text; v_key text; v_uid uuid;
begin
  if tg_op='INSERT' then v_action:='access_granted'; v_key:=new.table_key; v_uid:=new.user_id;
  else v_action:='access_revoked'; v_key:=old.table_key; v_uid:=old.user_id; end if;
  insert into public.table_audit(actor,action,table_id,table_name,detail)
  values (auth.uid(), v_action, null, v_key, jsonb_build_object('user_id', v_uid));
  return null;
end $$;
drop trigger if exists trg_log_access_change on public.table_access;
create trigger trg_log_access_change
  after insert or delete on public.table_access
  for each row execute function public.log_access_change();

-- table_audit: admin read only; no write grants to authenticated (triggers are definer).
alter table public.table_audit enable row level security;
drop policy if exists table_audit_select on public.table_audit;
create policy table_audit_select on public.table_audit for select to authenticated
  using (is_admin(auth.uid()));
revoke insert, update, delete on public.table_audit from authenticated, anon;
grant select on public.table_audit to authenticated;

\echo 'VERIFY: triggers exist'
select tgname from pg_trigger where tgname in ('trg_log_table_change','trg_log_access_change');
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Expected: both trigger names listed. Then, as an authenticated user, create/rename/share a table and confirm one `table_audit` row per action with the correct `actor`.

### Task A4 (F): pure helpers + failing test

**Files:**
- Modify: `index.html` (add near `loadRole`, ~line 2128)
- Test: `docs/tests/table-rights.test.js`

- [ ] **Step 1: Write the failing test**

```js
const fs=require('fs'),vm=require('vm'),assert=require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API=load('index.html',['canCreateTablesFrom','mayModifyTable','auditLine']);
let n=0;const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

t('admin can create tables', ()=>assert.strictEqual(API.canCreateTablesFrom({role:'admin'}),true));
t('flagged reviewer can create', ()=>assert.strictEqual(API.canCreateTablesFrom({role:'reviewer',can_create_tables:true}),true));
t('plain reviewer cannot create', ()=>assert.strictEqual(API.canCreateTablesFrom({role:'reviewer'}),false));
t('admin may modify any table', ()=>assert.strictEqual(API.mayModifyTable({created_by:'x'},'me',true),true));
t('owner may modify own table', ()=>assert.strictEqual(API.mayModifyTable({created_by:'me'},'me',false),true));
t('non-owner non-admin may not', ()=>assert.strictEqual(API.mayModifyTable({created_by:'x'},'me',false),false));
t('auditLine formats actor + action + table', ()=>{
  const s=API.auditLine({actor_name:'Ali',action:'table_created',table_name:'Contact Us'});
  assert.ok(s.indexOf('Ali')>=0 && s.toLowerCase().indexOf('created')>=0 && s.indexOf('Contact Us')>=0);
});
console.log(n+' table-rights tests passed');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node docs/tests/table-rights.test.js`
Expected: throws `no fn canCreateTablesFrom in index.html`.

- [ ] **Step 3: Implement the helpers in index.html**

```js
  function canCreateTablesFrom(profile) {
    return !!(profile && (profile.role === "admin" || profile.can_create_tables));
  }
  function mayModifyTable(table, myUserId, isAdminFlag) {
    return !!(isAdminFlag || (table && table.created_by && table.created_by === myUserId));
  }
  function auditLine(row) {
    var verb = { table_created: "created", table_edited: "edited", table_deleted: "deleted",
      table_activated: "reactivated", table_deactivated: "archived",
      access_granted: "shared", access_revoked: "unshared" }[row.action] || row.action;
    return (row.actor_name || "Someone") + " " + verb + " " + (row.table_name || "a table");
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node docs/tests/table-rights.test.js`
Expected: `7 table-rights tests passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html docs/tests/table-rights.test.js
git commit -m "feat(rights): pure helpers for create-permission, ownership, audit line"
```

### Task A5 (F): load flag + gate the create button

**Files:** Modify `index.html` `loadRole` (2128-2149)

- [ ] **Step 1: Add the column to the profiles select**

Change (index.html:2129):

```js
    db.from("profiles").select("role, full_name, avatar_path").eq("id", userId).single()
```
to:
```js
    db.from("profiles").select("role, full_name, avatar_path, can_create_tables").eq("id", userId).single()
```

- [ ] **Step 2: Gate the create button on the new right**

Change (index.html:2139):

```js
        document.getElementById("side-create").style.display = isAdmin ? "flex" : "none";
```
to:
```js
        window.canCreate = canCreateTablesFrom(res.data);
        document.getElementById("side-create").style.display = window.canCreate ? "flex" : "none";
```

- [ ] **Step 3: Manual check**

No pure seam (DOM + live role). Verified in Task V2: a flagged non-admin sees the "New table" button; a plain reviewer does not.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(rights): show create button for can_create_tables users"
```

### Task A6 (F): per-table controls by ownership

**Files:** Modify `index.html` custom-table controls (custom-edit/custom-share ~5028-5029, active toggle 4286, config save 4305)

- [ ] **Step 1: Gate edit/share/delete on ownership**

At the custom-table view render (index.html:5028-5029), change the admin-only display:

```js
    document.getElementById("custom-edit").style.display = isAdmin ? "inline-flex" : "none";
    document.getElementById("custom-share").style.display = isAdmin ? "" : "none";
```
to:
```js
    var mineOrAdmin = mayModifyTable(t, myUserId, isAdmin);
    document.getElementById("custom-edit").style.display = mineOrAdmin ? "inline-flex" : "none";
    document.getElementById("custom-share").style.display = mineOrAdmin ? "" : "none";
```

At the active-toggle guard (index.html:4286) and config-save guard (index.html:4305), change:

```js
    if (!t || !isAdmin) return;
```
to:
```js
    if (!t || !mayModifyTable(t, myUserId, isAdmin)) return;
```

- [ ] **Step 2: Ensure custom tables carry created_by to the client**

`loadCustomTables` selects `app_tables.select("*")` (index.html:4858), so `created_by` is already loaded. No change needed — confirm the field name matches the column.

- [ ] **Step 3: Run the full test suite (no regressions)**

Run: `for f in docs/tests/*.test.js; do node "$f" || echo "FAIL $f"; done`
Expected: every file prints its pass line, no `FAIL`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(rights): owners manage their own tables; admins keep all"
```

### Task A7 (F): admin History view

**Files:** Modify `index.html` — add an admin-only sidebar entry and a render function reading `table_audit`.

- [ ] **Step 1: Add the sidebar entry (admin-only)**

In the block that reveals admin-only sidebar items (near index.html:2140, inside the `if (isAdmin)` visibility fan-out), add a History entry element. Add the element to the sidebar markup next to `#pf-users` and toggle it:

```js
        var hist = document.getElementById("side-history"); if (hist) hist.style.display = isAdmin ? "flex" : "none";
```

Add the markup once, adjacent to the existing admin nav (mirror the `side-item` pattern used by `job_applications`):

```html
        <button class="side-item" id="side-history" data-view="history" style="display:none;">History</button>
```

- [ ] **Step 2: Render the log on click**

Add a render function and wire the click (mirror how other `side-item` views open). Keep the query small (latest 200):

```js
  function renderHistory() {
    db.from("table_audit").select("actor,action,table_name,created_at").order("created_at",{ascending:false}).limit(200)
      .then(function (res) {
        var rows = (res && res.data) || [];
        if (!rows.length) return;
        var ids = rows.map(function(r){return r.actor;}).filter(Boolean);
        db.from("profiles").select("id,full_name").in("id", ids).then(function (pRes) {
          var nm = {}; ((pRes&&pRes.data)||[]).forEach(function(p){nm[p.id]=p.full_name;});
          var host = document.getElementById("history-body"); if (!host) return;
          host.innerHTML = rows.map(function (r) {
            r.actor_name = nm[r.actor] || "Someone";
            return '<div class="hist-row">' + esc(auditLine(r)) +
              ' <span class="muted">' + esc(agoText(new Date(r.created_at))) + '</span></div>';
          }).join("");
        });
      });
  }
```

Add a `#history-body` container in the main content area (mirror an existing view pane). `agoText` and `esc` already exist in the file.

- [ ] **Step 3: Manual check**

Verified in Task V2: as admin, open History and see recent create/edit/share actions with actor names; as non-admin the entry is hidden and the `table_audit` select returns nothing (RLS).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(rights): admin History view over table_audit"
```

---

## Phase V — Verification & rollout

### Task V1: Part B live verification

- [ ] Apply B1→B2→B3→B4→(re-run B3) in order; each verify SELECT matches expectations.
- [ ] On a phone, submit an existing branch form (e.g. customer-complaints) choosing a branch; as a dashboard user confirm the record's branch column is set and the sidebar branch chip/grouping shows it.
- [ ] Create a new table with a "Branch" dropdown (Task B6), submit it, confirm branch populates (exercises `config.branch_field` auto-designation).
- [ ] Open the mismatch REPORT from B3; hand the list to Yazan for manual cleanup.
- [ ] Open Part B PR to BlkTable/blktable.github.io (frontend only; SQL stays in blktable-migration).

### Task V2: Part A live verification

- [ ] Apply A1→A2→A3 in order; verify SELECTs pass.
- [ ] Set `can_create_tables=true` for one test user; confirm: button appears, they create+own+edit+delete their table, cannot touch others'; admin sees it; a plain reviewer sees no button and cannot insert.
- [ ] Confirm `table_audit` rows appear for create/edit/share with correct actor; History view renders for admin only.
- [ ] Run `for f in docs/tests/*.test.js; do node "$f" || echo FAIL $f; done` — all pass.
- [ ] Open Part A PR.

---

## Self-review notes
- Spec coverage: Feature A (flag, ownership, admin-sees-all via SELECT policy, audit via triggers, History view) → A1-A7. Feature B (canonical `branches` list_key, per-table branch_field, populate trigger, backfill, text→dropdown, option regen, franchise list_key) → B1-B6. Inspection gate → Task 0. Rollout/no-creds-over-chat → execution notes + V1/V2.
- Legacy-value handling matches the decision: dropdown going forward means no new mismatches; B3 copies existing values as-is and reports non-canonical ones for one-time cleanup.
- Helper names are consistent across tasks and tests: `branchDropdownOptions`, `detectBranchFieldId`, `canCreateTablesFrom`, `mayModifyTable`, `auditLine`.
