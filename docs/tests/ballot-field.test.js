const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const F = load('f/index.html', ['ballotLabel','ballotOptions']);
// Values cross the vm realm boundary, so deepStrictEqual would compare prototypes
// from two different Array constructors. Same round-trip branch-field.test.js uses.
const asW=o=>JSON.parse(JSON.stringify(o));
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

const EV = [
  {id:'e-2', name:'Wedding',    date:'2026-09-14', start:'18:00:00', end:'23:00:00', location:'Abdoun'},
  {id:'e-1', name:'Autumn Fair',date:'2026-09-10', start:'10:00:00', end:'16:00:00', location:'Khalda'}
];

// ---- The label is what a barista reads, so it has to identify the shift -----
t('the label carries name, date, start time and place', () => {
  assert.strictEqual(F.ballotLabel(EV[1]), 'Autumn Fair — 2026-09-10 10:00 · Khalda');
});
t('the time is trimmed to hours and minutes, not seconds', () => {
  assert.ok(!/10:00:00/.test(F.ballotLabel(EV[1])));
});
t('a missing date, time or place drops that part instead of printing "undefined"', () => {
  assert.strictEqual(F.ballotLabel({id:'x', name:'Pop-up'}), 'Pop-up');
  assert.strictEqual(F.ballotLabel({id:'x', name:'Pop-up', date:'2026-09-01'}), 'Pop-up — 2026-09-01');
});
t('an event with no name still reads as something rather than as blank', () => {
  assert.strictEqual(F.ballotLabel({id:'x', date:'2026-09-01'}), '(untitled) — 2026-09-01');
});
// The rate is carried by ballot_options but deliberately NOT in the label yet. The
// built flow decided the event link says what the shift pays (workspaces/30), so
// turning it on later is a one-line change here and nothing else.
t('the label does not print the rate — that is a separate decision, not an accident', () => {
  // Compared against the same event without a rate, rather than by grepping for "15":
  // "2026-09-10" contains a 20 and a 10, so a digit search here tests nothing.
  assert.strictEqual(F.ballotLabel(Object.assign({rate:'15'}, EV[1])), F.ballotLabel(EV[1]));
});

// ---- The VALUE is the id. This is the test that protects every vote. -------
t('the value is the record id, never the name', () => {
  const opts = F.ballotOptions(EV);
  assert.deepStrictEqual(opts.map(o => o.value), ['e-1','e-2']);
});
t('renaming an event cannot orphan a vote, because the value never mentions the name', () => {
  const before = F.ballotOptions(EV).map(o => o.value);
  const renamed = EV.map(e => Object.assign({}, e, {name: e.name + ' (moved)'}));
  assert.deepStrictEqual(asW(F.ballotOptions(renamed).map(o => o.value)), asW(before));
});

// ---- Order: a barista reads a list of dates, so it is sorted by date -------
t('options are ordered by date, not by the order the rows arrived', () => {
  assert.deepStrictEqual(F.ballotOptions(EV).map(o => o.label.split(' — ')[0]),
    ['Autumn Fair','Wedding']);
});
t('two events on one date fall back to the name, so the order is never arbitrary', () => {
  const same = [{id:'b', name:'Zed', date:'2026-09-10'}, {id:'a', name:'Alpha', date:'2026-09-10'}];
  assert.deepStrictEqual(asW(F.ballotOptions(same).map(o => o.value)), ['a','b']);
});
// Matches what ballot_options already does in SQL: `order by date` puts nulls last.
t('a dateless event sorts last rather than first, so it cannot head the ballot', () => {
  const mixed = [{id:'n', name:'No date'}, {id:'d', name:'Dated', date:'2026-09-10'}];
  assert.deepStrictEqual(asW(F.ballotOptions(mixed).map(o => o.value)), ['d','n']);
});

