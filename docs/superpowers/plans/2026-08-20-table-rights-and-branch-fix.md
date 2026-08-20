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

## PART B — Branch normalization (ship first)

### File structure (Part B)
- `~/Documents/blktable-migration/branch-01-list-key.sql` — add `branches.list_key`, seed domestic `jo`.
- `~/Documents/blktable-migration/branch-02-designate-and-trigger.sql` — set `config.branch_field` per table, create the populate trigger.
- `~/Documents/blktable-migration/branch-03-backfill.sql` — backfill existing rows + report mismatches.
- `~/Documents/blktable-migration/branch-04-type-and-options.sql` — convert free-text branch fields to dropdown, regenerate divergent option lists from canonical.
- `index.html` — add `detectBranchFieldId`, `branchDropdownOptions`; wire `config.branch_field` on table create.
- `docs/tests/branch-field.test.js` — tests for the two pure helpers.

### Task B1 (D): branches.list_key

**Files:** Create `~/Documents/blktable-migration/branch-01-list-key.sql`

- [ ] **Step 1: Write the SQL**

```sql
begin;
alter table public.branches add column if not exists list_key text not null default 'jo';
-- domestic shops stay 'jo' (the default). Franchise lists are seeded later per country.
\echo 'VERIFY: every existing branch is jo unless already tagged'
select list_key, count(*) from public.branches group by 1 order by 1;
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Run: `docker exec -i supabase-db psql -U postgres -d postgres < ~/Documents/blktable-migration/branch-01-list-key.sql`
Expected: one row `jo | <branch_rows>` matching the count from Task 0.

### Task B2 (D): designate branch field + populate trigger

**Files:** Create `~/Documents/blktable-migration/branch-02-designate-and-trigger.sql`

- [ ] **Step 1: Write the SQL**

```sql
begin;
-- Designate the branch field per table: the dropdown whose label names the branch.
-- type='dropdown' excludes the stray short_text and the pf-* link fields.
update public.app_tables t
set config = jsonb_set(coalesce(t.config,'{}'::jsonb), '{branch_field}', to_jsonb(f.id::text))
from public.app_fields f
where f.table_id = t.id
  and f.type = 'dropdown'
  and (f.label ilike '%branch%' or f.label like '%الفرع%');

-- Single choke point: every write path (submit RPC, create_record, inline edit) passes here.
create or replace function public.app_submissions_set_branch()
returns trigger
language plpgsql
as $$
declare v_field text;
begin
  select t.config->>'branch_field' into v_field
  from public.app_tables t where t.id = new.table_id;
  if v_field is not null and (new.data ? v_field) then
    new.branch := nullif(new.data->>v_field, '');
  end if;
  return new;
end $$;

drop trigger if exists trg_app_submissions_set_branch on public.app_submissions;
create trigger trg_app_submissions_set_branch
  before insert or update of data on public.app_submissions
  for each row execute function public.app_submissions_set_branch();

\echo 'VERIFY: tables now carrying a branch_field'
select slug, config->>'branch_field' as branch_field
from public.app_tables where config ? 'branch_field' order by slug;
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Expected: contact-us, customer-complaints, customer-praise, feedback-fad-fed each show a non-null `branch_field`. content-creators will NOT appear yet (still short_text — fixed in B4, which re-runs the designate step).

### Task B3 (D): backfill existing rows

**Files:** Create `~/Documents/blktable-migration/branch-03-backfill.sql`

- [ ] **Step 1: Write the SQL**

