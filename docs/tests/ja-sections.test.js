// The three tabs on Job Applications — New / Approved / Rejected — and where their rows come
// from. This tests the CALLERS (`loadApps`, `searchApps`, `setSection`) with the database
// stubbed, for the same reason `delete-selected.test.js` does: the helper that filtered the
// tab was never wrong. `filterApps` filtered exactly what it was given. What was wrong was
// what it was given.
//
// The scope is bigger than the page. On 2026-08-30 the live board's scope (2026) held 11,042
// applications and the browser loads the newest `JA_PAGE` of them. All 500 of those were
// status `new`; the 46 approved people sat at positions 729-3811 and the 8 rejected at
// 2668-5114. So Approved read "showing 0 of 46" — the count came from the database and was
// right, the list came from the page and was empty — and it moved around as new applications
// arrived, which is what "sometimes a few of them show" means.
//
// Hence the shape of the fixture below: MORE unreviewed rows than one page can hold, sitting
// NEWER than every reviewed one. A test whose fixture fits in a page cannot fail on this bug.
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
const SRC = scripts('index.html');

// Read the page size out of the page rather than restating it: if someone raises it, the
// fixture has to grow with it or these tests quietly stop covering anything.
const JA_PAGE = Number(/var JA_PAGE = (\d+)/.exec(SRC)[1]);

// ---- the fixture: one scope, far bigger than one page ----
function fixture() {
  const rows = [];
  let t = Date.parse('2026-08-30T12:00:00Z');
  const push = (status, n, name) => {
    for (let i = 0; i < n; i++) {
      rows.push({
        id: status + '-' + i, seq: rows.length + 1,
        full_name: name + ' ' + i, phone: '+9627' + String(9000000 + rows.length),
        living_area: 'Amman', status: status, message_sent: false,
        created_at: new Date(t -= 60000).toISOString()
      });
    }
  };
  push('new', JA_PAGE + 20, 'Unreviewed');   // newest, and more than one page of them
  push('approved', 46, 'Approved person');   // reviewed earlier, so older, so off the page
  push('rejected', 8, 'Rejected person');
  return rows;
}
const COUNTS = { new: JA_PAGE + 20, approved: 46, rejected: 8 };

// A stub database that actually applies the filters, the order and the limit, because the
// bug IS the limit: a stub that answered every query with the rows the test wanted would
// have passed on the broken code.
function makeDb(rows, log) {
  function ilike(v, pat) {
    return String(v == null ? '' : v).toLowerCase().indexOf(pat.replace(/%/g, '').toLowerCase()) !== -1;
  }
  function orMatch(row, expr) {
    return expr.split(',').some(function (part) {
      const m = /^([a-z_]+)\.(ilike|eq)\.(.*)$/.exec(part);
      if (!m) return false;
      return m[2] === 'ilike' ? ilike(row[m[1]], m[3]) : String(row[m[1]]) === m[3];
    });
  }
  return {
    from: function (table) {
      const q = {
        _t: table, _tests: [], _eq: {}, _or: null, _limit: null, _order: null, _upd: null,
        select: function () { return this; },
        update: function (v) { this._upd = v; return this; },
        delete: function () { this._del = true; return this; },
        eq: function (c, v) { this._eq[c] = v; this._tests.push(r => String(r[c]) === String(v)); return this; },
        gte: function (c, v) { this._tests.push(r => String(r[c]) >= String(v)); return this; },
        lt: function (c, v) { this._tests.push(r => String(r[c]) < String(v)); return this; },
        is: function (c, v) { this._tests.push(r => r[c] === v); return this; },
        or: function (s) { this._or = s; this._tests.push(r => orMatch(r, s)); return this; },
        order: function (c, o) { this._order = [c, o]; return this; },
        limit: function (n) { this._limit = n; return this; },
        then: function (res, rej) {
          if (this._upd || this._del) {
            log.push({ op: this._del ? 'delete' : 'update', table: this._t, set: this._upd, id: this._eq.id });
            return Promise.resolve({}).then(res, rej);
          }
          let out = rows.filter(r => this._tests.every(f => f(r)));
          if (this._order) {
            const asc = this._order[1] && this._order[1].ascending;
            out = out.slice().sort((a, b) => (a[this._order[0]] < b[this._order[0]] ? -1 : 1) * (asc ? 1 : -1));
          }
          log.push({ op: 'select', table: this._t, status: this._eq.status, search: this._or, limit: this._limit, got: Math.min(out.length, this._limit || out.length) });
          if (this._limit) out = out.slice(0, this._limit);
          return Promise.resolve({ data: out }).then(res, rej);
        },
        catch: function (f) { return this.then(x => x).catch(f); }
      };
      return q;
    },
    // The tab counts: the real ja_facets_scoped() counts the whole scope in the database,
    // which is why they were right while the list was empty.
    rpc: function (name, args) {
      log.push({ op: 'rpc', name: name, args: args });
      return Promise.resolve({ data: { years: { 2026: rows.length }, countries: {}, statuses: Object.assign({}, COUNTS), total: rows.length, unsent: 46 } });
    }
  };
}

function el() { return { innerHTML: '', textContent: '', value: '', style: {}, classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [] }; }

