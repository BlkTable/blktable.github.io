# BLKTable Airtable-parity Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw the BLKTable dashboard cards, toolbar, per-table views and record-detail scoring so they read like the Airtable views they replaced, and promote the hidden country picker on the Job Application form into an explicit Country question.

**Architecture:** Single static `index.html` (~4,730 lines, no build, Supabase JS via CDN) plus the public form `apply/index.html`. All work is in the render layer and CSS; the scoring engine, RLS, migration and R2 are untouched. Per-table differences are driven by existing `app_tables.config` keys (`card_fields`, `detail_fields`, `score_field`) and additive `app_fields.options` keys, so most tuning is data, not code.

**Tech Stack:** Vanilla ES5-style JS (the file uses `var`/`function`, no framework), CSS custom properties, Supabase JS v2, GitHub Pages.

**Reconciliation with the approved spec:** The spec said "remove assignment chrome from cards." The user then clarified *"no need for the assigning at all… we're changing it anyway."* We interpret that as **do not add or redesign assignment UI**, and to avoid breaking a feature they still use in the interim we **carry the existing `mine-tag` / `is-mine` indicators over unchanged** into the redesigned card rather than deleting them. No new corner badge is added. Flag to the user if they'd rather strip them now.

**Prerequisite — database access:** Tasks 5, 6b and 7 read/write `app_tables.config` and `app_fields.options` on the self-hosted Supabase (`db.blktable.blk.jo`). Those need admin DB or service credentials (Baker/Yazan). The rendering tasks (1–4, 6a) need only an admin **login** to view real data locally. Confirm access before starting Task 5.

---

## File Structure

- `index.html` — CSS block (`<style>`, lines ~16–700) and the app script (lines ~1200–4730). Touched functions:
  - `renderCustom()` (~2876) — toolbar wiring, card/row render.
  - `renderCustomGrid()` (~3245) — grid pills (already close; light touch).
  - `openCustomDetail()` (~3548) — per-answer scoring section.
  - `renderApps()` (~1863) — Job Application cards (country pill already present).
  - Toolbar markup (~878–899) — Airtable-style bar, new Sort + Color buttons.
- `apply/index.html` — form markup (~140–190) and picker script (~348–410): explicit Country question.
- No new files. No migration files (config/options changes are additive rows, applied via SQL snippets included in the tasks).

## Local run + verification method

No test framework exists. Verify by observation against the Airtable screenshots plus a scoring-parity spot check.

- Serve: `cd ~/Documents/blktable && python3 -m http.server 8000`, open `http://localhost:8000`, sign in with an admin login. (The static site talks to the live self-hosted Supabase, so real data appears.)
- Screenshot comparison uses the playwright-skill or a manual browser.
- Commit after each task. Ship as one PR to `main` (Pages auto-deploys `main`).

---

### Task 1: Redesign CSS (cards, toolbar, score chip, per-answer scoring, thread)

**Files:**
- Modify: `index.html` — inside the `<style>` block, after the existing `.score-pill` rules (search for the marker `.score-pill.big`, ~line 478) add a new block.

- [ ] **Step 1: Add the redesign CSS block**

Search for the line containing `.score-pill.big {` and insert the following immediately after the closing `}` of the `.ja-card .name .score-pill.big` rule (search marker `.ja-row > .score-pill.big`):

