const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

// RECORD_OPTS is a page-level `var`, not a function, so `grab` cannot lift it — it is
// injected as a context global instead and mutated from here. Same trick branch-field
// uses to hand the page its rows.
const CACHE = {};
const API = load('index.html', ['esc','splitMulti','linkLive','recordOptsLabel','edChecksKeyed',
                                'pollConfig','pollSummary','recordOptsStatus','recordOptsFor'],
                 {RECORD_OPTS: CACHE});
const asW = o => JSON.parse(JSON.stringify(o));
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
  // Line-ending agnostic: see the note on the same assertion in ballot-field.test.js.
  assert.ok(/var ballotReady = db\.rpc\([\s\S]{0,400}?\.catch\(/.test(FSRC));
});

// ---- The button lives on the events table, and the store table is invisible ----
const PCFG = {store:'polls-zamel', form:'barista-availability-zamel', name:'F_NM', events:'F_EV'};
t('a complete polls config is returned', () => {
  assert.deepStrictEqual(API.pollConfig({config:{polls:PCFG}}), PCFG);
});
t('a half-written polls config is null, not half-usable', () => {
  assert.strictEqual(API.pollConfig({config:{polls:{store:'x', form:'y'}}}), null);
  assert.strictEqual(API.pollConfig({config:{polls:{name:'n', events:'e'}}}), null);
  assert.strictEqual(API.pollConfig({config:{}}), null);
  assert.strictEqual(API.pollConfig(null), null);
});
t('the Voting links button is gated on canManage, like Payroll', () => {
  const m = /custom-polls"\)\.style\.display =\s*\n?\s*\(([^;]*)\)/.exec(SRC);
  assert.ok(m, 'no visibility rule for the Voting links button');
  assert.ok(/pollConfig\(t\)/.test(m[1]) && /canManage\(t\.id\)/.test(m[1]),
    'a voting link asks staff to commit time and the roster it builds is what payroll pays');
});

// ---- What a link says about itself, so two links are tellable apart ---------
t('a link reports how many events it asks about and how many have answered', () => {
  const row = {id:'p1', data:{F_EV:'e-1, e-2, e-3'}};
  assert.strictEqual(API.pollSummary(row, PCFG, {p1: 4}), '3 events · 4 votes');
});
t('one event and one vote read as singular', () => {
  assert.strictEqual(API.pollSummary({id:'p1', data:{F_EV:'e-1'}}, PCFG, {p1: 1}), '1 event · 1 vote');
});
t('a link nobody has answered says 0 votes rather than nothing', () => {
  assert.strictEqual(API.pollSummary({id:'p1', data:{F_EV:'e-1'}}, PCFG, {}), '1 event · 0 votes');
  assert.strictEqual(API.pollSummary({id:'p1', data:{F_EV:'e-1'}}, PCFG, null), '1 event · 0 votes');
});
t('an empty event list counts 0, not 1 — a split of "" must not become one id', () => {
  assert.strictEqual(API.pollSummary({id:'p1', data:{F_EV:''}}, PCFG, {}), '0 events · 0 votes');
  assert.strictEqual(API.pollSummary({id:'p1', data:{}}, PCFG, {}), '0 events · 0 votes');
});

// ---- Which events Zamel may put on a link: draft and open only -------------
const PICK = {source:'events-zamel', when_status:['draft','open'], null_status_is:'draft'};
t('a null status reads as draft — what a dashboard-created record already displays as', () => {
  assert.strictEqual(API.recordOptsStatus({status:null}, PICK), 'draft');
  assert.strictEqual(API.recordOptsStatus({status:''}, PICK), 'draft');
  assert.strictEqual(API.recordOptsStatus({}, PICK), 'draft');
});
t('a real status is itself', () => {
  assert.strictEqual(API.recordOptsStatus({status:'open'}, PICK), 'open');
  assert.strictEqual(API.recordOptsStatus({status:'done'}, PICK), 'done');
});
t('null reads as draft even with no null_status_is configured', () => {
  assert.strictEqual(API.recordOptsStatus({status:null}, {}), 'draft');
  assert.strictEqual(API.recordOptsStatus({status:null}, null), 'draft');
});
// The gate is on the PICKER. It used to be on the ballot, which was wrong: the link
// decides what a barista sees, and this decides what Zamel may put on a link.
t('only draft and open events are offered — a finished event is not asked about', () => {
  RECORD_STUB();
  const got = API.recordOptsFor({options: PICK}).map(o => o.value);
  // Filtering preserves the cache's order; the sort happens once, where it is loaded.
  assert.deepStrictEqual(asW(got), ['e-open','e-null','e-draft']);
});
t('no when_status means no gate, which is what every question before this said', () => {
  RECORD_STUB();
  const got = API.recordOptsFor({options: {source:'events-zamel'}}).map(o => o.value);
  assert.strictEqual(got.length, 5);
});
t('an unknown source table is an empty picker rather than a throw', () => {
  assert.deepStrictEqual(asW(API.recordOptsFor({options:{source:'nope'}})), []);
  assert.deepStrictEqual(asW(API.recordOptsFor({})), []);
  assert.deepStrictEqual(asW(API.recordOptsFor(null)), []);
});

// ---- Completeness: a picker missing rows makes links missing events --------
// There is no insert policy on app_submissions, so a direct insert is refused by RLS.
// This is the assertion that would have caught it before it reached the screen.
t('the link row is created through create_record, never a direct insert', () => {
  assert.ok(!/from\("app_submissions"\)\.insert/.test(SRC),
    'a direct insert into app_submissions is denied — rows arrive via submit_public_form or create_record');
});
t('the dialog pages the whole table instead of reading the screen', () => {
  assert.ok(/fetchAllRows\(storeId, "id,data,share_token"\)/.test(SRC),
    'the links list must be read from the database, not from currentCustom.subs');
  assert.ok(/^  function fetchAllRows/m.test(SRC),
    'fetchAllRows must be top level so the payroll export and this dialog share one reader');
});
t('a link row with no minted token shows no URL rather than one ending in undefined', () => {
  assert.ok(/p\.share_token \? recordFormLink/.test(SRC),
    'a URL built from a null token reads as a link and 404s');
});
t('creating a link refuses an empty tick list and an unnamed link', () => {
  const m = /pl-go"\)\.addEventListener([\s\S]{0,900}?)create_record/.exec(SRC);
  assert.ok(m, 'could not find the create handler');
  assert.ok(/if \(!ids\)/.test(m[1]), 'a link asking about nothing has nothing to answer');
  assert.ok(/if \(!nm\)/.test(m[1]), 'an unnamed link cannot be told from the others later');
});
t('the token is minted when the link is created, not lazily', () => {
  assert.ok(/record_share_token[\s\S]{0,200}?p_rotate: false/.test(SRC),
    'the point of the dialog is to hand over a link; a row with no token has none');
});

console.log(n + ' passed');

// Fills the cache the picker reads. Hoisted, so the tests above can call it.
function RECORD_STUB() {
  CACHE['events-zamel'] = { byId: {}, list: [
    {value:'e-open',  label:'Open one',   status:'open'},
    {value:'e-null',  label:'Fresh one',  status:null},
    {value:'e-draft', label:'Draft one',  status:'draft'},
    {value:'e-asgn',  label:'Staffed',    status:'assigned'},
    {value:'e-done',  label:'Finished',   status:'done'}
  ]};
}
