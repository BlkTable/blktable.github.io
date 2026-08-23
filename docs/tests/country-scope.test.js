// canonicalCountry folds any spelling (code / alias / dial / name) to a canonical code.
// It reads COUNTRY_INDEX, which loadCountries() fills from the DB at login and which is
// pre-seeded with DEFAULT_COUNTRIES so the function works before login and under test.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
function grabVar(js,name){const m=js.match(new RegExp('\\n  var '+name+' = [\\s\\S]*?;(?=\\r?\\n)'));if(!m)throw new Error('no var '+name);return m[0];}
function load(names,vars){const js=scripts('index.html');const body=(vars||[]).map(v=>grabVar(js,v)).join('\n')+'\n'+names.map(n=>grab(js,n)).join('\n');const holder={};vm.runInThisContext('(function(API){'+body+'\nObject.assign(API,{'+names.concat(vars||[]).join(',')+'});})')(holder);return holder;}
const API = load(['rebuildCountryIndex','canonicalCountry','recordBranch','recordCountry','scopeFromCountries','countriesFromScope','scopeLabel','countryFacets','countryLabel'], ['DEFAULT_COUNTRIES','COUNTRY_LIST','COUNTRY_INDEX','BRANCH_RE','BRANCH_COUNTRY']);
API.rebuildCountryIndex();
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

API.BRANCH_COUNTRY.amman = 'jo';
t('recordCountry prefers the normalized country column', () => {
  assert.strictEqual(API.recordCountry({country:'lebanon', data:{}}, []), 'lebanon');
});
t('recordCountry reads an explicit country question when column empty', () => {
  const fields=[{id:'q1', label:'Country', type:'country'}];
  assert.strictEqual(API.recordCountry({data:{q1:'Iraq'}}, fields), 'iraq');
});
t('recordCountry derives country from the branch answer', () => {
  const fields=[{id:'b1', label:'Branch', type:'branch'}];
  assert.strictEqual(API.recordCountry({data:{b1:'Amman'}}, fields), 'jo');
});
t('recordCountry returns "" when nothing resolves', () => {
  assert.strictEqual(API.recordCountry({data:{}}, []), '');
});

t('scopeFromCountries builds {country:[...]}, empty => null (all)', () => {
  assert.deepStrictEqual(API.scopeFromCountries(['jo','lebanon']), {country:['jo','lebanon']});
  assert.strictEqual(API.scopeFromCountries([]), null);
});
t('countriesFromScope reads the new shape', () => {
  assert.deepStrictEqual(API.countriesFromScope({country:['iraq']}), ['iraq']);
  assert.deepStrictEqual(API.countriesFromScope(null), []);
});
t('countriesFromScope back-compat: legacy {phone_prefix} maps to a country', () => {
  assert.deepStrictEqual(API.countriesFromScope({phone_prefix:'+961'}), ['lebanon']);
});
t('scopeLabel summarises', () => {
  assert.strictEqual(API.scopeLabel(null), '');
  assert.strictEqual(API.scopeLabel({country:['jo','iraq']}), 'Jordan, Iraq');
});
t('countryFacets counts by resolved country, blanks under __none', () => {
  const fields=[{id:'q',label:'Country',type:'country'}];
  const rows=[{data:{q:'Jordan'}},{data:{q:'jordan'}},{data:{q:''}}];
  assert.deepStrictEqual(API.countryFacets(rows, fields), {jo:2, __none:1});
});
console.log('country-scope: '+n+' passed');
