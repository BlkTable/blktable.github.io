const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API = load('index.html', ['assignPersonKey','assignDiff','submitAssignments']);
const asW = o => JSON.parse(JSON.stringify(o));
let n=0, failed=0;
const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);failed++;process.exitCode=1;}};
const T=async(name,fn)=>{try{await fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);failed++;process.exitCode=1;}};

// existing rows arrive normalised by submitAssignments: {id, name, slot}
const R = (id, name, slot) => ({id, name, slot});
const P = (name, phone, slot) => ({key:name.trim().toLowerCase(), name, phone, slot});

// ---- The diff ------------------------------------------------------------
t('a first roster is all inserts', () => {
  const d = API.assignDiff([], [P('Ahmad','+1','confirmed'), P('Sara','+2','confirmed')]);
  assert.deepStrictEqual(asW(d.insert.map(x=>x.name)), ['Ahmad','Sara']);
  assert.deepStrictEqual(asW(d.remove), []);
  assert.deepStrictEqual(asW(d.update), []);
});
t('an unchanged person is KEPT — never inserted, never removed, never updated', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed')], [P('Ahmad','+1','confirmed')]);
  assert.deepStrictEqual(asW(d.insert), []);
  assert.deepStrictEqual(asW(d.remove), []);
  assert.deepStrictEqual(asW(d.update), []);
  assert.deepStrictEqual(asW(d.keep.map(x=>x.id)), ['r1']);
});
t('adding one person to a roster of seven inserts exactly one', () => {
  const have = ['A','B','C','D','E','F','G'].map((x,i)=>R('r'+i,x,'confirmed'));
  const want = ['A','B','C','D','E','F','G','H'].map(x=>P(x,'+1','confirmed'));
  const d = API.assignDiff(have, want);
  assert.deepStrictEqual(asW(d.insert.map(x=>x.name)), ['H']);
  assert.strictEqual(d.keep.length, 7);
});
t('a cleared tick is a removal', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed'), R('r2','Sara','confirmed')], [P('Ahmad','+1','confirmed')]);
  assert.deepStrictEqual(asW(d.remove.map(x=>x.id)), ['r2']);
});
t('a slot change is an UPDATE, not a remove plus an insert', () => {
  // delete+insert would re-fire the INSERT-only notify trigger and tell somebody twice.
  const d = API.assignDiff([R('r1','Ahmad','confirmed')], [P('Ahmad','+1','backup')]);
  assert.deepStrictEqual(asW(d.insert), []);
  assert.deepStrictEqual(asW(d.remove), []);
  assert.deepStrictEqual(asW(d.update.map(x=>[x.id, x.slot])), [['r1','backup']]);
});
t('a missing slot on either side counts as confirmed, so it is not a spurious update', () => {
  const d = API.assignDiff([R('r1','Ahmad',null)], [P('Ahmad','+1','confirmed')]);
  assert.deepStrictEqual(asW(d.update), []);
  assert.strictEqual(d.keep.length, 1);
});
t('the same person spelled differently is still the same person', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed')], [P('  ahmad ','+1','confirmed')]);
  assert.deepStrictEqual(asW(d.insert), []);
  assert.strictEqual(d.keep.length, 1);
});
t('a duplicate row for one person is trimmed to one rather than kept twice', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed'), R('r2','ahmad','confirmed')], [P('Ahmad','+1','confirmed')]);
  assert.strictEqual(d.keep.length, 1, 'one row is kept');
  assert.deepStrictEqual(asW(d.remove.map(x=>x.id)), ['r2'], 'the duplicate goes');
  assert.deepStrictEqual(asW(d.insert), [], 'and nothing is re-added');
});
t('an empty tick list removes everybody and inserts nobody', () => {
  const d = API.assignDiff([R('r1','Ahmad','confirmed')], []);
  assert.deepStrictEqual(asW(d.remove.map(x=>x.id)), ['r1']);
  assert.deepStrictEqual(asW(d.insert), []);
});
t('null inputs are an empty diff rather than a throw', () => {
  const d = API.assignDiff(null, null);
  assert.deepStrictEqual(asW(d), {insert:[], remove:[], update:[], keep:[]});
});

