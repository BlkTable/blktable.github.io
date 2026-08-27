// A form covers one country, or several. It is never a table per country.
//
// Until 2026-08-03 every table carried an appended `Country` question — 260 forms asked it,
// 4 records ever answered, and 10 of those 14 answers said "Jordan". So the country became a
// property of the FORM, stamped by the trigger, and the question went away.
//
// That left one gap, which this file now covers: a form used in TWO countries. It used to be
// answered by "shared with franchisees" — a parent form plus one sub-table per country, five
// tables for one form, records split five ways. It is answered now by ticking two countries
// on ONE table: the form asks which, the trigger stamps the answer, and the sidebar lists the
// countries underneath the single table the way Job Applications lists them.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
// brace-matching rather than regex, so a one-line function does not swallow the next one
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
function grabVar(js,name){const m=js.match(new RegExp('\\n  var '+name+' = [\\s\\S]*?;(?=\\r?\\n)'));if(!m)throw new Error('no var '+name);return m[0];}
function load(names,vars,extra){const js=scripts('index.html');const body=(vars||[]).map(v=>grabVar(js,v)).join('\n')+'\n'+names.map(n=>grab(js,n)).join('\n');const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+body+'\nthis.API={'+names.concat(vars||[]).join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const SRC = scripts('index.html');
const FSRC = scripts('f/index.html');
const API = load(
  ['rebuildCountryIndex','canonicalCountry','tableCountry','tableCountries','branchListMismatch','branchOpen',
   'builderConfig','fieldRowsFor','scopeCountry','scopeAsks','countryQuestionRow','countryQuestionOf',
   'countryChoiceNames','countryLabel'],
  ['DEFAULT_COUNTRIES','COUNTRY_LIST','COUNTRY_INDEX','COUNTRY_Q_LABEL','COUNTRY_Q_LABEL_AR'],
  // builderConfig reads the four serializers off the builder's DOM; stubbed with markers so
  // what it does with them is visible.
  { serializeStages: () => ['S'], serializeActions: () => ['A'], serializeLayers: () => ['L'], serializeIntro: () => ({ en: 'i' }), serializeDecision: () => ({ on: false }) }
);
API.rebuildCountryIndex();
const asW = o => JSON.parse(JSON.stringify(o));
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- The table-per-country builder is gone ------------------------------------------
t('nothing in the app creates a table per country any more', () => {
  // This is the whole point of the change. createFranchiseFamily made a parent plus one
  // table for every country on file — five tables for one form, and five sets of records
  // that then had to be read five at a time.
  assert.ok(!/createFranchiseFamily/.test(SRC), 'createFranchiseFamily is still here');
  assert.ok(!/isFranchiseParent/.test(SRC), 'isFranchiseParent is still here');
  assert.ok(!/bld-franchise/.test(SRC), 'the "shared with franchisees" tick is still in the markup');
});
t('no config.franchise is written anywhere', () => {
  // Zero rows in the live database carry it; writing a new one would resurrect the split
  // one table at a time.
  assert.ok(!/franchise:\s*\{/.test(SRC), 'something still writes config.franchise');
});
t('nothing appends a Country question to every new form', () => {
  // The old behaviour that put a question on 260 forms. A country field is written in
  // exactly ONE place now: countryQuestionRow, which only a multi-country form reaches.
  const writes = SRC.match(/type:\s*"country"/g) || [];
  assert.strictEqual(writes.length, 1, 'a country field is written in ' + writes.length + ' places — only countryQuestionRow should write one');
  assert.ok(/type:\s*"country"/.test(grab(SRC, 'countryQuestionRow')), 'the one country field written is not countryQuestionRow\'s');
});

// ---- One country, or several ---------------------------------------------------------
t('one country is stamped on the table; several make the form ask', () => {
  // The threshold IS the feature. One country needs no question because the table already
  // says which; two cannot be told apart by anything except an answer.
  assert.strictEqual(API.scopeAsks(['jo']), false);
  assert.strictEqual(API.scopeAsks(['jo', 'iraq']), true);
  assert.strictEqual(API.scopeAsks([]), false);
  assert.strictEqual(API.scopeAsks(null), false);
});
t('config.country is derived, and only means something for exactly one country', () => {
  // The database trigger's last step and the country-scoped access check both read this
  // one key. With two countries it would have to pick one and be wrong half the time, so
  // it goes null and the ANSWER decides instead.
  assert.strictEqual(API.scopeCountry(['jo']), 'jo');
  assert.strictEqual(API.scopeCountry(['jo', 'iraq']), null);
  assert.strictEqual(API.scopeCountry([]), null);
  assert.strictEqual(API.scopeCountry(null), null);
});
t('creating writes the list AND the derived single country', () => {
  const s = grab(SRC, 'runBuilderSave');
  assert.ok(/countries: scope\.countries, country: scopeCountry\(scope\.countries\)/.test(s),
    'the create path does not write both keys, so the trigger has nothing to read');
});
t('creating with no country ticked is refused', () => {
  // A silent default would stamp every new form Jordan and nobody would notice until the
  // country list under the table lied.
  const s = grab(SRC, 'runBuilderSave');
  assert.ok(/if \(!scope\.countries\.length\)/.test(s), 'an empty tick list is not checked');
  const at = s.indexOf('if (!scope.countries.length)'), ins = s.indexOf('app_tables").insert');
  assert.ok(at !== -1 && at < ins, 'the check happens after the table is already written');
});

// ---- The question a multi-country form asks -------------------------------------------
t('the country question comes first and is required', () => {
  // First because it decides how the rest of the form reads; required because it is the
  // only thing that can say which country a record belongs to once one link serves both.
  const r = asW(API.countryQuestionRow('T', ['jo', 'iraq']));
  assert.strictEqual(r.position, 0);
  assert.strictEqual(r.required, true);
  assert.strictEqual(r.type, 'country');
  assert.strictEqual(r.internal, false, 'a staff-only question cannot be answered by the public');
});
t('the question offers the countries the form was built for, and no others', () => {
  // 195 choices where two are meant is how a Jordan-and-Iraq form collects a Syria record
  // that no reviewer can account for.
  assert.deepStrictEqual(asW(API.countryQuestionRow('T', ['jo', 'iraq']).options), { only: ['jo', 'iraq'] });
});
t('options.only is a copy, so editing the ticks cannot rewrite a written row', () => {
  const codes = ['jo', 'iraq'];
  const r = API.countryQuestionRow('T', codes);
  codes.push('syria');
  assert.deepStrictEqual(asW(r.options.only), ['jo', 'iraq']);
});
t('the designed questions shift down to leave room for it', () => {
  const s = grab(SRC, 'runBuilderSave');
  assert.ok(/fieldRowsFor\(tid, fields, asks \? 1 : 0\)/.test(s), 'the designed questions are not shifted');
  assert.ok(/writePendingConds\(tid, fields, asks \? 1 : 0\)/.test(s), 'conditions are resolved against the unshifted positions');
});
t('the country question is found by TYPE, not by its label', () => {
  // The label is editable; a renamed question is still the one that answers.
  assert.strictEqual(API.countryQuestionOf([{ id: 'a', type: 'short_text' }, { id: 'b', type: 'country', options: { only: ['jo'] } }]).id, 'b');
  assert.strictEqual(API.countryQuestionOf([{ id: 'a', type: 'short_text' }]), null);
  assert.strictEqual(API.countryQuestionOf([]), null);
  assert.strictEqual(API.countryQuestionOf(null), null);
});
t('a hand-added country question is NOT mistaken for the automatic one', () => {
  // "Which country are you interested in franchising in?" is a real question on a real
  // form and means anywhere in the world. Deleting it because somebody unticked a country
  // would take a question nobody asked about with it — `options.only` is what tells them apart.
  assert.strictEqual(API.countryQuestionOf([{ id: 'a', type: 'country', options: null }]), null);
  assert.strictEqual(API.countryQuestionOf([{ id: 'a', type: 'country' }]), null);
});

// ---- Editing: adding, changing and removing the question --------------------------------
t('editing reconciles the question with the ticks in all three directions', () => {
  const s = grab(SRC, 'saveTableEdit');
  assert.ok(/if \(asksNow && !editingCountryFieldId\) toInsert\.push\(countryQuestionRow/.test(s), 'a second country does not add the question');
  assert.ok(/else if \(asksNow\)[\s\S]{0,160}only: editCountries/.test(s), 'changing the countries does not update what the question offers');
  assert.ok(/else if \(editingCountryFieldId\) toDelete\.push\(editingCountryFieldId\)/.test(s), 'dropping back to one country leaves the question standing');
});
t('editing writes the list and the derived country, and can clear both', () => {
  // 226 imported tables have no country; one ticked by mistake must be removable.
  const s = grab(SRC, 'saveTableEdit');
  assert.ok(/countries: editCountries, country: scopeCountry\(editCountries\)/.test(s), 'the countries are not saved, or cannot be cleared');
});
t('the country question is held back from the editable rows', () => {
  // Shown as an ordinary row, somebody could untick every country and still leave the
  // question standing, asking about a country nothing then records.
  const o = grab(SRC, 'openBuilderEdit');
  assert.ok(/countryQuestionOf\(fields\)/.test(o), 'the country question is not identified when the editor opens');
  assert.ok(/editingCountryFieldId = cq \? cq\.id : null/.test(o), 'its id is not remembered, so the save cannot update it');
  assert.ok(/fields\.filter\(function \(f\) \{ return f\.id !== cq\.id; \}\)/.test(o), 'it is still shown as an editable question');
});
t('a held-back question is not counted as a question the user deleted', () => {
  // toDelete is built from editingFieldIds. Filtering the row out BEFORE that array is
  // filled is what keeps a save from dropping the question every single time.
  const o = grab(SRC, 'openBuilderEdit');
  assert.ok(o.indexOf('editingCountryFieldId = cq') < o.indexOf('editingFieldIds.push'),
    'the country question is filtered out after the id list is built, so every save would delete it');
});
t('editing applies the same offset to the rows and to the conditions', () => {
  // Off by one here is a question gated on the answer to a DIFFERENT question, which no
  // test of the public form would catch — both pages would agree, and both be wrong.
  const s = grab(SRC, 'saveTableEdit');
  assert.ok(/var off = asksNow \? 1 : 0/.test(s), 'the edit path does not offset at all');
  assert.ok(/var pos = f\.position \+ off/.test(s), 'the rows are written at their unshifted positions');
  assert.ok(/writePendingConds\(tid, fields, off\)/.test(s), 'conditions are resolved against the unshifted positions');
});
t('a built-in form is never given a country question', () => {
  // Job Applications carries a country per applicant already, and Casting is one board.
  const s = grab(SRC, 'saveTableEdit');
  assert.ok(/var asksNow = builderMode !== "builtin"/.test(s), 'a built-in form can be given one');
  assert.ok(/if \(builderMode !== "builtin"\) \{\s*\n\s*if \(asksNow && !editingCountryFieldId\)/.test(s), 'the reconcile runs for built-in forms too');
});

// ---- What the question offers, on both pages ---------------------------------------------
t('a scoped country question offers exactly its own countries', () => {
  assert.deepStrictEqual(API.countryChoiceNames({ options: { only: ['jo', 'iraq'] } }), ['Jordan', 'Iraq']);
  assert.deepStrictEqual(API.countryChoiceNames({ options: { only: ['lebanon'] } }), ['Lebanon']);
});
t('an unscoped country question still offers every country on file', () => {
  const all = API.COUNTRY_LIST.map(c => c.name_en);
  assert.deepStrictEqual(API.countryChoiceNames({ options: null }), all);
  assert.deepStrictEqual(API.countryChoiceNames({}), all);
  assert.deepStrictEqual(API.countryChoiceNames(null), all);
});
t('a code with no country row is dropped rather than shown raw', () => {
  // A country deleted from the manager after a form was built would otherwise print its
  // code as a choice, which nobody can pick deliberately.
  assert.deepStrictEqual(API.countryChoiceNames({ options: { only: ['jo', 'atlantis'] } }), ['Jordan']);
});
t('the public form scopes the same question the same way', () => {
  // Two pages render this field and both must narrow it. The dashboard agreeing with
  // itself while /f/ offers 195 countries is the failure this catches.
  assert.ok(/function countryChoiceNames/.test(FSRC), 'the public form has no scoped country list');
  assert.ok(/f\.type === "country" \? countryChoiceNames\(f\)/.test(FSRC), 'the public form still renders the full world list');
  assert.ok(/COUNTRY_NAMES_ALL/.test(FSRC), 'the full world list is gone, so an unscoped country question has nothing to offer');
});
t('the public form takes its names from the countries table, not a second hard-coded list', () => {
  const f = grab(FSRC, 'countryChoiceNames');
  assert.ok(/COUNTRY_ROWS/.test(f), 'there is a second country list here to keep in step');
});

// ---- builderConfig / fieldRowsFor ---------------------------------------------------
t('builderConfig always writes the five builder keys', () => {
  const c = asW(API.builderConfig());
  assert.deepStrictEqual(Object.keys(c).sort(), ['actions', 'decision', 'intro', 'layers', 'statuses']);
});
t('builderConfig adds what this save adds, and skips a null', () => {
  assert.strictEqual(API.builderConfig({ country: 'jo' }).country, 'jo');
  assert.ok(!('country' in API.builderConfig({ country: null })), 'a null country is written as a key');
  assert.deepStrictEqual(asW(API.builderConfig({ countries: ['jo', 'iraq'] }).countries), ['jo', 'iraq']);
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
  const w = grab(SRC, 'writePendingConds');
  assert.ok(/byPos\[f\.condOnIdx \+ off\]/.test(w), 'the controlling row is looked up without the offset');
  assert.ok(/byPos\[f\.position \+ off\]/.test(w), 'the conditional row is looked up without the offset');
});

// ---- Reading the countries off a table ------------------------------------------------
t('tableCountry folds whatever spelling the config holds', () => {
  assert.strictEqual(API.tableCountry({ config: { country: 'jo' } }), 'jo');
  assert.strictEqual(API.tableCountry({ config: { country: 'lb' } }), 'lebanon');
  assert.strictEqual(API.tableCountry({ config: { country: 'Lebanon' } }), 'lebanon');
});
t('a country nobody has heard of reads as not set, not as itself', () => {
  assert.strictEqual(API.tableCountry({ config: { country: 'atlantis' } }), null);
});
t('no config, no country, nothing at all — all read as not set', () => {
  assert.strictEqual(API.tableCountry({ config: {} }), null);
  assert.strictEqual(API.tableCountry({}), null);
  assert.strictEqual(API.tableCountry(null), null);
});
t('tableCountries reads the list where there is one', () => {
  assert.deepStrictEqual(asW(API.tableCountries({ config: { countries: ['jo', 'iraq'] } })), ['jo', 'iraq']);
});
t('a table written before the list existed still reads as its one country', () => {
  // Every table created up to now carries config.country and no list. Reading only the
  // list would show all 226 of them as having no country the next time one was edited —
  // and then save that back.
  assert.deepStrictEqual(asW(API.tableCountries({ config: { country: 'jo' } })), ['jo']);
  assert.deepStrictEqual(asW(API.tableCountries({ config: {} })), []);
  assert.deepStrictEqual(asW(API.tableCountries({})), []);
  assert.deepStrictEqual(asW(API.tableCountries(null)), []);
});
t('the list wins over the derived key, never the other way round', () => {
  // They are written together and cannot normally disagree; if they ever do, the list is
  // what the person ticked.
  assert.deepStrictEqual(asW(API.tableCountries({ config: { countries: ['jo', 'iraq'], country: null } })), ['jo', 'iraq']);
  assert.deepStrictEqual(asW(API.tableCountries({ config: { countries: [], country: 'jo' } })), []);
});
t('tableCountries hands back a copy, not the config\'s own array', () => {
  const cfg = { countries: ['jo'] };
  API.tableCountries({ config: cfg }).push('iraq');
  assert.deepStrictEqual(cfg.countries, ['jo']);
});
t('the table is the LAST word on a record country, never the first', () => {
  // A branch or an answer on the record itself is better evidence than a property of the
  // form, and the database's trigger orders it the same way for the same reason.
  const rc = grab(SRC, 'recordCountry');
  const iCol = rc.indexOf('s.country'), iBranch = rc.indexOf('recordBranch'), iTbl = rc.indexOf('config.country');
  assert.ok(iCol < iBranch && iBranch < iTbl, 'the form\'s country is consulted before the record\'s own evidence');
});
t('the table fallback survives being lifted out of the page', () => {
  const rc = grab(SRC, 'recordCountry');
  assert.ok(/typeof currentCustom !== "undefined"/.test(rc), 'currentCustom is read without a guard');
});

// ---- The builder's own chrome ---------------------------------------------------------
t('the country picker is built from the countries on file', () => {
  const f = grab(SRC, 'fillBuilderCountries');
  assert.ok(/COUNTRY_LIST\.map/.test(f), 'there is a second hard-coded country list here');
  assert.ok(/class="bld-co"/.test(f), 'the ticks are not the ones builderScope reads');
});
t('nothing ticked is a real answer and is left ticked-off, not defaulted', () => {
  // 226 imported tables have no country and must not silently acquire one on the next save
  // of an unrelated question.
  const f = grab(SRC, 'fillBuilderCountries');
  assert.ok(/var on = codes \|\| \[\]/.test(f), 'a table with no country would throw here');
  assert.ok(!/checked" : ""[\s\S]{0,40}COUNTRY_LIST\[0\]/.test(f), 'a country is pre-ticked');
});
t('the note says what one country and several each mean', () => {
  // The difference is invisible until somebody has already filled the form in.
  const s = grab(SRC, 'syncScopeNote');
  assert.ok(/does not ask/.test(s), 'the one-country case does not say the form stays silent');
  assert.ok(/asks which country/.test(s), 'the several-countries case does not say the form asks');
  assert.ok(/codes\.length === 1/.test(s), 'the note does not distinguish the two');
});
t('the countries a table covers are shown on its header', () => {
  const o = grab(SRC, 'openCustomTable');
  assert.ok(/tableCountries\(t\)\.map/.test(o), 'the header shows at most one country');
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
  const w = grab(SRC, 'wireBranchRows');
  assert.ok(/if \(!v\) \{ name\.value = was\.name; return; \}/.test(w), 'an empty name is written');
});
t('a failed write puts the old value back and says so', () => {
  const w = grab(SRC, 'wireBranchRows');
  assert.ok(/undo\(\);/.test(w) && /window\.alert/.test(w), 'a refused write leaves the screen claiming something the database did not accept');
});
t('adding a shop that is already on the list is refused, and says if it is switched off', () => {
  const w = grab(SRC, 'wireBranchRows');
  assert.ok(/is already on/.test(w), 'a duplicate name is accepted');
  assert.ok(/switch it back on/.test(w), 'a closed namesake is not explained');
});
t('a write to the branch list refreshes the array every reader shares', () => {
  const r = grab(SRC, 'reloadBranches');
  assert.ok(/allBranches = res\.data/.test(r), 'the shared array is not updated');
  assert.ok(/renderCountriesManager\(\)/.test(r), 'the panel is not redrawn');
});

// ---- Countries manager: a shop filed under the wrong country -------------------------
t('a shop whose name names another country is flagged', () => {
  assert.strictEqual(API.branchListMismatch({ name: 'Jal el Deeb - Lebanon', list_key: 'jo' }), 'Lebanon');
});
t('a shop in the country its own name says is not flagged', () => {
  assert.strictEqual(API.branchListMismatch({ name: 'Jal el Deeb - Lebanon', list_key: 'lebanon' }), null);
  assert.strictEqual(API.branchListMismatch({ name: 'Abdoun', list_key: 'jo' }), null);
});
t('the flag is case-insensitive and survives a missing list', () => {
  assert.strictEqual(API.branchListMismatch({ name: 'Basra IRAQ branch', list_key: 'jo' }), 'Iraq');
  assert.strictEqual(API.branchListMismatch({ name: 'Beirut Lebanon' }), 'Lebanon');
});
t('nothing at all is not a mismatch', () => {
  assert.strictEqual(API.branchListMismatch({}), null);
  assert.strictEqual(API.branchListMismatch(null), null);
});

console.log(n + ' form-country tests passed');
