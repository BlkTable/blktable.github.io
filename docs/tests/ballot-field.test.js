const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const F = load('f/index.html', ['eventDays','ballotKey','ballotLabel','ballotOptions']);
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
  assert.deepStrictEqual(asW(opts.map(o => o.value)), ['e-1#2026-09-10','e-2#2026-09-14']);
});
t('renaming an event cannot orphan a vote, because the value never mentions the name', () => {
  const before = F.ballotOptions(EV).map(o => o.value);
  const renamed = EV.map(e => Object.assign({}, e, {name: e.name + ' (moved)'}));
  assert.deepStrictEqual(asW(F.ballotOptions(renamed).map(o => o.value)), asW(before));
});

// ---- Order: a barista reads a list of dates, so it is sorted by date -------
t('options are ordered by date, not by the order the rows arrived', () => {
  assert.deepStrictEqual(asW(F.ballotOptions(EV).map(o => o.label.split(' — ')[0])),
    ['Autumn Fair','Wedding']);
});
t('two events on one date fall back to the name, so the order is never arbitrary', () => {
  const same = [{id:'b', name:'Zed', date:'2026-09-10'}, {id:'a', name:'Alpha', date:'2026-09-10'}];
  assert.deepStrictEqual(asW(F.ballotOptions(same).map(o => o.value)), ['a#2026-09-10','b#2026-09-10']);
});
// Matches what ballot_options already does in SQL: `order by date` puts nulls last.
t('a dateless event sorts last rather than first, so it cannot head the ballot', () => {
  const mixed = [{id:'n', name:'No date'}, {id:'d', name:'Dated', date:'2026-09-10'}];
  assert.deepStrictEqual(asW(F.ballotOptions(mixed).map(o => o.value)), ['d#2026-09-10','n#']);
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

// ---- Multi-day events: one tick box per day -------------------------------
t('a single day is one day, which is every event written before End date existed', () => {
  assert.deepStrictEqual(asW(F.eventDays('2026-09-10', null)), ['2026-09-10']);
  assert.deepStrictEqual(asW(F.eventDays('2026-09-10', '')), ['2026-09-10']);
  assert.deepStrictEqual(asW(F.eventDays('2026-09-10', '2026-09-10')), ['2026-09-10']);
});
t('a range is inclusive at both ends', () => {
  assert.deepStrictEqual(asW(F.eventDays('2026-09-10', '2026-09-12')),
    ['2026-09-10','2026-09-11','2026-09-12']);
});
t('it crosses a month and a year boundary correctly', () => {
  assert.deepStrictEqual(asW(F.eventDays('2026-08-31', '2026-09-01')), ['2026-08-31','2026-09-01']);
  assert.deepStrictEqual(asW(F.eventDays('2026-12-31', '2027-01-01')), ['2026-12-31','2027-01-01']);
});
t('a leap day is a real day', () => {
  assert.deepStrictEqual(asW(F.eventDays('2028-02-28', '2028-03-01')),
    ['2028-02-28','2028-02-29','2028-03-01']);
});
t('an end BEFORE the start is one day, not zero and not backwards', () => {
  assert.deepStrictEqual(asW(F.eventDays('2026-09-10', '2026-09-01')), ['2026-09-10']);
});
t('no date at all is one unnamed day, so a dateless event is still tickable', () => {
  assert.deepStrictEqual(asW(F.eventDays(null, null)), [null]);
  assert.deepStrictEqual(asW(F.eventDays('', '2026-09-12')), [null]);
  assert.deepStrictEqual(asW(F.eventDays('not-a-date', null)), [null]);
});
t('a year typed wrong is capped, so it cannot draw hundreds of boxes', () => {
  assert.strictEqual(F.eventDays('2026-09-10', '2027-09-10').length, 60);
});

t('a three-day event becomes three tick boxes, one per day', () => {
  const three = [{id:'e-9', name:'Fair', date:'2026-09-10', end_date:'2026-09-12',
                  start:'10:00', location:'Khalda'}];
  const opts = F.ballotOptions(three);
  assert.strictEqual(opts.length, 3);
  assert.deepStrictEqual(asW(opts.map(o => o.value)),
    ['e-9#2026-09-10','e-9#2026-09-11','e-9#2026-09-12']);
});
t('each day says which day it is, so two boxes are never indistinguishable', () => {
  const three = [{id:'e-9', name:'Fair', date:'2026-09-10', end_date:'2026-09-12', start:'10:00'}];
  const opts = F.ballotOptions(three);
  assert.ok(/day 1 of 3/.test(opts[0].label), opts[0].label);
  assert.ok(/day 3 of 3/.test(opts[2].label), opts[2].label);
  assert.ok(/2026-09-11/.test(opts[1].label), 'and each carries its own date, not the first');
});
t('a single-day event says nothing about days, so it reads as it always did', () => {
  const one = [{id:'e-1', name:'Autumn Fair', date:'2026-09-10', start:'10:00', location:'Khalda'}];
  assert.strictEqual(F.ballotOptions(one)[0].label, 'Autumn Fair — 2026-09-10 10:00 · Khalda');
});
t('the value carries the day, so ticking Friday is not ticking Saturday', () => {
  assert.strictEqual(F.ballotKey('e-9','2026-09-10'), 'e-9#2026-09-10');
  assert.notStrictEqual(F.ballotKey('e-9','2026-09-10'), F.ballotKey('e-9','2026-09-11'));
});
t('a dateless event still gets a stable key rather than "undefined"', () => {
  assert.strictEqual(F.ballotKey('e-9', null), 'e-9#');
  assert.strictEqual(F.ballotKey('e-9', undefined), 'e-9#');
});

// ---- The page must not send a key the database has not got ---------------
// Same rule as p_token and p_device: PostgREST resolves an RPC by the keys in the
// body, and a form that hard-fails when ballot_options is missing is a form that
// cannot be deployed before the migration.
const SRC = fs.readFileSync('f/index.html','utf8');
t('the ballot fetch tolerates a missing function instead of killing the page', () => {
  // Anchored on the call and its .catch rather than on the end of the line: this repo's
  // checkouts are CRLF, and a regex needing ";\n" passes on one machine and fails on
  // another after nothing more than a rebase.
  const m = /var ballotReady = db\.rpc\([\s\S]{0,400}?\.catch\(/.exec(SRC);
  assert.ok(m, 'ballotReady must catch — a database without ballot_options must still render the form');
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
// A vote names one day, stored as "<id>#<date>". Looking the whole key up as an id
// would print "(deleted event)" against every good vote.
t('a day-bearing vote reads as the event and the day', () => {
  assert.strictEqual(D.ballotNames('e-1#2026-09-10', BY), 'Autumn Fair (2026-09-10)');
});
t('three days of one event read as three entries, each with its date', () => {
  assert.strictEqual(D.ballotNames('e-1#2026-09-10, e-1#2026-09-11', BY),
    'Autumn Fair (2026-09-10), Autumn Fair (2026-09-11)');
});
t('a dayless key still reads as just the event', () => {
  assert.strictEqual(D.ballotNames('e-1#', BY), 'Autumn Fair');
  assert.strictEqual(D.ballotNames('e-1', BY), 'Autumn Fair');
});
t('a deleted event still says so, with its day', () => {
  assert.strictEqual(D.ballotNames('gone#2026-09-10', BY), '(deleted event) (2026-09-10)');
});
t('order follows what the barista ticked, not the lookup table', () => {
  assert.strictEqual(D.ballotNames('e-2, e-1', BY), 'Wedding, Autumn Fair');
});

console.log(n + ' passed');
