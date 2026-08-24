const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API = load('index.html', ['branchOpen','branchDropdownOptions','branchListKeys']);
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

t('branchDropdownOptions maps rows to {en,ar,list} in position order', () => {
  const rows=[{name:'Abdoun',name_ar:'عبدون',position:1,list_key:'jo'},
              {name:'Khalda',name_ar:'خلدا',position:0,list_key:'jo'},
              {name:'Basra',name_ar:'',position:0,list_key:'iraq'}];
  const opts=API.branchDropdownOptions(rows,'jo');
  // `list` rides along so a picker offering several countries can say which is which;
  // every caller that only wants the name still reads .en.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(opts)),
    [{en:'Khalda',ar:'خلدا',list:'jo'},{en:'Abdoun',ar:'عبدون',list:'jo'}]);
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
// ---- More than one country's shops in one question -------------------------
// The point of the change: a form covering Jordan and Lebanon used to need two forms,
// two links and two sets of submissions to reconcile.
const asW=o=>JSON.parse(JSON.stringify(o));
const MIXED=[
  {name:'Abdoun',name_ar:'عبدون',position:1,list_key:'jo'},
  {name:'Khalda',name_ar:'خلدا',position:0,list_key:'jo'},
  {name:'Beirut',name_ar:'بيروت',position:0,list_key:'lebanon'},
  {name:'Basra',name_ar:'البصرة',position:0,list_key:'iraq'}
];
t('branchListKeys splits a comma-separated list and lowercases it', () => {
  assert.deepStrictEqual(asW(API.branchListKeys({options:{list:'jo, Lebanon'}})),['jo','lebanon']);
});
t('branchListKeys defaults to jo — which is what every question written before this said', () => {
  assert.deepStrictEqual(asW(API.branchListKeys({})),['jo']);
  assert.deepStrictEqual(asW(API.branchListKeys({options:{}})),['jo']);
  assert.deepStrictEqual(asW(API.branchListKeys({options:{list:''}})),['jo']);
  assert.deepStrictEqual(asW(API.branchListKeys(null)),['jo']);
});
t('two lists offer both countries, each still in its own position order', () => {
  const opts=asW(API.branchDropdownOptions(MIXED,['jo','lebanon']).map(o=>o.en));
  assert.deepStrictEqual(opts,['Khalda','Abdoun','Beirut']);
});
t('the lists are kept in the order they were named, not merged and re-sorted', () => {
  // Whoever wrote "lebanon, jo" wants Lebanon first; sorting the union would ignore that.
  const opts=asW(API.branchDropdownOptions(MIXED,['lebanon','jo']).map(o=>o.en));
  assert.deepStrictEqual(opts,['Beirut','Khalda','Abdoun']);
});
t('a comma-separated string is accepted as well as an array', () => {
  assert.deepStrictEqual(asW(API.branchDropdownOptions(MIXED,'jo, lebanon').map(o=>o.en)),
                         ['Khalda','Abdoun','Beirut']);
});
t('each option still says which list it came from, so the picker can name the country', () => {
  const opts=API.branchDropdownOptions(MIXED,['jo','lebanon']);
  assert.strictEqual(opts.filter(o=>o.en==='Beirut')[0].list,'lebanon');
  assert.strictEqual(opts.filter(o=>o.en==='Abdoun')[0].list,'jo');
});
t('a list nobody has branches in adds nothing rather than throwing', () => {
  assert.strictEqual(API.branchDropdownOptions(MIXED,['jo','syria']).length,2);
});

// ---- A shop that has closed ------------------------------------------------
// The Countries manager can switch a shop off, and off has to MEAN something: a closed
// shop stops being offered. It is never deleted, because its name is the answer on every
// record ever filed against it — deleting the row would leave those records naming
// something that does not exist.
t('a shop with no is_active is open, because that is every row written before the column was read', () => {
  assert.strictEqual(API.branchOpen({name:'Abdoun'}),true);
  assert.strictEqual(API.branchOpen({name:'Abdoun',is_active:true}),true);
});
t('only false closes a shop — null and undefined do not', () => {
  assert.strictEqual(API.branchOpen({name:'Abdoun',is_active:false}),false);
  assert.strictEqual(API.branchOpen({name:'Abdoun',is_active:null}),true);
});
t('nothing at all reads as open rather than throwing', () => {
  assert.strictEqual(API.branchOpen(null),true);
});
t('a closed shop is not offered on a form', () => {
  const rows=[{name:'Abdoun',name_ar:'',position:1,list_key:'jo'},
              {name:'Kia Showroom',name_ar:'',position:2,list_key:'jo',is_active:false},
              {name:'Khalda',name_ar:'',position:3,list_key:'jo',is_active:true}];
  assert.deepStrictEqual(asW(API.branchDropdownOptions(rows,'jo').map(o=>o.en)),['Abdoun','Khalda']);
});
t('closing every shop in a list leaves the question with nothing, not with a closed shop', () => {
  const rows=[{name:'Beirut',position:1,list_key:'lebanon',is_active:false}];
  assert.strictEqual(API.branchDropdownOptions(rows,'lebanon').length,0);
});
console.log(n+' branch-field tests passed');
