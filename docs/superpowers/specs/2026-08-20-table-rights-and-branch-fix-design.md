# BLKTable: create-table rights + branch normalization

Date: 2026-08-20
Repo: BlkTable/blktable.github.io
DB: self-hosted Supabase/Postgres, db.blktable.blk.jo (2.28.1.141), container `supabase-db`

Two independent features requested together, sharing one inspection + rollout track.

- Feature A: let specific non-admin users create tables, own the tables they create, with an admin-visible audit log of structural and access changes.
- Feature B: fix the branch field so submissions land in the structured `branch` column across all tables, standardize branch dropdowns to a canonical list, and support separate lists for franchises.

---

## Background (verified in code)

- Table creation is a direct client-side insert into `app_tables` then `app_fields`
  (index.html:8410), gated only by the UI check `isAdmin` (from `profiles.role`,
  index.html:2138). The real gate is RLS on those tables.
- Per-table sharing uses `table_access(table_key, user_id, can_edit, can_manage, scope)`
  (index.html:2159, 2510).
- Public forms key every answer by field UUID: `data[c.f.id]` (f/index.html:682). The
  answer blob lands in `app_submissions.data`.
- The generic submit path `submit_public_form(p_slug, p_data)` inserts only
  `{table_id, data}` and never sets `app_submissions.branch`
  (blktable-migration/submit-form-rpcs.sql). Only the two hand-coded tables
  (casting/job_applications) map branch explicitly.
- The app groups/filters custom tables by the `app_submissions.branch` column
  (index.html:5084-5085). That column is the empty "branch line".
- A canonical `branches` table already exists (`name, position`), read by
  `loadBranchTints()` for color tints (index.html:5572).
- Branch fields are inconsistent across tables (verified from forms-dump):
  - content-creators: `short_text` "Branch Name"
  - customer-complaints: `dropdown` "Branch - الفرع" (42 opts, duplicates) + stray
    `short_text` "اسم الفرع؟"
  - customer-praise (23 opts), feedback-fad-fed (21 opts): `dropdown`, divergent lists
  - contact-us: `dropdown`, shown only when Topic = Complaint (conditional)
  - pf-chai-karak / pf-karkadeh / pf-salted-honey-latte: `link` type (not a branch column
    candidate; excluded)

---

## Feature A: create-table rights, ownership, audit log

### Data model

- `profiles.can_create_tables boolean not null default false` — granted to specific people.
- `app_tables.created_by uuid references profiles(id)`, default `auth.uid()`; backfill
  existing rows to an admin id.
- `table_audit`:
  - `id bigint generated always as identity primary key`
  - `actor uuid` (auth.uid at write time), `action text`, `table_id uuid`,
    `table_name text`, `detail jsonb`, `created_at timestamptz default now()`
  - actions: `table_created`, `table_edited`, `table_deleted`, `table_activated`,
    `table_deactivated`, `access_granted`, `access_revoked`.

### RLS (the real enforcement — creation is a direct insert, not an RPC)

Assumes `is_admin(uid)` helper exists (per audit memory). Confirm exact current policies
in the inspection step before writing final SQL.

