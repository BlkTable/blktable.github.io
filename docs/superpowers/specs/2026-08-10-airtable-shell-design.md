# Airtable shell — design spec

Date: 2026-08-10

The earlier parity work (2026-08-09) covered the *inside* of a table: cards, the
toolbar, per-answer scoring, colour tints. This one covers the **shell** — the
frame Airtable puts around every base — plus the pieces of the grid that make it
read as a spreadsheet rather than a list.

The source was a walkthrough of the live Airtable workspace: home screen, a
base's grid view, the view switcher, the filter popover, the form builder,
Interfaces and Automations.

---

## The look

Airtable's shell is **near-black and flat**. Surfaces are separated by
low-contrast lines, not by drop shadows or gradients. Saturated colour is rare
and each colour has exactly one job.

Tokens (`:root` in `index.html`):

| token | value | what it is |
| --- | --- | --- |
| `--bg` | `#000000` | page ground |
| `--bg-2` | `#0d0d0f` | sidebar and popovers |
| `--bg-top` | `#1a1a1a` | header, base bar, sticky grid header |
| `--card` | `#141416` | cards, grid body |
| `--line` / `--line-2` | 7% / 14% white | the two divider weights |
| `--accent` | `#2d7ff9` | **the primary action on the screen** — Create, Sign in, Update |
| `--pink` | `#f82b60` | **sharing, and the active-tab underline** |

Everything that used to be a gradient or a `0 18px 40px` shadow is now a border.
`button.primary` is blue instead of silver. Radii dropped from 11–18px to 6–8px.

### Per-table colour and glyph

Airtable gives every base its own accent so you recognise it without reading the
name. Ours is **derived from the table's key** (`tableTint` / `tableGlyph`), so
it is stable for the life of the table and needs no schema change — while
`config.color` and `config.icon` override it if someone wants to pick. The mark
appears in the sidebar, on Home cards and rows, in the base bar, and in the
Ctrl-K palette, so it is the same square everywhere.

---

## The frame

**Global header** (slim, three zones):
menu + logo · one centred search box with a printed `ctrl K` hint · help,
notification bell with a count, circular avatar.

- The search box **is** the Ctrl-K palette: focusing it opens the palette, which
  searches every accessible table and (when a table is open) its saved views.
  Arrow keys and Enter work.
- The bell's badge is the number of records currently assigned to this person —
  the same number Home's "N for you" badges add up to. Clicking it goes to Home
  filtered to *Assigned to me*.
- Help opens a real shortcut and feature sheet, not a link.

**Sidebar**: Home · Starred · Shared, then the Workspace table list, then a
footer (Public forms, Help & shortcuts, Archived) and a **full-width blue Create
button pinned at the bottom**. Create offers a new table, and — when a table is
open — a new saved view of it, by type.

- *Starred* is a filter on Home rather than its own screen, which is what
  Airtable's is.
- *Shared* answers "who can see what" from `table_access`. Admins see every
  grant; a reviewer's own rows are all RLS lets them read, which is exactly the
  list of tables shared with them.

**Base bar** (per table): colour mark · table name with a `▾` menu · **Data /
Form tabs with a thin pink underline** · record count, refresh, pink **Share**.

The Form tab is where the public form's QR, link and regenerate controls now
live. That is a real improvement, not just relocation: the records view was
carrying a QR block above every table. Task tables have no public form, so their
Form tab is removed rather than left empty.

**Home**: cards/list toggle, an ordering dropdown (Recently opened · Name A→Z ·
Starred first), and — on *Recently opened* — rows grouped by period (Today, Past
7 days, Past 30 days, Older, Not opened yet). List rows carry the colour mark,
the name, a star toggle, when you last opened it, and its workspace/category.
Last-opened is per-person habit, so it lives in `localStorage`, not the database.

---

## The grid

**Toolbar** is now a flat strip: Hide fields · Filter · Group · Sort · Color ·
Row height · CSV · Assigned-to-me, with Edit table and a **search that collapses
to its icon** on the right.

**Column headers** read as `icon + field name` in normal case (they used to be
uppercase with no icon). `fieldIcon()` maps every field type — text, long text,
number, date, date-of-birth, dropdown, multi-select, yes/no, photo, phone,
email, link — and falls back on the column's name for synthetic columns
(Submitted, Branch, a score).

**Row furniture**: a row number that becomes a tick box on hover, and an expand
button that opens the record. Ticking rows shows a selection bar whose action is
**Export selected as CSV** — pulling a specific set of records out without
having to filter the whole table down to it.

**Row height**: short / medium / tall / extra tall, remembered per browser.

**End of the header row**: a `+` for admins that opens a **field-type picker**;
picking a type opens the table editor with a fresh question of that type already
waiting.

**Under the grid**: a live record count, and — for tables that have a public
form — "＋ Add a record through the form", which is how a record is actually
born here.

---

## The filter popover

Now matches Airtable's:

- empty state reads **"No filter conditions are applied"**
- **＋ Add condition** and **＋ Add condition group**
- **Copy from a view**, offering only saved views that actually carry conditions

A **condition group** is a nested set with its own And/Or, so
`score > 80 AND (branch is Abdoun OR branch is Zarqa)` is now expressible. A
group is just another entry in `conds`, so **saved views written before groups
existed load unchanged** — there is no migration and no new column.

The engine changes are recursive rather than special-cased: `pruneConds`,
`activeConds`, `filterCount` and `passesList` all walk the tree. A group whose
conditions are all blank is inert, and a group emptied by pruning (its field was
deleted from the table) is dropped with it.

Table-agnostic, like the rest of the filter: Job Applications, Casting and every
custom table get groups for free.

---

## Deliberately not built

These are in Airtable's UI but have no counterpart here, and inventing dead
surfaces for them would be worse than leaving them out:

- **Automations** and **Interfaces** — BLKTable has no automation engine and no
  interface builder. The Operate task scheduler (STATUS Next steps #1) is the
  nearest real thing and is not built yet.
- **Templates and apps / Marketplace / Import** in the sidebar footer — nothing
  to point them at. The footer carries Public forms, Help and Archived instead.
- **Launch**, **history/undo**, **"Upgrade to new forms"** — no counterpart.
  Refresh takes the history icon's place in the base bar.
- **A second table-tab pill strip** under the base bar — it would duplicate the
  sidebar, which is BLKTable's table navigation by design. The stage pipeline
  tabs already read as Airtable's pills.
- **Calendar / Gallery / Kanban / Timeline / Gantt / List / Section view types**
  — the create-view menu offers the three types the app really has (Grid, Cards,
  List), each with its own colour, which is the pattern worth copying.
- **A drag handle for reordering rows** — rows are ordered by sort, not by hand.
- **Form cover image and logo** — real work (storage + rendering on `/f/`,
  `/apply/`, `/cast/`), not styling, so it is a separate job.
- **The public form pages** (`apply/`, `cast/`, `f/`) keep their own BLK
  branding. The walkthrough described the internal workspace; applicant-facing
  pages are not the same audience.
