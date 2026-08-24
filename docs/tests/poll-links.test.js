const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API = load('index.html', ['esc','splitMulti','linkLive','recordOptsLabel','edChecksKeyed']);
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

// ---- What labels a record: the source table's own card_fields --------------
// Not a lookup by question label. card_fields' first entry is already the record's
// title everywhere else in the app, so this cannot drift from what the cards show.
const CF = ['f-name','f-date'];
t('a record is labelled by its card fields, joined', () => {
  assert.strictEqual(
    API.recordOptsLabel({data:{'f-name':'Autumn Fair','f-date':'2026-09-10'}}, CF),
    'Autumn Fair — 2026-09-10');
});
t('a blank card field is skipped rather than leaving a dangling dash', () => {
  assert.strictEqual(API.recordOptsLabel({data:{'f-name':'Autumn Fair','f-date':''}}, CF), 'Autumn Fair');
  assert.strictEqual(API.recordOptsLabel({data:{'f-name':'  ','f-date':'2026-09-10'}}, CF), '2026-09-10');
});
t('a record with nothing to show reads as untitled, never as blank or undefined', () => {
  assert.strictEqual(API.recordOptsLabel({data:{}}, CF), '(untitled)');
  assert.strictEqual(API.recordOptsLabel({}, CF), '(untitled)');
  assert.strictEqual(API.recordOptsLabel({data:{'f-name':'x'}}, []), '(untitled)');
  assert.strictEqual(API.recordOptsLabel({data:{'f-name':'x'}}, null), '(untitled)');
});

// ---- The picker: value is the id, text is the label -----------------------
const OPTS = [{value:'e-1', label:'Autumn Fair — 2026-09-10'},
              {value:'e-2', label:'Wedding — 2026-09-14'}];
t('the checkbox value is the record id and the text is the label', () => {
  const h = API.edChecksKeyed('ed-x', '', OPTS);
  assert.ok(/value="e-1"/.test(h), 'value must be the id');
  assert.ok(/Autumn Fair — 2026-09-10/.test(h), 'text must be the label');
  assert.ok(!/value="Autumn Fair/.test(h), 'the name must never be the stored value');
});
t('only the ticked ids come back ticked', () => {
  const h = API.edChecksKeyed('ed-x', 'e-2', OPTS);
  assert.ok(/value="e-1"> /.test(h) || !/value="e-1" checked/.test(h), 'e-1 must not be checked');
  assert.ok(/value="e-2" checked/.test(h), 'e-2 must be checked');
});
t('spacing in the stored answer does not stop a box being ticked', () => {
  assert.ok(/value="e-1" checked/.test(API.edChecksKeyed('ed-x', ' e-1 , e-2 ', OPTS)));
});
t('nothing stored ticks nothing', () => {
  assert.ok(!/checked/.test(API.edChecksKeyed('ed-x', '', OPTS)));
  assert.ok(!/checked/.test(API.edChecksKeyed('ed-x', null, OPTS)));
});
// The rule edChecks already follows for a retired choice, and for the same reason.
t('a ticked id whose record is gone is still shown, still ticked, and marked', () => {
  const h = API.edChecksKeyed('ed-x', 'e-1, e-99', OPTS);
  assert.ok(/value="e-99" checked/.test(h), 'dropping it would silently delete an answer on save');
  assert.ok(/as recorded/.test(h), 'and it has to be visibly not a current choice');
  assert.ok(/retired/.test(h));
});
t('an empty picker is empty markup rather than a throw', () => {
  assert.ok(/ed-checks/.test(API.edChecksKeyed('ed-x', '', [])));
  assert.ok(/ed-checks/.test(API.edChecksKeyed('ed-x', '', null)));
});
t('a label containing markup is escaped', () => {
  const h = API.edChecksKeyed('ed-x', '', [{value:'e-1', label:'<img src=x>'}]);
  assert.ok(!/<img/.test(h), 'an event name is typed by a person');
});

// ---- The bug Zamel spotted: a link offered for a form nobody fills in -----
const SRC = fs.readFileSync('index.html','utf8');
t('linkLive treats a missing flag as live, so an unselected column is not a dead link', () => {
  assert.strictEqual(API.linkLive({}), true);
  assert.strictEqual(API.linkLive({is_active:true}), true);
  assert.strictEqual(API.linkLive({is_active:false}), false);
});
t('the record-panel link block is gated on the child form being live', () => {
  const m = /function recordLinkBlockHtml\(child\) \{([\s\S]{0,240}?)return/.exec(SRC);
  assert.ok(m, 'could not find recordLinkBlockHtml');
  assert.ok(/linkLive\(child\)/.test(m[1]),
    'without this every parent record offers a link to an app-written child form');
});
t('filling that link in is gated the same way', () => {
  const m = /function fillRecordLink\(rec, child\) \{([\s\S]{0,160}?)return;/.exec(SRC);
  assert.ok(m && /linkLive\(child\)/.test(m[1]));
});
t('and so is the "here is its link" prompt after creating a record', () => {
  const m = /function offerNewRecordLink\(t, recId\)([\s\S]*?)record_share_token/.exec(SRC);
  assert.ok(m, 'could not find offerNewRecordLink');
  assert.ok(/linkLive\(child\)/.test(m[1]),
    'every event created popped a shareable link for the roster form without this');
  assert.ok(/canManage\(t\.id\)/.test(m[1]), 'and it stays manager-only');
});

// ---- record_multi has to be read back, or saving writes nothing ----------
t('edValues reads a record_multi the way it reads a multi_select', () => {
  const m = /out\[f\.id\] = \(([^)]*)\) \? edChecksValue\(el\)/.exec(SRC);
  assert.ok(m, 'edValues no longer routes checkbox fields through edChecksValue');
  assert.ok(/record_multi/.test(m[1]),
    'without this the picker renders, is ticked, and saves an empty answer');
});
t('the record editor renders record_multi through the keyed picker', () => {
  assert.ok(/f\.type === "record_multi"\) inner = edChecksKeyed/.test(SRC),
    'a record_multi with no branch falls through to a text box asking for raw uuids');
});
t('the source records are loaded before an editor is drawn', () => {
  assert.ok(/loadRecordOptsFor\(currentCustom\.fields\)/.test(SRC),
    'the picker would come up empty and saving would write an answer of nothing');
});

// ---- The poll token: the rule that stopped the 2026-08-09 outage ---------
const FSRC = fs.readFileSync('f/index.html','utf8');
t('the poll token is sent to ballot_options only when there is one', () => {
  const m = /var ballotPayload[\s\S]{0,300}?rpc\("ballot_options", ballotPayload\)/.exec(FSRC);
  assert.ok(m, 'ballot_options is not called with a conditional payload');
  assert.ok(/if \(parentToken\) ballotPayload\.p_token = parentToken;/.test(m[0]),
    'PostgREST resolves a function by the keys in the body — an always-sent key breaks against the one-argument version');
});
t('the ballot fetch still cannot break the page', () => {
  const m = /var ballotReady[\s\S]{0,300}?;\n/.exec(FSRC);
  assert.ok(m && /\.catch\(/.test(m[0]));
});

console.log(n + ' passed');
