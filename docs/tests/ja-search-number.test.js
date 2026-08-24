// Searching an applicant by the number printed on their card: "#1945" and "1945" both
// reach applicant 1945. The number is the one thing about a record anyone can read out
// loud over the phone, and the Job Applications search box has always advertised it
// ("Search #123, name, phone, area..."), but filterApps() only ever looked at the name,
// the phone and the area. That local pass runs on every render, including the render
// straight after searchApps() has found the row in the database by seq, so the row was
// found and then dropped again: the number it was found by is in none of those three
// fields. These tests pin the rule that closes that gap, and the exactness of it.
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
// filterApps() reads the search box and three globals it does not own, so the harness
// supplies them: the term, the loaded page of applicants, and the tab you are on.
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  ctx.term = '';
  ctx.document = { getElementById: () => ({ value: ctx.term }) };
  ctx.allApps = [];
  ctx.section = 'new';
  ctx.jobFV = null;
  ctx.passesFilters = () => true;      // the Filter panel is a separate rule, tested elsewhere
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return { API: ctx.API, ctx };
}

const { API: { filterApps }, ctx } = load('index.html', ['filterApps']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const TARGET = { id: 'a', seq: 1945, full_name: 'Layla Haddad', phone: '+962790001111', living_area: 'Amman', status: 'new' };
const OTHER = { id: 'b', seq: 45, full_name: 'Omar Nimri', phone: '+962790002222', living_area: 'Irbid', status: 'new' };
const DECOY = { id: 'c', seq: 12, full_name: 'Rana Odeh', phone: '+962791945333', living_area: 'Zarqa', status: 'new' };

// search(term) with the given page loaded, returning the seq numbers that survive.
// Sorted numerically: the default sort is lexicographic, which puts 1945 before 45.
function search(term, pool) {
  ctx.term = term;
  ctx.allApps = pool || [TARGET, OTHER, DECOY];
  return filterApps().map(a => a.seq).sort((a, b) => a - b);
}

// ---- the number finds the record ----
t('the number with the hash finds the applicant', () => {
  assert.deepStrictEqual(search('#1945'), [1945]);
});
// Nobody types the hash consistently, and the database search already accepts both.
// Pooled without DECOY, whose phone contains 1945 and is the next test's subject.
t('the number without the hash finds the applicant too', () => {
  assert.deepStrictEqual(search('1945', [TARGET, OTHER]), [1945]);
});
// The row the database found by seq is the row that must survive the local pass. Before
// this rule it arrived as a page of one and was filtered back out to nothing.
t('a server search result of one survives the local pass', () => {
  assert.deepStrictEqual(search('#1945', [TARGET]), [1945]);
});
t('the hash is optional on a single-digit number', () => {
  assert.deepStrictEqual(search('#12'), [12]);
});

// ---- exactly the number, not a number containing it ----
// Searching 45 must not drag in 1945, or the number stops being a way to reach one record.
t('the number is matched exactly, not as a substring', () => {
  assert.deepStrictEqual(search('#45'), [45]);
});
// A phone number full of digits is the reason substring matching on the number is wrong:
// 1945 appears inside DECOY's phone, so it still comes along on a bare digit search (that
// is the phone rule doing its job), but the hash form asks for the record number only.
t('the hash form does not match digits inside a phone', () => {
  assert.deepStrictEqual(search('#1945'), [1945]);
});
t('a bare digit search still matches a phone, as it always did', () => {
  assert.deepStrictEqual(search('1945'), [12, 1945]);
});

// ---- the text rules are untouched ----
t('searching a name still works', () => assert.deepStrictEqual(search('layla'), [1945]));
t('searching an area still works', () => assert.deepStrictEqual(search('irbid'), [45]));
t('searching a phone still works', () => assert.deepStrictEqual(search('790002222'), [45]));
t('name matching is still case-insensitive', () => assert.deepStrictEqual(search('HADDAD'), [1945]));
t('an empty search returns the whole page', () => {
  assert.deepStrictEqual(search(''), [12, 45, 1945]);
});
t('a term matching nothing returns nothing', () => assert.deepStrictEqual(search('#99999'), []));
// A lone hash is not a number, so it falls through to the text rule and matches no answer.
t('a lone hash matches nothing', () => assert.deepStrictEqual(search('#'), []));

// ---- what the number search does NOT override ----
// The tab you are on still decides what you can see: searching a number does not reach
// into Approved while you are standing in New. Worth pinning so the day that changes it
// is a decision and not a surprise.
t('the number does not cross the status tabs', () => {
  const approved = Object.assign({}, TARGET, { status: 'approved' });
  assert.deepStrictEqual(search('#1945', [approved]), []);
  ctx.section = 'approved';
  assert.deepStrictEqual(search('#1945', [approved]), [1945]);
  ctx.section = 'new';
});
// The Filter panel is an AND, not an OR: a number is a way to find a record, not a way
// to smuggle it past a filter the user has set.
t('the number still has to pass the filter panel', () => {
  ctx.passesFilters = () => false;
  assert.deepStrictEqual(search('#1945'), []);
  ctx.passesFilters = () => true;
});
// An applicant with no number at all must not answer to a number search. String(null)
// is "null", which no digit term can equal, and this is what proves it.
t('a record with no seq is never matched by a number', () => {
  const noSeq = { id: 'd', seq: null, full_name: 'Sami Tal', phone: '', living_area: '', status: 'new' };
  assert.deepStrictEqual(search('#1945', [noSeq]), []);
  assert.deepStrictEqual(search('1945', [noSeq]), []);
});

if (!process.exitCode) console.log('ok - ' + n + ' tests');
