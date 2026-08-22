// Per-account card prefs: the server copy is the account's answer, the localStorage copy is
// only this browser's cache. cardMine decides which the rest of the code reads — server wins
// when it has anything, otherwise fall back to this browser, otherwise nothing chosen.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
function load(names){const js=scripts('index.html');const ctx={console};vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n)).join('\n')+'\nthis.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}
const API = load(['cardMine']);
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

t('server prefs win when present', () => {
  assert.deepStrictEqual(API.cardMine({fields:['a']}, {fields:['b']}), {fields:['a']});
});
t('falls back to local when server is null', () => {
  assert.deepStrictEqual(API.cardMine(null, {fields:['b']}), {fields:['b']});
});
t('empty-object server ({}) still wins over local (account chose "reset")', () => {
  assert.deepStrictEqual(API.cardMine({}, {fields:['b']}), {});
});
t('returns an empty object when both are empty/null', () => {
  const r = API.cardMine(null, null);
  assert.strictEqual(r && typeof r === 'object', true);
  assert.strictEqual(Object.keys(r).length, 0);
});
console.log('card-prefs-server: '+n+' passed');