```css
/* ---- Airtable-parity redesign ---- */
/* labelled fields on a card */
.rec-fld { margin-bottom: 9px; }
.rec-fld .k { color: var(--muted); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
.rec-fld .v { font-size: 0.86rem; line-height: 1.35; }
.rec-fld .v.rtl { direction: rtl; text-align: right; }
.rec-fld-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 9px; }
.rec-fld-row .rec-fld { margin: 0; }
.clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.clamp3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
/* score chip carrying raw + percent */
.scorechip { display: inline-flex; align-items: baseline; gap: 6px; padding: 5px 11px; border-radius: 10px; font-weight: 800; }
.scorechip .pct { font-size: 1rem; } .scorechip .raw { font-size: 0.72rem; font-weight: 600; opacity: 0.85; }
.scorechip.good { background: #1c5b34; color: #dcffe9; } .scorechip.ok { background: #2f5b7a; color: #e2f2ff; }
.scorechip.warn { background: #7a5b16; color: #fff6e0; } .scorechip.bad { background: #8c2f2f; color: #ffecec; }
.card-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--line); }
.card-foot .when { color: var(--muted); font-size: 0.72rem; }
/* WhatsApp thread preview on complaint cards */
.thread { background: #0f1418; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 5px; margin-bottom: 9px; max-height: 132px; overflow: hidden; position: relative; }
.thread:after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 40px; background: linear-gradient(transparent, #0f1418); }
.bub { max-width: 82%; padding: 5px 9px; border-radius: 11px; font-size: 0.72rem; line-height: 1.3; direction: rtl; }
.bub.them { align-self: flex-start; background: #23282f; color: var(--silver); }
.bub.us { align-self: flex-end; background: #123047; color: #cfe9ff; }
/* per-answer scoring in the record */
.qsec-head { display: flex; align-items: baseline; justify-content: space-between; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700; margin: 18px 0 8px; }
.qsec-head .sub { font-weight: 800; color: var(--silver); }
.q-scored { display: flex; align-items: flex-start; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.q-scored .ql { flex: 1; min-width: 0; }
.q-scored .qq { font-size: 0.8rem; color: var(--silver-lo); margin-bottom: 4px; }
.q-scored .qp { flex: 0 0 auto; align-self: center; font-weight: 800; font-size: 0.8rem; border-radius: 8px; padding: 3px 9px; min-width: 46px; text-align: center; }
.qp.plus { background: #1c5b34; color: #dcffe9; } .qp.zero { background: #2a1414; color: #ff9d9d; } .qp.na { background: #1a1d22; color: var(--muted); }
.score-side { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin: 4px 0 16px; }
.score-side .bignum { font-size: 2.2rem; font-weight: 800; line-height: 1; }
.score-side .bignum small { font-size: 0.95rem; color: var(--muted); font-weight: 600; }
.score-bar { height: 10px; border-radius: 999px; background: #20242b; overflow: hidden; margin: 12px 0 6px; }
.score-bar > i { display: block; height: 100%; border-radius: 999px; }
.score-breakdown { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.score-breakdown .brow { display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; }
.score-breakdown .brow .bl { color: var(--muted); } .score-breakdown .brow .bv { font-weight: 700; font-variant-numeric: tabular-nums; }
/* Airtable-style toolbar buttons */
.tb-btn { border: 1px solid transparent; background: none; color: var(--muted); font-size: 0.82rem; font-weight: 600; padding: 6px 10px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.tb-btn:hover { color: var(--text); background: rgba(255,255,255,0.04); }
.tb-btn.active { color: #ffe9a6; background: rgba(234,179,8,0.12); }
```

Note: `--silver-lo` is referenced above and already declared in `:root` — confirm; if absent, add `--silver-lo: #b4b9c0;` to `:root`.

- [ ] **Step 2: Verify CSS parses**

Run: `cd ~/Documents/blktable && python3 -c "import re,sys; s=open('index.html').read(); print('braces balanced' if s.count('{')==s.count('}') else 'MISMATCH %d/%d'%(s.count('{'),s.count('}')))"`
Expected: `braces balanced` (note: JS braces also count, so compare against the pre-edit count — record it first with the same command on `git stash`; a clean edit changes both counts by the same amount).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "CSS: Airtable-parity classes for cards, toolbar, scoring, thread"
```

---

### Task 2: Reskin the toolbar into an Airtable-style bar + add Sort and Color

**Files:**
- Modify: `index.html` toolbar markup (~878–899) and add wiring in `renderCustom()` (~2876) / near the existing `wireToggle("custom-viewtoggle", …)` (~4589).

- [ ] **Step 1: Add Sort and Color controls to the toolbar markup**

In the `<div class="toolbar">` block (search marker `id="custom-viewtoggle"`), after the `group-wrap` div and before `id="custom-export"`, insert:

```html
            <div class="cols-wrap" id="sort-wrap" style="display:none;">
              <button class="tb-btn" id="sort-btn" type="button">↕ <span id="sort-lab">Sort</span></button>
              <div class="cols-panel" id="sort-panel"></div>
            </div>
            <div class="cols-wrap" id="color-wrap" style="display:none;">
              <button class="tb-btn" id="color-btn" type="button">◧ <span id="color-lab">Color</span></button>
              <div class="cols-panel" id="color-panel"></div>
            </div>
