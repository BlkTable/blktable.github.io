# BLK Events — the Zamel flow

Design settled 2026-08-24. Sits beside `FIT-TO-BLKTABLE.md`, which describes the flow that
is already built and live. **This document does not replace that one — it describes a second,
parallel set of tables built alongside it.** `STATUS.md` holds the running state.

---

## Why this exists

Zamel manages Faisal and Waleed. Asked what he wanted from the events board, he described a
different shape from the one that was built:

> Send **one link only**. Collect a vote from the baristas. **He** assigns them to the events
> he wants. When he submits the assignment, the baristas are **messaged with the details**.

The built flow is the opposite: one link *per event*, baristas take places first-come
first-served, the database enforces capacity and promotes backups by itself. Zamel is not
asking for a tweak to that — he is inverting the intake and adding an outbound leg.

## The decision: build a parallel pair, keep the old one as a fallback

New tables named `… (Zamel)`, built next to the existing `Events` / `Event signups`. Only one
of the two flows will actually be used — Zamel sits above Faisal and Waleed, so this is a
replacement candidate, not a second stream of work.

**Why the parallel copy is safe here.** The old pair holds no real payroll history to protect.
Its 12 events and 49 signups are the deliberately-fake test seed tagged `extra->>'_test'`, and
the only two genuine signups are the orphans with a null `parent_id` that are invisible to
every view and earn nothing. So the new pair starts empty and correct, and nothing has to be
migrated, unioned or reconciled.

**The cutover, in both directions, is `is_active` on the form** — the publish gate. When
Zamel's flow is proven, the old pair's form goes `false`, its per-event links stop serving,
and the tables stay readable. If his flow does not work out, flip it back. No code either way.

**And there is only ever one payroll export.** The export is table-agnostic and driven by
`config.payroll` on the child table, so pointing it at the new roster table is configuration,
not code. That matters because payroll is the part of this project that has broken twice.

---

## The three tables

Three, not two. A barista ticking six events is *one* submit that must become *six* paid rows.
Splitting intake from roster puts that fan-out where Zamel presses Submit, inside the app —
so **the public-form submit RPC does not change at all**, which is essential, because adding
an argument to a public-form RPC breaks all 226 live forms at once.

### `Events (Zamel)` — slug `events-zamel`

One record per event, created from the dashboard (Standard 0, already live).

Fields: Event name · Date · Start time · End time · Location · Description · Places ·
Rate per person (JD).

Statuses: `draft → open → assigned → running → done`. **`open` is what puts an event on the
ballot** — that is Zamel's publish step per event, and it is the existing workflow engine
rather than a new control.

> **Trap, and it has bitten this exact table before.** A record created from the dashboard has
> `status` **null** and merely *displays* as the first stage. The ballot query must therefore
> test `status = 'open'` explicitly. Anything phrased as "not draft" puts every
> freshly-created event in front of the baristas.

### `Barista availability (Zamel)` — slug `barista-availability-zamel`

The one link. A plain top-level table, **not** parent-scoped — a submission spans many events,
so it cannot carry a single `parent_id`.

Fields: Your name (the 292-name staff dropdown, as on the existing signups form) · Phone ·
Events you can work (multi-tick, options read live from `Events (Zamel)` where status is
`open`).

One row per submit, kept forever. Identity is the name chosen from the dropdown; there is no
per-event token to hang it on.

**The re-submission rule: for any event, the candidate list shows everyone whose *latest*
submission ticks that event.** Submit three times and you appear once per event, not three
times. The earlier submissions stay in the table as history.

### `Event assignments (Zamel)` — slug `event-assignments-zamel`

Child of `Events (Zamel)` via `config.parent`. One row per assigned barista per event.

Fields: Barista name · Phone · Slot (`confirmed` / `backup`) · Assigned at ·
Message state (`queued` / `sent` / `failed`).

