// Store Audit scoring (audit/index.html auditScore, auditMissing, auditPayload). The same cases are
// asserted in SQL inside audit-03-score.sql, so the live score on the page and the stored score
// cannot drift apart without one of the two failing.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}
const API = load('audit/index.html', ['auditPoints', 'auditScore', 'auditMissing', 'auditPayload']);

// Copy of the audit-01-catalog-and-stores.sql catalog (codes, domains, weights, tiers). If the
// catalog changes, regenerate this and audit-03's cases together.
const DOMAINS = [{"key": "header", "weight": 0, "scored": false, "position": 0}, {"key": "craft", "weight": 20, "scored": true, "position": 1}, {"key": "station", "weight": 16, "scored": true, "position": 2}, {"key": "safety", "weight": 20, "scored": true, "position": 3}, {"key": "ops", "weight": 14, "scored": true, "position": 4}, {"key": "systems", "weight": 12, "scored": true, "position": 5}, {"key": "orchestra", "weight": 10, "scored": true, "position": 6}, {"key": "brand", "weight": 5, "scored": true, "position": 7}, {"key": "core", "weight": 5, "scored": true, "position": 8}, {"key": "people", "weight": 3, "scored": true, "position": 9}, {"key": "spots", "weight": 0, "scored": false, "position": 10}, {"key": "comp", "weight": 0, "scored": false, "position": 11}, {"key": "cal", "weight": 0, "scored": false, "position": 12}, {"key": "deep", "weight": 0, "scored": false, "position": 13}, {"key": "support", "weight": 0, "scored": false, "position": 14}, {"key": "result", "weight": 0, "scored": false, "position": 15}];
const ITEMS = [{"code": "h_store", "domain": "header", "position": 1, "tier": null, "kind": "branch", "dt": false}, {"code": "h_market", "domain": "header", "position": 2, "tier": null, "kind": "select", "dt": false}, {"code": "h_area_leader", "domain": "header", "position": 3, "tier": null, "kind": "text", "dt": false}, {"code": "h_auditor", "domain": "header", "position": 4, "tier": null, "kind": "select", "dt": false}, {"code": "h_date", "domain": "header", "position": 5, "tier": null, "kind": "date", "dt": false}, {"code": "h_visit_type", "domain": "header", "position": 6, "tier": null, "kind": "select", "dt": false}, {"code": "h_prior", "domain": "header", "position": 7, "tier": null, "kind": "text", "dt": false}, {"code": "c1", "domain": "craft", "position": 1, "tier": "major", "kind": "rating", "dt": false}, {"code": "c2", "domain": "craft", "position": 2, "tier": "major", "kind": "rating", "dt": false}, {"code": "c3", "domain": "craft", "position": 3, "tier": "major", "kind": "rating", "dt": false}, {"code": "c4", "domain": "craft", "position": 4, "tier": "major", "kind": "rating", "dt": false}, {"code": "c5", "domain": "craft", "position": 5, "tier": "major", "kind": "rating", "dt": false}, {"code": "c8", "domain": "craft", "position": 6, "tier": "major", "kind": "rating", "dt": false}, {"code": "c7_drink", "domain": "craft", "position": 7, "tier": null, "kind": "select", "dt": false}, {"code": "c7", "domain": "craft", "position": 8, "tier": "major", "kind": "rating", "dt": false}, {"code": "st1", "domain": "station", "position": 1, "tier": "major", "kind": "rating", "dt": false}, {"code": "st2", "domain": "station", "position": 2, "tier": "major", "kind": "rating", "dt": false}, {"code": "st3", "domain": "station", "position": 3, "tier": "minor", "kind": "rating", "dt": false}, {"code": "st4", "domain": "station", "position": 4, "tier": "major", "kind": "rating", "dt": false}, {"code": "st5", "domain": "station", "position": 5, "tier": "major", "kind": "rating", "dt": false}, {"code": "st6", "domain": "station", "position": 6, "tier": "minor", "kind": "rating", "dt": false}, {"code": "st7", "domain": "station", "position": 7, "tier": "major", "kind": "rating", "dt": true}, {"code": "s1", "domain": "safety", "position": 1, "tier": "critical", "kind": "rating", "dt": false}, {"code": "s1b", "domain": "safety", "position": 2, "tier": null, "kind": "number", "dt": false}, {"code": "s1_set", "domain": "safety", "position": 3, "tier": null, "kind": "number", "dt": false}, {"code": "s1_act", "domain": "safety", "position": 4, "tier": null, "kind": "number", "dt": false}, {"code": "s2", "domain": "safety", "position": 5, "tier": "critical", "kind": "rating", "dt": false}, {"code": "s3", "domain": "safety", "position": 6, "tier": "critical", "kind": "rating", "dt": false}, {"code": "s4", "domain": "safety", "position": 7, "tier": "major", "kind": "rating", "dt": false}, {"code": "s6", "domain": "safety", "position": 8, "tier": "critical", "kind": "rating", "dt": false}, {"code": "s7", "domain": "safety", "position": 9, "tier": "critical", "kind": "rating", "dt": false}, {"code": "o1", "domain": "ops", "position": 1, "tier": "critical", "kind": "rating", "dt": false}, {"code": "o2", "domain": "ops", "position": 2, "tier": "critical", "kind": "rating", "dt": false}, {"code": "o3", "domain": "ops", "position": 3, "tier": "minor", "kind": "rating", "dt": false}, {"code": "o4", "domain": "ops", "position": 4, "tier": "minor", "kind": "rating", "dt": false}, {"code": "o5", "domain": "ops", "position": 5, "tier": "major", "kind": "rating", "dt": false}, {"code": "o6", "domain": "ops", "position": 6, "tier": "critical", "kind": "rating", "dt": false}, {"code": "o7", "domain": "ops", "position": 7, "tier": "major", "kind": "rating", "dt": false}, {"code": "o8", "domain": "ops", "position": 8, "tier": "major", "kind": "yesno", "dt": false}, {"code": "sy1", "domain": "systems", "position": 1, "tier": "major", "kind": "rating", "dt": false}, {"code": "sy2", "domain": "systems", "position": 2, "tier": "major", "kind": "rating", "dt": true}, {"code": "sy2b", "domain": "systems", "position": 3, "tier": "major", "kind": "rating", "dt": true}, {"code": "sy3", "domain": "systems", "position": 4, "tier": "major", "kind": "rating", "dt": false}, {"code": "sy5", "domain": "systems", "position": 5, "tier": "major", "kind": "rating", "dt": false}, {"code": "sy6", "domain": "systems", "position": 6, "tier": "minor", "kind": "rating", "dt": false}, {"code": "sy7", "domain": "systems", "position": 7, "tier": "minor", "kind": "rating", "dt": false}, {"code": "sy8", "domain": "systems", "position": 8, "tier": "major", "kind": "rating", "dt": false}, {"code": "v1", "domain": "orchestra", "position": 1, "tier": "major", "kind": "rating", "dt": false}, {"code": "v2", "domain": "orchestra", "position": 2, "tier": "major", "kind": "rating", "dt": false}, {"code": "v3", "domain": "orchestra", "position": 3, "tier": "major", "kind": "rating", "dt": false}, {"code": "v5", "domain": "orchestra", "position": 4, "tier": "minor", "kind": "rating", "dt": false}, {"code": "v6", "domain": "orchestra", "position": 5, "tier": "minor", "kind": "rating", "dt": false}, {"code": "v7", "domain": "orchestra", "position": 6, "tier": "major", "kind": "rating", "dt": false}, {"code": "v8", "domain": "orchestra", "position": 7, "tier": "major", "kind": "rating", "dt": true}, {"code": "b1", "domain": "brand", "position": 1, "tier": "major", "kind": "rating", "dt": false}, {"code": "b2", "domain": "brand", "position": 2, "tier": "major", "kind": "rating", "dt": false}, {"code": "b3", "domain": "brand", "position": 3, "tier": "minor", "kind": "rating", "dt": false}, {"code": "b4", "domain": "brand", "position": 4, "tier": "major", "kind": "rating", "dt": false}, {"code": "b5", "domain": "brand", "position": 5, "tier": "minor", "kind": "rating", "dt": false}, {"code": "sc1", "domain": "core", "position": 1, "tier": "major", "kind": "rating", "dt": false}, {"code": "sc2", "domain": "core", "position": 2, "tier": "major", "kind": "rating", "dt": false}, {"code": "sc3", "domain": "core", "position": 3, "tier": "major", "kind": "rating", "dt": false}, {"code": "sc4", "domain": "core", "position": 4, "tier": "major", "kind": "rating", "dt": false}, {"code": "sc5", "domain": "core", "position": 5, "tier": "major", "kind": "rating", "dt": false}, {"code": "sc6", "domain": "core", "position": 6, "tier": "major", "kind": "rating", "dt": false}, {"code": "p1", "domain": "people", "position": 1, "tier": "minor", "kind": "rating", "dt": false}, {"code": "p2", "domain": "people", "position": 2, "tier": "minor", "kind": "rating", "dt": false}, {"code": "p3", "domain": "people", "position": 3, "tier": "minor", "kind": "rating", "dt": false}, {"code": "p4", "domain": "people", "position": 4, "tier": "minor", "kind": "rating", "dt": false}, {"code": "spot_toilets", "domain": "spots", "position": 1, "tier": null, "kind": "rating", "dt": false}, {"code": "spot_lockers", "domain": "spots", "position": 2, "tier": null, "kind": "rating", "dt": false}, {"code": "spot_undercash", "domain": "spots", "position": 3, "tier": null, "kind": "rating", "dt": false}, {"code": "spot_trash", "domain": "spots", "position": 4, "tier": null, "kind": "rating", "dt": false}, {"code": "comp_fire", "domain": "comp", "position": 1, "tier": null, "kind": "date", "dt": false}, {"code": "comp_pest", "domain": "comp", "position": 2, "tier": null, "kind": "date", "dt": false}, {"code": "water_softener", "domain": "comp", "position": 3, "tier": null, "kind": "rating", "dt": false}, {"code": "cal1", "domain": "cal", "position": 1, "tier": null, "kind": "number", "dt": false}, {"code": "cal2", "domain": "cal", "position": 2, "tier": null, "kind": "number", "dt": false}, {"code": "cal3", "domain": "cal", "position": 3, "tier": null, "kind": "rating", "dt": false}, {"code": "cal4", "domain": "cal", "position": 4, "tier": null, "kind": "rating", "dt": false}, {"code": "cal5", "domain": "cal", "position": 5, "tier": null, "kind": "rating", "dt": false}, {"code": "cal6", "domain": "cal", "position": 6, "tier": null, "kind": "rating", "dt": false}, {"code": "cal7", "domain": "cal", "position": 7, "tier": null, "kind": "rating", "dt": false}, {"code": "dc1", "domain": "deep", "position": 1, "tier": null, "kind": "rating", "dt": false}, {"code": "dc2", "domain": "deep", "position": 2, "tier": null, "kind": "rating", "dt": false}, {"code": "dc3", "domain": "deep", "position": 3, "tier": null, "kind": "rating", "dt": false}, {"code": "dc4", "domain": "deep", "position": 4, "tier": null, "kind": "rating", "dt": false}, {"code": "dc5", "domain": "deep", "position": 5, "tier": null, "kind": "rating", "dt": false}, {"code": "dc6", "domain": "deep", "position": 6, "tier": null, "kind": "rating", "dt": false}, {"code": "dc7", "domain": "deep", "position": 7, "tier": null, "kind": "rating", "dt": false}, {"code": "sup_fixed", "domain": "support", "position": 1, "tier": null, "kind": "long_text", "dt": false}, {"code": "sup_coached", "domain": "support", "position": 2, "tier": null, "kind": "long_text", "dt": false}, {"code": "sup_trainings", "domain": "support", "position": 3, "tier": null, "kind": "long_text", "dt": false}, {"code": "sup_focus", "domain": "support", "position": 4, "tier": null, "kind": "long_text", "dt": false}, {"code": "sup_qc", "domain": "support", "position": 5, "tier": null, "kind": "yesno", "dt": false}, {"code": "sup_qc_note", "domain": "support", "position": 6, "tier": null, "kind": "long_text", "dt": false}, {"code": "out_score", "domain": "result", "position": 1, "tier": null, "kind": "computed", "dt": false}, {"code": "out_grade", "domain": "result", "position": 2, "tier": null, "kind": "computed", "dt": false}, {"code": "out_flags", "domain": "result", "position": 3, "tier": null, "kind": "computed", "dt": false}, {"code": "out_findings", "domain": "result", "position": 4, "tier": null, "kind": "computed", "dt": false}, {"code": "out_evidence", "domain": "result", "position": 5, "tier": null, "kind": "computed", "dt": false}, {"code": "out_report", "domain": "result", "position": 6, "tier": null, "kind": "computed", "dt": false}];

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const score = a => API.auditScore(a, DOMAINS, ITEMS);
const scoredDomains = new Set(DOMAINS.filter(d => d.scored).map(d => d.key));
const base = {};
ITEMS.forEach(i => { if (scoredDomains.has(i.domain) && (i.kind === 'rating' || i.kind === 'yesno')) base[i.code] = i.kind === 'yesno' ? 'Yes' : 'Pass'; });
Object.assign(base, { spot_toilets: 'Pass', spot_lockers: 'Pass', spot_undercash: 'Pass', spot_trash: 'Pass' });
const w = o => Object.assign({}, base, o);