```

- [ ] **Step 2: Build the Sort panel render**

In `renderCustom()`, where the grid panels are prepared (search marker `renderGroupPanel(currentCustom.table, fields);` inside the `if (customView === "table")` block), the sort panel should be available for **all** views (Airtable sorts galleries too). Add a `renderSortPanel(t, fields)` function next to `renderGroupPanel` (~3224):

```javascript
  function sortableCols(t, fields) {
    return fields.filter(function (f) { return !f.internal && f.type !== "photo"; })
      .concat([{ id: "__created", label: "Submitted" }, { id: "__branch", label: "Branch" }]);
  }
  function renderSortPanel(t, fields) {
    var panel = document.getElementById("sort-panel");
    var cols = sortableCols(t, fields);
    var rules = customSort.length ? customSort : [{ id: "", dir: -1 }];
    panel.innerHTML = '<div class="cols-head"><b>Sort by</b>' +
      '<button class="linkbtn" id="sort-clear" type="button">Clear</button></div>' +
      rules.map(function (r, i) {
        return '<div class="sort-row" data-i="' + i + '"><select class="sort-f">' +
          '<option value="">Field…</option>' +
          cols.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === r.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') +
          '</select><select class="sort-d"><option value="1"' + (r.dir === 1 ? ' selected' : '') + '>A→Z / 1→9</option>' +
          '<option value="-1"' + (r.dir === -1 ? ' selected' : '') + '>Z→A / 9→1</option></select></div>';
      }).join('') +
      '<button class="linkbtn" id="sort-add" type="button">+ Add another sort</button>';
    panel.querySelectorAll('.sort-f, .sort-d').forEach(function (el) {
      el.addEventListener('change', function () {
        customSort = [].slice.call(panel.querySelectorAll('.sort-row')).map(function (row) {
          return { id: row.querySelector('.sort-f').value, dir: parseInt(row.querySelector('.sort-d').value, 10) };
        }).filter(function (r) { return r.id; });
        updateSortLabel(); renderCustom();
      });
    });
    var add = document.getElementById('sort-add');
    if (add) add.addEventListener('click', function () { customSort.push({ id: '', dir: 1 }); renderSortPanel(t, fields); });
    var clr = document.getElementById('sort-clear');
    if (clr) clr.addEventListener('click', function () { customSort = []; updateSortLabel(); renderSortPanel(t, fields); renderCustom(); });
  }
  function updateSortLabel() {
    var lab = document.getElementById('sort-lab'), btn = document.getElementById('sort-btn');
    if (!lab) return;
    if (customSort.length) { lab.textContent = 'Sorted by ' + customSort.length + ' field' + (customSort.length > 1 ? 's' : ''); btn.classList.add('active'); }
    else { lab.textContent = 'Sort'; btn.classList.remove('active'); }
  }
