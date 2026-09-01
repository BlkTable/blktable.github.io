// Staff-only questions have to be on screen BEFORE they hold an answer.
//
// A staff-only question is, by definition, one the customer never saw — so every record
// arrives with all of them empty. showsOn() used to draw a staff-only question only once it
// held an answer, which meant a complaint submitted an hour ago opened on the customer's side
// (read-only to the shop, which is correct) and no follow-up questions at all: no "did you
// call them", no "how was it resolved". The work the record exists for was unreachable, on
// every new record, for every table with a follow-up.
//
// The set drawn when empty is the table's NOMINATED follow-up — internal AND branch_edit —
// with no fallback to "every staff-only question". The fallback is right for the write limit
// (branchFillableIds) and wrong here: Shop Audit and Shop Spot Check (QC) carry 88 staff-only
// questions each, Mystery Shopper 65, none of them nominated, so a fallback would open those
// records on ~90 empty rows. That difference is asserted below, because it is the one thing
// that would quietly make this fix worse than the bug.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}

// Both pieces live inside openCustomDetail(), so they come out by source text rather than by
// name the way the top-level helpers do. A rename or a reindent fails here loudly, which is
// the intent: this rule is easy to "tidy" back into the bug it fixes.
function loadDetailRules(file) {
  const js = scripts(file);
  // index.html is CRLF here, so every anchor is written \r?\n — a regex that assumes \n finds
  // nothing and the whole file reads as "rule missing".
  const fu = js.match(/\r?\n {4}var followUpIds = \{\};\r?\n {4}\(fields \|\| \[\]\)\.forEach\([^\r\n]*\r?\n/);
  if (!fu) throw new Error('could not find the followUpIds construction in ' + file);
  const so = js.match(/\r?\n {4}function showsOn\(f, d, forEdit\) \{[\s\S]*?\r?\n {4}\}\r?\n/);
  if (!so) throw new Error('could not find showsOn() in ' + file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('this.make = function (fields, env) {' +
    ' env = env || {};' +
    ' var scoreSlot = env.scoreSlot || null;' +
    ' var currentCustom = env.currentCustom || { table: { id: "t1", config: {} } };' +
    ' var curated = !!env.curated, pickedIds = env.pickedIds || null;' +
    ' function isScorerField(f) { return !!f.scorer; }' +
    ' function condMet(f, d) { return env.condMet ? env.condMet(f, d) : true; }' +
    fu[0] + so[0] +
    ' return { showsOn: showsOn, followUpIds: followUpIds };' +
    '};').runInContext(ctx);
  return ctx.make;
}
const make = loadDetailRules('index.html');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// Customer Complaints in miniature, as it stands after migration 60: what the customer filled,
// the follow-up the shop is meant to fill, and a retired import column nobody fills.
const complaint = { id: 'q-complaint', label: 'Your Complaint',    internal: false, branch_edit: false };
const called    = { id: 'q-called',    label: 'First Contact',     internal: true,  branch_edit: true  };
const resolved  = { id: 'q-resolved',  label: 'How was it fixed',  internal: true,  branch_edit: true  };
const email     = { id: 'q-email',     label: 'Email',             internal: true,  branch_edit: false };
const legacy    = { id: 'q-legacy',    label: 'Star for later',    internal: true,  branch_edit: false };
const FIELDS = [complaint, called, resolved, email, legacy];

// A complaint as it exists the moment the customer presses submit: their side answered, every
// staff-only question empty. This is the record the bug made unworkable.
const fresh = { 'q-complaint': 'the drink arrived cold' };
const EDIT = true, READ = undefined;

t('the customer\'s own answer shows, both views', () => {
  const A = make(FIELDS);
  assert.strictEqual(A.showsOn(complaint, fresh, EDIT), true);
  assert.strictEqual(A.showsOn(complaint, fresh, READ), true);
});

t('an EMPTY nominated follow-up question shows in the editable view', () => {
  const A = make(FIELDS);
  assert.strictEqual(A.showsOn(called, fresh, EDIT), true, 'First Contact must be fillable on a new complaint');
  assert.strictEqual(A.showsOn(resolved, fresh, EDIT), true, 'the resolution box must be there before it is filled');
});

t('an empty follow-up question stays out of the read-only view', () => {
  // A viewer without can_edit cannot fill it, and a column of "—" says nothing the answered
  // questions do not.
  const A = make(FIELDS);
  assert.strictEqual(A.showsOn(called, fresh, READ), false);
  assert.strictEqual(A.showsOn(resolved, fresh, READ), false);
});

t('an empty staff question the table did NOT nominate stays hidden', () => {
  const A = make(FIELDS);
  assert.strictEqual(A.showsOn(email, fresh, EDIT), false);
  assert.strictEqual(A.showsOn(legacy, fresh, EDIT), false);
  assert.strictEqual(A.showsOn(legacy, fresh, READ), false);
});

t('an answered staff question still shows whether nominated or not', () => {
  // The old rule's one correct half: an answer is history and must stay visible.
  const A = make(FIELDS);
  const done = { 'q-complaint': 'cold', 'q-called': 'Yes', 'q-legacy': 'Yes', 'q-email': 'a@b.co' };
  assert.strictEqual(A.showsOn(called, done, EDIT), true);
  assert.strictEqual(A.showsOn(called, done, READ), true);
  assert.strictEqual(A.showsOn(legacy, done, EDIT), true);
  assert.strictEqual(A.showsOn(legacy, done, READ), true);
  assert.strictEqual(A.showsOn(email, done, READ), true);
});

t('an empty string counts as unanswered, not as an answer', () => {
  const A = make(FIELDS);
  assert.strictEqual(A.showsOn(legacy, { 'q-legacy': '' }, EDIT), false);
  assert.strictEqual(A.showsOn(called, { 'q-called': '' }, EDIT), true);   // nominated, so still drawn
});

t('NO fallback: a table that nominates nothing draws no empty staff questions', () => {
  // Shop Audit's shape — 88 staff-only questions, none nominated. branchFillableIds() would
  // return all 88 here; the follow-up set must return none, or opening a Shop Audit record
  // lists 88 empty rows above the answers.
  const audit = [];
  for (let i = 0; i < 88; i++) audit.push({ id: 'a' + i, label: 'Q' + i, internal: true, branch_edit: false });
  audit.push({ id: 'pub', label: 'Shop', internal: false, branch_edit: false });
  const A = make(audit);
  assert.strictEqual(Object.keys(A.followUpIds).length, 0, 'an unnominated table has no follow-up set');
  const empty = { pub: 'Khalda' };
  assert.strictEqual(audit.filter(f => A.showsOn(f, empty, EDIT)).length, 1, 'only the answered public question');
});

t('the follow-up set is internal AND branch_edit, never branch_edit alone', () => {
  // branch_edit on a public question is meaningless and must not leak into the set — the same
  // belt-and-braces the write limit applies, because a public question ticked branch-fillable
  // would hand the shop the customer's own words.
  const odd = [{ id: 'x', label: 'Customer said', internal: false, branch_edit: true }];
  const A = make(odd);
  assert.strictEqual(Object.keys(A.followUpIds).length, 0);
});

t('a nominated follow-up question still loses to the curated list and to scorers', () => {
  // config.detail_fields and the score-field rules are checked before this one, and stay that way.
  const A = make(FIELDS, { curated: true, pickedIds: ['q-complaint'] });
  assert.strictEqual(A.showsOn(called, fresh, EDIT), false, 'a curated view shows only what it names');
  const B = make(FIELDS);
  const scorer = { id: 'q-sc', label: 'Score', internal: true, branch_edit: true, scorer: true };
  assert.strictEqual(B.showsOn(scorer, fresh, EDIT), false, 'a computed score is never a box');
});

console.log(n + ' passed');
