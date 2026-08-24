const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name,file){const re=new RegExp('\\n  function '+name+'\\s*\\([\\s\\S]*?\\n  \\}','');const m=js.match(re);if(!m)throw new Error('no fn '+name+' in '+file);return m[0];}
function load(file,names,extra){const js=scripts(file);const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+names.map(n=>grab(js,n,file)).join('\n')+'\n this.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const API = load('index.html', ['assignConfig','assignPersonKey','assignCandidates',
                                'assignMonthCount','eventsOverlap','assignClashes']);
const asW = o => JSON.parse(JSON.stringify(o));
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

const CFG = {from:'barista-availability-zamel', match:'F_EV', name:'F_NM', phone:'F_PH',
             roster:'event-assignments-zamel', capacity:'F_CAP'};
const row = (id, name, phone, evs, at) =>
  ({id, created_at: at, data: {F_NM: name, F_PH: phone, F_EV: evs}});

// ---- assignConfig: a half-written config is no config --------------------
t('a complete config is returned', () => {
  assert.deepStrictEqual(API.assignConfig({config:{assign:CFG}}), CFG);
});
t('a config missing from, match, roster or name is null, not half-usable', () => {
  assert.strictEqual(API.assignConfig({config:{assign:{from:'x', match:'y'}}}), null);
  assert.strictEqual(API.assignConfig({config:{assign:{match:'y', roster:'z', name:'n'}}}), null);
  assert.strictEqual(API.assignConfig({config:{assign:{from:'x', roster:'z', name:'n'}}}), null);
  assert.strictEqual(API.assignConfig({config:{}}), null);
  assert.strictEqual(API.assignConfig(null), null);
});

// ---- Identity. Must agree with payrollRows or the roster and the money
// ---- disagree about who a person is.
t('a name is identified trimmed and lowercased, the same rule payroll uses', () => {
  assert.strictEqual(API.assignPersonKey('Ahmad'), 'ahmad');
  assert.strictEqual(API.assignPersonKey('  ahmad  '), 'ahmad');
  assert.strictEqual(API.assignPersonKey(null), '');
  assert.strictEqual(API.assignPersonKey(undefined), '');
});

// ---- The rule Zamel described: only people who voted for THIS event ------
t('only people who ticked this event are candidates', () => {
  const rows = [row('s1','Ahmad','+962791','e-1, e-2','2026-08-01T10:00:00Z'),
                row('s2','Sara','+962792','e-2','2026-08-01T11:00:00Z')];
  assert.deepStrictEqual(asW(API.assignCandidates(rows,'e-1',CFG).map(c=>c.name)), ['Ahmad']);
  assert.deepStrictEqual(asW(API.assignCandidates(rows,'e-2',CFG).map(c=>c.name)), ['Ahmad','Sara']);
});
t('somebody who voted for A and B is NOT offered for C', () => {
  const rows = [row('s1','Ali','+962791','e-A, e-B','2026-08-01T10:00:00Z')];
  assert.deepStrictEqual(asW(API.assignCandidates(rows,'e-C',CFG)), []);
});
t('a substring is not a tick — e-1 must never match e-12', () => {
  const rows = [row('s1','Ahmad','+962791','e-12','2026-08-01T10:00:00Z')];
  assert.deepStrictEqual(asW(API.assignCandidates(rows,'e-1',CFG)), []);
});
t('spacing in the stored tick list does not matter', () => {
  const rows = [row('s1','Ahmad','+962791','  e-1 ,e-2 ','2026-08-01T10:00:00Z')];
  assert.strictEqual(API.assignCandidates(rows,'e-1',CFG).length, 1);
});
t('the phone comes across, because it is what the message is sent to', () => {
  const rows = [row('s1','Ahmad','+962791','e-1','2026-08-01T10:00:00Z')];
  assert.strictEqual(API.assignCandidates(rows,'e-1',CFG)[0].phone, '+962791');
});