```

`customSort`, `esc`, `renderCustom`, `compareRows` already exist. Sorting is applied to card/list rows too: in `renderCustom()`, before rendering `rows`, add `if (customSort.length) rows = rows.slice().sort(function (a, b) { return compareRows(a, b, customCols(currentCustom.table, fields).concat([{id:'__created',label:'Submitted'},{id:'__branch',label:'Branch'}])); });` (search marker `var rows = base.filter(function (s) {` and add immediately after that line).

- [ ] **Step 3: Build the Color panel render**

Add next to `renderSortPanel`:

```javascript
  var customColorField = null; // field id whose choices tint the card
  function colorableCols(fields) { return fields.filter(function (f) { return isChoiceField(f) || f.type === 'yesno'; }); }
  function renderColorPanel(t, fields) {
    var panel = document.getElementById('color-panel');
    var cols = colorableCols(fields);
    panel.innerHTML = '<div class="cols-head"><b>Color by</b></div>' +
      '<label><input type="radio" name="colf" value=""' + (customColorField ? '' : ' checked') + '> None</label>' +
      cols.map(function (f) { return '<label><input type="radio" name="colf" value="' + f.id + '"' + (customColorField === f.id ? ' checked' : '') + '> ' + esc(f.label) + '</label>'; }).join('');
    panel.querySelectorAll('input[name="colf"]').forEach(function (r) {
      r.addEventListener('change', function () {
        customColorField = r.value || null;
        var lab = document.getElementById('color-lab'), btn = document.getElementById('color-btn');
        if (customColorField) { lab.textContent = 'Color'; btn.classList.add('active'); } else { lab.textContent = 'Color'; btn.classList.remove('active'); }
        renderCustom();
      });
    });
  }
```

Card tint is applied in Task 3 using `customColorField`. `isChoiceField` already exists.

- [ ] **Step 4: Show and wire the new panels for every view**

In `renderCustom()`, find the block that toggles `cols-wrap`/`group-wrap` visibility by view (search marker `if (colsWrap) colsWrap.style.display = customView === "table"`). After it, add:

```javascript
    var sortWrap = document.getElementById("sort-wrap");
    if (sortWrap) sortWrap.style.display = "";        // sort is available in all views
    var colorWrap = document.getElementById("color-wrap");
    if (colorWrap) colorWrap.style.display = customView === "table" ? "none" : ""; // color tints cards/rows
    renderSortPanel(currentCustom.table, fields);
    if (customView !== "table") renderColorPanel(currentCustom.table, fields);
    updateSortLabel();
```

Add open/close toggles near the existing `cols-btn`/`group-btn` toggles (search marker `id="group-btn"` wiring, or the `wirePanelToggle` helper if one exists; otherwise add DOM listeners in `renderCustom` that toggle `.open` on `#sort-panel` / `#color-panel`, mirroring how `#cols-panel` opens). If the codebase already has a generic `document.addEventListener('click', …)` that closes `.cols-panel.open` on outside click, the new panels inherit it because they use the `cols-panel` class.

- [ ] **Step 5: Verify in browser**

Serve locally, open a custom table (e.g. Mystery Shopper). Expected: a Sort button showing "Sorted by 1 field" after choosing a field, card order changes; a Color button tints cards by the chosen select. Compare the toolbar row to the Airtable screenshot (`Filter | Sort | Group | Color`).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Toolbar: Airtable-style bar with Sort and Color panels for all views"
```

---

### Task 3: Redesign the gallery/list card render

**Files:**
- Modify: `index.html` `renderCustom()` card/row build (~2956–2986).

- [ ] **Step 1: Replace the card/row HTML build**

Locate the `rows.forEach(function (s) { … })` block that builds `.ja-card` / `.ja-row` (search marker `var title = summary.length ? customCellText(summary[0], d)`). Replace the body of the loop with the labelled-field render below. Keep the existing `moveHtml`, `actions`, `mine`/`tag` computations and the `wireRecMenu` / `data-move` wiring exactly as they are — only the element HTML changes.

```javascript
    rows.forEach(function (s) {
      var d = s.data || {};
      // labelled fields: skip the score field (shown as a chip) and photo fields (cover)
      var fldsHtml = summary.filter(function (f) { return !scoreField || f.id !== scoreField.id; })
        .map(function (f) {
          var v = cellValueHtml(f, d, s);
          var isLong = f.type === "long_text";
          return '<div class="rec-fld"><div class="k">' + esc(f.label) + '</div>' +
            '<div class="v' + (isLong ? ' clamp3' : '') + (hasArabic(customCellText(f, d)) ? ' rtl' : '') + '">' + v + '</div></div>';
        }).join("");
      var scoreHtml = "";
      if (scoreField) {
        var sn = scoreFraction(scoreField, customCellText(scoreField, d));
        if (sn !== null) scoreHtml = scoreChipHtml(sn, scoreRawText(currentCustom.table, s));
      }
      var initial = esc(String(summary.length ? customCellText(summary[0], d) : "?").trim().charAt(0).toUpperCase() || "?");
      var moveHtml = "";
      if (stages.length && mayEdit) {
        var cur = subStage(s, stages);
        moveHtml = '<div class="move-btns">' + stages.filter(function (st) { return st.key !== cur; }).map(function (st) {
          return '<button type="button" class="sc-' + esc(st.color || "gray") + '" data-move="' + esc(st.key) + '">→ ' + esc(st.label) + "</button>";
        }).join("") + "</div>";
      }
      var actions = '<div class="card-actions">' + moveHtml + recMenuHtml(tableActions, mayManageTbl) + "</div>";
      var mine = isMine(s);
      var tag = mine ? '<span class="mine-tag" title="This entry is waiting on you">For you</span>' : "";
      var tint = cardTint(d);       // Task 2 Color
      var el = document.createElement("div");
      if (kcards) {
        el.className = "ja-card is-rec" + (mine ? " is-mine" : "");
        if (tint) el.style.borderTopColor = tint, el.style.borderTopWidth = "3px";
        el.innerHTML =
          (photoField && d[photoField.id] ? '<div class="photo"></div>' : '<div class="photo">' + initial + '</div>') +
          '<div class="body" style="text-align:left">' +
            '<div class="name">' + esc(summary.length ? customCellText(summary[0], d) : "—") + tag + '</div>' +
            fldsHtml +
            '<div class="card-foot">' + (scoreHtml || '<span></span>') + '<span class="when">' + fmtDate(s.created_at) + '</span></div>' +
            actions +
          '</div>';
      } else {
        el.className = "ja-row is-rec" + (mine ? " is-mine" : "");
        if (tint) el.style.boxShadow = "inset 3px 0 0 " + tint;
        el.innerHTML = '<div class="ja-thumb">' + initial + '</div>' +
          '<div class="info"><div class="name">' + esc(summary.length ? customCellText(summary[0], d) : "—") + tag + '</div>' +
          '<div class="sub">' + summary.slice(1).filter(function (f) { return !scoreField || f.id !== scoreField.id; }).map(function (f) { return esc(customCellText(f, d)); }).join(" · ") + '</div></div>' +
          scoreHtml + '<div class="row-actions">' + actions + '</div>';
      }
      el.addEventListener("click", function () { openCustomDetail(s, fields); });
      wireRecMenu(el, function () { openCustomDetail(s, fields); }, function () { deleteCustomSub(s, fields); }, function (a) { doRecordAction(a, s, fields); }, tableActions);
      [].slice.call(el.querySelectorAll("[data-move]")).forEach(function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); setSubStatus(s, b.getAttribute("data-move")); }); });
      kcont.appendChild(el);
      if (photoField && d[photoField.id]) setThumb(el.querySelector(".photo, .ja-thumb"), { photo_path: d[photoField.id] });
    });
