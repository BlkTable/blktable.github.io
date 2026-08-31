// canonicalCountry folds any spelling (code / alias / dial / name) to a canonical code.
// It reads COUNTRY_INDEX, which loadCountries() fills from the DB at login and which is
// pre-seeded with DEFAULT_COUNTRIES so the function works before login and under test.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
function grabVar(js,name){const m=js.match(new RegExp('\\n  var '+name+' = [\\s\\S]*?;(?=\\r?\\n)'));if(!m)throw new Error('no var '+name);return m[0];}
function load(names,vars){const js=scripts('index.html');const body=(vars||[]).map(v=>grabVar(js,v)).join('\n')+'\n'+names.map(n=>grab(js,n)).join('\n');const ctx={console};vm.createContext(ctx);new vm.Script('(function(){'+body+'\nthis.API={'+names.concat(vars||[]).join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}
const API = load(['rebuildCountryIndex','canonicalCountry','recordBranch','branchListCountry','branchCountry','branchListKeys','recordCountry','scopeFromCountries','countriesFromScope','branchesFromScope','fieldsInternalFromScope','scopeFrom','scopeLabel','countryFacets','countryLabel'], ['DEFAULT_COUNTRIES','COUNTRY_LIST','COUNTRY_INDEX','BRANCH_RE','allBranches']);
API.rebuildCountryIndex();
// Objects/arrays built inside the vm sandbox use its own Array/Object intrinsics, so a raw
// deepStrictEqual against a host-realm literal fails on prototype identity. asWritten normalizes
// both sides to plain host JSON before comparing — same convention as archive.test.js.
const asWritten = o => JSON.parse(JSON.stringify(o));
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

t('code passes through', () => {
  assert.strictEqual(API.canonicalCountry('lebanon'), 'lebanon');
  assert.strictEqual(API.canonicalCountry('jo'), 'jo');
});
t('alias codes fold in', () => {
  assert.strictEqual(API.canonicalCountry('lb'), 'lebanon');
  assert.strictEqual(API.canonicalCountry('iq'), 'iraq');
  assert.strictEqual(API.canonicalCountry('sy'), 'syria');
});
t('dial codes fold in', () => {
  assert.strictEqual(API.canonicalCountry('961'), 'lebanon');
  assert.strictEqual(API.canonicalCountry('+962'), 'jo');
});
t('english + arabic names fold in, case/space-insensitive', () => {
  assert.strictEqual(API.canonicalCountry('Jordan'), 'jo');
  assert.strictEqual(API.canonicalCountry('  IRAQ '), 'iraq');
  assert.strictEqual(API.canonicalCountry('لبنان'), 'lebanon');
});
t('unknown / empty returns null', () => {
  assert.strictEqual(API.canonicalCountry(''), null);
  assert.strictEqual(API.canonicalCountry('France'), null);
  assert.strictEqual(API.canonicalCountry(null), null);
});

t('recordCountry prefers the normalized country column', () => {
  assert.strictEqual(API.recordCountry({country:'lebanon', data:{}}, []), 'lebanon');
});
t('recordCountry reads an explicit country question when column empty', () => {
  const fields=[{id:'q1', label:'Country', type:'country'}];
  assert.strictEqual(API.recordCountry({data:{q1:'Iraq'}}, fields), 'iraq');
});
t('recordCountry derives country from the branch field list (jo)', () => {
  const fields=[{id:'b1', label:'Branch', type:'branch', options:{list:'jo'}}];
  assert.strictEqual(API.recordCountry({data:{b1:'Amman'}}, fields), 'jo');
});
t('recordCountry derives lebanon from a lebanon-list branch field, and parses string options', () => {
  const fields=[{id:'b1', label:'Branch', type:'branch', options:'{"list":"lebanon"}'}];
  assert.strictEqual(API.recordCountry({data:{b1:'Jal el Deeb'}}, fields), 'lebanon');
});
t('recordCountry returns "" when nothing resolves', () => {
  assert.strictEqual(API.recordCountry({data:{}}, []), '');
});

// ---- A form offering more than one country's shops -------------------------
// The field can no longer say which country a record is in, because it offers several.
// The SHOP that was answered says, which is also what app_submissions_set_country() does
// in the database — the two are written twice on purpose and must not disagree.
const MIXED_BRANCHES=[
  {name:'Abdoun',name_ar:'عبدون',position:1,list_key:'jo'},
  {name:'Beirut',name_ar:'بيروت',position:0,list_key:'lebanon'}
];
t('branchCountry reads the country off the shop, by English or Arabic name', () => {
  assert.strictEqual(API.branchCountry(MIXED_BRANCHES,'Beirut'), 'lebanon');
  assert.strictEqual(API.branchCountry(MIXED_BRANCHES,'  abdoun '), 'jo');
  assert.strictEqual(API.branchCountry(MIXED_BRANCHES,'بيروت'), 'lebanon');
});
t('branchCountry says nothing about a shop it does not know, rather than guessing', () => {
  assert.strictEqual(API.branchCountry(MIXED_BRANCHES,'Nowhere'), null);
  assert.strictEqual(API.branchCountry(MIXED_BRANCHES,''), null);
  assert.strictEqual(API.branchCountry([], 'Beirut'), null);
});
t('a two-list question takes the country from the branch answered, not from the question', () => {
  API.allBranches.length = 0; MIXED_BRANCHES.forEach(b => API.allBranches.push(b));
  const fields=[{id:'b1', label:'Branch', type:'branch', options:{list:'jo, lebanon'}}];
  assert.strictEqual(API.recordCountry({data:{b1:'Beirut'}}, fields), 'lebanon');
  assert.strictEqual(API.recordCountry({data:{b1:'Abdoun'}}, fields), 'jo');
  API.allBranches.length = 0;
});
t('branchListCountry declines to answer for a question naming several lists', () => {
  // "jo, lebanon" is not a country, and pretending it is one is how every Lebanese
  // record on a mixed form would have been filed under Jordan.
  assert.strictEqual(API.branchListCountry([{id:'b1',type:'branch',options:{list:'jo, lebanon'}}]), null);
});
t('the single-list rule is unchanged: the field still answers when the shop is unknown', () => {
  // Which is what an import produces — a branch name the branches table never had.
  const fields=[{id:'b1', label:'Branch', type:'branch', options:{list:'lebanon'}}];
  assert.strictEqual(API.recordCountry({data:{b1:'Some old spelling'}}, fields), 'lebanon');
});

t('scopeFromCountries builds {country:[...]}, empty => null (all)', () => {
  assert.deepStrictEqual(asWritten(API.scopeFromCountries(['jo','lebanon'])), {country:['jo','lebanon']});
  assert.strictEqual(API.scopeFromCountries([]), null);
});
t('countriesFromScope reads the new shape', () => {
  assert.deepStrictEqual(asWritten(API.countriesFromScope({country:['iraq']})), ['iraq']);
  assert.deepStrictEqual(asWritten(API.countriesFromScope(null)), []);
});
t('countriesFromScope back-compat: legacy {phone_prefix} maps to a country', () => {
  assert.deepStrictEqual(asWritten(API.countriesFromScope({phone_prefix:'+961'})), ['lebanon']);
});
t('scopeLabel summarises', () => {
  assert.strictEqual(API.scopeLabel(null), '');
  assert.strictEqual(API.scopeLabel({country:['jo','iraq']}), 'Jordan, Iraq');
});
t('scopeLabel names one branch, counts several, and flags the field limit', () => {
  assert.strictEqual(API.scopeLabel({branch:['Khalda']}), 'Khalda');
  assert.strictEqual(API.scopeLabel({branch:['Muqabalein','Muqabalein 5B']}), '2 branches');
  assert.strictEqual(API.scopeLabel({branch:['Khalda'],fields:'internal'}), 'Khalda, staff fields only');
  assert.strictEqual(API.scopeLabel({country:['jo'],branch:['Khalda']}), 'Jordan, Khalda');
});
t('branchesFromScope only trusts an array', () => {
  assert.deepStrictEqual(asWritten(API.branchesFromScope({branch:['Khalda']})), ['Khalda']);
  assert.deepStrictEqual(asWritten(API.branchesFromScope(null)), []);
  assert.deepStrictEqual(asWritten(API.branchesFromScope({})), []);
  // a malformed scope must not be read as a branch list
  assert.deepStrictEqual(asWritten(API.branchesFromScope({branch:'Khalda'})), []);
});
t('fieldsInternalFromScope is exact, not truthy', () => {
  assert.strictEqual(API.fieldsInternalFromScope({fields:'internal'}), true);
  assert.strictEqual(API.fieldsInternalFromScope({fields:'all'}), false);
  assert.strictEqual(API.fieldsInternalFromScope(null), false);
});
t('scopeFrom builds all three limits, and NULL when there is no limit at all', () => {
  // an unrestricted grant must store a clean null, not {}, or every row looks scoped
  assert.strictEqual(API.scopeFrom({countries:[],branches:[],fieldsInternal:false}), null);
  assert.deepStrictEqual(asWritten(API.scopeFrom({countries:[],branches:['Khalda'],fieldsInternal:false})),
    {branch:['Khalda']});
  assert.deepStrictEqual(asWritten(API.scopeFrom({countries:['jo'],branches:['Khalda'],fieldsInternal:true})),
    {country:['jo'],branch:['Khalda'],fields:'internal'});
});
t('countryFacets counts by resolved country, blanks under __none', () => {
  const fields=[{id:'q',label:'Country',type:'country'}];
  const rows=[{data:{q:'Jordan'}},{data:{q:'jordan'}},{data:{q:''}}];
  assert.deepStrictEqual(asWritten(API.countryFacets(rows, fields)), {jo:2, __none:1});
});
console.log('country-scope: '+n+' passed');