```sql
begin;
update public.app_submissions s
set branch = nullif(s.data->>(t.config->>'branch_field'), '')
from public.app_tables t
where t.id = s.table_id
  and t.config ? 'branch_field'
  and s.branch is null
  and s.data ? (t.config->>'branch_field');

\echo 'VERIFY: branch fill rate per table after backfill'
select t.slug,
       count(*) as rows,
       count(s.branch) as with_branch
from public.app_tables t
join public.app_submissions s on s.table_id=t.id
where t.config ? 'branch_field'
group by t.slug order by t.slug;

\echo 'REPORT: branch values not matching a canonical branch name (manual cleanup list)'
select t.slug, s.branch, count(*)
from public.app_tables t
join public.app_submissions s on s.table_id=t.id
where t.config ? 'branch_field' and s.branch is not null
  and not exists (select 1 from public.branches b where b.name = s.branch)
group by 1,2 order by 1,3 desc;
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Expected: `with_branch` jumps toward `rows` (allowing for conditional fields like contact-us where branch only applies to Complaint submissions). Save the REPORT list; hand it to Yazan for manual cleanup. Because branch is a dropdown going forward, this list can only contain pre-existing values and will not grow.

### Task B4 (D): free-text → dropdown + canonical option lists

**Files:** Create `~/Documents/blktable-migration/branch-04-type-and-options.sql`

- [ ] **Step 1: Write the SQL** (drop `name_ar` per Task 0 if `branches` has no such column)

```sql
begin;
-- Canonical options for the domestic list, built once.
create temporary table _canon_jo as
select jsonb_agg(jsonb_build_object('en', b.name, 'ar', coalesce(b.name_ar,'')) order by b.position) as opts
from public.branches b where b.list_key = 'jo';

-- 1) Convert free-text branch fields to dropdown with the canonical list.
update public.app_fields f
set type = 'dropdown', options = (select opts from _canon_jo)
where f.type in ('short_text','text')
  and (f.label ilike '%branch%' or f.label like '%الفرع%');

-- 2) Regenerate the divergent/duplicated existing branch dropdowns from canonical.
update public.app_fields f
set options = (select opts from _canon_jo)
where f.type = 'dropdown'
  and (f.label ilike '%branch%' or f.label like '%الفرع%');

-- 3) Re-run designation so newly-converted fields get config.branch_field.
update public.app_tables t
set config = jsonb_set(coalesce(t.config,'{}'::jsonb), '{branch_field}', to_jsonb(f.id::text))
from public.app_fields f
where f.table_id = t.id and f.type='dropdown'
  and (f.label ilike '%branch%' or f.label like '%الفرع%')
  and not (t.config ? 'branch_field');

\echo 'VERIFY: no branch field is still free-text'
select slug, f.label, f.type from public.app_tables t
join public.app_fields f on f.table_id=t.id
where (f.label ilike '%branch%' or f.label like '%الفرع%') and f.type in ('short_text','text');
\echo 'VERIFY: content-creators now has a branch_field'
select slug, config->>'branch_field' from public.app_tables where slug='content-creators';
commit;
```

- [ ] **Step 2: Yazan applies + pastes verify**

Expected: first VERIFY returns zero rows (no free-text branch fields remain); second shows content-creators with a branch_field. Then re-run **branch-03-backfill.sql** so the newly-dropdown tables backfill too.

- [ ] **Step 3: Franchise lists (only if Yazan supplies franchise branches now)**

If franchise shop names are provided, insert them with their own `list_key` (e.g. `iraq`) and set the relevant form's branch dropdown options from that list_key instead of `jo`. Otherwise defer — the `list_key` column is already in place for later.

### Task B5 (F): pure helper `branchDropdownOptions` + failing test

**Files:**
- Modify: `index.html` (add helper near `loadBranchTints`, ~line 5590)
- Test: `docs/tests/branch-field.test.js`

- [ ] **Step 1: Write the failing test**

```js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API = load('index.html', ['branchDropdownOptions','detectBranchFieldId']);
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

