// The countries listed under a table in the sidebar — which ones, in what order, and the
// two ways the rail managed to show nothing at all.
//
// Ticking a second country on a form is supposed to put those countries under the table in
// the sidebar, the way Job Applications has always listed its own. On the live database four
// tables cover more than one country, and only ONE of them (Shop Audit) had records in more
// than one:
//
//   Branches              covers jo + lebanon    rows: lebanon 3,  no country 31
//   Customer Complaints   covers jo + lebanon    rows: jo 1327,    no country 116
//   Shop Audit            covers jo + lebanon    rows: jo 23,      lebanon 2
//   Shop Spot Check (QC)  covers lebanon + jo    rows: lebanon 1585, jo 3, no country 3
//
// The rail was built from the RECORDS alone (`table_facets`), so three of those four listed
// one country, failed the "more than one" test and drew nothing — a form ticked for two
// countries with nothing under it. It now reads the countries the table COVERS as well, so
// the rail is there from the day the form is made, and a country that has since been
// un-ticked keeps its rows on it.
//
// The second way it showed nothing was the fold, and that is DOM and events, so it lives in
// country-rail.chrome.js. What is checkable here is read out of the page as source.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/country-rail.test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
function grabVar(js,name){const m=js.match(new RegExp('var '+name+' = \\[[\\s\\S]*?\\n  \\];'));if(!m)throw new Error('no var '+name);return m[0];}
const SRC = scripts('index.html');

// The country lists are the page's own, lifted as source: a test that re-typed them would
// go on passing after the app changed its mind about what a country code is. `jo` is a
// code, `lebanon` is a code — they are NOT ISO pairs, which is exactly the trap that makes
// re-typing them dangerous.
const ctx = { console };
vm.createContext(ctx);
new vm.Script(
  ['scopeCountryCodes', 'countryFlag', 'tableCountries'].map(grab.bind(null, SRC)).join('\n') + '\n' +
  grabVar(SRC, 'DEFAULT_COUNTRIES') + '\n' + grabVar(SRC, 'COUNTRIES') + '\n' +
  'var COUNTRY_LIST = DEFAULT_COUNTRIES.slice();\n' +
  'var customFacets = { countries: {} };\n' +
  'function setFacets(c) { customFacets = { countries: c }; }\n' +
  'this.API = { scopeCountryCodes: scopeCountryCodes, countryFlag: countryFlag,' +
  '             tableCountries: tableCountries, setFacets: setFacets,' +
  '             COUNTRY_LIST: COUNTRY_LIST };'
).runInContext(ctx);
const API = ctx.API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// A table as the app sees it, and the rule the rail applies to the answer.
const tbl = (countries) => ({ id: 'x', config: countries === null ? {} : { countries: countries } });
// Arrays built inside the vm are a different realm's Array, so they are compared as data.
const asW = o => JSON.parse(JSON.stringify(o));
const rail = (t2, facets) => { API.setFacets(facets || {}); return asW(API.scopeCountryCodes(t2)); };
const meaningful = (codes) => codes.filter(c => c !== '__none').length > 1;

// ---- the four multi-country tables on the live database ---------------------------------
t('Shop Audit: records in two countries, both listed', () => {
  const codes = rail(tbl(['jo', 'lebanon']), { jo: 23, lebanon: 2 });
  assert.deepStrictEqual(codes, ['jo', 'lebanon']);
  assert.ok(meaningful(codes), 'two countries must draw the rail');
});

t('Customer Complaints: ticked for two, records in one — both are still listed', () => {
  // This is the report. 1,327 Jordanian rows, no Lebanese ones yet, so the facets named one
  // country, and one country is not a rail.
  const codes = rail(tbl(['jo', 'lebanon']), { jo: 1327, __none: 116 });
  assert.deepStrictEqual(codes, ['jo', 'lebanon', '__none']);
  assert.ok(meaningful(codes), 'a form ticked for two countries must draw the rail');
});

t('Branches: records in the second country only — the first is still listed', () => {
  const codes = rail(tbl(['jo', 'lebanon']), { lebanon: 3, __none: 31 });
  assert.deepStrictEqual(codes, ['jo', 'lebanon', '__none']);
  assert.ok(meaningful(codes));
});

t('Shop Spot Check (QC): the ticks are in the other order, the rail is not', () => {
  // Order comes from the countries table (sort 1 = Jordan), not from the order somebody
  // happened to tick the boxes in, and not from the record counts — 1,585 Lebanese rows
  // against 3 Jordanian ones must not put Lebanon on top one week and Jordan the next.
  const codes = rail(tbl(['lebanon', 'jo']), { lebanon: 1585, jo: 3, __none: 3 });
  assert.deepStrictEqual(codes, ['jo', 'lebanon', '__none']);
});

// ---- the rules that hold for every table ------------------------------------------------
t('a table ticked for one country has no rail', () => {
  const codes = rail(tbl(['jo']), { jo: 40 });
  assert.deepStrictEqual(codes, ['jo']);
  assert.ok(!meaningful(codes), 'one country is a label, not a choice');
});

t('a form ticked for two countries has its rail before a single record arrives', () => {
  const codes = rail(tbl(['jo', 'lebanon']), {});
  assert.deepStrictEqual(codes, ['jo', 'lebanon']);
  assert.ok(meaningful(codes));
});