Written **only** by the assign screen and by a manager editing the grid — never by a public
form. Being a proper parent-scoped child is what lets `config.payroll` name the *event's* own
Date and Rate, which is what makes the payroll export work as pure configuration.

Two deliberate choices:

- **Slot stays**, even though Zamel picks the roster himself. He will want to name backups at
  a real event, and keeping the column means `only_slot: 'confirmed'` in the payroll config
  works untouched.
- **Phone is copied onto the row** at assign time rather than joined back to availability. The
  row is a record of what was actually sent; a later re-submission must not silently change
  the number a message went to.

### Config to set

`config.parent` on assignments, pointing at `events-zamel`, with `show` naming the event
fields the roster grid needs as read-only columns (Date, Rate) — Standard 1 already does this.

`config.payroll` on assignments: `{date, rate, group, only_slot: 'confirmed'}`, where `date`
and `rate` name the **event's** questions, because pay is earned by working the event.

`config.assign` on the events table (see Standard 7 below).

`config.child_only = true` on assignments, so Events is the only entry point. Note that no
migration file has ever set this key — on the existing pair it was set by hand on the server.
Set it in SQL this time.

> **Never look these field ids up by label. Read them off `config.payroll`, `config.parent`,
> `config.assign`.** That is how the existing seed and export do it. (This pair has no
> `config.capacity` — capacity is not enforced here.)

---

## Standard 6 — ballot options from a live table

A public-form multi-select whose choices are live rows of another table.

**This is not a new mechanism.** The existing `branch` question already sources its choices
from a live table — the form page reads `branches` directly as anon at boot. The ballot is a
second instance of that pattern.

**But it needs an RPC where `branch` does not**, and the reason is narrower and stronger than
"`config_public` is a generated whitelist" (true, but not the binding constraint). A branch's
`name` and `position` are *real columns*. An event's name, date and location are jsonb answers
keyed by **field ids that live in config**, so the pivot has to be resolved at call time. That
is what `ballot_options(p_slug)` does, in the same spirit as `get_parent_details` and
`form_slots`.

**And it must degrade, not fail.** A page that hard-errors when `ballot_options` is missing
cannot be deployed before the migration. The fetch catches and renders an empty ballot with a
"nothing open" line — the same rule that `p_token` and `p_device` taught: the page and the
database must each work without the other.

**What the tick stores: record ids, not names.** A `multi_select` stores the visible text;
this one stores the event's record id, with the label shown to the barista and resolved back
to a name for display in the dashboard. Storing names would make the assign screen match
people to events by printed label — the one thing this app refuses to do anywhere else — and
renaming an event would silently orphan every vote for it.

The RPC returns, for a given form slug, the `open` rows of the configured source table with
the fields worth showing a barista — event name, date, start and end time, location. It
returns rows, not counts, but only of a table whose contents are not sensitive; assignments
and submissions remain unreadable to anon exactly as today.

Table-agnostic by design: any form can gain "offer me the live rows of table X as choices".
Other tables want it — a per-branch task form, a per-vendor sample form.

## Standard 7 — assign from a source table

A manager-only **Assign** button on the `Events (Zamel)` record panel, one event at a time.
Gated the same way the Payroll button is gated, because this button is what creates paid rows.

**Rejected alternative:** a cross-event grid, baristas down the side and A/B/C across the top.
It is the nicer tool in the abstract, but it is a considerably bigger build and it makes
clashes *harder* to see rather than easier. Per-event, where the places count and the
candidate list already live, is the honest first version.

**What the screen shows.** The event's name, date, time and location, then everyone whose
latest availability ticks this event:

- name and phone
- **how many other events they are already assigned to in the same calendar month as this
  event**, so the work can be spread rather than the same four people getting everything
- **a clash warning** where they are already assigned to another event overlapping in time.
  Double-booking is the obvious real-world failure and the dates and times are in the same
  table; not warning would be a choice.
- a checkbox, and a confirmed/backup toggle
- a running counter: *6 of 8 places · 2 backup*

