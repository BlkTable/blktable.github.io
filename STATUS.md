# BLKTable

## What this project is
A custom, in-house web app for BLK that borrows Airtable's *concept* (tables of records, add new tables over time) but is our own site and code — not built inside the Airtable product. Each table has two faces: a public shareable form link anyone can submit through (no login), and a private login-gated dashboard where the team reviews and manages submissions.

## Current state
Fully built, deployed, and live.
- **App:** https://blktable.blk.jo (repo `BlkTable/blktable.github.io`, GitHub Pages, custom domain). Static site, single `index.html` + public form pages under `apply/`, `cast/`, `f/`. No build step; uses `@supabase/supabase-js` v2 via CDN.
- **Backend:** cloud Supabase project `cisqemycewkqakyqmusw` (eu-central-1). Front-end uses the legacy anon JWT (the `sb_publishable_` key breaks Storage uploads).
- **Local folder:** `C:\Users\ASUS\blktable` (see note in Decisions about folder location).
- Working tree clean, everything pushed to `main`.

What works right now:
- **Home** view (default): all accessible tables as cards/list, ★ star toggle, admin Share button, "N for you" assignment badge + All/Assigned-to-me filter.
- **Table builder** (admin): create bilingual EN/AR tables + public forms, drag-reorder fields, field types (text/number/date/yesno/dropdown/phone/photo/email), workflow stages, record actions, review-chain layers, staff-only fields, delete table (math-gated).
- **Workflow engine:** status pipeline (per-stage tabs + move buttons); record actions (WhatsApp/Call/Email templates with `{field}` placeholders); dynamic multi-layer review chain with per-record assignment, delegate-and-return routing, reject-stops; form-manager access; auto-grant-view-on-assign.
- **Review:** inline autosave editing (Airtable-style, admin/editor only), reviewers read-only; View/Edit/Manager per-table access levels; Users panel + per-table Share modal.
- **Built-in tables:** Job Applications (`/apply/`) and BLK Casting (`/cast/`) — hand-coded with their own hiring workflow (New/Approved/Rejected, WhatsApp interview invite). Admins can add extra questions and hide/relabel built-in questions.
- **Custom tables live:** Sample Submissions (vendor-facing product-sample intake + staff evaluation pipeline).
- QR codes per form (regenerate = rotate link/token), submission fingerprint (IP + device captured server-side).

## Decisions made
- **Own code, not Airtable:** user explicitly rejected building inside Airtable; we only mimic the idea.
- **Stack:** GitHub Pages (static) + Supabase, same as the Qahwa site. No framework, no build step — keep it simple.
- **Roles:** `admin` (full) and `reviewer` (scoped). Access is per-table via `table_access` with `can_edit` and `can_manage` capability flags. No public signup.
- **Anon key gotcha:** must use the legacy anon JWT everywhere; the publishable key format is rejected by Supabase Storage on uploads.
- **Backend future:** decided to leave Supabase Cloud and self-host Supabase (Docker) on Baker's server, with files on Cloudflare R2. Server is up (`db.blktable.blk.jo`); cutover blocked on R2 credentials.
- **Folder location:** repo currently lives at `C:\Users\ASUS\blktable`, NOT under `C:\Users\ASUS\Projects\` as the global rule prefers. Left in place for now to avoid disrupting git/Pages; move is a separate decision.
- Full architecture and the blow-by-blow history live in auto-memory (`project_blktable_app.md`) — richer than this file by design.

## Next steps
1. **Airtable → self-host migration — BLOCKED on Baker.** Need R2 creds (Account ID, Access Key ID, Secret, S3 endpoint, bucket `blktable-uploads`) + self-hosted Supabase anon+service keys + confirm `db.blktable.blk.jo`. Plan is written; schema-rebuild bundle + Airtable importer can be pre-built while waiting.
2. **Rotate exposed secrets** — the Airtable PAT and the server SSH password were both pasted in chat earlier.
3. **Phase 3:** retrofit Job Applications & Casting onto the generic workflow engine (currently custom tables only) so there's one workflow system.
4. Optional: whose-turn badge on Home list rows; storage cleanup for deleted-table photos; fully migrate built-in forms to the editable engine.

## Log
- 2026-07-29: Fixed desktop form-submit bug (native page-reload submit → JS AJAX on all three public forms). Home assignment badge/filter + delegate-return chain routing. Form-manager per-table access. Created this STATUS.md (the save ritual's required file, missing until now) and committed it.