t('a country that has been un-ticked keeps its records on the rail', () => {
  // Otherwise editing the form would make rows vanish from a rail that is the only way to
  // reach them — and they are still there, still answered, still Lebanese.
  const codes = rail(tbl(['jo']), { jo: 10, lebanon: 4 });
  assert.deepStrictEqual(codes, ['jo', 'lebanon']);
  assert.ok(meaningful(codes));
});

t('the 226 imported tables tick nothing, so they are read from their records alone', () => {
  assert.deepStrictEqual(rail(tbl(null), { jo: 5, lebanon: 5 }), ['jo', 'lebanon']);
  assert.deepStrictEqual(rail(tbl(null), { __none: 1950 }), ['__none']);
  assert.ok(!meaningful(rail(tbl(null), { __none: 1950 })), 'no country at all is not a rail');
});

t('a single-country table written before config.countries existed still reads', () => {
  // Every table made before one table covered several carries `config.country`, singular.
  assert.deepStrictEqual(asW(API.tableCountries({ config: { country: 'jo' } })), ['jo']);
  assert.deepStrictEqual(rail({ config: { country: 'jo' } }, { jo: 3, lebanon: 1 }), ['jo', 'lebanon']);
});

t('"no country" comes last, and only when some records have none', () => {
  assert.deepStrictEqual(rail(tbl(['jo', 'lebanon']), { __none: 9, lebanon: 1 }).pop(), '__none');
  assert.ok(rail(tbl(['jo', 'lebanon']), { jo: 1, lebanon: 1 }).indexOf('__none') === -1);
});

t('a country code no longer on file is still listed rather than dropped', () => {
  // A country removed from the Countries manager takes its rows nowhere — they are still
  // in the table and the rail is how they are reached.
  const codes = rail(tbl(['jo']), { jo: 2, atlantis: 1 });
  assert.deepStrictEqual(codes, ['jo', 'atlantis']);
});

t('nothing is listed twice, however many places name the same country', () => {
  const codes = rail({ config: { country: 'jo', countries: ['jo', 'jo', 'lebanon'] } }, { jo: 1, lebanon: 1 });
  assert.deepStrictEqual(codes, ['jo', 'lebanon']);
});

// ---- the flag beside each name ----------------------------------------------------------
t('every country on file gets its flag, derived from its dial code', () => {
  // The codes are not ISO pairs — `lebanon`, `iraq`, `syria` — so the flag cannot come from
  // the code. It comes from `countries.dial`, which the phone picker already maps.
  assert.strictEqual(API.countryFlag('jo'), 'jo');
  assert.strictEqual(API.countryFlag('lebanon'), 'lb');
  assert.strictEqual(API.countryFlag('iraq'), 'iq');
  assert.strictEqual(API.countryFlag('syria'), 'sy');
  API.COUNTRY_LIST.forEach(c => assert.ok(API.countryFlag(c.code), 'no flag for ' + c.code));
});

t('a country with no dial reads as its name instead of breaking the row', () => {
  assert.strictEqual(API.countryFlag('atlantis'), null);
  assert.strictEqual(API.countryFlag('__none'), null);
  assert.strictEqual(API.countryFlag(null), null);
});

// ---- what the page must say about the fold ----------------------------------------------
// The fold itself is driven in country-rail.chrome.js. These are the two decisions that a
// later edit would quietly undo.
t('the rail starts open, and only an explicit fold is remembered', () => {
  assert.ok(/var customKidsOpen = true;/.test(SRC), 'the rail no longer starts open');
  assert.ok(/localStorage\.getItem\("blk_custom_kids"\) !== "0"/.test(SRC),
            'a rail nobody has folded must read as open');
});

t('opening a table cannot fold its own rail', () => {
  // openCustomTable sets currentCustom before the delegated handler runs, so comparing
  // against currentCustom made every press a toggle. The comparison is against the table
  // that was open BEFORE the press, captured in the capture phase.
  assert.ok(/sideOpenBefore = \(currentCustom && currentCustom\.table\) \? currentCustom\.table\.id : null;/.test(SRC),
            'nothing captures which table was open before the press');
  assert.ok(/addEventListener\("click", function \(\) \{[\s\S]{0,200}?sideOpenBefore[\s\S]{0,200}?\}, true\);/.test(SRC),
            'the snapshot is not taken in the capture phase, so it is taken too late');
  assert.ok(/if \(sideOpenBefore !== item\.getAttribute\("data-custom"\)\) return;/.test(SRC),
            'the fold is still decided by currentCustom');
  assert.ok(!/customKidsOpen = true;\s*\/\/ opening a different table/.test(SRC),
            'the unreachable "a different table" branch is back');
});

t('a table ticked for more than one country carries a caret before it is opened', () => {
  assert.ok(/tableCountries\(t\)\.length > 1 \? '<span class="side-caret">'/.test(SRC),
            'a custom table line has no caret, so its fold is invisible');
  assert.ok(/function paintSideCaret\(/.test(SRC) && /paintSideCaret\(item, !!countryHtml, customKidsOpen\)/.test(SRC),
            'the caret is not kept in step with the rail that is actually drawn');
});

t('a covered country with no records reads as 0, not as "undefined"', () => {
  assert.ok(/\(co\[c\] \|\| 0\)/.test(SRC), 'the count of an empty country is not defaulted');
});

console.log(n + ' country-rail tests passed');
