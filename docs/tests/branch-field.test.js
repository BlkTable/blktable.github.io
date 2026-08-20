const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API = load('index.html', ['branchDropdownOptions']);
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

t('branchDropdownOptions maps rows to {en,ar} in position order', () => {
  const rows=[{name:'Abdoun',name_ar:'عبدون',position:1,list_key:'jo'},
              {name:'Khalda',name_ar:'خلدا',position:0,list_key:'jo'},
              {name:'Basra',name_ar:'',position:0,list_key:'iraq'}];
  const opts=API.branchDropdownOptions(rows,'jo');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(opts)),[{en:'Khalda',ar:'خلدا'},{en:'Abdoun',ar:'عبدون'}]);
});
t('branchDropdownOptions defaults list_key to jo', () => {
  const rows=[{name:'Abdoun',name_ar:'',position:1,list_key:'jo'}];
  assert.strictEqual(API.branchDropdownOptions(rows).length,1);
});
t('branchDropdownOptions filters by franchise list_key', () => {
  const rows=[
    {name:'Abdoun',name_ar:'عبدون',position:1,list_key:'jo'},
    {name:'Basra',name_ar:'البصرة',position:0,list_key:'iraq'},
    {name:'Zarqa',name_ar:'الزرقاء',position:2,list_key:'jo'},
    {name:'Baghdad',name_ar:'بغداد',position:1,list_key:'iraq'}
  ];
  const iraq=API.branchDropdownOptions(rows,'iraq');
  assert.strictEqual(iraq.length,2);
  assert.strictEqual(iraq[0].en,'Basra');
  assert.strictEqual(iraq[1].en,'Baghdad');
  const jo=API.branchDropdownOptions(rows,'jo');
  assert.strictEqual(jo.length,2);
  assert.strictEqual(jo[0].en,'Abdoun');
  assert.strictEqual(jo[1].en,'Zarqa');
});
console.log(n+' branch-field tests passed');
