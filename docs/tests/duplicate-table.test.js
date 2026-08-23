// Duplicating a table. Almost all of the work is one SECURITY DEFINER function in the
// database (workspaces/19-duplicate-table.sql), which verifies itself when it is applied:
// it duplicates a real table, checks the copy question for question and record for record,
// checks no answer was left pointing at a question id that is not in the copy, and refuses
// to commit otherwise. What can be tested from here is the part that lives in the page, and
// every test below is a way the feature could ship looking finished and not be:
//
//   * the menu item missing from one of the two ⋯ menus (they are separate code),
//   * a non-admin being offered it,
//   * the copy being made but never opened, so it is lost in a sidebar of 272 entries,
//   * "with records" defaulting to on, which for the biggest table copies 28,000 rows
//     because somebody clicked through a dialog.
const fs = require('fs'), assert = require('assert');
const SRC = fs.readFileSync('index.html', 'utf8');
const JS = [...SRC.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

t('both ⋯ menus offer it — the sidebar one and the one in the table header', () => {
  // Two separate menus built two separate ways: the sidebar's is an HTML string of <li>,
  // the header's is an array of objects. Adding it to one and calling it done is the
  // likeliest way this ships half-built.
  assert.ok(/<li data-a="duplicate">Duplicate table…<\/li>/.test(JS), 'not in the sidebar ⋯ menu');
  assert.ok(/label: "Duplicate table…"/.test(JS), 'not in the table header ⋯ menu');
});

t('the sidebar menu only opens for an admin at all, and the header entry sits inside isAdmin', () => {
  assert.ok(/if \(!isAdmin\) return;\s*\n\s*var item = gear\.closest/.test(JS),
            'the sidebar ⋯ menu no longer refuses non-admins');
  // The header menu's admin half starts at `if (isAdmin) {` and ends at the `} else {`
  // that gives everyone else just Share. Duplicate must be inside the first half.
  const admin = JS.slice(JS.indexOf('var ws = tableWorkspace(t);'));
  const upTo = admin.slice(0, admin.indexOf('items.push({ label: "Share…"'));
  assert.ok(/Duplicate table…/.test(upTo), 'Duplicate is not inside the admin-only half of the header menu');
});

t('it calls duplicate_table rather than writing the rows from the browser', () => {
  // A table is a row, its questions, the ids those questions are referenced by, its access
  // grants and maybe its records. Done as five requests, a failure after the second leaves
  // half a table in the sidebar that nobody asked for.
  assert.ok(/db\.rpc\("duplicate_table", \{/.test(JS), 'not going through the RPC');
  assert.ok(/p_table:[\s\S]{0,200}p_with_records:/.test(JS), 'the RPC is not being sent its three arguments');
});

t('"copy the records too" is off when the dialog opens', () => {
  assert.ok(/getElementById\("duptbl-records"\)\.checked = false;/.test(JS),
            'the records box is not reset to off — a stale tick copies 28,000 rows on the next table');
  assert.ok(/<input type="checkbox" id="duptbl-records">/.test(SRC),
            'the checkbox is not unchecked in the markup either');
});

t('the dialog says how many records it would copy, rather than "records"', () => {
  assert.ok(/count: "exact", head: true/.test(JS), 'the count is not being read');
  assert.ok(/duptbl-recn/.test(JS) && /id="duptbl-recn"/.test(SRC), 'nowhere to show it');
});

t('the copy is opened once it exists', () => {
  const fn = JS.slice(JS.indexOf('function doDuplicateTable()'));
  const body = fn.slice(0, fn.indexOf('\n  document.getElementById("duptbl-cancel")'));
  assert.ok(/loadCustomTables\(\)\.then\(/.test(body), 'the table list is not reloaded before looking for it');
  assert.ok(/openCustomTable\(nt\)/.test(body), 'the copy is never opened');
});

t('a missing migration is named, instead of reading as a permissions problem', () => {
  // The lesson from record_share_token: any error at all was reported as "you cannot share
  // records of this table", so a missing function read as a missing permission for a week.
  assert.ok(/19-duplicate-table\.sql/.test(JS), 'the migration is not named in the failure message');
  assert.ok(/Could not duplicate\. " \+ \(\(r\.error && r\.error\.message\)/.test(JS),
            'other failures do not repeat the database\'s own words');
});

t('the dialog says out loud what duplicating does NOT do', () => {
  // Duplicate and "Restart form…" sit two lines apart in the same menu and do very
  // different things to the original. The dialog has to say which one this is.
  assert.ok(/is not touched/.test(SRC), 'the dialog does not say the original is left alone');
  assert.ok(/its own public link/.test(SRC), 'the dialog does not say the copy gets its own link');
});

console.log(n + ' duplicate-table tests passed');