**What Submit does.** It diffs against the rows already on the event: new ticks insert,
cleared ticks delete, everyone unchanged is left completely alone.

> **Only newly-added people are messaged.** Getting this wrong means every small roster tweak
> re-messages the whole team, which is how a feature gets switched off in its first week. It
> is enforced structurally — see the trigger below — not by careful UI code.

**Two things Submit deliberately does not do.**

- **It does not block at capacity.** Ten ticks for eight places warns and proceeds. Zamel is
  the manager; the numbers are advisory in this flow.
- **It does not move the event's status.** Auto-flipping to `assigned` would drop the event
  off the ballot the moment a half-finished roster was saved, so nobody could vote into the
  gap still to be filled. Same reasoning as turning the auto-promote trigger off: the machine
  stays out of his roster. He moves the status himself.

**Config, so this is a standard and not a one-off:**

```
config.assign = {
  from:     'barista-availability-zamel',   // where candidates come from
  match:    '<the multi-tick field id>',    // the field naming this table's records
  name:     '<the availability name field>',// who a candidate is
  phone:    '<the availability phone field>',// the number copied onto the roster row
  roster:   'event-assignments-zamel',      // where roster rows are written
  capacity: '<field id on this table: Places>' // shown, not enforced
}
```

The field ids above are filled in at step 1, when the tables are created and their real ids are
known. `name` and `phone` are part of the contract and not an afterthought: the candidate list
cannot be built without knowing which questions hold them.

Any table can then gain "read candidates from here, write a roster into there". The
per-branch task assignment in the BLKOperations work wants this same screen.

## Standard 4 must be OFF on this pair

The existing auto-promote trigger fires on DELETE and promotes the oldest backup. On a
manager-assigned roster that is the database overruling Zamel. It is not installed here.

---

## The message

**The pipe already exists and is mostly not new code.** `blktable-migration/whatsapp/02-notify-outbox.sql`
holds the trigger, outbox and RPCs; `selfhost/functions/notify/index.ts` is the Cloud API
sender; the app half is PR #49 on `feat/reject-alert-whatsapp`. It installs with
`notify_config.enabled = false`, so go-live and rollback are that one boolean.

**Reuse its central decision: Postgres decides and queues, the edge function only sends.** An
assignment row is normally written by the assign screen but can also be edited by hand in the
grid; a row trigger sees both, whereas a send call inside the assign screen would miss the
second.

**The trigger fires on INSERT only.** The diff does not re-insert unchanged rows, so unchanged
people cannot be re-messaged. That is what makes the rule above structural. The sender writes
the outcome back to `Message state`, so Zamel sees `sent` or `failed` rather than assuming
delivery.

**One message per event, not a digest per barista.** A barista on two events gets two
messages, because they are two shifts at two times and places, and because it lets the message
ride the row trigger. A digest would need a batching window and a separate send step, and
would delay the message past the moment Zamel assigns.

**Removals are messaged too**, with their own wording — silent removal means somebody turns up
to an event they are not on. Conditional on the row having actually been sent: added and
removed in one sitting sends nothing.

### Two constraints that shape the wording

Meta's Cloud API will not send free text to somebody who has not messaged the business in the
last 24 hours. Business-initiated messages must use a **pre-approved template** with variable
slots. So the sentence is fixed in advance — only name, event, date, time and location vary —
and changing the wording later means going back to Meta for re-approval.

Each language needs its own approved template. **The first template is English**, consistent
with this project's English-only decision. An Arabic template can be added later; because
approval is per-language either way, adding it costs an approval round and not a redesign.

Phone numbers: the API wants E.164 (`9627…`); baristas will type `07…`. Normalise on the way
in and validate on the availability form, because a malformed number is a message that goes
nowhere quietly.

### Blocked on, and by whom

Not on code. On **Meta WhatsApp Cloud API credentials from Mego**, outstanding since
2026-08-19, plus template approval on the same account. Steps 1–3 below do not depend on any
of it.

