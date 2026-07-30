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
1. **Chain workflow upgrade — APPROACH PROPOSED, awaiting final go, then build.** Three parts (all for chain tables, i.e. tables with `config.layers`; only "Sample Request Form" id `0e7d6487-6785-4325-9ec9-e74cd194968a` has one today, 2 layers):
   a. **Auto 3-stage board (Received → Waiting for feedback → Done)** derived from the chain (NOT manual stage-moving). Store `chain_phase` on `app_submissions`, maintained by the existing `submission_log` trigger. Received (blue) = on the manager's desk to act (new→assign OR returned→close); Waiting (amber) = out with a reviewer; Done (green), rejected = red tag inside Done. Show as tabs + a colored badge per card. Replaces manual pipeline tabs on chain tables only.
   b. **Return-to-assigner sign-off:** when the LAST reviewer submits feedback, route it back to the person who assigned them (the manager) → manager sees a "Mark as done" button → only that click = Done. (Today the last completion silently ends the chain.)
   c. **Realtime auto-refresh:** enable Supabase realtime on `app_submissions` + `submission_log` (publication is currently EMPTY — verified 2026-07-29). Live-update the table list/badges, the open entry's chain, and the Home "N for you" count; add a window-focus refresh as safety net. MUST be re-enabled on the self-hosted Supabase after migration.
   Open question raised with user: whether "Received" folding both new + returned-for-signoff is fine, or they want a separate 4th "Ready to close" stage.
2. **Airtable → self-host migration — BLOCKED on Baker.** Need R2 creds (Account ID, Access Key ID, Secret, S3 endpoint, bucket `blktable-uploads`) + self-hosted Supabase anon+service keys + confirm `db.blktable.blk.jo`. Plan is written; schema-rebuild bundle + Airtable importer can be pre-built while waiting. (Add realtime-publication step to the cutover.)
3. **Rotate exposed secrets** — the Airtable PAT and the server SSH password were both pasted in chat earlier.
4. **Phase 3:** retrofit Job Applications & Casting onto the generic workflow engine (currently custom tables only) so there's one workflow system.
5. Optional: whose-turn badge on Home list rows; storage cleanup for deleted-table photos; fully migrate built-in forms to the editable engine.

## Log
- 2026-07-29: Fixed desktop form-submit bug (native page-reload submit → JS AJAX on all three public forms). Home assignment badge/filter + delegate-return chain routing. Form-manager per-table access. Created this STATUS.md (the save ritual's required file, missing until now) and committed it.
- 2026-07-29: Shipped "assigned to me" separation on custom tables — "For you" tag + gold edge on entries you're the current assignee of, an "Assigned to me (N)" toolbar toggle (filters list + stage tabs + count), and Home cards now open filtered to your entries when they have any. Pushed & live (commit 3ef482d).
- 2026-07-30: Discussed & proposed the chain workflow upgrade (auto 3-stage board + return-to-assigner sign-off + realtime) — see Next steps #1. Not built yet; awaiting final go. Verified realtime publication is empty and Sample Request Form is the only chain table (2 layers).