```

- [ ] **Step 2: Add the score-chip and tint helpers**

Next to `scorePillHtml` (~3015) add:

```javascript
  function scoreChipHtml(n, raw) {
    return '<span class="scorechip ' + scoreTone(n) + '"><span class="pct">' + Math.round(n * 100) + '%</span>' +
      (raw ? '<span class="raw">' + esc(raw) + '</span>' : '') + '</span>';
  }
  // raw "63/68" from config.score_raw_field (points) + config.score_max (denominator), if set
  function scoreRawText(t, s) {
    var cfg = t.config || {};
    if (!cfg.score_raw_field) return "";
    var pts = (s.data || {})[cfg.score_raw_field];
    if (pts == null || pts === "") return "";
    return cfg.score_max ? (pts + "/" + cfg.score_max) : String(pts);
  }
  function cardTint(d) {
    if (!customColorField) return "";
    var val = d[customColorField];
    return val ? choiceColor(String(val).split(/\s*,\s*/)[0]) : "";
  }
  // map a choice string to one of the pill accent colors, stable by hash
  var TINTS = ["#4aa3df", "#2ecc71", "#e0a53a", "#a06be0", "#3aa3a3", "#e05a5a"];
  function choiceColor(v) {
    var h = 0, str = String(v);
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
    return TINTS[h % TINTS.length];
  }
```

`scoreTone` and `scoreFraction` already exist.

- [ ] **Step 3: Verify in browser**

Open QC and Mystery Shopper. Expected: each card shows labelled fields (label above value), coloured pills for selects/yes-no, a score chip with % (and raw `63/68` once `score_raw_field`/`score_max` are set in Task 5), the submitted date in the footer, and Arabic values right-aligned and trimmed. Compare to the QC and Mystery Shopper screenshots.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Cards: labelled-field layout, score chip with raw+percent, color tint"
```

---

### Task 4: Per-answer scoring in the record detail

**Files:**
- Modify: `index.html` `openCustomDetail()` (~3548) — both the read-only branch (~3644) and the editor branch (~3662).

- [ ] **Step 1: Add the scored-section builder**

Before `openCustomDetail` add a helper that, given the fields and data, groups scored questions by section and returns the section HTML plus totals. It relies on the question→scorer map resolved in Step 2.

```javascript
  // Returns { html, earned, possible, sections:[{name,earned,possible}] } or null when the
  // table is not scored. Renders each scored question with the points that answer earned.
  function scoredDetail(table, fields, d) {
    var cfg = table.config || {};
    if (!cfg.score_field) return null;
    var map = questionScorerMap(table, fields);      // questionFieldId -> scorerField
    var qIds = Object.keys(map);
    if (!qIds.length) return null;
    var bySection = {}; var order = [];
    fields.forEach(function (qf) {
      if (!map[qf.id]) return;
      var sec = (qf.options && qf.options.score_section) || "Score";
      if (!bySection[sec]) { bySection[sec] = []; order.push(sec); }
      bySection[sec].push(qf);
    });
    var earned = 0, possible = 0, sections = [], html = "";
    order.forEach(function (sec) {
      var se = 0, sp = 0, rows = "";
      bySection[sec].forEach(function (qf) {
        var sf = map[qf.id];
        var ptsRaw = (d[sf.id] == null || d[sf.id] === "") ? null : parseFloat(d[sf.id]);
        var answered = d[qf.id] != null && d[qf.id] !== "";
        var na = (ptsRaw == null);
        var pts = na ? 0 : ptsRaw;
        var maxP = (sf.options && sf.options.score_weight) || 1;
        if (!na) { se += pts; sp += maxP; earned += pts; possible += maxP; }
        var cls = na ? "na" : (pts >= maxP ? "plus" : (pts > 0 ? "na" : "zero"));
        var lbl = na ? "n/a" : (pts > 0 ? "+" + pts : "0");
        rows += '<div class="q-scored"><div class="ql"><div class="qq">' + esc(qf.label) + '</div>' +
          '<div class="qa">' + (answered ? cellValueHtml(qf, d, null) : '<span class="empty-box"></span>') + '</div></div>' +
          '<div class="qp ' + cls + '">' + lbl + '</div></div>';
      });
      sections.push({ name: sec, earned: se, possible: sp });
      html += '<div class="qsec-head"><span>' + esc(sec) + '</span><span class="sub">' + se + '/' + sp + '</span></div>' + rows;
    });
    return { html: html, earned: earned, possible: possible, sections: sections };
  }
  function scoreSideHtml(sd, table, d) {
    var pct = sd.possible ? Math.round(sd.earned / sd.possible * 100) : 0;
    var col = pct >= 90 ? "#2ecc71" : pct >= 75 ? "#4aa3df" : pct >= 50 ? "#e0a53a" : "#e05a5a";
    return '<div class="score-side"><div style="color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Final score</div>' +
      '<div class="bignum" style="color:' + col + '">' + pct + '% <small>' + sd.earned + '/' + sd.possible + '</small></div>' +
      '<div class="score-bar"><i style="width:' + pct + '%;background:' + col + '"></i></div>' +
      '<div style="color:var(--muted);font-size:.72rem">Scored by the engine — matches Airtable exactly</div>' +
      '<div class="score-breakdown">' + sd.sections.map(function (x) {
        return '<div class="brow"><span class="bl">' + esc(x.name) + '</span><span class="bv">' + x.earned + '/' + x.possible + '</span></div>';
      }).join('') + '</div></div>';
  }
```