// ---- The caller. A helper tested alone says nothing about who calls it. ----
// payroll.test.js passing 16/16 while the export was broken is why this exists.
// Inserts go through the create_record RPC, never a direct insert: there is no insert
// policy on app_submissions, so a direct insert is refused by RLS. That is not a detail
// the stub may paper over — it is the bug this stub exists to catch.
function stubDb(fail){
  const calls = [];
  const res = (kind) => Promise.resolve({error: (fail === kind) ? {message:'nope'} : null, data: 'new-id'});
  return { calls,
    rpc(name, args){ calls.push({kind:name, args}); return res(name); },
    from(){ return {
      insert(rows){ calls.push({kind:'insert', rows}); return res('insert'); },
      update(patch){ return {
        eq(col, id){ calls.push({kind:'update', patch, id}); return res('update'); } }; },
      delete(){ return {
        in(col, ids){ calls.push({kind:'delete', ids}); return res('delete'); } }; }
    }; } };
}
const RCFG = {assign_name:'R_NM', assign_phone:'R_PH'};
const ctx = (existing, ticked, db) => ({db, rosterTableId:'T_ROSTER', eventId:'e-1',
  rosterCfg:RCFG, existing, ticked});
// what submitAssignments receives from the panel: raw roster rows
const RAW = (id, name, slot) => ({id, slot, data:{R_NM:name, R_PH:'+1'}});