t('branchDropdownOptions maps rows to {en,ar} in position order', () => {
  const rows=[{name:'Abdoun',name_ar:'عبدون',position:1,list_key:'jo'},
              {name:'Khalda',name_ar:'خلدا',position:0,list_key:'jo'},
              {name:'Basra',name_ar:'',position:0,list_key:'iraq'}];
  const opts=API.branchDropdownOptions(rows,'jo');
  assert.deepStrictEqual(opts,[{en:'Khalda',ar:'خلدا'},{en:'Abdoun',ar:'عبدون'}]);
});
t('branchDropdownOptions defaults list_key to jo', () => {
  const rows=[{name:'Abdoun',name_ar:'',position:1,list_key:'jo'}];
  assert.strictEqual(API.branchDropdownOptions(rows).length,1);
});
t('detectBranchFieldId returns the dropdown branch field id', () => {
  const fields=[{id:'a',type:'short_text',label:'Name'},
                {id:'b',type:'dropdown',label:'Branch - الفرع'}];
  assert.strictEqual(API.detectBranchFieldId(fields),'b');
});
t('detectBranchFieldId ignores non-dropdown branch fields', () => {
  const fields=[{id:'a',type:'short_text',label:'Branch Name'}];
  assert.strictEqual(API.detectBranchFieldId(fields),null);
});
console.log(n+' branch-field tests passed');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node docs/tests/branch-field.test.js`
Expected: throws `no fn branchDropdownOptions in index.html`.

- [ ] **Step 3: Implement the helpers in index.html**

Add after `loadBranchTints` (keep 2-space indent to match the file so `grab`'s regex matches):

```js
  function branchDropdownOptions(rows, listKey) {
    var key = listKey || "jo";
    return (rows || []).filter(function (b) { return (b.list_key || "jo") === key; })
      .sort(function (a, b) { return (a.position || 0) - (b.position || 0); })
      .map(function (b) { return { en: b.name, ar: b.name_ar || "" }; });
  }
  function detectBranchFieldId(fields) {
    var hit = (fields || []).find(function (f) {
      return f.type === "dropdown" && /branch|الفرع/i.test(f.label || "");
    });
    return hit ? hit.id : null;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node docs/tests/branch-field.test.js`
Expected: `4 branch-field tests passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html docs/tests/branch-field.test.js
git commit -m "feat(branch): pure helpers for canonical branch options + field detection"
```

### Task B6 (F): wire config.branch_field on table create

**Files:** Modify `index.html` in `runBuilderSave` (the create branch, ~line 8410)

- [ ] **Step 1: Capture the inserted field rows so their ids are available**

The field ids do not exist until `app_fields` are inserted. Reuse the `detectBranchFieldId` helper (added in B5) against the rows returned from the insert, then patch `config.branch_field`. Change the `app_fields` insert to select its rows back.

Find (index.html create path, ~line 8412):

```js
      return db.from("app_fields").insert(toInsert).then(function (fRes) { if (fRes.error) throw fRes.error; return writePendingConds(tid, fields); })
        .then(function () { return tRes.data; });
```

Replace with (capture inserted rows, then designate the branch field via the shared helper):

```js
      return db.from("app_fields").insert(toInsert).select().then(function (fRes) { if (fRes.error) throw fRes.error;
        return writePendingConds(tid, fields).then(function () {
          var brId = detectBranchFieldId(fRes.data);
          if (!brId) return tRes.data;
          var cfg = tRes.data.config || {}; cfg.branch_field = brId;
          return db.from("app_tables").update({ config: cfg }).eq("id", tid)
            .then(function () { tRes.data.config = cfg; return tRes.data; });
        });
      });
```

This keeps the branch-field detection logic in one place (`detectBranchFieldId`) rather than duplicating the label regex inline.

- [ ] **Step 2: Manual smoke (no unit test — DB round-trip)**

This path writes to the live DB and has no pure-function seam. Verify during Phase-B live check (Task V1): create a table with a dropdown field named "Branch", submit the public form choosing a branch, confirm the record's branch column and sidebar grouping populate.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(branch): auto-designate branch_field when a new table has a branch dropdown"
```

---

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