// ---- Nothing to vote on is a normal state, not an error -------------------
t('no events, a failed RPC, or a database without the function all read as empty', () => {
  assert.deepStrictEqual(asW(F.ballotOptions([])), []);
  assert.deepStrictEqual(asW(F.ballotOptions(null)), []);
  assert.deepStrictEqual(asW(F.ballotOptions(undefined)), []);
});
t('ballotOptions never mutates the array it was handed', () => {
  const rows = EV.slice();
  F.ballotOptions(rows);
  assert.strictEqual(rows[0].id, 'e-2');
});

// ---- The page must not send a key the database has not got ---------------
// Same rule as p_token and p_device: PostgREST resolves an RPC by the keys in the
// body, and a form that hard-fails when ballot_options is missing is a form that
// cannot be deployed before the migration.
const SRC = fs.readFileSync('f/index.html','utf8');
t('the ballot fetch tolerates a missing function instead of killing the page', () => {
  const m = /ballotReady\s*=[\s\S]{0,500}?;\n/.exec(SRC);
  assert.ok(m, 'no ballotReady in the boot sequence');
  assert.ok(/\.catch\(/.test(m[0]), 'ballotReady must catch — a database without ballot_options must still render the form');
});
t('the ballot is fetched alongside the branches, not in a second round trip', () => {
  assert.ok(/Promise\.all\(\[fieldsReady, branchesReady, countriesReady, ballotReady\]\)/.test(SRC),
    'ballotReady must join the existing Promise.all');
});
t('record_multi is rendered by buildField', () => {
  assert.ok(/f\.type === "record_multi"/.test(SRC), 'buildField has no record_multi branch');
});
t('the ballot checkbox value is the id and the text is the label', () => {
  const b = /f\.type === "record_multi"([\s\S]*?)\n    \} else if/.exec(SRC);
  assert.ok(b, 'could not isolate the record_multi branch');
  assert.ok(/cb\.value = o\.value/.test(b[1]), 'the checkbox value must be the record id');
  assert.ok(/o\.label/.test(b[1]), 'the checkbox text must be the label');
});
t('an empty ballot says so rather than showing an empty box', () => {
  const b = /f\.type === "record_multi"([\s\S]*?)\n    \} else if/.exec(SRC);
  assert.ok(/ropts\.length/.test(b[1]), 'nothing checks whether there is anything to vote on');
});

// ---- Ids are correct storage and useless display -------------------------
const D = load('index.html', ['ballotNames']);
const BY = {'e-1': {id:'e-1', name:'Autumn Fair', date:'2026-09-10'},
            'e-2': {id:'e-2', name:'Wedding',     date:'2026-09-14'}};

t('a stored id list is shown as names', () => {
  assert.strictEqual(D.ballotNames('e-1, e-2', BY), 'Autumn Fair, Wedding');
});
t('spacing in the stored string does not matter', () => {
  assert.strictEqual(D.ballotNames('e-1,e-2', BY), 'Autumn Fair, Wedding');
  assert.strictEqual(D.ballotNames('  e-1 ,  e-2  ', BY), 'Autumn Fair, Wedding');
});
t('an id whose event was deleted is shown as a deleted event, not dropped', () => {
  // Dropping it would make a vote for a deleted event look like a vote never cast.
  assert.strictEqual(D.ballotNames('e-1, gone', BY), 'Autumn Fair, (deleted event)');
});
t('an empty or absent answer is empty, never the word undefined', () => {
  assert.strictEqual(D.ballotNames('', BY), '');
  assert.strictEqual(D.ballotNames(null, BY), '');
  assert.strictEqual(D.ballotNames(undefined, BY), '');
});
t('no lookup table yet reads as deleted rather than throwing', () => {
  assert.strictEqual(D.ballotNames('e-1', null), '(deleted event)');
});
t('order follows what the barista ticked, not the lookup table', () => {
  assert.strictEqual(D.ballotNames('e-2, e-1', BY), 'Wedding, Autumn Fair');
});

console.log(n + ' passed');