t('weights total 105 across 9 scored domains', () => {
  assert.strictEqual(DOMAINS.filter(d => d.scored).reduce((s, d) => s + d.weight, 0), 105);
});
t('all pass = 100 Green, no stage 2', () => {
  const r = score(base);
  assert.strictEqual(r.score, 100); assert.strictEqual(r.grade, 'Green');
  assert.strictEqual(r.deep_clean, false); assert.strictEqual(r.calibration, false);
});
t('critical Fail forces Red at 96.8', () => {
  const r = score(w({ s2: 'Fail' }));
  assert.strictEqual(r.score, 96.8); assert.strictEqual(r.grade, 'Red'); assert.deepStrictEqual([...r.critical_fails], ['s2']);
});
t('critical Partial does not force Red', () => {
  const r = score(w({ s2: 'Partial' }));
  assert.strictEqual(r.score, 98.4); assert.strictEqual(r.grade, 'Green');
});
t('Spot Fail caps Green at Amber and opens Deep Clean', () => {
  const r = score(w({ spot_toilets: 'Fail' }));
  assert.strictEqual(r.grade, 'Amber'); assert.strictEqual(r.deep_clean, true);
});
t('3 Partial + 1 Pass Spots (5/8) opens Deep Clean, grade untouched', () => {
  const r = score(w({ spot_toilets: 'Partial', spot_lockers: 'Partial', spot_undercash: 'Partial' }));
  assert.strictEqual(r.spot_pts, 5); assert.strictEqual(r.deep_clean, true); assert.strictEqual(r.grade, 'Green');
});
t('2 Partial + 2 Pass Spots (6/8) does not open Deep Clean', () => {
  const r = score(w({ spot_toilets: 'Partial', spot_lockers: 'Partial' }));
  assert.strictEqual(r.spot_pts, 6); assert.strictEqual(r.deep_clean, false);
});
t('taste test Partial opens Calibration', () => {
  assert.strictEqual(score(w({ c7: 'Partial' })).calibration, true);
  assert.strictEqual(score(w({ c7: 'Fail' })).calibration, true);
});
t('non-DT store, every applicable Systems item Fail = 88.6 Amber', () => {
  const r = score(w({ st7: 'N/A', sy2: 'N/A', sy2b: 'N/A', v8: 'N/A', sy1: 'Fail', sy3: 'Fail', sy5: 'Fail', sy6: 'Fail', sy7: 'Fail', sy8: 'Fail' }));
  assert.strictEqual(r.score, 88.6); assert.strictEqual(r.grade, 'Amber'); assert.strictEqual(r.domains.systems, 0);
});
t('a domain rated all N/A drops out and the rest rescale', () => {
  const r = score(w({ p1: 'N/A', p2: 'N/A', p3: 'N/A', p4: 'N/A', b1: 'Fail' }));
  assert.strictEqual(r.domains.people, null); assert.strictEqual(r.score, 99);
});
t('certificates No scores like a Fail', () => {
  const r = score(w({ o8: 'No' }));
  assert.strictEqual(r.score, 98.3); assert.strictEqual(r.grade, 'Green');
});
t('nothing rated = no score, no grade', () => {
  const r = score({});
  assert.strictEqual(r.score, null); assert.strictEqual(r.grade, null);
});

