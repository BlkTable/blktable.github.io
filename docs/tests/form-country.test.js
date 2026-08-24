// A form belongs to a country; the person filling it in is not asked.
//
// Until now every table carried an appended `Country` question — 260 forms asked it, 4
// records ever answered, and 10 of those 14 answers said "Jordan". The country is a
// property of the FORM, so it lives on the table (`config.country`) and the trigger stamps
// it. A form shared with franchisees is the exception: a family of forms, one that asks the
// country in front of the questions and one per country that does not need to.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
// brace-matching rather than regex, so a one-line function does not swallow the next one
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
function grabVar(js,name){const m=js.match(new RegExp('\\n  var '+name+' = [\\s\\S]*?;(?=\\r?\\n)'));if(!m)throw new Error('no var '+name);return m[0];}
function load(names,vars,extra){const js=scripts('index.html');const body=(vars||[]).map(v=>grabVar(js,v)).join('\n')+'\n'+names.map(n=>grab(js,n)).join('\n');const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+body+'\nthis.API={'+names.concat(vars||[]).join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const SRC = scripts('index.html');
const API = load(
  ['rebuildCountryIndex','canonicalCountry','tableCountry','isFranchiseParent','branchListMismatch','branchOpen','builderConfig','fieldRowsFor'],
  ['DEFAULT_COUNTRIES','COUNTRY_LIST','COUNTRY_INDEX'],
  // builderConfig reads the four serializers off the builder's DOM; stubbed with markers so
  // what it does with them is visible.
  { serializeStages: () => ['S'], serializeActions: () => ['A'], serializeLayers: () => ['L'], serializeIntro: () => ({ en: 'i' }) }
);
API.rebuildCountryIndex();
const asW = o => JSON.parse(JSON.stringify(o));
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- The question is gone -----------------------------------------------------------
t('nothing appends a Country question to a new table any more', () => {
  assert.ok(!/Every new table collects a Country/.test(SRC), 'the old auto-append comment is still there');
  // The ONE place a country field is written is the parent of a franchise family, where it
  // is the point of the form. A second `type: "country"` insert is the old behaviour coming
  // back — which is what put a question on 260 forms.
  const writes = SRC.match(/type:\s*"country"/g) || [];
  assert.strictEqual(writes.length, 1, 'a country field is written in ' + writes.length + ' places — only the franchise parent should write one');
  const fam = grab(SRC, 'createFranchiseFamily');
  assert.ok(/type:\s*"country"/.test(fam), 'the one country field written is not the franchise parent\'s');
});
t('the country question the parent form asks is required and comes first', () => {
  // First because it decides how the rest of the form reads, required because this is the
  // one form where the link cannot say which country it is — an unanswered country here is
  // a record nobody can file.
  const fam = grab(SRC, 'createFranchiseFamily');
  const m = fam.match(/position:\s*0,\s*label:\s*"Country"[\s\S]{0,160}?required:\s*(true|false)/);
  assert.ok(m, 'the parent country question is not written at position 0');
  assert.strictEqual(m[1], 'true', 'the parent country question is not required');
  assert.ok(/fieldRowsFor\(parentRow\.id,\s*fields,\s*1\)/.test(fam), 'the designed questions are not shifted down to leave room for it');
});

// ---- Creating: one country, or a family --------------------------------------------
t('creating a form that is not shared refuses to go ahead with no country', () => {
  // "determine which country this form is for" is the whole point; a silent default would
  // stamp every new form Jordan and nobody would notice until the country tabs lied.
  const st = grab(SRC, "runBuilderSave");
  assert.ok(/if \(!scope\.country\)/.test(st), 'the country is not checked');
  assert.ok(/Pick which country this form is for/.test(st), 'nothing tells the person what is missing');
  const at = st.indexOf('if (!scope.country)'), ins = st.indexOf('app_tables").insert');
  assert.ok(at !== -1 && at < ins, 'the check happens after the table is already written');
});
t('the shared path is taken before the country check, not after', () => {
  // Ticking "shared with franchisees" disables the country picker, so a country check
  // reached first would refuse the very case it does not apply to.
  const st = grab(SRC, "runBuilderSave");
  assert.ok(st.indexOf('if (scope.shared)') < st.indexOf('if (!scope.country)'), 'a shared form would be refused for having no country');
});
t('a sub-form carries its country and points back at the parent', () => {
  const fam = grab(SRC, 'createFranchiseFamily');
  assert.ok(/country:\s*c\.code/.test(fam), 'a sub-form does not record which country it is for');
  assert.ok(/franchise:\s*\{\s*of:\s*parentRow\.id\s*\}/.test(fam), 'a sub-form does not name its parent');
  assert.ok(/franchise:\s*\{\s*shared:\s*true\s*\}/.test(fam), 'the parent is not marked as the shared form');
});
t('the sub-forms are created one at a time, and each gets its own slug', () => {
  // Fired together, N inserts sharing a slug prefix are N ways to collide.
  const fam = grab(SRC, 'createFranchiseFamily');
  assert.ok(/\.reduce\(/.test(fam), 'the countries are not chained');
  assert.ok(!/Promise\.all/.test(fam), 'the sub-forms are fired together');
  assert.ok(/base \+ "-" \+ c\.code \+ "-" \+ rnd\(\)/.test(fam), 'a sub-form slug does not carry the country and a random tail');
});
t('a family that fails half way says what it DID create', () => {
  // "Could not create the form" after three of five exist sends somebody looking for
  // nothing, and the three that exist are real forms with real links.
  const fam = grab(SRC, 'createFranchiseFamily');
  assert.ok(/Stopped after creating: " \+ made\.join/.test(fam), 'the failure does not name what was created');
  assert.ok(/if \(made\.length\) loadCustomTables\(\)/.test(fam), 'the sidebar is not refreshed, so the forms that exist stay invisible');
});
t('no countries on file is refused rather than creating a lone parent', () => {
  const fam = grab(SRC, 'createFranchiseFamily');
  assert.ok(/if \(!countries\.length\)/.test(fam), 'an empty country list is not checked');
});

// ---- builderConfig / fieldRowsFor ---------------------------------------------------
t('builderConfig always writes the four builder keys', () => {
  const c = asW(API.builderConfig());
  assert.deepStrictEqual(Object.keys(c).sort(), ['actions', 'intro', 'layers', 'statuses']);
});
t('builderConfig adds what this save adds, and skips a null', () => {
  assert.strictEqual(API.builderConfig({ country: 'jo' }).country, 'jo');
  assert.ok(!('country' in API.builderConfig({ country: null })), 'a null country is written as a key');
  assert.deepStrictEqual(asW(API.builderConfig({ franchise: { shared: true } }).franchise), { shared: true });
});
t('fieldRowsFor stamps the table on every row and keeps the order', () => {
  const rows = asW(API.fieldRowsFor('T', [
    { position: 0, label: 'A', label_ar: null, type: 'short_text', required: true, internal: false, options: null, show_if: null },
    { position: 1, label: 'B', label_ar: 'ب', type: 'number', required: false, internal: true, options: null, show_if: null }
  ], 0));
  assert.deepStrictEqual(rows.map(r => [r.table_id, r.position, r.label]), [['T', 0, 'A'], ['T', 1, 'B']]);
  assert.strictEqual(rows[1].internal, true);
});
t('fieldRowsFor offsets every position by the same amount', () => {
  const rows = API.fieldRowsFor('T', [{ position: 0, label: 'A' }, { position: 1, label: 'B' }], 1);
  assert.deepStrictEqual(asW(rows).map(r => r.position), [1, 2]);
});
t('no offset and an offset of nothing mean the same thing', () => {
  const a = asW(API.fieldRowsFor('T', [{ position: 3, label: 'A' }]));
  const b = asW(API.fieldRowsFor('T', [{ position: 3, label: 'A' }], 0));
  assert.deepStrictEqual(a, b);
});
t('nothing to write is an empty list, not a throw', () => {
  assert.deepStrictEqual(asW(API.fieldRowsFor('T', null, 1)), []);
});
t('a condition points at a row, so the offset is applied to it too', () => {
  // Off by one here is a question gated on the answer to a DIFFERENT question, which no
  // test of the public form would catch — both pages would agree, and both be wrong.
  const w = grab(SRC, 'writePendingConds');
  assert.ok(/byPos\[f\.condOnIdx \+ off\]/.test(w), 'the controlling row is looked up without the offset');
  assert.ok(/byPos\[f\.position \+ off\]/.test(w), 'the conditional row is looked up without the offset');
});

// ---- Reading the country off a table ------------------------------------------------
t('tableCountry folds whatever spelling the config holds', () => {
  assert.strictEqual(API.tableCountry({ config: { country: 'jo' } }), 'jo');
  assert.strictEqual(API.tableCountry({ config: { country: 'lb' } }), 'lebanon');
  assert.strictEqual(API.tableCountry({ config: { country: 'Lebanon' } }), 'lebanon');
});
t('a country nobody has heard of reads as not set, not as itself', () => {
  // Otherwise the header prints a code and the country tabs grow a group of one.
  assert.strictEqual(API.tableCountry({ config: { country: 'atlantis' } }), null);
});
t('no config, no country, nothing at all — all read as not set', () => {
  assert.strictEqual(API.tableCountry({ config: {} }), null);
  assert.strictEqual(API.tableCountry({}), null);
  assert.strictEqual(API.tableCountry(null), null);
});
t('only the shared form of a family reads as the all-countries one', () => {
  assert.strictEqual(API.isFranchiseParent({ config: { franchise: { shared: true } } }), true);
  assert.strictEqual(API.isFranchiseParent({ config: { franchise: { of: 'abc' } } }), false);
  assert.strictEqual(API.isFranchiseParent({ config: { country: 'jo' } }), false);
  assert.strictEqual(API.isFranchiseParent(null), false);
});
t('the table is the LAST word on a record country, never the first', () => {
  // A branch or an answer on the record itself is better evidence than a property of the
  // form, and the database's trigger orders it the same way for the same reason.
  const rc = grab(SRC, 'recordCountry');
  const iCol = rc.indexOf('s.country'), iBranch = rc.indexOf('recordBranch'), iTbl = rc.indexOf('config.country');
  assert.ok(iCol < iBranch && iBranch < iTbl, 'the form\'s country is consulted before the record\'s own evidence');
});
t('the table fallback survives being lifted out of the page', () => {
  // It reads `currentCustom`, which does not exist outside the app — an unguarded reference
  // would throw for every caller here, which is exactly how this was caught.
  const rc = grab(SRC, 'recordCountry');
  assert.ok(/typeof currentCustom !== "undefined"/.test(rc), 'currentCustom is read without a guard');
});

// ---- Countries manager: shops --------------------------------------------------------
t('a shop can never be deleted from this panel', () => {
  // Its name is the answer on every record ever filed against it. Deleting the row leaves
  // those records naming something that does not exist; switching it off does not.
  assert.ok(!/from\("branches"\)\s*\.?\s*\n?\s*\.delete\(/.test(SRC), 'something deletes a branch row');
  assert.ok(!/\.from\("branches"\)\.delete\(/.test(SRC), 'something deletes a branch row');
});
t('moving a shop to another country is confirmed first', () => {
  const w = grab(SRC, 'wireBranchRows');
  assert.ok(/window\.confirm/.test(w), 'a country change is not confirmed');
  assert.ok(/list\.value = was\.list_key; return;/.test(w), 'declining the confirm leaves the select showing the new country');
});
t('a shop cannot be renamed to nothing', () => {
  // A nameless choice on 28 forms reads as a blank line nobody can pick deliberately.
  const w = grab(SRC, 'wireBranchRows');
  assert.ok(/if \(!v\) \{ name\.value = was\.name; return; \}/.test(w), 'an empty name is written');
});
t('a failed write puts the old value back and says so', () => {
  const w = grab(SRC, 'wireBranchRows');
  assert.ok(/undo\(\);/.test(w) && /window\.alert/.test(w), 'a refused write leaves the screen claiming something the database did not accept');
});
t('adding a shop that is already on the list is refused, and says if it is switched off', () => {
  // Two shops of one name in one country are two choices nobody can tell apart, and the
  // usual cause is somebody re-adding a shop that was closed rather than reopening it.
  const w = grab(SRC, 'wireBranchRows');
  assert.ok(/is already on/.test(w), 'a duplicate name is accepted');
  assert.ok(/switch it back on/.test(w), 'a closed namesake is not explained');
});
t('a write to the branch list refreshes the array every reader shares', () => {
  // Not just this panel: the sidebar tints, both record editors and the builder's checks
  // all read `allBranches`, so a shop added and not published there is a shop the form
  // still does not offer.
  const r = grab(SRC, 'reloadBranches');
  assert.ok(/allBranches = res\.data/.test(r), 'the shared array is not updated');
  assert.ok(/renderCountriesManager\(\)/.test(r), 'the panel is not redrawn');
});

// ---- Countries manager: a shop filed under the wrong country -------------------------
t('a shop whose name names another country is flagged', () => {
  // Real today: "Jal el Deeb - Lebanon" sits in the Jordan list, so Jordanian forms offer
  // it and its records are stamped Jordan.
  assert.strictEqual(API.branchListMismatch({ name: 'Jal el Deeb - Lebanon', list_key: 'jo' }), 'Lebanon');
});
t('a shop in the country its own name says is not flagged', () => {
  assert.strictEqual(API.branchListMismatch({ name: 'Jal el Deeb - Lebanon', list_key: 'lebanon' }), null);
  assert.strictEqual(API.branchListMismatch({ name: 'Abdoun', list_key: 'jo' }), null);
});
t('the flag is case-insensitive and survives a missing list', () => {
  assert.strictEqual(API.branchListMismatch({ name: 'Basra IRAQ branch', list_key: 'jo' }), 'Iraq');
  // no list_key at all means Jordan, which is what every row written before list_key said
  assert.strictEqual(API.branchListMismatch({ name: 'Beirut Lebanon' }), 'Lebanon');
});
t('nothing at all is not a mismatch', () => {
  assert.strictEqual(API.branchListMismatch({}), null);
  assert.strictEqual(API.branchListMismatch(null), null);
});

// ---- The builder's own chrome ---------------------------------------------------------
t('"shared with franchisees" is offered only while creating', () => {
  // Ticking it on an existing table would either do nothing or turn a Save button into four
  // new tables, and both are worse than not offering it.
  const c = grab(SRC, 'setBuilderChrome');
  assert.ok(/bld-franchise-lab[\s\S]{0,120}isCreate/.test(c), 'the tick is not hidden outside create');
  assert.ok(/fcb && !isCreate\) fcb\.checked = false/.test(c), 'a tick left over from a create survives into an edit');
});
t('editing a form can change its country, and can clear it', () => {
  // 226 imported tables have no country; one picked by mistake must be removable, so "Not
  // set" writes null rather than being skipped.
  const s = grab(SRC, 'saveTableEdit');
  assert.ok(/country: builderScope\(\)\.country \|\| null/.test(s), 'the country is not saved, or cannot be cleared');
});
t('the country picker is built from the countries on file, with "Not set" on it', () => {
  const f = grab(SRC, 'fillBuilderCountry');
  assert.ok(/COUNTRY_LIST\.map/.test(f), 'there is a second hard-coded country list here');
  assert.ok(/Not set/.test(f), 'a table with no country has nothing to show');
});
t('the tick says how many forms it is about to create, and names them', () => {
  const s = grab(SRC, 'syncFranchiseNote');
  assert.ok(/names\.length \+ 1/.test(s), 'the count does not include the all-countries form');
  assert.ok(/names\.join\(", "\)/.test(s), 'the countries are not named');
  assert.ok(/sel\.disabled = on/.test(s), 'the one-country picker stays live while shared is ticked');
});

console.log(n + ' form-country tests passed');