- [ ] **Step 2: Add the question→scorer mapping resolver**

Add this helper. It first honours an explicit pointer (`options.score_of` on a scorer field or `options.scorer` on a question), then falls back to a label-prefix convention; it caches the result on the table object.

```javascript
  // questionFieldId -> scorer field. Two supported shapes (populated in Task 5 / the DB):
  //   scorer field carries options.score_of = "<questionFieldId>", OR
  //   question field carries options.scorer  = "<scorerFieldId>".
  // Fallback: a scorer field is one with options.score_fmt !== 'percent' AND options.is_scorer,
  // paired to the question whose label it mirrors (options.score_of is preferred and exact).
  function questionScorerMap(table, fields) {
    if (table.__qsMap) return table.__qsMap;
    var byId = {}; fields.forEach(function (f) { byId[f.id] = f; });
    var map = {};
    fields.forEach(function (f) {
      var o = f.options || {};
      if (o.score_of && byId[o.score_of]) map[o.score_of] = f;          // scorer -> its question
      else if (o.scorer && byId[o.scorer]) map[f.id] = byId[o.scorer];  // question -> its scorer
    });
    table.__qsMap = map;
    return map;
  }
```

- [ ] **Step 3: Render the score section in both detail branches**

In `openCustomDetail`, replace the current `scoreHead` computation (search marker `var scoreHead = "";`) so that when a scored breakdown exists it renders the sidebar + sections, otherwise it falls back to the existing headline pill:

```javascript
    var scoreHead = "";
    var scoredBlock = "";
    var sd = scoredDetail(currentCustom.table, fields, d);
    if (sd) {
      scoreHead = scoreSideHtml(sd, currentCustom.table, d);
      scoredBlock = '<div class="scored-section">' + sd.html + '</div>';
    } else {
      var shId = currentCustom && currentCustom.table && currentCustom.table.config && currentCustom.table.config.score_field;
      if (shId) {
        var shf = fields.filter(function (f) { return f.id === shId; })[0];
        var shn = shf ? scoreFraction(shf, customCellText(shf, d)) : null;
        if (shn !== null) scoreHead = '<div class="score-head">' + scorePillHtml(shn, true) + '<span class="sh-lab">' + esc(shf.label) + "</span></div>";
      }
    }
```

Then in the read-only branch (search marker `body.innerHTML = scoreHead + '<div class="m-sub">'`), insert `scoredBlock` right after the `m-grid` div and skip re-listing the scorer fields in the plain grid: in `showsOn`, add at the top `if (sd && (questionScorerMap(currentCustom.table, fields)[f.id] || isScorerField(f))) return false;`. Add helper:

```javascript
  function isScorerField(f) { var o = f.options || {}; return !!(o.score_of); }
```

Apply the same `scoredBlock` insertion and `showsOn` guard in the editor branch (search marker `var grid = detailOrder(fields).map(function (f) {`), placing `scoredBlock` immediately after the score head in that branch's `body.innerHTML` assignment.

- [ ] **Step 4: Verify scoring parity in the browser console**

Serve locally, open a QC record. In the console run (adjust the stored final field id):

```javascript
// pick the open record's data `d`, the table config `cfg`, sum scorer fields, compare to score_field
```

