const fs=require('fs'),vm=require('vm'),assert=require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API=load('index.html',['canCreateTablesFrom','mayModifyTable','auditLine']);
let n=0;const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

t('admin can create tables', ()=>assert.strictEqual(API.canCreateTablesFrom({role:'admin'}),true));
t('flagged reviewer can create', ()=>assert.strictEqual(API.canCreateTablesFrom({role:'reviewer',can_create_tables:true}),true));
t('plain reviewer cannot create', ()=>assert.strictEqual(API.canCreateTablesFrom({role:'reviewer'}),false));
t('null profile cannot create', ()=>assert.strictEqual(API.canCreateTablesFrom(null),false));
t('admin may modify any table', ()=>assert.strictEqual(API.mayModifyTable({created_by:'x'},'me',true),true));
t('owner may modify own table', ()=>assert.strictEqual(API.mayModifyTable({created_by:'me'},'me',false),true));
t('non-owner non-admin may not', ()=>assert.strictEqual(API.mayModifyTable({created_by:'x'},'me',false),false));
t('null table not modifiable by non-admin', ()=>assert.strictEqual(API.mayModifyTable(null,'me',false),false));
t('auditLine formats actor + action + table', ()=>{
  const s=API.auditLine({actor_name:'Ali',action:'table_created',table_name:'Contact Us'});
  assert.ok(s.indexOf('Ali')>=0 && s.toLowerCase().indexOf('created')>=0 && s.indexOf('Contact Us')>=0);
});
t('auditLine falls back for unknown action/actor', ()=>{
  const s=API.auditLine({action:'weird_action'});
  assert.ok(s.indexOf('Someone')>=0 && s.indexOf('weird_action')>=0);
});
console.log(n+' table-rights tests passed');