// ---- Voting again replaces, never duplicates ----------------------------
t('three submissions from one person are one candidate, and the latest wins', () => {
  const rows = [row('s1','Ahmad','+962791','e-1','2026-08-01T10:00:00Z'),
                row('s2','Ahmad','+962791','e-1','2026-08-05T10:00:00Z'),
                row('s3','Ahmad','+962799','e-1','2026-08-09T10:00:00Z')];
  const got = API.assignCandidates(rows,'e-1',CFG);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].phone, '+962799', 'a new number on the latest vote is the one used');
});
t('the LATEST vote decides, so withdrawing a tick actually withdraws it', () => {
  const rows = [row('s1','Ahmad','+962791','e-1, e-2','2026-08-01T10:00:00Z'),
                row('s2','Ahmad','+962791','e-2','2026-08-09T10:00:00Z')];
  assert.deepStrictEqual(asW(API.assignCandidates(rows,'e-1',CFG)), []);
  assert.strictEqual(API.assignCandidates(rows,'e-2',CFG).length, 1);
});
t('array order never decides — only created_at does', () => {
  const a = [row('s1','Ahmad','+962791','e-1','2026-08-09T10:00:00Z'),
             row('s2','Ahmad','+962791','','2026-08-01T10:00:00Z')];
  assert.strictEqual(API.assignCandidates(a,'e-1',CFG).length, 1);
  assert.strictEqual(API.assignCandidates(a.slice().reverse(),'e-1',CFG).length, 1);
});
// Votes now arrive under different polls. An event can sit on more than one link, and
// a person's vote counts wherever it was cast — the tick names the event, not the poll.
t('votes from two different polls both count for the same event', () => {
  const rows = [Object.assign(row('s1','Ahmad','+1','e-1','2026-08-01T10:00:00Z'), {parent_id:'poll-A'}),
                Object.assign(row('s2','Sara','+2','e-1','2026-08-02T10:00:00Z'), {parent_id:'poll-B'})];
  assert.deepStrictEqual(asW(API.assignCandidates(rows,'e-1',CFG).map(c=>c.name)), ['Ahmad','Sara']);
});

// ---- One person, spelled two ways --------------------------------------
t('Ahmad and "  ahmad  " are one person, and the display keeps the typed spelling', () => {
  const rows = [row('s1','Ahmad','+962791','e-1','2026-08-01T10:00:00Z'),
                row('s2','  ahmad  ','+962792','e-1','2026-08-09T10:00:00Z')];
  const got = API.assignCandidates(rows,'e-1',CFG);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].name, 'ahmad', 'the latest spelling, trimmed — not the lowercase key');
  assert.strictEqual(got[0].key, 'ahmad');
});
t('a nameless vote is kept as (no name) rather than silently dropped', () => {
  const rows = [row('s1','','+962791','e-1','2026-08-01T10:00:00Z')];
  const got = API.assignCandidates(rows,'e-1',CFG);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].name, '(no name)');
});
t('candidates come back sorted by name, so the list does not reshuffle on reload', () => {
  const rows = [row('s1','Sara','+1','e-1','2026-08-01T10:00:00Z'),
                row('s2','Ahmad','+2','e-1','2026-08-02T10:00:00Z'),
                row('s3','Mego','+3','e-1','2026-08-03T10:00:00Z')];
  assert.deepStrictEqual(asW(API.assignCandidates(rows,'e-1',CFG).map(c=>c.name)), ['Ahmad','Mego','Sara']);
});
t('no rows, no event, or a null config is an empty list rather than a throw', () => {
  assert.deepStrictEqual(asW(API.assignCandidates([], 'e-1', CFG)), []);
  assert.deepStrictEqual(asW(API.assignCandidates(null, 'e-1', CFG)), []);
  assert.deepStrictEqual(asW(API.assignCandidates([row('s1','A','+1','e-1','2026-08-01T10:00:00Z')], 'e-1', null)), []);
  assert.deepStrictEqual(asW(API.assignCandidates([row('s1','A','+1','e-1','2026-08-01T10:00:00Z')], null, CFG)), []);
});

// ---- Spreading the work -------------------------------------------------
const EVS = {'e-1':{id:'e-1',date:'2026-09-10'}, 'e-2':{id:'e-2',date:'2026-09-14'},
             'e-3':{id:'e-3',date:'2026-10-02'}};
const rrow = (pid, name) => ({id:'r'+name+pid, parent_id: pid, data:{R_NM: name}});

t("counts a person's events in the given month only", () => {
  const roster = [rrow('e-1','Ahmad'), rrow('e-2','Ahmad'), rrow('e-3','Ahmad'), rrow('e-1','Sara')];
  const c = API.assignMonthCount(roster, EVS, '2026-09', 'R_NM');
  assert.strictEqual(c['ahmad'], 2, 'October must not be counted into September');
  assert.strictEqual(c['sara'], 1);
});
t('the same name spelled differently counts as one person here too', () => {
  const roster = [rrow('e-1','Ahmad'), rrow('e-2','  ahmad ')];
  assert.strictEqual(API.assignMonthCount(roster, EVS, '2026-09', 'R_NM')['ahmad'], 2);
});
t('a roster row whose event is gone is counted into no month', () => {
  assert.deepStrictEqual(asW(API.assignMonthCount([rrow('e-nope','Ahmad')], EVS, '2026-09', 'R_NM')), {});
});
t('an empty roster is an empty count, not a throw', () => {
  assert.deepStrictEqual(asW(API.assignMonthCount([], EVS, '2026-09', 'R_NM')), {});
  assert.deepStrictEqual(asW(API.assignMonthCount(null, EVS, '2026-09', 'R_NM')), {});
});