- `app_tables`
  - SELECT: `is_admin(auth.uid())` sees all rows (incl. others' and inactive) — required:
    every created form is always visible to admins. Non-admins: `created_by = auth.uid()`
    OR a matching `table_access` row (current shared-access behavior).
  - INSERT: `is_admin(auth.uid())` OR `profiles.can_create_tables`; `with check
    (created_by = auth.uid())` so a creator can only create as themselves.
  - UPDATE/DELETE: `is_admin(auth.uid())` OR `created_by = auth.uid()`.
- `app_fields`
  - INSERT/UPDATE/DELETE: allowed when the parent `app_tables` row is one the caller may
    modify (admin or owner), via an EXISTS subquery on `created_by`.
  - SELECT: unchanged from today (staff read; anon keeps SELECT for form rendering).
- `table_audit`
  - SELECT: admin only. No INSERT/UPDATE/DELETE grant to authenticated (written by
    triggers running as definer). Immutable in practice.

### Audit via DB triggers (not client writes)

Client-written logs can be spoofed; triggers capture `auth.uid()` and can't be bypassed.

- AFTER INSERT/UPDATE/DELETE on `app_tables` → write `table_created` /
  `table_edited` / `table_activated` / `table_deactivated` / `table_deleted`.
- AFTER INSERT/DELETE on `table_access` → `access_granted` / `access_revoked`.
- `actor = auth.uid()`; `actor` display name resolved at read time by joining `profiles`.
- Scope: structural + access only (record-level decisions already live in
  `submission_log`).

### Client (index.html)

- In `loadRole`, also read `can_create_tables`; define
  `canCreateTables = isAdmin || can_create_tables`.
- Show `#side-create` when `canCreateTables` (was `isAdmin`, index.html:2139).
- Per-table gear / edit / delete / share visible when `isAdmin || table.created_by ===
  myUserId`. Admins keep all; user-management panel (`#pf-users`) stays admin-only.
- A creator may open the Share panel for a table they own (grant `table_access` to others).
- New admin-only "History" view listing `table_audit` (actor, action, table, when).
- Owners' non-owned tables and creators' UI unchanged otherwise.

### Tests (docs/tests)

- Non-admin with `can_create_tables=false` cannot see the create button and an insert is
  rejected by RLS.
- Non-admin with flag can create; `created_by` is pinned; can edit/delete own but not
  others'.
- Admin sees all tables including a creator's.
- Trigger writes one `table_created` / `access_granted` row with the correct actor.

---

## Feature B: branch normalization + column population

### Canonical branch lists

- Extend `branches` with `list_key text not null default 'jo'` (domestic = `jo`;
  franchises get their own, e.g. `iraq`, `lebanon`). Populate franchise rows as needed.
- Dropdown `options` are materialized as `[{en, ar}]` from the chosen list so the public
  form renderer and tint logic stay unchanged.
- `app_tables.config.branch_list` optionally records which list a table's branch field
  draws from (default `jo`).

### Designate the branch field per table

- `app_tables.config.branch_field = <field_uuid>` — the field whose answer is the branch.
- Set for every table with a branch field; auto-detect by label match `branch` / `الفرع`
  and type dropdown. Excludes the `link`-type pf-* fields.

### Populate `app_submissions.branch` (single choke point)

- BEFORE INSERT OR UPDATE trigger `app_submissions_set_branch`:
  - if the row's table has `config.branch_field`, set
    `NEW.branch = NEW.data->>'<branch_field>'`.
  - covers every write path (public submit RPC, dashboard `create_record`, inline edits).
- One-time backfill: `update app_submissions set branch = data->>'<branch_field>'`
  per affected table where `branch is null`.

### Field-type fix (text → dropdown)

- Convert free-text branch fields (content-creators "Branch Name", the stray complaints
  "اسم الفرع؟") to `dropdown` with options from the canonical list.
- Regenerate the divergent/duplicated dropdown option lists (complaints/praise/feedback)
  from the canonical list so all forms share one set.
- Legacy values: because branch is now a dropdown, new and existing dropdown answers are
  canonical and copy cleanly. Pre-conversion free-text answers are copied as-is by the
  backfill; produce a list of any values not matching a canonical branch name for manual
  cleanup (one-time, does not recur once the field is a dropdown).

### Tests (docs/tests)

- Submitting a form with a branch answer lands the value in the `branch` column (trigger).
- Editing a record's branch answer updates the column.
- Backfill sets branch for existing rows; a form with no branch field leaves it null.
- Contact-us: branch populated only for the Complaint topic (conditional field), null
  otherwise — expected.

---

## Shared: inspection + rollout

### Inspection first (read-only; Yazan runs it, no prod creds over chat)

A read-only SQL to capture, before writing final migrations:
- current policies on `app_tables` / `app_fields` (cmd, roles, qual, with_check) and the
  `is_admin` helper definition;
- `branches` column set;
- per-table branch field id (from config or detected) and current branch-column fill rate;
- distinct legacy free-text branch values that won't match the canonical list.

### Rollout

- DB changes as transactional `begin; … commit;` SQL files in
  `~/Documents/blktable-migration`, each with a verify SELECT, applied on the self-hosted
  DB via `docker exec -i supabase-db psql -U postgres -d postgres < file.sql` (NOT the
  hosted decoy project). SQL files are gitignored in the app repo.
- Frontend changes in one PR to BlkTable/blktable.github.io with tests under `docs/tests`.
- Order: inspection → Feature B DB (branches list_key, config.branch_field, trigger,
  backfill, type/option fixes) → Feature B frontend (if any) → Feature A DB (columns, RLS,
  audit triggers) → Feature A frontend → phone/live verification.

### Out of scope

- pf-* `link`-type location fields (not branch columns).
- Migrating record-level history into `table_audit` (kept in `submission_log`).
- Any change to the hosted decoy Supabase project.