Expected: the sidebar `earned/possible` and `%` equal the record's stored `score_field` value (to the same rounding Airtable uses) for at least 5 QC and 5 Mystery Shopper records. If they differ, the mapping in Task 5 is incomplete — fix the map, not the arithmetic.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Record: per-answer scoring with section subtotals and live total sidebar"
```

---

### Task 5: Populate per-table config and the scorer mapping (DATABASE)

**Requires DB credentials for `db.blktable.blk.jo`.** These are additive updates to `app_tables.config` and `app_fields.options`; no schema change. Run via `psql` or the Supabase SQL editor.

- [ ] **Step 1: Inspect the scoring fields to learn the pairing convention**

```sql
-- QC and Mystery Shopper table ids
select id, name, config->>'score_field' as score_field from app_tables
where name ilike '%spot check%' or name ilike '%mystery%';
-- list fields + options for one of them (replace :tid)
select id, label, type, options from app_fields where table_id = ':tid' order by position;
```

Determine how each scorer field relates to its question (shared label stem? adjacent position? an existing key in `options`?). Record the rule.

- [ ] **Step 2: Populate the question→scorer pointer**

For each scorer field, set `options.score_of` to its question field id (and `options.score_section` / `options.score_weight` where known). Example shape (repeat per pair, or generate with a script from the rule found in Step 1):

```sql
update app_fields
set options = coalesce(options,'{}'::jsonb) || jsonb_build_object('score_of', ':questionFieldId','score_section',:'Cleanliness','score_weight', 1)
where id = ':scorerFieldId';
```

- [ ] **Step 3: Set card/detail/score-raw config per table**

```sql
-- QC: which fields on the card, which in the curated detail, the raw points field + denominator
update app_tables set config = config
  || jsonb_build_object(
       'card_fields', to_jsonb(array[:'branchFieldId', :'dateFieldId', :'actionPlanFieldId', :'finalScorePctFieldId']),
       'detail_fields', to_jsonb(array[ /* curated question ids */ ]),
       'score_field', :'finalScorePctFieldId',
       'score_raw_field', :'finalScorePointsFieldId',
       'score_max', 68)
where id = ':qcTableId';
-- Mystery Shopper: card fields = branch, # other customers, full orchestra, closing, feedback, final %
update app_tables set config = config
  || jsonb_build_object('card_fields', to_jsonb(array[ /* ids */ ]), 'score_field', :'msFinalPctId', 'score_raw_field', :'msOrchestraPointsId', 'score_max', 18)
where id = ':msTableId';
-- Complaints: card fields = screenshot(thread), name, phone, branch, complaint type, issue (no score)
update app_tables set config = config || jsonb_build_object('card_fields', to_jsonb(array[ /* ids */ ])) where id = ':ccTableId';
```

- [ ] **Step 4: Verify**

Reload each table in the dashboard. Expected: cards show the intended fields; QC/Mystery detail shows the per-answer breakdown with the sidebar total matching `score_field` (Task 4 Step 4 passes). Commit is not applicable (DB change) — record the executed SQL in `docs/superpowers/plans/2026-08-09-config-applied.sql` and commit that file:

```bash
git add docs/superpowers/plans/2026-08-09-config-applied.sql
git commit -m "Docs: record the config/scorer SQL applied to the DB"
```

---

### Task 6a: Complaints WhatsApp-thread card

**Files:**
- Modify: `index.html` `renderCustom()` card build (Task 3 output).

- [ ] **Step 1: Render the screenshot photo field as a thread/cover on complaint cards**

Complaints store the WhatsApp screenshot in a photo field. On the card, when `config.card_lead_photo` names that field and the record has it, render it as the top cover (it is already handled by `photoField` cover). Additionally, when `config.thread_field` names a long-text transcription (if present), render a `.thread` preview. If Complaints only has the screenshot image (no text transcript), the existing photo cover is sufficient — set `card_lead_photo` in Task 5 and skip the text thread. Add, in the card build, before `fldsHtml`:

```javascript
      var threadHtml = "";
      var threadId = currentCustom.table.config && currentCustom.table.config.thread_field;
      if (threadId && d[threadId]) {
        var lines = String(d[threadId]).split(/\n+/).slice(0, 6);
        threadHtml = '<div class="thread">' + lines.map(function (ln, i) {
          return '<div class="bub ' + (i % 2 ? 'us' : 'them') + '">' + esc(ln) + '</div>';
        }).join('') + '</div>';
      }
```

Insert `threadHtml` into the card body immediately after the cover `photo` div and before `fldsHtml`.

- [ ] **Step 2: Verify**

Open Customer Complaints. Expected: the screenshot shows as the card cover with name/phone/branch/complaint-type/issue as labelled pills below, matching the Complaints screenshot. Commit:

```bash
git add index.html
git commit -m "Complaints: WhatsApp screenshot cover + thread preview on cards"
```

---

### Task 6b: Job Application — explicit Country question

**Files:**
- Modify: `apply/index.html` form markup (~162, before `city-field`) and picker script (~366, `selectCountry`) and submit insert (~509).

- [ ] **Step 1: Add the Country select to the form**

Immediately before the `<div class="field" id="city-field">` (search marker `id="city-field"`), insert:

```html
          <div class="field" id="country-field">
            <label for="country">Country <span class="ar">/ الدولة</span> <span class="req">*</span></label>
            <select id="country" required>
              <option value="Jordan">Jordan / الأردن</option>
              <option value="Lebanon">Lebanon / لبنان</option>
              <option value="Syria">Syria / سوريا</option>
              <option value="Iraq">Iraq / العراق</option>
            </select>
          </div>