**Operational note for the day it is switched on: expire the backlog, do not drain it.**
Flipping `notify_config.enabled` with a full outbox fires notices for events that already
happened.

---

## Payroll: no work

`config.payroll` on `Event assignments (Zamel)`, and the existing export runs. The range
filters on the **event's** date and the amount sums **each event's own rate**, so a future
rate change leaves old months alone.

---

## Deliberately not built

- **Reply-to-confirm.** Inbound WhatsApp webhooks, an inbound parser and confirmation state on
  every roster row. Zamel's ask reads one-way. Revisit only if he asks for confirmations.
- **A cross-event assignment grid.** See Standard 7.
- **Capacity enforcement, auto-fill, auto-promotion.** The manager decides in this flow.
- **Arabic ballot or Arabic dashboard.** English, as the rest of the project.
- **Migrating anything out of the old pair.** There is nothing there worth moving.

---

## Build order

Four steps, each shippable alone.

1. **SQL only — the three tables and their config.** No app code, and yet the record panel and
   the payroll export light up immediately because both are config-driven. Ends with Zamel
   able to create events.
2. **Standard 6 — the ballot.** Public RPC plus the multi-tick field on the form. **This is
   the step where Zamel gets the thing he asked for**, and it is useful even while assignment
   is still done by eye in the grid.
3. **Standard 7 — the assign screen.** Candidate list, clash warning, diff-on-submit.
4. **Messaging.** Merge the outbox, add the assignment trigger and the template, leave
   `enabled = false` until one message has been proven to one number.

The ballot is at step 2 on purpose: it is the shortest path to Zamel using this for real, and
his reaction to it will probably change step 3.

## Risk specific to "one link for everyone"

The old design trickled signups in through many per-event links. This one sends a single link
to ~292 people who mostly sit on a handful of shop wifi connections, and Kong throttles per
IP — a whole shop is one IP. If a manager forwards the link and a branch fills it in together,
some of them get an error instead of a submission.

**Check the throttle against the form-submit path before launch**, and read Kong's log first
if anyone reports "couldn't submit".

## Tested by hand, because no automated test reaches it

1. **Submit a roster twice after adding one person, with the sender live to one test number,
   and confirm the other seven get nothing.** This is the test that protects the feature from
   being switched off in week one.
2. Create an event from the dashboard and confirm it does **not** appear on the ballot while
   its status is null.
3. Vote, then vote again — the candidate list must show that person once, not twice.
4. Two overlapping same-day events, and check the clash warning fires.
5. A malformed phone number — the row must read `failed`, not `sent`.
6. **Payroll over the new tables with one event at a different rate.** A flat 15 on everything
   cannot distinguish "sums each event's own rate" from "counts and multiplies by 15", so that
   one odd event is the whole test.

**Test seed follows the existing pattern:** everything tagged `extra->>'_test'`, deliberately
fake names, expected totals printed by the file so the CSV can be diffed, and a cleanup file
deleting exactly the tagged rows. Fake money sitting against real staff names in a production
payroll table is the thing that must not be left behind.

## Ops facts this build has to carry

- SQL runs against **`db.blktable.blk.jo`** over ssh + `docker exec … psql`. The hosted
  Supabase project is a **different database**; reaching for the MCP is a dead end.
- Work in a **worktree**. Never switch branches in the shared clone at `C:\Users\ASUS\blktable` —
  another session may be mid-task there.
- **Stage named files. Never `git add -A`** — it sweeps another session's uncommitted work into
  the commit, and merging deploys it.
- PRs **squash-merge and the branch is deleted**. `git fetch --prune` and rebase onto a fresh
  `origin/main` or a dead branch gets resurrected.
- **Diff the container's copy of `notify` before deploying it.** The server copy has been ahead
  of the repo twice.
- **`curl` the live page before debugging a live bug.** It is often correct code on an
  unmerged branch.
- Read field ids off `config`, never look them up by label.