const header = { h_store: 'Abdoun', h_market: 'Amman', h_auditor: 'Rama', h_date: '2026-09-30', h_visit_type: 'Announced', c7_drink: 'Espresso', water_softener: 'Pass' };
t('complete visit with no evidence owed has nothing missing', () => {
  const a = w(header);
  assert.deepStrictEqual([...API.auditMissing(a, {}, {}, ITEMS, score(a), false).map(m => m.code)], []);
});
t('Partial owes a note; Fail owes a note and a photo', () => {
  const a = w(Object.assign({}, header, { c3: 'Partial', b1: 'Fail' }));
  const m = [...API.auditMissing(a, {}, {}, ITEMS, score(a), false).map(x => x.code + ':' + x.why)];
  assert.deepStrictEqual(m, ['c3:note', 'b1:note', 'b1:photo']);
  assert.strictEqual(API.auditMissing(a, { c3: 'x', b1: 'y' }, { b1: ['p.jpg'] }, ITEMS, score(a), false).length, 0);
});
t('open Calibration makes its items required; closed does not', () => {
  const a = w(Object.assign({}, header, { c7: 'Partial' }));
  const m = API.auditMissing(a, { c7: 'sour' }, {}, ITEMS, score(a), false).map(x => x.code);
  assert.ok(m.includes('cal3') && m.includes('cal7'));
  const b = w(header);
  assert.ok(!API.auditMissing(b, {}, {}, ITEMS, score(b), false).some(x => x.code.startsWith('cal')));
});
t('drive-thru items are not owed on a non-DT store', () => {
  const a = w(header); delete a.st7; delete a.v8;
  assert.ok(!API.auditMissing(a, {}, {}, ITEMS, score(a), true).some(x => x.code === 'st7' || x.code === 'v8'));
  assert.ok(API.auditMissing(a, {}, {}, ITEMS, score(a), false).some(x => x.code === 'st7'));
});
t('payload drops closed stage 2 answers and evidence on items back at Pass', () => {
  const a = w(Object.assign({}, header, { cal3: 'Pass', c3: 'Pass' }));
  const p = API.auditPayload(a, { c3: 'left over' }, { c3: ['old.jpg'] }, ITEMS, score(a));
  assert.strictEqual(p.answers.cal3, undefined);
  assert.strictEqual(p.notes.c3, undefined); assert.strictEqual(p.photos.c3, undefined);
  assert.strictEqual(p.answers.h_prior, undefined);
});

console.log(n + ' passed');