```

- [ ] **Step 2: Wire Country → dial code (reuse the existing picker)**

The `COUNTRIES` array (line ~349) already holds Jordan/Lebanon/Syria/Iraq with `cc`/`name`. Wire the select to the existing `selectCountry(i)` so choosing a country drives the dial code, City visibility and the "Are you Lebanese?" visibility. After the `selectCountry(0);` call (line ~410) add:

```javascript
  var countrySel = document.getElementById("country");
  if (countrySel) {
    countrySel.addEventListener("change", function () {
      var i = COUNTRIES.map(function (c) { return c.name; }).indexOf(countrySel.value);
      if (i >= 0) selectCountry(i);
    });
    // keep the select in sync if the user opens the flag picker instead
    var origSelect = selectCountry;
    selectCountry = function (i) { origSelect(i); if (countrySel) countrySel.value = COUNTRIES[i].name; };
    selectCountry(0);
  }
```

- [ ] **Step 3: Store country explicitly on submit**

In the `db.from("job_applications").insert({ … })` payload (line ~509), add `country: selCountry.name,` (the `country` column already exists and is used for grouping). This makes the answer explicit rather than only trigger-derived.

- [ ] **Step 4: Verify**

Serve locally, open `/apply/`. Expected: a Country dropdown above City; choosing Lebanon flips the dial code to +961, hides City, shows "Are you Lebanese?"; choosing Jordan shows City and +962. Submit a test application for each country; confirm in the dashboard the record's Country groups correctly in the sidebar and shows on the card.

- [ ] **Step 5: Commit**

```bash
git add apply/index.html
git commit -m "Job Application: explicit Country question wired to dial code and grouping"
```

---

### Task 7: Backfill country on existing records + light grid pill parity (DATABASE + verify)

- [ ] **Step 1: Backfill `country` where derivable from phone**

Existing records mostly already have `country` (STATUS: trigger fills it from the dial code). Confirm and backfill any nulls that have a phone:

```sql
update job_applications set country = case
  when phone like '+962%' then 'Jordan' when phone like '+961%' then 'Lebanon'
  when phone like '+963%' then 'Syria'  when phone like '+964%' then 'Iraq' else country end
where country is null and phone is not null;
```

- [ ] **Step 2: Verify grid pills**

Open any custom table's Grid view. Confirm select/yes-no cells already render as pills (existing `gridCell`); no change expected. If a scored column shows a bare number rather than a pill, confirm `options.score_fmt = 'percent'` on the final-score column only (not the per-question scorers).

- [ ] **Step 3: Record applied SQL and commit**

```bash
git add docs/superpowers/plans/2026-08-09-config-applied.sql
git commit -m "Docs: country backfill SQL"
```

---

### Task 8: Full verification pass + PR

- [ ] **Step 1: Screenshot each view against its Airtable reference**

Using the playwright-skill or a manual browser, capture QC, Mystery Shopper, Complaints and Job Application galleries and a QC record detail; compare side-by-side with the provided Airtable screenshots. Note any gaps.

- [ ] **Step 2: Regression checklist**

Confirm still working: search, Filter panel, Sort (new), Group, Column picker, saved views (My/Shared), CSV export, stage tabs + move buttons, record actions (WhatsApp/Call/Email), the review chain in the record panel, photo lightbox, RTL Arabic. Confirm no assignment UI was added and existing "For you"/is-mine still renders unchanged.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin redesign-airtable-parity
gh pr create --repo blktable/blktable.github.io --base main --head redesign-airtable-parity \
  --title "Airtable-parity redesign: cards, toolbar, per-answer scoring, Job App country" \
  --body "$(cat <<'EOF'
Redraws the dashboard toward the Airtable views: labelled-field cards with a raw+percent score chip, an Airtable-style toolbar (Sort + Color added), per-answer scoring in QC/Mystery Shopper records, a WhatsApp-thread cover on Complaints, and an explicit Country question on the Job Application form wired to the dial code.

Scope excludes assignment (being reworked separately). Scoring surfaces existing engine values — totals still equal Airtable. Config/scorer mapping applied via the recorded SQL.

See docs/superpowers/specs/2026-08-09-airtable-parity-redesign-design.md and docs/superpowers/plans/2026-08-09-airtable-parity-redesign.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Merging to `main` deploys via GitHub Pages. Verify the live site after merge.
