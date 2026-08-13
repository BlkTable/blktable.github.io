const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

// Pull just the pure helpers out of the page, by name, and run them in isolation.
function grab(name) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
}
function grabVar(name) {
  const re = new RegExp('\\n  var ' + name + ' = \\[[\\s\\S]*?\\];', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
const names = ['periodOf', 'groupByPeriod', 'agoText', 'keyHash', 'tableTint', 'tableGlyph',
  'isGroup', 'pruneConds', 'activeConds', 'isCondActive', 'filterCount', 'passesList', 'passesFilters',
  // isFileField: fvFields excludes upload questions through it, so it has to come along
  'condSlot', 'evalCond', 'valueKind', 'opsFor', 'isFileField', 'fvFields', 'fvFieldById', 'defaultValFor'];
const code = grabVar('TINTS') + grabVar('PERIOD_ORDER') + names.map(grab).join('\n');
const ctx = { console };
vm.createContext(ctx);
new vm.Script('(function(){' + code + '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
const A = ctx.API;

let n = 0;
const assertSame=(a,b)=>assert.strictEqual(JSON.stringify(a),JSON.stringify(b));
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- periodOf / groupByPeriod ----
const DAY = 86400000, now = Date.now();
const iso = d => new Date(now - d).toISOString();
t('today', () => assert.strictEqual(A.periodOf(iso(2 * 3600000)), 'Today'));
t('past 7 days', () => assert.strictEqual(A.periodOf(iso(3 * DAY)), 'Past 7 days'));
t('past 30 days', () => assert.strictEqual(A.periodOf(iso(20 * DAY)), 'Past 30 days'));
t('older', () => assert.strictEqual(A.periodOf(iso(200 * DAY)), 'Older'));
t('never opened', () => assert.strictEqual(A.periodOf(null), 'Not opened yet'));
t('clock skew reads as today', () => assert.strictEqual(A.periodOf(new Date(now + 60000).toISOString()), 'Today'));

const items = [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }, { key: 'c', name: 'C' }, { key: 'd', name: 'D' }];
const lo = { a: iso(1 * 3600000), b: iso(4 * DAY), c: iso(3 * 3600000) };
const g = A.groupByPeriod(items, lo);
t('period order kept', () => assertSame(g.map(x => x.name), ['Today', 'Past 7 days', 'Not opened yet']));
t('newest first inside a period', () => assertSame(g[0].items.map(x => x.key), ['a', 'c']));
t('unopened tables still listed', () => assertSame(g[2].items.map(x => x.key), ['d']));
t('empty input is an empty list', () => assertSame(A.groupByPeriod([], {}), []));
t('null input is an empty list', () => assertSame(A.groupByPeriod(null, {}), []));

t('agoText singular', () => assert.strictEqual(A.agoText(iso(1 * 3600000)), '1 hour ago'));
t('agoText plural', () => assert.strictEqual(A.agoText(iso(3 * DAY)), '3 days ago'));
t('agoText missing', () => assert.strictEqual(A.agoText(null), '—'));

// ---- table identity: colour + glyph ----
t('tint is stable for a key', () => assert.strictEqual(A.tableTint('job_applications'), A.tableTint('job_applications')));
t('tint comes from the palette', () => assert.ok(/^#[0-9a-f]{6}$/i.test(A.tableTint('x'))));
t('config colour wins', () => assert.strictEqual(A.tableTint('x', { color: '#abcdef' }), '#abcdef'));
t('glyph is the first letter', () => assert.strictEqual(A.tableGlyph('Mystery Shopper'), 'M'));
t('glyph skips punctuation', () => assert.strictEqual(A.tableGlyph('  (draft) qc'), 'D'));
t('glyph keeps an Arabic name', () => assert.strictEqual(A.tableGlyph('شهادة صحية'), 'ش'));
t('glyph falls back', () => assert.strictEqual(A.tableGlyph(''), '?'));
t('config icon wins', () => assert.strictEqual(A.tableGlyph('QC', { icon: 'X' }), 'X'));

// ---- filter engine: condition groups ----
const FIELDS = [{ id: 'branch', label: 'Branch', type: 'short_text' }, { id: 'score', label: 'Score', type: 'number' }];
const fv = { getFields: () => FIELDS, getVal: (r, id) => r[id], state: null };
const leaf = (id, op, val) => ({ fieldId: id, op: op, val: val });

fv.state = { conj: 'and', conds: [leaf('branch', 'is', 'Abdoun')] };
t('a flat filter still works', () => {
  assert.strictEqual(A.passesFilters(fv, { branch: 'Abdoun' }), true);
  assert.strictEqual(A.passesFilters(fv, { branch: 'Zarqa' }), false);
});

// score > 80 AND (branch is Abdoun OR branch is Zarqa)
fv.state = { conj: 'and', conds: [leaf('score', 'gt', 80),
  { group: true, conj: 'or', conds: [leaf('branch', 'is', 'Abdoun'), leaf('branch', 'is', 'Zarqa')] }] };
t('a group ORs inside an AND', () => {
  assert.strictEqual(A.passesFilters(fv, { score: 90, branch: 'Abdoun' }), true);
  assert.strictEqual(A.passesFilters(fv, { score: 90, branch: 'Zarqa' }), true);
  assert.strictEqual(A.passesFilters(fv, { score: 90, branch: 'Irbid' }), false);
  assert.strictEqual(A.passesFilters(fv, { score: 70, branch: 'Abdoun' }), false);
});
t('leaves are counted, not groups', () => assert.strictEqual(A.filterCount(fv), 3));

fv.state = { conj: 'and', conds: [{ group: true, conj: 'or', conds: [leaf('branch', 'is', '')] }] };
t('a group with no value filters nothing', () => {
  assert.strictEqual(A.passesFilters(fv, { branch: 'anything' }), true);
  assert.strictEqual(A.filterCount(fv), 0);
});

fv.state = { conj: 'and', conds: [{ group: true, conj: 'and', conds: [
  leaf('score', 'gte', 50), { group: true, conj: 'or', conds: [leaf('branch', 'is', 'A'), leaf('branch', 'is', 'B')] }] }] };
t('groups nest', () => {
  assert.strictEqual(A.passesFilters(fv, { score: 60, branch: 'B' }), true);
  assert.strictEqual(A.passesFilters(fv, { score: 60, branch: 'C' }), false);
  assert.strictEqual(A.passesFilters(fv, { score: 40, branch: 'B' }), false);
});

// pruneConds drops dead fields and the groups they empty
const conds = [leaf('gone', 'is', 'x'), { group: true, conj: 'or', conds: [leaf('gone', 'is', 'y')] },
  { group: true, conj: 'or', conds: [leaf('branch', 'is', 'A'), leaf('gone', 'is', 'z')] }];
const out = A.pruneConds(fv, conds);
t('a condition on a deleted field is dropped', () => assert.strictEqual(out.length, 1));
t('a group emptied by pruning is dropped', () => assert.strictEqual(out[0].group, true));
t('a surviving group keeps only live leaves', () => assertSame(out[0].conds.map(c => c.fieldId), ['branch']));

// condSlot addresses a nested condition by path
fv.state = { conj: 'and', conds: [leaf('score', 'gt', 1),
  { group: true, conj: 'or', conds: [leaf('branch', 'is', 'A'), leaf('branch', 'is', 'B')] }] };
t('top-level path', () => assert.strictEqual(A.condSlot(fv, '0').list[0].fieldId, 'score'));
const s = A.condSlot(fv, '1.1');
t('nested path finds the leaf', () => assert.strictEqual(s.list[s.i].val, 'B'));
t('nested path owner is the group', () => assert.strictEqual(s.owner.conj, 'or'));
t('a path into a non-group is refused', () => assert.strictEqual(A.condSlot(fv, '0.0'), null));

console.log(n + ' tests passed');