// ---- Double-booking, and the data is right there ------------------------
const ev = (date, start, end) => ({date, start, end});

t('two events on different days never clash', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00','16:00'), ev('2026-09-11','10:00','16:00')), false);
});
t('overlapping times on one day clash', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00','16:00'), ev('2026-09-10','15:00','20:00')), true);
});
t('touching but not overlapping does not clash — 10-16 and 16-20 are two shifts', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00','16:00'), ev('2026-09-10','16:00','20:00')), false);
});
t('one event inside another clashes', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','09:00','23:00'), ev('2026-09-10','12:00','14:00')), true);
});
t('seconds on the stored time do not change the answer', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00:00','16:00:00'), ev('2026-09-10','16:00:00','20:00:00')), false);
});
t('a missing end time counts as the end of the day, as eventPhase already treats it', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','10:00',null), ev('2026-09-10','20:00','22:00')), true);
});
t('an end before its own start is the end of the day, not a negative shift', () => {
  // Otherwise the window collapses and a real clash reads as free.
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10','18:00','02:00'), ev('2026-09-10','20:00','22:00')), true);
});
t('a missing start counts from the beginning of the day rather than never', () => {
  assert.strictEqual(API.eventsOverlap(ev('2026-09-10',null,'09:00'), ev('2026-09-10','08:00','10:00')), true);
});
t('a dateless event clashes with nothing rather than with everything', () => {
  assert.strictEqual(API.eventsOverlap(ev(null,'10:00','16:00'), ev('2026-09-10','10:00','16:00')), false);
  assert.strictEqual(API.eventsOverlap(null, ev('2026-09-10','10:00','16:00')), false);
});

const THIS = {id:'e-1', name:'Autumn Fair', date:'2026-09-10', start:'10:00', end:'16:00'};
const ALL  = {'e-1': THIS,
              'e-9': {id:'e-9', name:'Brunch',  date:'2026-09-10', start:'12:00', end:'14:00'},
              'e-8': {id:'e-8', name:'Evening', date:'2026-09-10', start:'18:00', end:'22:00'},
              'e-7': {id:'e-7', name:'Next day',date:'2026-09-11', start:'10:00', end:'16:00'}};

t('a person already on an overlapping event is flagged, and the event is named', () => {
  const roster = [{id:'r1', parent_id:'e-9', data:{R_NM:'Ahmad'}}];
  assert.deepStrictEqual(asW(API.assignClashes(roster, THIS, ALL, 'R_NM')), {ahmad: ['Brunch']});
});
t('a non-overlapping same-day event is not a clash', () => {
  const roster = [{id:'r1', parent_id:'e-8', data:{R_NM:'Ahmad'}}];
  assert.deepStrictEqual(asW(API.assignClashes(roster, THIS, ALL, 'R_NM')), {});
});
t("this event's own roster is never a clash with itself", () => {
  const roster = [{id:'r1', parent_id:'e-1', data:{R_NM:'Ahmad'}}];
  assert.deepStrictEqual(asW(API.assignClashes(roster, THIS, ALL, 'R_NM')), {});
});
t('two clashes for one person are both named, and named once each', () => {
  const roster = [{id:'r1', parent_id:'e-9', data:{R_NM:'Ahmad'}},
                  {id:'r2', parent_id:'e-6', data:{R_NM:'Ahmad'}},
                  {id:'r3', parent_id:'e-6', data:{R_NM:'Ahmad'}}];
  const all = Object.assign({}, ALL, {'e-6': {id:'e-6', name:'Lunch', date:'2026-09-10', start:'11:00', end:'13:00'}});
  assert.deepStrictEqual(asW(API.assignClashes(roster, THIS, all, 'R_NM').ahmad).sort(), ['Brunch','Lunch']);
});
t('an empty roster clashes with nothing', () => {
  assert.deepStrictEqual(asW(API.assignClashes([], THIS, ALL, 'R_NM')), {});
  assert.deepStrictEqual(asW(API.assignClashes(null, THIS, ALL, 'R_NM')), {});
});

console.log(n + ' passed');
