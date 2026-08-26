// The sidebar's left edge. Two rules, both of which showed up as "why do these all look
// different?" rather than as a bug report about grouping.
//
// 1. A GROUP OF ONE IS NOT A GROUP. The Airtable migration made one category per base, and
//    37 of those bases hold a single table — so the sidebar showed a fold arrow, the base's
//    name and the count "1", and opening it revealed one table usually called the same
//    thing. Two rows and two clicks for one form, and no emblem to recognise it by.
// 2. EVERY ROW STARTS AT THE SAME x. A table's row opens with its 20px colour mark; a
//    category's opened with a text arrow inside the label, so headings sat half a character
//    out of line with everything underneath them.
//
// The first is a pure function and is tested as one. The second is markup, so it is read out
// of the page as source — the same way archive.test.js checks its menus.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
const SRC = scripts('index.html');
function load(names){const ctx={console};vm.createContext(ctx);new vm.Script('(function(){'+names.map(grab.bind(null,SRC)).join('\n')+'\nthis.API={'+names.join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}
const API = load(['groupByCategory']);
const asW = o => JSON.parse(JSON.stringify(o));
let n=0; const t=(name,fn)=>{try{fn();n++;}catch(e){console.log('FAIL: '+name+' -> '+e.message);process.exitCode=1;}};

const shape = gs => asW(gs).map(g => [g.name, g.items.map(t => t.name)]);

t('a category holding two or more tables is still a group', () => {
  const out = shape(API.groupByCategory([
    {name:'A', category:'Finance'}, {name:'B', category:'Finance'}
  ]));
  assert.deepStrictEqual(out, [['Finance', ['A','B']]]);
});

t('a category holding exactly one table is not a group — the table is listed directly', () => {
  const out = shape(API.groupByCategory([
    {name:'Bas Offerat Data', category:'Bas Offerat Data'}
  ]));
  assert.deepStrictEqual(out, [['', ['Bas Offerat Data']]]);
});

t('the lone table keeps its place in the flat list instead of being appended after it', () => {
  // It used to be simplest to move singletons out of their group afterwards, which put all
  // 37 of them in a block at the bottom in an order nobody chose.
  const out = shape(API.groupByCategory([
    {name:'First'},                             // no category at all
    {name:'Alone', category:'Alone'},           // a group of one
    {name:'Last'}
  ]));
  assert.deepStrictEqual(out, [['', ['First','Alone','Last']]]);
});

t('a group of one and a real group can coexist, uncategorised first then A→Z', () => {
  const out = shape(API.groupByCategory([
    {name:'Loose'},
    {name:'Solo', category:'Solo base'},
    {name:'Q1', category:'Ops'}, {name:'Q2', category:'Ops'},
    {name:'E1', category:'Events'}, {name:'E2', category:'Events'}
  ]));
  assert.deepStrictEqual(out, [['', ['Loose','Solo']], ['Events', ['E1','E2']], ['Ops', ['Q1','Q2']]]);
});

t('a category becomes a group again by itself the moment a second table joins it', () => {
  // Nothing is written to the database when a group is flattened — the category is still
  // there, saying where the table came from. This is the proof.
  const one = [{name:'Solo', category:'Merchant application'}];
  assert.deepStrictEqual(shape(API.groupByCategory(one)), [['', ['Solo']]]);
  assert.deepStrictEqual(shape(API.groupByCategory(one.concat([{name:'Two', category:'Merchant application'}]))),
                         [['Merchant application', ['Solo','Two']]]);
});

t('whitespace-only and missing categories are the same thing', () => {
  const out = shape(API.groupByCategory([{name:'A', category:'   '}, {name:'B', category:null}, {name:'C'}]));
  assert.deepStrictEqual(out, [['', ['A','B','C']]]);
});

t('an empty list produces no groups rather than one empty heading', () => {
  assert.deepStrictEqual(shape(API.groupByCategory([])), []);
  assert.deepStrictEqual(shape(API.groupByCategory(null)), []);
});

// ---- the left edge ----------------------------------------------------------
t('both fold headings put their arrow in a fixed slot, not inside the label', () => {
  // Two paint functions, one for categories and one for workspaces. Either one left as
  // "▸&nbsp;&nbsp;" inside the label is a row that does not line up with the rest.
  const folds = SRC.match(/class="side-fold/g) || [];
  assert.strictEqual(folds.length, 2, 'expected both headings to use .side-fold, found ' + folds.length);
  assert.ok(!/side-label">' \+ \(collapsed \? "▸"/.test(SRC), 'an arrow is still being written into a label');
});

t('.side-fold is as wide as the emblem it lines up with', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const fold = (css.match(/\.side-fold \{[^}]*\}/) || [''])[0];
  const mark = (css.match(/\n  \.tmark \{[^}]*\}/) || [''])[0];
  const w = s => (s.match(/width:\s*(\d+)px/) || [])[1];
  assert.ok(fold, 'no .side-fold rule in the stylesheet');
  assert.strictEqual(w(fold), w(mark), '.side-fold is ' + w(fold) + 'px, .tmark is ' + w(mark) + 'px');
});

t('and so is the ＋ on the New workspace row, which is a third thing in that slot', () => {
  // It appears only while a table is being dragged, so it is the one row nobody sees in a
  // screenshot — and the easiest to leave half a character out of line with the rest.
  const css = fs.readFileSync('index.html', 'utf8');
  const plus = (css.match(/\.side-ws-plus \{[^}]*\}/) || [''])[0];
  const mark = (css.match(/\n  \.tmark \{[^}]*\}/) || [''])[0];
  const w = s => (s.match(/width:\s*(\d+)px/) || [])[1];
  assert.ok(plus, 'no .side-ws-plus rule in the stylesheet');
  assert.strictEqual(w(plus), w(mark), '.side-ws-plus is ' + w(plus) + 'px, .tmark is ' + w(mark) + 'px');
});

console.log(n + ' sidebar-group tests passed');
