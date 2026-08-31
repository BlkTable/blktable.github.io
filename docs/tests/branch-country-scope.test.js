// The shops a branch question offers follow the country — from the country GROUPS, never
// from guessing.
//
// Two things were true before this and are not now. First, a branch question carried its own
// hand-typed list ("jo, lebanon") in the Options box, a second place to say which countries a
// form is for and therefore a place to get them out of step. Second, a question naming two
// lists showed BOTH countries' shops in one long list and never narrowed, because nothing on
// those forms asked which country it was.
//
// Now: the question's scope is written from the country groups ticked on the table, and once
// the country question is answered the list narrows to that country's shops. The grouping is
// `branches.list_key` — the country group kept in the Countries manager — at every step.
// Nothing anywhere reads a country's name out of a shop's name to decide this;
// branchListMismatch does that, and it is a WARNING in the manager, not a filter.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js, name) {
  const multi = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}'));
  if (multi) return multi[0];
  const one = js.match(new RegExp('\\n  function ' + name + '\\s*\\(.*'));
  if (one) return one[0];
  throw new Error('no fn ' + name);
}
function grabVar(js,name){const m=js.match(new RegExp('\\n  var '+name+' = [\\s\\S]*?;(?=\\r?\\n)'));if(!m)throw new Error('no var '+name);return m[0];}
function load(file,names,vars,extra){const js=scripts(file);const body=(vars||[]).map(v=>grabVar(js,v)).join('\n')+'\n'+names.map(n=>grab(js,n)).join('\n');const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+body+'\nthis.API={'+names.concat(vars||[]).join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const SRC = scripts('index.html');
const FSRC = scripts('f/index.html');

// The dashboard half.
const D = load('index.html',
  ['rebuildCountryIndex','canonicalCountry','branchListKeys','branchScopeList','branchScopeKeys',
   'countryAnswerIn','needsBranchScope','branchOpen','branchDropdownOptions','branchListMismatch'],
  ['DEFAULT_COUNTRIES','COUNTRY_LIST','COUNTRY_INDEX']);
D.rebuildCountryIndex();

// The public half. countryNameFor and BRANCHES are the page's; COUNTRY_ROWS is the countries
// table as the page loads it.
const BRANCHES = [
  { name: 'Abdoun',      name_ar: 'عبدون', position: 1, list_key: 'jo',      is_active: true },
  { name: 'Swefieh',     name_ar: null,    position: 2, list_key: 'jo',      is_active: true },
  { name: 'Closed Shop', name_ar: null,    position: 3, list_key: 'jo',      is_active: false },
  { name: 'Jal el Deeb', name_ar: null,    position: 1, list_key: 'lebanon', is_active: true },
  { name: 'Hamra',       name_ar: null,    position: 2, list_key: 'lebanon', is_active: true },
  { name: 'Baghdad One', name_ar: null,    position: 1, list_key: 'iraq',    is_active: true },
  { name: 'Old Row',     name_ar: null,    position: 9, /* no list_key */    is_active: true }
];
const COUNTRY_ROWS = [
  { code: 'jo', name_en: 'Jordan', name_ar: 'الأردن' },
  { code: 'lebanon', name_en: 'Lebanon', name_ar: 'لبنان' },
  { code: 'iraq', name_en: 'Iraq', name_ar: 'العراق' },
  { code: 'syria', name_en: 'Syria', name_ar: 'سوريا' }
];
const F = load('f/index.html',
  ['branchListKeysOf','countryCodeOf','branchScopeKeysOf','branchOptionsFor','countryNameFor'],
  [], { BRANCHES, COUNTRY_ROWS });

const asW = o => JSON.parse(JSON.stringify(o));
const names = os => asW(os).map(o => o.value);
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const twoCountry = { id: 'b1', type: 'branch', options: { list: 'jo, lebanon' } };
const oneCountry = { id: 'b1', type: 'branch', options: { list: 'lebanon' } };
const legacy     = { id: 'b1', type: 'branch', options: null };

// ---- The Options box is gone; the ticks are the source ------------------------------------
t('a branch question no longer has a list typed into it', () => {
  // Two places to say which countries a form is for is one place to get them out of step,
  // and the symptom is a form asking for Iraq's shops on a table nobody ticked Iraq on.
  const u = grab(SRC, 'typeUsesOpts');
  assert.ok(!/"branch"/.test(u), 'the branch type still uses the free-text Options box');
  const p = grab(SRC, 'optsPlaceholder');
  assert.ok(!/Branch lists/.test(p), 'the Options box still explains a branch list to type');
});
t('the scope is written from the countries ticked on the table', () => {
  // rowOptionsForSave is the seam the save reads a row's options through — the branch case
  // moved there with the rest when choice questions got the answers editor.
  const s = grab(SRC, 'rowOptionsForSave');
  assert.ok(/list: branchScopeList\(builderScope\(\)\.countries,/.test(s),
    'a branch question is not scoped from the country ticks');
});
t('ticked countries are what the question is scoped to', () => {
  assert.strictEqual(D.branchScopeList(['jo']), 'jo');
  assert.strictEqual(D.branchScopeList(['jo', 'lebanon']), 'jo, lebanon');
  assert.strictEqual(D.branchScopeList(['jo', 'lebanon'], 'syria'), 'jo, lebanon', 'the ticks must win over the old list');
});
t('NOTHING ticked keeps the list the question already had', () => {
  // Three live tables depend on this. Customer Complaints (1,440 records), Shop Audit and
  // Shop Spot Check (QC) (1,591) all ask for Lebanon's shops as well as Jordan's, and none
  // of them has a country ticked. Deriving "jo" here would take Lebanon's shops off three
  // working forms on the next unrelated save, and say nothing about it.
  assert.strictEqual(D.branchScopeList([], 'lebanon, jo'), 'lebanon, jo');
  assert.strictEqual(D.branchScopeList(null, 'jo, lebanon, syria, iraq'), 'jo, lebanon, syria, iraq');
  assert.strictEqual(D.branchScopeList([], '  lebanon, jo  '), 'lebanon, jo');
});
t('and only a question with no list at all falls back to Jordan', () => {
  // What every branch question written before any of this already means. A blank would
  // offer no shops at all.
  assert.strictEqual(D.branchScopeList([], ''), 'jo');
  assert.strictEqual(D.branchScopeList([], null), 'jo');
  assert.strictEqual(D.branchScopeList([]), 'jo');
  assert.strictEqual(D.branchScopeList(null), 'jo');
});
t('the save reads the list off the row, so it has something to keep', () => {
  // The Options box is hidden for a branch question now but still holds its value. Reading
  // builderScope() alone is what would have lost it.
  const s = grab(SRC, 'rowOptionsForSave');
  assert.ok(/branchScopeList\(builderScope\(\)\.countries, row\.querySelector\("\.opts"\)\.value\)/.test(s),
    'the existing branch list is not passed in, so nothing can be kept');
});

// ---- Narrowing, on both pages ---------------------------------------------------------------
t('unanswered, a two-country form offers both countries\' shops', () => {
  assert.deepStrictEqual(names(F.branchOptionsFor(twoCountry, null)),
    ['Abdoun', 'Swefieh', 'Old Row', 'Jal el Deeb', 'Hamra']);
  assert.deepStrictEqual(asW(F.branchScopeKeysOf(twoCountry, null)), ['jo', 'lebanon']);
  assert.deepStrictEqual(asW(D.branchScopeKeys(twoCountry, null)), ['jo', 'lebanon']);
});
t('answering Lebanon leaves Lebanon\'s shops and takes the rest out', () => {
  // The whole ask: "if i chose lebanon from the countries, i want to only see the lebanon
  // branches".
  assert.deepStrictEqual(names(F.branchOptionsFor(twoCountry, 'Lebanon')), ['Jal el Deeb', 'Hamra']);
  assert.deepStrictEqual(asW(F.branchScopeKeysOf(twoCountry, 'Lebanon')), ['lebanon']);
  assert.deepStrictEqual(asW(D.branchScopeKeys(twoCountry, 'Lebanon')), ['lebanon']);
});
t('and answering Jordan leaves Jordan\'s', () => {
  assert.deepStrictEqual(names(F.branchOptionsFor(twoCountry, 'Jordan')), ['Abdoun', 'Swefieh', 'Old Row']);
});
t('both pages agree, because disagreeing means the form offers what the record cannot hold', () => {
  ['Lebanon', 'Jordan', null, 'Iraq'].forEach(function (a) {
    assert.deepStrictEqual(asW(F.branchScopeKeysOf(twoCountry, a)), asW(D.branchScopeKeys(twoCountry, a)),
      'the two pages disagree for ' + a);
  });
});
t('a one-country form needs no answer and is unchanged by one', () => {
  assert.deepStrictEqual(names(F.branchOptionsFor(oneCountry, null)), ['Jal el Deeb', 'Hamra']);
  assert.deepStrictEqual(names(F.branchOptionsFor(oneCountry, 'Lebanon')), ['Jal el Deeb', 'Hamra']);
});
t('an answer OUTSIDE the form\'s countries narrows nothing rather than emptying the box', () => {
  // Iraq is a real country but not one this form covers. Filtering to it would leave the
  // person with no shop to pick and no way to tell why.
  assert.deepStrictEqual(names(F.branchOptionsFor(twoCountry, 'Iraq')), ['Abdoun', 'Swefieh', 'Old Row', 'Jal el Deeb', 'Hamra']);
  assert.deepStrictEqual(asW(D.branchScopeKeys(twoCountry, 'Iraq')), ['jo', 'lebanon']);
});
t('an answer nobody has heard of narrows nothing either', () => {
  assert.deepStrictEqual(names(F.branchOptionsFor(twoCountry, 'Atlantis')), ['Abdoun', 'Swefieh', 'Old Row', 'Jal el Deeb', 'Hamra']);
  assert.deepStrictEqual(names(F.branchOptionsFor(twoCountry, '')), ['Abdoun', 'Swefieh', 'Old Row', 'Jal el Deeb', 'Hamra']);
});
t('the Arabic name of a country answers too', () => {
  assert.strictEqual(F.countryCodeOf('لبنان'), 'lebanon');
  assert.strictEqual(F.countryCodeOf('Lebanon'), 'lebanon');
  assert.strictEqual(F.countryCodeOf('  lebanon  '), 'lebanon');
  assert.strictEqual(F.countryCodeOf('nowhere'), null);
  assert.strictEqual(F.countryCodeOf(null), null);
});

// ---- From the groups, never from the names ---------------------------------------------------
t('a shop is placed by its list_key, not by any country in its name', () => {
  // "Jal el Deeb" says nothing about Lebanon and "Baghdad One" says Iraq in its name. Both
  // are grouped by list_key alone, which is what the Countries manager maintains.
  assert.deepStrictEqual(names(F.branchOptionsFor({ options: { list: 'lebanon' } }, null)), ['Jal el Deeb', 'Hamra']);
  assert.deepStrictEqual(names(F.branchOptionsFor({ options: { list: 'iraq' } }, null)), ['Baghdad One']);
});
t('a shop whose name names a country it is NOT filed under stays where it is filed', () => {
  // branchListMismatch flags this in the Countries manager so a human can move it. It is a
  // warning, and must never quietly become a filter — a shop would then appear under a
  // country nobody put it in.
  const odd = [{ name: 'Jal el Deeb - Lebanon', position: 1, list_key: 'jo', is_active: true }];
  const G = load('f/index.html', ['branchOptionsFor', 'branchScopeKeysOf', 'branchListKeysOf', 'countryCodeOf', 'countryNameFor'],
    [], { BRANCHES: odd, COUNTRY_ROWS });
  assert.deepStrictEqual(names(G.branchOptionsFor({ options: { list: 'jo, lebanon' } }, 'Lebanon')), [],
    'a shop was moved to Lebanon by reading its name');
  assert.deepStrictEqual(names(G.branchOptionsFor({ options: { list: 'jo, lebanon' } }, 'Jordan')), ['Jal el Deeb - Lebanon']);
  // and the warning still says what a human should look at
  assert.strictEqual(D.branchListMismatch({ name: 'Jal el Deeb - Lebanon', list_key: 'jo' }), 'Lebanon');
});
t('no filtering path anywhere reads a country out of a shop name', () => {
  ['branchOptionsFor', 'branchScopeKeysOf', 'branchListKeysOf'].forEach(function (fn) {
    assert.ok(!/branchListMismatch/.test(grab(FSRC, fn)), fn + ' guesses from the shop name');
  });
  ['branchScopeKeys', 'branchDropdownOptions', 'branchListKeys'].forEach(function (fn) {
    assert.ok(!/branchListMismatch/.test(grab(SRC, fn)), fn + ' guesses from the shop name');
  });
});

// ---- Shops that are closed, and rows written before list_key -------------------------------
t('a closed shop is offered nowhere', () => {
  // It is switched off rather than deleted, so the answers naming it still read correctly.
  assert.ok(names(F.branchOptionsFor(twoCountry, 'Jordan')).indexOf('Closed Shop') === -1);
  assert.ok(D.branchDropdownOptions(BRANCHES, ['jo']).map(function (o) { return o.en; }).indexOf('Closed Shop') === -1);
});
t('a shop with no list_key counts as Jordan on both pages', () => {
  // Which is what every row written before the column existed says.
  assert.ok(names(F.branchOptionsFor({ options: { list: 'jo' } }, null)).indexOf('Old Row') !== -1);
  assert.ok(D.branchDropdownOptions(BRANCHES, ['jo']).map(function (o) { return o.en; }).indexOf('Old Row') !== -1);
});
t('a question with no options at all still means Jordan', () => {
  assert.deepStrictEqual(asW(F.branchListKeysOf(legacy)), ['jo']);
  assert.deepStrictEqual(asW(D.branchListKeys(legacy)), ['jo']);
});
t('shops keep the order the Countries manager put them in', () => {
  assert.deepStrictEqual(names(F.branchOptionsFor({ options: { list: 'lebanon' } }, null)), ['Jal el Deeb', 'Hamra']);
});

// ---- The country suffix on the label ----------------------------------------------------------
t('two lists label each shop with its country; one list does not', () => {
  // The control is a type-to-search box, so the country goes in the TEXT — typing "leb"
  // narrows to Lebanon's shops. A heading would be invisible the moment anyone typed.
  assert.ok(/— Jordan /.test(asW(F.branchOptionsFor(twoCountry, null))[0].label));
  assert.ok(!/—/.test(asW(F.branchOptionsFor(twoCountry, 'Jordan'))[0].label),
    'the country is still suffixed once there is only one list to show');
  assert.ok(!/—/.test(asW(F.branchOptionsFor(oneCountry, null))[0].label));
});

// ---- The record editors --------------------------------------------------------------------------
t('the country answer is found by TYPE, so a renamed question still answers', () => {
  const fields = [{ id: 'c1', type: 'country' }, { id: 'b1', type: 'branch' }];
  assert.strictEqual(D.countryAnswerIn(fields, { c1: 'Lebanon' }), 'Lebanon');
  assert.strictEqual(D.countryAnswerIn(fields, {}), null);
  assert.strictEqual(D.countryAnswerIn(fields, null), null);
  assert.strictEqual(D.countryAnswerIn([{ id: 'b1', type: 'branch' }], { c1: 'Lebanon' }), null);
});
t('only a table asking BOTH has anything to narrow', () => {
  assert.strictEqual(D.needsBranchScope([{ type: 'country' }, { type: 'branch' }]), true);
  assert.strictEqual(D.needsBranchScope([{ type: 'branch' }]), false);
  assert.strictEqual(D.needsBranchScope([{ type: 'country' }]), false);
  assert.strictEqual(D.needsBranchScope([]), false);
  assert.strictEqual(D.needsBranchScope(null), false);
});
t('a shop the record already names is never taken off its list', () => {
  // An editor that cannot show what is saved is worse than one offering a stale choice —
  // and 226 imported tables have shops that predate every one of these rules.
  const a = grab(SRC, 'applyBranchScope');
  assert.ok(/if \(was && names\.indexOf\(was\) === -1\) names\.push\(was\)/.test(a), 'a stored shop can vanish from the box');
  const e = grab(SRC, 'edFieldRowHtml');
  assert.ok(/if \(v && brOpts\.indexOf\(v\) < 0\) brOpts\.push\(v\)/.test(e), 'a stored shop is missing when the record opens');
});
t('a NEW record narrows strictly, because it has nothing stored to protect', () => {
  assert.ok(/applyBranchScope\(asked, cur, null\)/.test(SRC), 'the new-record panel protects a stored value it cannot have');
});
t('a shop that is neither this country\'s nor the stored one is cleared, not left showing', () => {
  // A box still reading "Abdoun" under Lebanon submits a Jordanian shop against a Lebanese
  // record, which is the mistake all of this exists to prevent.
  const a = grab(SRC, 'applyBranchScope');
  assert.ok(/if \(names\.indexOf\(now\) === -1\) sel\.value = ""/.test(a), 'an invalid shop stays chosen');
});
t('the public form drops it too, rather than leaving the text in the box', () => {
  const c = grab(FSRC, 'buildCombo');
  assert.ok(/setOptions/.test(c), 'the combo cannot be re-scoped at all');
  assert.ok(/if \(value && !options\.some\(function \(o\) \{ return o\.value === value; \}\)\) \{ value = ""; input\.value = ""; \}/.test(c),
    'a choice that left the list stays in the box');
});
t('both editors are wired even when the table has no conditional and no score', () => {
  // Those two are what used to wire the change listener. A table with a country and a branch
  // and neither of them would narrow once, when the record opened, and never again.
  const occurrences = (SRC.match(/\|\| needsBranchScope\(/g) || []).length;
  assert.strictEqual(occurrences, 2, 'expected the record panel and the new-record panel, found ' + occurrences);
});

console.log(n + ' branch-country-scope tests passed');