(async () => {

await T('an unchanged roster writes NOTHING — the rule the feature lives on', async () => {
  const db = stubDb();
  await API.submitAssignments(ctx([RAW('r1','Ahmad','confirmed')], [P('Ahmad','+1','confirmed')], db));
  assert.deepStrictEqual(asW(db.calls), [],
    'a re-submit with no change must not touch the database at all — every write is a message');
});

await T('adding one to seven inserts one row and leaves the seven alone', async () => {
  const db = stubDb();
  const have = ['A','B','C','D','E','F','G'].map((x,i)=>RAW('r'+i,x,'confirmed'));
  const want = ['A','B','C','D','E','F','G','H'].map(x=>P(x,'+1','confirmed'));
  await API.submitAssignments(ctx(have, want, db));
  const ins = db.calls.filter(c=>c.kind==='create_record');
  assert.strictEqual(ins.length, 1, 'exactly one person created, not eight');
  assert.strictEqual(ins[0].args.p_data.R_NM, 'H');
  assert.strictEqual(db.calls.filter(c=>c.kind==='insert').length, 0,
    'a direct insert is refused by RLS — there is no insert policy on app_submissions');
  assert.strictEqual(db.calls.filter(c=>c.kind==='delete').length, 0);
  assert.strictEqual(db.calls.filter(c=>c.kind==='update').length, 0);
});

await T('an inserted row carries the event as parent, the phone, and slot as a COLUMN', async () => {
  const db = stubDb();
  await API.submitAssignments(ctx([], [P('Ahmad','+962791','backup')], db));
  const a = db.calls.filter(c=>c.kind==='create_record')[0].args;
  assert.strictEqual(a.p_table, 'T_ROSTER');
  assert.strictEqual(a.p_parent, 'e-1', 'without a parent the row is invisible and earns nothing');
  assert.strictEqual(a.p_slot, 'backup',
    'payrollRows filters s.slot, the native column — a slot inside data is never paid');
  assert.ok(!a.p_data.slot, 'and it must not also be written into data, or the two can disagree');
  assert.strictEqual(a.p_data.R_NM, 'Ahmad');
  assert.strictEqual(a.p_data.R_PH, '+962791', 'the number is copied onto the row, not looked up later');
});

await T('a slot change issues a column update and no insert or delete', async () => {
  const db = stubDb();
  await API.submitAssignments(ctx([RAW('r1','Ahmad','confirmed')], [P('Ahmad','+1','backup')], db));
  assert.strictEqual(db.calls.filter(c=>c.kind==='create_record').length, 0, 'no insert: it would message again');
  assert.strictEqual(db.calls.filter(c=>c.kind==='delete').length, 0);
  const up = db.calls.filter(c=>c.kind==='update');
  assert.strictEqual(up.length, 1);
  assert.deepStrictEqual(asW(up[0].patch), {slot:'backup'});
  assert.strictEqual(up[0].id, 'r1');
});

await T('removals are deleted in one call rather than one round trip each', async () => {
  const db = stubDb();
  const have = ['A','B','C'].map((x,i)=>RAW('r'+i,x,'confirmed'));
  await API.submitAssignments(ctx(have, [], db));
  const del = db.calls.filter(c=>c.kind==='delete');
  assert.strictEqual(del.length, 1);
  assert.deepStrictEqual(asW(del[0].ids).sort(), ['r0','r1','r2']);
});

await T('inserts go LAST, so nothing is messaged before the removals have landed', async () => {
  const db = stubDb();
  await API.submitAssignments(ctx([RAW('r1','Ahmad','confirmed')], [P('Sara','+1','confirmed')], db));
  const kinds = db.calls.map(c=>c.kind);
  assert.deepStrictEqual(asW(kinds), ['delete','create_record']);
});

await T('a failed delete stops before anything is inserted', async () => {
  const db = stubDb('delete');
  let threw = false;
  try { await API.submitAssignments(ctx([RAW('r1','Ahmad','confirmed')], [P('Sara','+1','confirmed')], db)); }
  catch (e) { threw = true; }
  assert.ok(threw, 'a failed write must surface, not be swallowed');
  assert.strictEqual(db.calls.filter(c=>c.kind==='create_record').length, 0, 'nothing inserted after a failed delete');
});

await T('a failed insert surfaces too', async () => {
  const db = stubDb('create_record');
  let threw = false;
  try { await API.submitAssignments(ctx([], [P('Sara','+1','confirmed')], db)); }
  catch (e) { threw = true; }
  assert.ok(threw);
});

await T('the diff is handed back, so the panel can say what actually happened', async () => {
  const db = stubDb();
  const d = await API.submitAssignments(ctx([RAW('r1','Ahmad','confirmed')],
    [P('Ahmad','+1','confirmed'), P('Sara','+2','confirmed')], db));
  assert.strictEqual(d.insert.length, 1);
  assert.strictEqual(d.keep.length, 1);
});

// ---- Gating and restraint, read out of the page as source ----------------
const SRC = fs.readFileSync('index.html','utf8');
// The button lives on the record, because a roster belongs to one event.
t('the Assign button is gated on canManage, like Payroll — it creates paid rows', () => {
  const m = /var mayAssign = ([^;]*);/.exec(SRC);
  assert.ok(m, 'no gate for the Assign button on the record panel');
  assert.ok(/assignConfig\(/.test(m[1]) && /canManage\(/.test(m[1]),
    'assigning creates the rows payroll pays, so it follows can_manage not can_edit');
  assert.ok(/mayAssign \?/.test(SRC), 'the gate has to actually decide whether the button is drawn');
  assert.ok(/if \(mayAssign\)/.test(SRC), 'and whether it is wired');
});
t('openAssign refuses to run for someone who cannot manage, even if called directly', () => {
  const fn = grab(scripts('index.html'), 'openAssign', 'index.html');
  assert.ok(/canManage\(t\.id\)/.test(fn), 'the gate must not live only in the markup');
});
t('submitting a roster never touches the event status', () => {
  const fn = grab(scripts('index.html'), 'submitAssignments', 'index.html');
  assert.ok(!/status/.test(fn),
    'auto-closing on a half-finished roster would stop anyone voting into the gap still to fill');
});
t('capacity warns and never blocks', () => {
  assert.ok(/assign-over|assignOver|over-capacity|\bover\b/.test(SRC),
    'over capacity must be shown; Zamel is the manager and the number is advisory');
  const fn = grab(scripts('index.html'), 'submitAssignments', 'index.html');
  assert.ok(!/capacity/.test(fn), 'the write must not enforce a limit');
});

console.log(n + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
})();