function rig(opts) {
  opts = opts || {};
  const log = [];
  const rows = fixture();
  const nodes = {};
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    section: opts.section || 'new',
    allApps: [],
    jaScope: { year: 2026, country: null },
    jaFacets: { years: {}, countries: {}, statuses: {}, total: 0, unsent: 0 },
    jaRenderCap: 300,
    jaServerSearch: false,
    JA_PAGE: JA_PAGE,
    JA_RENDER_STEP: 300,
    jobFV: {},
    renderApps() { log.push({ op: 'render' }); },
    renderScopeBar() {},
    buildFilterPanel() {},
    passesFilters: () => true,          // the shared filter engine has its own tests
    alert() {},
    document: { getElementById: id => (nodes[id] || (nodes[id] = el())) },
    window: { console: { error() {} } }
  };
  ctx.window.alert = ctx.alert;
  ctx.db = makeDb(rows, log);
  if (opts.search) ctx.document.getElementById('ja-search').value = opts.search;
  vm.createContext(ctx);
  const names = ['jaScoped', 'loadFacets', 'loadApps', 'searchApps', 'setSection', 'filterApps', 'sectionCounts', 'setStatus'];
  new vm.Script('(function(){' + names.map(n => grab(SRC, n, 'index.html')).join('\n') +
    '\n' + names.map(n => 'this.' + n + ' = ' + n + ';').join('\n') + '}).call(this)').runInContext(ctx);
  return { ctx, log, rows, settle: () => new Promise(r => setTimeout(r, 20)) };
}

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const selects = log => log.filter(e => e.op === 'select');

// ---- the bug ----
t('the Approved tab loads the approved people, not the newest page of whatever', async () => {
  const r = rig({ section: 'approved' });
  await r.ctx.loadApps();
  await r.settle();
  assert.strictEqual(r.ctx.allApps.length, 46,
    'expected all 46 approved rows, got ' + r.ctx.allApps.length +
    ' — the newest page of this scope is entirely unreviewed rows');
  assert.ok(r.ctx.allApps.every(a => a.status === 'approved'), 'a non-approved row came back on the Approved tab');
});

// The exact thing on screen: the count is read from the database and the list from the page,
// so when they disagree the board says "showing 0 of 46" about 46 people who really are there.
t('the list and the tab count agree', async () => {
  const r = rig({ section: 'approved' });
  await r.ctx.loadApps();
  await r.settle();
  assert.strictEqual(r.ctx.filterApps().length, r.ctx.sectionCounts().approved);
});

t('Rejected loads its 8, which sit even deeper in the scope', async () => {
  const r = rig({ section: 'rejected' });
  await r.ctx.loadApps();
  await r.settle();
  assert.strictEqual(r.ctx.filterApps().length, 8);
});

t('New still loads a page of the unreviewed, newest first', async () => {
  const r = rig({ section: 'new' });
  await r.ctx.loadApps();
  await r.settle();
  assert.strictEqual(r.ctx.allApps.length, JA_PAGE, 'New should still be capped at one page');
  assert.ok(r.ctx.allApps.every(a => a.status === 'new'));
  assert.ok(r.ctx.allApps[0].created_at > r.ctx.allApps[1].created_at, 'newest first');
});

// ---- the query itself ----
t('the section is asked for at the database, not filtered out of the page', async () => {
  const r = rig({ section: 'approved' });
  await r.ctx.loadApps();
  await r.settle();
  assert.strictEqual(selects(r.log)[0].status, 'approved');
  assert.strictEqual(selects(r.log)[0].limit, JA_PAGE, 'the page cap has to stay: a scope can hold five figures');
});

t('a search stays inside the tab it was typed in', async () => {
  const r = rig({ section: 'approved' });
  await r.ctx.searchApps('person');
  await r.settle();
  assert.strictEqual(selects(r.log)[0].status, 'approved');
  assert.ok(r.ctx.allApps.length > 0 && r.ctx.allApps.every(a => a.status === 'approved'),
    'searching from Approved returned rows from another tab');
});

// ---- changing tab ----
t('pressing a tab re-reads that tab from the database', async () => {
  const r = rig({ section: 'new' });
  await r.ctx.loadApps();
  await r.settle();
  r.log.length = 0;
  r.ctx.setSection('approved');
  await r.settle();
  assert.strictEqual(r.ctx.section, 'approved');
  assert.ok(selects(r.log).length, 'switching tab only re-rendered the rows already in the page');
  assert.strictEqual(selects(r.log)[0].status, 'approved');
  assert.strictEqual(r.ctx.allApps.length, 46);
});

t('switching tab while searching keeps the search, in the new tab', async () => {
  const r = rig({ section: 'new', search: 'Approved person' });
  r.ctx.setSection('approved');
  await r.settle();
  const s = selects(r.log)[0];
  assert.strictEqual(s.status, 'approved');
  assert.ok(s.search && s.search.indexOf('Approved person') !== -1, 'the typed search was dropped on the tab change');
});

t('a one-character search is not sent to the database', async () => {
  const r = rig({ section: 'approved', search: 'a' });
  r.ctx.setSection('approved');
  await r.settle();
  assert.strictEqual(selects(r.log)[0].search, null);
});

// ---- the counts stay true after a move ----
// Approving somebody moves them between two tabs whose numbers are database counts. Without
// re-reading them, Approved keeps yesterday's number and its own now-shorter list reads as
// "showing 45 of 46" — the same lie as the bug, from the other end.
t('moving somebody between tabs re-reads the counts from the database', async () => {
  const r = rig({ section: 'new' });
  await r.ctx.loadApps();
  await r.settle();
  r.log.length = 0;
  r.ctx.setStatus(r.rows[0], 'approved');
  await r.settle();
  assert.ok(r.log.some(e => e.op === 'update' && e.set.status === 'approved'), 'the status was not saved');
  assert.ok(r.log.some(e => e.op === 'rpc' && e.name === 'ja_facets_scoped'), 'the tab counts were not re-read');
  assert.ok(r.log.some(e => e.op === 'render'), 'the board was not redrawn');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; }
  }
  console.log(n + '/' + tests.length + ' passed');
})();
