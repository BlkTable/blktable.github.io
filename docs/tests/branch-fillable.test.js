// Branch-fillable questions: which answers a field-limited user may change.
//
// A branch login carries table_access.scope = {"branch":[...], "fields":"internal"}. Until now
// that meant "any staff-only question", which on Customer Complaints was 37 questions — the whole
// imported history, Coupon Code and Star for later included. A table can now nominate the handful
// its shops actually fill in, with the staff-only set as the fallback for the tables that predate
// the flag.
//
// The rule lives here and in the database trigger enforce_scope_field_limit(). The trigger is the
// authority; this side only decides which rows the panel draws as inputs. They must agree, so the
// two conditions are written the same way: internal AND branch_edit, falling back to internal.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

// lockedAnswerHtml reads its text through customCellText, the same rule the grid cell uses, so
// that chain comes along by name — a rename anywhere in it fails loudly here.
const A = load('index.html', [
  'branchFillableIds', 'lockedAnswerHtml', 'customCellText', 'esc',
  'ageText', 'isOtherChoice', 'otherKeyFor', 'isFileField', 'filePaths', 'fileLabel'
]);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// Customer Complaints in miniature: what the customer typed, the imported clutter, and the
// five follow-up questions a store leader is meant to fill in.
const cust   = { id: 'f-name',   label: 'Customer Name',  type: 'short_text', internal: false };
const phone  = { id: 'f-phone',  label: 'Phone Number',   type: 'phone',      internal: false };
const coupon = { id: 'f-coupon', label: 'Coupon Code',    type: 'short_text', internal: true };
const first  = { id: 'f-first',  label: 'First Contact',  type: 'yesno',      internal: true, branch_edit: true };
const howfix = { id: 'f-howfix', label: 'How was it resolved?', type: 'long_text', internal: true, branch_edit: true };
const FIELDS = [cust, phone, coupon, first, howfix];

// ---- which questions a field-limited user may fill ----
t('a nominated question is fillable', () => {
  const ok = A.branchFillableIds(FIELDS);
  assert.strictEqual(ok['f-first'], true);
  assert.strictEqual(ok['f-howfix'], true);
});
t('a staff-only question that was NOT nominated is locked', () => {
  // the whole point: Coupon Code is internal, so the old rule let a shop rewrite it
  assert.ok(!A.branchFillableIds(FIELDS)['f-coupon']);
});
t("a question the customer answered is locked", () => {
  const ok = A.branchFillableIds(FIELDS);
  assert.ok(!ok['f-name']);
  assert.ok(!ok['f-phone']);
});
t('nominating a public question does not unlock it', () => {
  // a foot-gun worth closing: branch_edit on a question the customer answers would hand the
  // shop the customer's own words. internal is required as well, in the trigger too.
  const sneaky = [Object.assign({}, cust, { branch_edit: true }), first];
  assert.ok(!A.branchFillableIds(sneaky)['f-name']);
  assert.strictEqual(A.branchFillableIds(sneaky)['f-first'], true);
});
t('a table that nominates nothing falls back to every staff-only question', () => {
  // Mystery Shopper and Shop Audit predate the flag and must keep working exactly as before
  const old = [cust, phone, coupon];
  const ok = A.branchFillableIds(old);
  assert.strictEqual(ok['f-coupon'], true);
  assert.ok(!ok['f-name']);
  assert.ok(!ok['f-phone']);
});
t('the fallback is per table, not per record: one nomination switches the whole table over', () => {
  const ok = A.branchFillableIds([cust, coupon, first]);
  assert.strictEqual(ok['f-first'], true);
  assert.ok(!ok['f-coupon']);
});
t('no fields at all is not a crash', () => {
  // Object.keys, not deepStrictEqual: the object is built inside the vm context and so has a
  // different Object.prototype, which deepStrictEqual counts as a difference.
  assert.strictEqual(Object.keys(A.branchFillableIds([])).length, 0);
  assert.strictEqual(Object.keys(A.branchFillableIds(null)).length, 0);
});

// ---- a locked row carries no input ----
// This is the load-bearing property, not a cosmetic one. edValues() reads every answer back out
// of the DOM by id="ed-<field id>" and saveCustom() re-trims and reformats whatever it finds. A
// *disabled* input would still be read, so a locked phone would round-trip through the phone
// formatter and a locked number through .trim(), land in data as a different JSON value, and the
// trigger would refuse the entire save — the shop could not file its follow-up at all. With no
// input element the key is skipped and the stored value survives byte for byte.
t('a locked row renders no ed- input for edValues to find', () => {
  const html = A.lockedAnswerHtml(phone, { 'f-phone': '+962 7 9000 0000' });
  assert.ok(html.indexOf('id="ed-f-phone"') === -1, 'locked row must not carry the ed- id');
  assert.ok(html.indexOf('<input') === -1 && html.indexOf('<textarea') === -1 && html.indexOf('<select') === -1,
    'locked row must not carry a form control at all');
});
t('a locked row still shows the answer', () => {
  assert.ok(A.lockedAnswerHtml(phone, { 'f-phone': '+962 7 9000 0000' }).indexOf('+962 7 9000 0000') > -1);
});
t('a locked row with no answer shows a dash, not blank', () => {
  assert.ok(A.lockedAnswerHtml(coupon, {}).indexOf('—') > -1);
});
t('a locked answer is escaped', () => {
  const html = A.lockedAnswerHtml(cust, { 'f-name': '<img src=x onerror=alert(1)>' });
  assert.ok(html.indexOf('<img') === -1, 'the answer must not reach the page as markup');
  assert.ok(html.indexOf('&lt;img') > -1);
});
t('a locked multi-select answer reads as a list, not [object Object]', () => {
  const ms = { id: 'f-ms', label: 'Issues', type: 'multi_select', internal: false };
  const html = A.lockedAnswerHtml(ms, { 'f-ms': ['Cold', 'Late'] });
  assert.ok(html.indexOf('Cold') > -1 && html.indexOf('Late') > -1);
  assert.ok(html.indexOf('[object') === -1);
});

console.log(n + ' passed');
